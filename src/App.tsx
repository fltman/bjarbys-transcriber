import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Cpu,
  Download,
  FileAudio,
  Mic,
  Podcast,
  ShieldCheck,
  Sliders,
  Sparkles,
  Zap,
} from "lucide-react";
import { decodeToPCM } from "./lib/audio";
import {
  type Backend,
  type Family,
  FAMILY_DEFAULT_MODEL,
  FAMILY_META,
  availableTiers,
  defaultDtype,
  familyOf,
  findModel,
  formatSize,
  isEnglishOnly,
  tierFor,
} from "./lib/models";
import { type Settings } from "./lib/settings";
import { ACTIVE_STATUSES, type Job, type JobInput, makeJob } from "./lib/jobs";
import {
  type ExportFormat,
  extFor,
  render,
  withExtension,
  downloadText,
} from "./lib/exporters";
import {
  DEFAULT_PROXY,
  type Episode,
  type Podcast as PodcastShow,
  fetchEpisodeAudio,
} from "./lib/podcasts";
import type { TranscriptResult } from "./lib/protocol";
import { useWhisper } from "./hooks/useWhisper";
import { LanguageChooser } from "./components/LanguageChooser";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { Dropzone } from "./components/Dropzone";
import { Recorder } from "./components/Recorder";
import { PodcastPanel } from "./components/PodcastPanel";
import { JobQueue } from "./components/JobQueue";
import { ProcessingHero } from "./components/Processing";
import { Card } from "./components/ui";

type Tab = "files" | "mic" | "podcast";

const TABS: { id: Tab; label: string; icon: typeof FileAudio }[] = [
  { id: "files", label: "Files", icon: FileAudio },
  { id: "mic", label: "Record", icon: Mic },
  { id: "podcast", label: "Podcast", icon: Podcast },
];

