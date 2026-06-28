import type { TranscriptResult } from "./protocol";

export type JobSource = "file" | "mic" | "podcast";

export type JobStatus =
  | "queued"
  | "fetching"
  | "decoding"
  | "transcribing"
  | "done"
  | "error";

export interface Job {
  id: string;
  label: string;
  source: JobSource;
  status: JobStatus;
  /** 0..1 progress for the fetch/decode stage. */
  stageProgress: number;
  result: TranscriptResult | null;
  error: string | null;
  /** Base filename used when exporting (without extension is fine). */
  downloadName: string;
  /** Lazily acquire + decode this job's audio to mono 16 kHz PCM. */
  getAudio: (onProgress?: (p: number) => void) => Promise<Float32Array>;
}

export interface JobInput {
  label: string;
  source: JobSource;
  downloadName: string;
  getAudio: (onProgress?: (p: number) => void) => Promise<Float32Array>;
}

let counter = 0;
export function makeJob(input: JobInput): Job {
  counter += 1;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `job-${counter}`;
  return {
    id,
    label: input.label,
    source: input.source,
    status: "queued",
    stageProgress: 0,
    result: null,
    error: null,
    downloadName: input.downloadName,
    getAudio: input.getAudio,
  };
}

export const ACTIVE_STATUSES: JobStatus[] = [
  "fetching",
  "decoding",
  "transcribing",
];
