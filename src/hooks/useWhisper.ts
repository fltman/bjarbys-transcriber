import { useCallback, useEffect, useRef, useState } from "react";
import type { Backend, Dtype } from "../lib/models";
import type {
  FromWorker,
  SpeakerActivity,
  TranscriptResult,
} from "../lib/protocol";

export type ModelStatus = "idle" | "loading" | "ready" | "error";

export interface DownloadFile {
  loaded: number;
  total: number;
  progress: number;
}

export interface ModelState {
  status: ModelStatus;
  error: string | null;
  /** Backend actually in use (may differ from requested after a fallback). */
  device: Backend | null;
  requestedDevice: Backend | null;
  modelId: string | null;
  dtype: Dtype | null;
  files: Record<string, DownloadFile>;
  /** Aggregate download progress, 0..1. */
  overall: number;
  fellBackToWasm: boolean;
}

const INITIAL: ModelState = {
  status: "idle",
  error: null,
  device: null,
  requestedDevice: null,
  modelId: null,
  dtype: null,
  files: {},
  overall: 0,
  fellBackToWasm: false,
};

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  onProgress?: (progress: number) => void;
}

export function useWhisper() {
  const workerRef = useRef<Worker | null>(null);
  const jobs = useRef(new Map<string, Pending<TranscriptResult>>());
  const diarizeJobs = useRef(new Map<string, Pending<SpeakerActivity[]>>());
  const load = useRef<Pending<void> | null>(null);
  const [state, setState] = useState<ModelState>(INITIAL);

  useEffect(() => {
    const worker = new Worker(new URL("../worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<FromWorker>) => handle(e.data);
    worker.onerror = (e) => {
      setState((p) => ({
        status: "error",
        error: e.message || "Worker crashed.",
        device: p.device,
        requestedDevice: p.requestedDevice,
        modelId: p.modelId,
        dtype: p.dtype,
        files: p.files,
        overall: p.overall,
        fellBackToWasm: p.fellBackToWasm,
      }));
      load.current?.reject(new Error(e.message || "Worker crashed."));
      load.current = null;
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handle(msg: FromWorker) {
    switch (msg.type) {
      case "download": {
        const f = msg.data;
        const name = f.file ?? f.name ?? "model";
        setState((prev) => {
          const files = { ...prev.files };
          const prevFile = files[name];
          const total = f.total ?? prevFile?.total ?? 0;
          const loaded =
            f.status === "done"
              ? total || prevFile?.loaded || 0
              : f.loaded ?? prevFile?.loaded ?? 0;
          files[name] = {
            loaded,
            total,
            progress: f.progress ?? (total ? (loaded / total) * 100 : 0),
          };
          const sums = Object.values(files).reduce(
            (a, x) => ({ l: a.l + x.loaded, t: a.t + x.total }),
            { l: 0, t: 0 },
          );
          return { ...prev, files, overall: sums.t ? sums.l / sums.t : 0 };
        });
        break;
      }
      case "device-fallback":
        setState((prev) => ({ ...prev, device: msg.to, fellBackToWasm: true }));
        break;
      case "ready":
        setState((prev) => ({
          ...prev,
          status: "ready",
          device: prev.fellBackToWasm ? prev.device : msg.device,
          dtype: msg.dtype,
          modelId: msg.modelId,
          overall: 1,
        }));
        load.current?.resolve();
        load.current = null;
        break;
      case "result": {
        const p = jobs.current.get(msg.jobId);
        p?.resolve(msg.result);
        jobs.current.delete(msg.jobId);
        break;
      }
      case "diarize-progress":
        diarizeJobs.current.get(msg.jobId)?.onProgress?.(msg.progress);
        break;
      case "diarize-result": {
        const p = diarizeJobs.current.get(msg.jobId);
        p?.resolve(msg.activity);
        diarizeJobs.current.delete(msg.jobId);
        break;
      }
      case "error": {
        if (msg.jobId) {
          jobs.current.get(msg.jobId)?.reject(new Error(msg.message));
          jobs.current.delete(msg.jobId);
          diarizeJobs.current.get(msg.jobId)?.reject(new Error(msg.message));
          diarizeJobs.current.delete(msg.jobId);
        } else {
          setState((prev) => ({ ...prev, status: "error", error: msg.message }));
          load.current?.reject(new Error(msg.message));
          load.current = null;
        }
        break;
      }
      case "transcribe-start":
        break;
    }
  }

  const loadModel = useCallback(
    (modelId: string, dtype: Dtype, device: Backend) => {
      const worker = workerRef.current;
      if (!worker) return Promise.reject(new Error("Worker not ready"));
      setState({
        ...INITIAL,
        status: "loading",
        device,
        requestedDevice: device,
        modelId,
        dtype,
      });
      return new Promise<void>((resolve, reject) => {
        load.current = { resolve, reject };
        worker.postMessage({ type: "load", modelId, dtype, device });
      });
    },
    [],
  );

  const transcribe = useCallback(
    (
      jobId: string,
      audio: Float32Array,
      opts: {
        language: string | null;
        task: "transcribe" | "translate";
        /** Keep the audio in the worker so diarize() can reuse it. */
        retainAudio?: boolean;
      },
    ) => {
      const worker = workerRef.current;
      if (!worker) return Promise.reject(new Error("Worker not ready"));
      return new Promise<TranscriptResult>((resolve, reject) => {
        jobs.current.set(jobId, { resolve, reject });
        worker.postMessage(
          {
            type: "transcribe",
            jobId,
            audio,
            language: opts.language,
            task: opts.task,
            retainAudio: opts.retainAudio,
          },
          [audio.buffer],
        );
      });
    },
    [],
  );

  // No audio argument: the worker still holds the buffer transcribe() sent it,
  // so it isn't copied across the boundary twice.
  const diarize = useCallback(
    (jobId: string, onProgress?: (progress: number) => void) => {
      const worker = workerRef.current;
      if (!worker) return Promise.reject(new Error("Worker not ready"));
      return new Promise<SpeakerActivity[]>((resolve, reject) => {
        diarizeJobs.current.set(jobId, { resolve, reject, onProgress });
        worker.postMessage({ type: "diarize", jobId });
      });
    },
    [],
  );

  return { state, loadModel, transcribe, diarize };
}
