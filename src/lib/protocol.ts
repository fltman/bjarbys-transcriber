// Message protocol between the UI thread and the Whisper Web Worker.
import type { Backend, Dtype } from "./models";

export interface TranscriptChunk {
  text: string;
  timestamp: [number, number | null];
  /**
   * 1-based speaker index. Null when speaker separation ran but detected no
   * speech in this chunk; absent entirely when it wasn't run.
   */
  speaker?: number | null;
  /**
   * 0..1 confidence in the `speaker` attribution — the margin between the
   * top two speakers' active time in this chunk. Low values mean overlapping
   * or ambiguous speech, not necessarily a wrong answer.
   */
  speaker_conf?: number;
}

export interface TranscriptResult {
  text: string;
  chunks: TranscriptChunk[];
}

/**
 * A span during which one speaker is active. Spans belonging to *different*
 * speakers may overlap in time — that's how simultaneous speech is
 * represented, and distinguishing it from a third speaker is the whole point.
 */
export interface SpeakerActivity {
  /** Speaker index, namespaced across diarization windows. */
  speaker: number;
  start: number;
  end: number;
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
      /**
       * Keep the audio in the worker for a `diarize` on the same job.
       *
       * Transferring detaches the buffer, so without this the caller has to
       * hold a second full copy of the PCM to diarize afterwards — for an
       * hour of speech that is a redundant ~230 MB.
       */
      retainAudio?: boolean;
    }
  | {
      // Uses the audio retained by the preceding `transcribe` for this job.
      type: "diarize";
      jobId: string;
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
  | { type: "diarize-progress"; jobId: string; progress: number }
  | { type: "diarize-result"; jobId: string; activity: SpeakerActivity[] }
  | { type: "error"; jobId?: string; message: string };
