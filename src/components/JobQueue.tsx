import { useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FileAudio,
  Mic,
  Podcast,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Job, JobSource } from "../lib/jobs";
import { Badge, ProgressBar, Spinner } from "./ui";

const SOURCE_ICON: Record<JobSource, typeof FileAudio> = {
  file: FileAudio,
  mic: Mic,
  podcast: Podcast,
};

function StatusCell({ job }: { job: Job }) {
  switch (job.status) {
    case "queued":
      return <Badge tone="neutral">Queued</Badge>;
    case "fetching":
      return (
        <div className="w-40">
          <ProgressBar value={job.stageProgress} />
          <span className="mt-1 block text-xs text-slate-400">
            Downloading… {Math.round(job.stageProgress * 100)}%
          </span>
        </div>
      );
    case "decoding":
      return (
        <Badge tone="brand">
          <Spinner className="size-3" /> Decoding
        </Badge>
      );
    case "transcribing":
      return (
        <Badge tone="brand">
          <Spinner className="size-3" /> Transcribing
        </Badge>
      );
    case "done":
      return (
        <Badge tone="green">
          <Check className="size-3" /> Done
        </Badge>
      );
    case "error":
      return (
        <Badge tone="red">
          <TriangleAlert className="size-3" /> Failed
        </Badge>
      );
  }
}

export function JobQueue({
  jobs,
  onDownload,
  onRemove,
  onClearCompleted,
}: {
  jobs: Job[];
  onDownload: (job: Job) => void;
  onRemove: (job: Job) => void;
  onClearCompleted: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  if (jobs.length === 0) return null;

  const doneCount = jobs.filter((j) => j.status === "done").length;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function copy(job: Job) {
    if (!job.result) return;
    await navigator.clipboard.writeText(job.result.text.trim());
    setCopied(job.id);
    window.setTimeout(() => setCopied((c) => (c === job.id ? null : c)), 1500);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Queue · {jobs.length}
        </h2>
        {doneCount > 0 && (
          <button
            type="button"
            onClick={onClearCompleted}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          >
            <Trash2 className="size-3.5" /> Clear completed
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {jobs.map((job) => {
          const Icon = SOURCE_ICON[job.source];
          const open = expanded.has(job.id);
          return (
            <li
              key={job.id}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/60"
            >
              <div className="flex items-center gap-3 p-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-slate-300">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {job.label}
                  </p>
                  {job.status === "error" && job.error && (
                    <p className="truncate text-xs text-red-300">{job.error}</p>
                  )}
                  {job.status === "done" && job.result && (
                    <p className="truncate text-xs text-slate-500">
                      {job.result.text.trim().slice(0, 80) || "(no speech detected)"}
                    </p>
                  )}
                </div>

                <StatusCell job={job} />

                <div className="flex shrink-0 items-center gap-1">
                  {job.status === "done" && (
                    <>
                      <button
                        type="button"
                        title="Show transcript"
                        onClick={() => toggle(job.id)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-slate-200"
                      >
                        <ChevronDown
                          className={`size-4 transition ${open ? "rotate-180" : ""}`}
                        />
                      </button>
                      <button
                        type="button"
                        title="Download transcript"
                        onClick={() => onDownload(job)}
                        className="rounded-lg p-2 text-sky-300 hover:bg-sky-400/10"
                      >
                        <Download className="size-4" />
                      </button>
                    </>
                  )}
                  {(job.status === "done" ||
                    job.status === "error" ||
                    job.status === "queued") && (
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => onRemove(job)}
                      className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-slate-300"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              </div>

              {open && job.result && (
                <div className="border-t border-[var(--color-border)] p-3">
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => copy(job)}
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-white/5"
                    >
                      {copied === job.id ? (
                        <>
                          <Check className="size-3.5" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <p className="max-h-60 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-200 scroll-thin">
                    {job.result.text.trim() || "(no speech detected)"}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
