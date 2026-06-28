import { Cpu, Loader2, Zap } from "lucide-react";
import type { Job } from "../lib/jobs";
import type { ModelState } from "../hooks/useWhisper";

/** Animated equalizer bars. */
export function WaveBars({
  count = 5,
  className = "",
  active = true,
}: {
  count?: number;
  className?: string;
  active?: boolean;
}) {
  const delays = [0, 0.18, 0.36, 0.12, 0.28, 0.42, 0.06];
  return (
    <div className={`flex items-end gap-[3px] ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full bg-gradient-to-t from-sky-500 to-cyan-300 ${
            active ? "eq-bar" : ""
          }`}
          style={{
            height: "100%",
            animationDelay: `${delays[i % delays.length]}s`,
            opacity: active ? 1 : 0.35,
          }}
        />
      ))}
    </div>
  );
}

/** Circular gradient progress ring with a percentage label. */
export function ProgressRing({
  value,
  size = 116,
  stroke = 9,
  indeterminate = false,
  label,
}: {
  value: number; // 0..1
  size?: number;
  stroke?: number;
  indeterminate?: boolean;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  const dash = indeterminate ? c * 0.25 : c * pct;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className={indeterminate ? "spin-slow" : ""}
        style={{ transform: indeterminate ? undefined : "rotate(-90deg)" }}
      >
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-surface-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          style={{ transition: indeterminate ? undefined : "stroke-dasharray 0.3s" }}
        />
      </svg>
      {!indeterminate && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-slate-100">
            {Math.round(pct * 100)}
            <span className="text-sm text-slate-400">%</span>
          </span>
          {label && (
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const STAGE_TEXT: Record<string, string> = {
  fetching: "Downloading episode",
  decoding: "Decoding audio",
  transcribing: "Transcribing speech",
};

/**
 * The "now processing" hero. Shows model-download progress while loading, then
 * a live equalizer + queue progress while jobs run.
 */
export function ProcessingHero({
  state,
  activeJob,
  done,
  total,
}: {
  state: ModelState;
  activeJob: Job | null;
  done: number;
  total: number;
}) {
  const loading = state.status === "loading";
  const hasWork = loading || !!activeJob;
  if (!hasWork) return null;

  const queuePct = total > 0 ? done / total : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-sky-400/20 bg-gradient-to-br from-sky-500/[0.07] to-cyan-400/[0.04] p-5">
      <div className="flex items-center gap-5">
        {loading ? (
          <ProgressRing value={state.overall} label="download" />
        ) : (
          <ProgressRing
            value={0}
            indeterminate
            label=""
          />
        )}

        <div className="min-w-0 flex-1">
          {loading ? (
            <>
              <p className="flex items-center gap-2 text-base font-semibold text-slate-100">
                <Loader2 className="size-4 animate-spin text-sky-300" />
                Downloading model
              </p>
              <p className="mt-1 truncate text-sm text-slate-400">
                {Math.round(state.overall * 100)}% · cached in your browser after
                the first time
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                {state.device === "webgpu" ? (
                  <Zap className="size-3.5 text-sky-300" />
                ) : (
                  <Cpu className="size-3.5" />
                )}
                Preparing {state.device === "webgpu" ? "GPU" : "CPU"} runtime
              </div>
            </>
          ) : activeJob ? (
            <>
              <div className="flex items-center gap-3">
                <WaveBars className="h-7 w-14" />
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-slate-100">
                    {STAGE_TEXT[activeJob.status] ?? "Working"}
                  </p>
                  <p className="truncate text-sm text-slate-400">
                    {activeJob.label}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-xs text-slate-400">
                  <span>Queue progress</span>
                  <span className="tabular-nums">
                    {done} / {total} done
                  </span>
                </div>
                <div className="shimmer-track h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-300 transition-[width] duration-300"
                    style={{ width: `${queuePct * 100}%` }}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