export default function App() {
  const { state, loadModel, transcribe } = useWhisper();

  const [settings, setSettings] = useState<Settings>({
    modelId: "KBLab/kb-whisper-base",
    dtype: "q8",
    deviceMode: "auto",
    language: "sv",
    task: "transcribe",
    exportFormat: "txt",
    autoDownload: true,
  });
  const proxyBase = DEFAULT_PROXY;

  const [tab, setTab] = useState<Tab>("files");
  const [showSettings, setShowSettings] = useState(false);
  const [webgpuAvailable, setWebgpuAvailable] = useState(false);

  const [jobs, setJobs] = useState<Job[]>([]);
  const jobsRef = useRef<Job[]>([]);
  const drainingRef = useRef(false);

  // ── WebGPU detection ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const gpu = (
          navigator as unknown as {
            gpu?: { requestAdapter: () => Promise<unknown> };
          }
        ).gpu;
        const ok = !!gpu && !!(await gpu.requestAdapter());
        if (!cancelled) setWebgpuAvailable(ok);
      } catch {
        if (!cancelled) setWebgpuAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedDevice: Backend = useMemo(
    () =>
      settings.deviceMode === "auto"
        ? webgpuAvailable
          ? "webgpu"
          : "wasm"
        : settings.deviceMode,
    [settings.deviceMode, webgpuAvailable],
  );

  const patchSettings = useCallback(
    (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })),
    [],
  );

  // Keep the quantization valid for the chosen model + backend.
  useEffect(() => {
    const model = findModel(settings.modelId)!;
    const tiers = availableTiers(model, resolvedDevice);
    if (!tiers.some((t) => t.dtype === settings.dtype)) {
      patchSettings({ dtype: defaultDtype(model, resolvedDevice) });
    }
  }, [settings.modelId, settings.dtype, resolvedDevice, patchSettings]);

  const family = familyOf(settings.modelId);
  const setFamily = useCallback(
    (f: Family) => {
      patchSettings({
        modelId: FAMILY_DEFAULT_MODEL[f],
        language: f === "swedish" ? "sv" : null,
      });
    },
    [patchSettings],
  );

  const model = findModel(settings.modelId)!;
  const currentTier =
    tierFor(model, settings.dtype) ??
    availableTiers(model, resolvedDevice)[0] ??
    model.tiers[0];
  // Track the exact (model, dtype, device) we last asked the worker to load, so
  // changing quality or backend in Settings correctly triggers a reload. We
  // compare against the *requested* key (not the post-fallback actual device),
  // which avoids a reload loop when WebGPU silently falls back to WASM.
  const loadedReqKey = useRef("");
  const desiredKey = `${settings.modelId}|${settings.dtype}|${resolvedDevice}`;
  const loadedForModel =
    state.status === "ready" && loadedReqKey.current === desiredKey;

  // ── Job list helpers ──────────────────────────────────────────────────────
  const commit = useCallback((next: Job[]) => {
    jobsRef.current = next;
    setJobs(next);
  }, []);
  const updateJob = useCallback(
    (id: string, patch: Partial<Job>) =>
      commit(jobsRef.current.map((j) => (j.id === id ? { ...j, ...patch } : j))),
    [commit],
  );
  const addJobs = useCallback(
    (inputs: JobInput[]) => commit([...jobsRef.current, ...inputs.map(makeJob)]),
    [commit],
  );

  const downloadJob = useCallback(
    (job: Job, result: TranscriptResult, format: ExportFormat) => {
      downloadText(
        withExtension(job.downloadName, extFor(format)),
        render(result, format),
        format,
      );
    },
    [],
  );

  // ── Sequential queue runner ───────────────────────────────────────────────
  const runJob = useCallback(
    async (job: Job) => {
      try {
        updateJob(job.id, {
          status: job.source === "podcast" ? "fetching" : "decoding",
          error: null,
          stageProgress: 0,
        });
        const audio = await job.getAudio((p) =>
          updateJob(job.id, { stageProgress: p }),
        );

        updateJob(job.id, { status: "transcribing" });
        const loadedId = state.modelId ?? settings.modelId;
        const englishOnly = isEnglishOnly(loadedId);
        const result = await transcribe(job.id, audio, {
          language: englishOnly ? null : settings.language,
          task: englishOnly ? "transcribe" : settings.task,
        });

        updateJob(job.id, { status: "done", result });
        if (settings.autoDownload)
          downloadJob(job, result, settings.exportFormat);
      } catch (e) {
        updateJob(job.id, {
          status: "error",
          error: String((e as Error)?.message ?? e),
        });
      }
    },
    [
      updateJob,
      transcribe,
      downloadJob,
      state.modelId,
      settings.modelId,
      settings.language,
      settings.task,
      settings.autoDownload,
      settings.exportFormat,
    ],
  );

  const drain = useCallback(async () => {
    if (drainingRef.current || !loadedForModel) return;
    drainingRef.current = true;
    try {
      for (;;) {
        const next = jobsRef.current.find((j) => j.status === "queued");
        if (!next) break;
        await runJob(next);
      }
    } finally {
      drainingRef.current = false;
    }
  }, [loadedForModel, runJob]);

  useEffect(() => {
    void drain();
  }, [jobs, loadedForModel, drain]);

  // ── Model loading (manual + auto when work arrives) ───────────────────────
  const handleLoad = useCallback(() => {
    loadedReqKey.current = `${settings.modelId}|${settings.dtype}|${resolvedDevice}`;
    loadModel(settings.modelId, settings.dtype, resolvedDevice).catch(() => {});
  }, [loadModel, settings.modelId, settings.dtype, resolvedDevice]);

  useEffect(() => {
    const hasQueued = jobs.some((j) => j.status === "queued");
    if (!hasQueued) return;
    if (state.status === "loading" || state.status === "error") return;
    if (loadedForModel) return;
    handleLoad();
  }, [jobs, state.status, loadedForModel, handleLoad]);

  // ── Source → queue wiring ─────────────────────────────────────────────────
  const onFiles = useCallback(
    (files: File[]) =>
      addJobs(
        files.map((f) => ({
          label: f.name,
          source: "file" as const,
          downloadName: f.name,
          getAudio: () => decodeToPCM(f),
        })),
      ),
    [addJobs],
  );

  const onRecorded = useCallback(
    (blob: Blob, label: string) =>
      addJobs([
        {
          label,
          source: "mic",
          downloadName: label,
          getAudio: () => decodeToPCM(blob),
        },
      ]),
    [addJobs],
  );

  const onEnqueueEpisodes = useCallback(
    (show: PodcastShow, episodes: Episode[]) => {
      addJobs(
        episodes.map((ep) => ({
          label: ep.title,
          source: "podcast" as const,
          downloadName: `${show.title} - ${ep.title}`,
          getAudio: async (onProgress) => {
            const blob = await fetchEpisodeAudio(ep, proxyBase, (l, t) =>
              onProgress?.(t ? l / t : 0),
            );
            return decodeToPCM(blob);
          },
        })),
      );
      setTab("files");
    },
    [addJobs, proxyBase],
  );

  // ── Queue actions ─────────────────────────────────────────────────────────
  const onRemove = useCallback(
    (job: Job) => commit(jobsRef.current.filter((j) => j.id !== job.id)),
    [commit],
  );
  const onClearCompleted = useCallback(
    () => commit(jobsRef.current.filter((j) => j.status !== "done")),
    [commit],
  );
  const onManualDownload = useCallback(
    (job: Job) => {
      if (job.result) downloadJob(job, job.result, settings.exportFormat);
    },
    [downloadJob, settings.exportFormat],
  );

  const activeJob = jobs.find((j) => ACTIVE_STATUSES.includes(j.status)) ?? null;
  const processed = jobs.filter(
    (j) => j.status === "done" || j.status === "error",
  ).length;
  const busy = state.status === "loading" || !!activeJob;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      {/* Header */}
      <header className="mb-8 text-center">
        <div className="mb-3 flex items-center justify-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-400 text-white shadow-lg shadow-sky-500/20">
            <FileAudio className="size-7" />
          </div>
          <h1 className="bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">
            Bjarbys Transcriber
          </h1>
        </div>
        <p className="mx-auto max-w-md text-base text-slate-400">
          Turn talking into text — privately, right in your browser.{" "}
          <span className="whitespace-nowrap">Nothing is uploaded ✨</span>
        </p>
        <div className="mt-4 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/20">
            <ShieldCheck className="size-4" />
            100% on your device
          </span>
        </div>
      </header>

      {/* Step 1 — language */}
      <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
        What language is it in?
      </p>
      <LanguageChooser
        value={family}
        onChange={setFamily}
        disabled={state.status === "loading"}
      />

      {/* Step 2 — source tabs */}
      <div className="mt-6 grid grid-cols-3 gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${
                active
                  ? "bg-sky-500 text-white shadow-lg shadow-sky-500/20"
                  : "bg-[var(--color-surface)]/60 text-slate-300 ring-1 ring-inset ring-[var(--color-border)] hover:bg-white/[0.04]"
              }`}
            >
              <Icon className="size-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Source area */}
      <div className="mt-3">
        {tab === "files" && <Dropzone onFiles={onFiles} />}
        {tab === "mic" && (
          <Card className="p-4">
            <Recorder onRecorded={onRecorded} />
          </Card>
        )}
        {tab === "podcast" && (
          <Card className="p-5">
            <PodcastPanel proxyBase={proxyBase} onEnqueue={onEnqueueEpisodes} />
          </Card>
        )}
      </div>

      {/* Model status + settings toggle */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className="text-base">{FAMILY_META[family].emoji}</span>
          <span className="font-medium text-slate-200">{model.name}</span>
          <span className="text-slate-600">·</span>
          {state.status === "loading" ? (
            <span className="text-sky-300">
              loading {Math.round(state.overall * 100)}%
            </span>
          ) : loadedForModel ? (
            <span className="inline-flex items-center gap-1 text-emerald-300">
              {state.device === "webgpu" ? (
                <Zap className="size-3.5" />
              ) : (
                <Cpu className="size-3.5" />
              )}
              ready
            </span>
          ) : (
            <span>{formatSize(currentTier.sizeMB)} · loads on first file</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
        >
          <Sliders className="size-4" />
          Settings
          <ChevronDown
            className={`size-4 transition ${showSettings ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* Optional: pre-load button when idle */}
      {!loadedForModel && state.status !== "loading" && (
        <button
          type="button"
          onClick={handleLoad}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/40 px-4 py-2 text-sm text-slate-300 transition hover:border-sky-400/30 hover:text-white"
        >
          <Download className="size-4" />
          Pre-download {model.name} ({formatSize(currentTier.sizeMB)})
        </button>
      )}

      {/* Advanced settings drawer */}
      {showSettings && (
        <Card className="mt-3 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-300">
            <Sparkles className="size-4 text-sky-300" /> Fine-tune
          </div>
          <AdvancedSettings
            settings={settings}
            onChange={patchSettings}
            resolvedDevice={resolvedDevice}
            webgpuAvailable={webgpuAvailable}
            disabled={state.status === "loading"}
          />
          {state.status === "ready" && !loadedForModel && (
            <button
              type="button"
              onClick={handleLoad}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
            >
              <Download className="size-4" /> Apply &amp; reload model
            </button>
          )}
          {state.status === "error" && state.error && (
            <p className="mt-3 text-sm text-red-300">{state.error}</p>
          )}
        </Card>
      )}

      {/* Processing + queue */}
      {busy && (
        <div className="mt-5">
          <ProcessingHero
            state={state}
            activeJob={activeJob}
            done={processed}
            total={jobs.length}
          />
        </div>
      )}

      <div className="mt-5">
        <JobQueue
          jobs={jobs}
          onDownload={onManualDownload}
          onRemove={onRemove}
          onClearCompleted={onClearCompleted}
        />
      </div>

      <footer className="mt-12 border-t border-[var(--color-border)] pt-6 text-center text-xs text-slate-500">
        <p>
          Made by{" "}
          <span className="font-medium text-slate-300">Anders Bjarby</span> ·{" "}
          <a
            href="https://github.com/fltman/bjarbys-transcriber"
            className="text-slate-400 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Source on GitHub
          </a>
        </p>
        <p className="mt-2">
          Powered by{" "}
          <a
            href="https://github.com/huggingface/transformers.js"
            className="text-slate-400 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Transformers.js
          </a>{" "}
          ·{" "}
          <a
            href="https://huggingface.co/KBLab"
            className="text-slate-400 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            KB-Whisper
          </a>{" "}
          · models download once and cache in your browser.
        </p>
      </footer>
    </div>
  );
}
