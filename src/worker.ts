/// <reference lib="webworker" />
import {
  pipeline,
  env,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";
import type { Backend, Dtype } from "./lib/models";
import type {
  FileProgress,
  FromWorker,
  ToWorker,
  TranscriptResult,
} from "./lib/protocol";

// Only ever fetch models from the Hugging Face Hub (avoids spurious local 404s).
env.allowLocalModels = false;

let pipe: AutomaticSpeechRecognitionPipeline | null = null;
let loadedKey = "";

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

function keyOf(modelId: string, dtype: Dtype, device: Backend): string {
  return `${modelId}|${dtype}|${device}`;
}

// If a WebGPU load fails, retry on WASM — and swap a GPU-only dtype for a
// CPU-friendly one (q4f16/fp16 don't belong on WASM; q8 is the safe default).
function wasmDtypeFor(dtype: Dtype): Dtype {
  return dtype === "q4f16" || dtype === "fp16" ? "q8" : dtype;
}

// Cast away transformers.js's huge pipeline() overload union (TS2590) by
// pinning the exact signature we use.
const createPipeline = pipeline as unknown as (
  task: "automatic-speech-recognition",
  model: string,
  options: Record<string, unknown>,
) => Promise<AutomaticSpeechRecognitionPipeline>;

type DtypeArg = string | Record<string, string>;

// Whisper's encoder is VERY sensitive to quantization on the WebGPU backend:
// anything below fp32 (fp16/q4f16/q4) makes base+ models emit a single token
// then stop (verified empirically — only tiny survives 4-bit). So on WebGPU we
// pin the encoder to fp32 and 4-bit only the (large) decoder — the exact config
// the official transformers.js Whisper examples use. On WASM a single integer
// dtype works fine. (transformers.js issue #1317 + dtypes guide.)
function resolveDtype(dtype: Dtype, device: Backend): DtypeArg {
  if (device === "webgpu") {
    if (dtype === "fp32") return "fp32";
    // Our "Balanced (GPU)" tier:
    return { encoder_model: "fp32", decoder_model_merged: "q4" };
  }
  return dtype; // WASM/CPU: q8 (default), q4, or fp32
}

async function build(
  modelId: string,
  dtype: Dtype,
  device: Backend,
): Promise<AutomaticSpeechRecognitionPipeline> {
  return await createPipeline("automatic-speech-recognition", modelId, {
    device,
    dtype: resolveDtype(dtype, device),
    progress_callback: (data: unknown) =>
      post({ type: "download", data: data as FileProgress }),
  });
}

async function ensurePipeline(
  modelId: string,
  dtype: Dtype,
  device: Backend,
): Promise<AutomaticSpeechRecognitionPipeline> {
  const key = keyOf(modelId, dtype, device);
  if (pipe && key === loadedKey) return pipe;

  // Dispose any previously loaded model before switching.
  if (pipe) {
    try {
      await pipe.dispose();
    } catch {
      /* ignore */
    }
    pipe = null;
    loadedKey = "";
  }

  try {
    pipe = await build(modelId, dtype, device);
    loadedKey = key;
    return pipe;
  } catch (err) {
    if (device === "webgpu") {
      const to: Backend = "wasm";
      const fallbackDtype = wasmDtypeFor(dtype);
      post({
        type: "device-fallback",
        from: "webgpu",
        to,
        reason: String((err as Error)?.message ?? err),
      });
      pipe = await build(modelId, fallbackDtype, to);
      loadedKey = keyOf(modelId, fallbackDtype, to);
      return pipe;
    }
    throw err;
  }
}

self.addEventListener("message", async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;

  if (msg.type === "load") {
    try {
      await ensurePipeline(msg.modelId, msg.dtype, msg.device);
      const [, dtype, device] = loadedKey.split("|");
      post({
        type: "ready",
        modelId: msg.modelId,
        dtype: dtype as Dtype,
        device: device as Backend,
      });
    } catch (err) {
      post({ type: "error", message: String((err as Error)?.message ?? err) });
    }
    return;
  }

  if (msg.type === "transcribe") {
    try {
      if (!pipe) throw new Error("Model is not loaded yet.");
      post({ type: "transcribe-start", jobId: msg.jobId });

      const output = (await pipe(msg.audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
        ...(msg.language
          ? { language: msg.language, task: msg.task }
          : {}),
      })) as { text: string; chunks?: TranscriptResult["chunks"] };

      const result: TranscriptResult = {
        text: output.text ?? "",
        chunks: output.chunks ?? [],
      };
      post({ type: "result", jobId: msg.jobId, result });
    } catch (err) {
      post({
        type: "error",
        jobId: msg.jobId,
        message: String((err as Error)?.message ?? err),
      });
    }
    return;
  }
});
