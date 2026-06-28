// Message protocol between the UI thread and the Whisper Web Worker.
import type { Backend, Dtype } from "./models";

export interface TranscriptChunk {
  text: string;
  timestamp: [number, number | null];
}

export interface TranscriptResult {
  text: string;
  chunks: TranscriptChunk[];
}

// ── UI → Worker ────────────────────────────────────────────────────────────
export type ToWorker =
  | {
      type: "load";
      modelId: string;
      dtype: Dtype;
      device: Backend;
    }
  | {
      type: "transcribe";
      jobId: string;
      audio: Float32Array;
      /** ISO language code (e.g. "sv") or null to auto-detect. */
      language: string | null;
      task: "transcribe" | "translate";
    };

// ── Worker → UI ────────────────────────────────────────────────────────────
/** A raw onnxruntime/transformers download-progress event. */
export interface FileProgress {
  status: "initiate" | "download" | "progress" | "done";
  name?: string;
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
}

export type FromWorker =
  | { type: "download"; data: FileProgress }
  | {
      type: "ready";
      modelId: string;
      dtype: Dtype;
      device: Backend;
    }
  | {
      // The worker may downgrade webgpu → wasm if the GPU fails to initialise.
      type: "device-fallback";
      from: Backend;
      to: Backend;
      reason: string;
    }
  | { type: "transcribe-start"; jobId: string }
  | { type: "result"; jobId: string; result: TranscriptResult }
  | { type: "error"; jobId?: string; message: string };
