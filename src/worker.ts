/// <reference lib="webworker" />
import {
  pipeline,
  env,
  AutoModelForAudioFrameClassification,
  AutoProcessor,
  type AutomaticSpeechRecognitionPipeline,
  type PreTrainedModel,
  type Processor,
} from "@huggingface/transformers";
import {
  DIARIZE_WINDOW_SECONDS,
  decodeActivity,
  planWindows,
  stitchWindows,
} from "./lib/diarize";
import type { Backend, Dtype } from "./lib/models";
import type {
  FileProgress,
  FromWorker,
  SpeakerActivity,
  ToWorker,
  TranscriptResult,
} from "./lib/protocol";

// Only ever fetch models from the Hugging Face Hub (avoids spurious local 404s).
env.allowLocalModels = false;

let pipe: AutomaticSpeechRecognitionPipeline | null = null;
let loadedKey = "";

// ── Speaker separation (pyannote segmentation-3.0) ──────────────────────────
// A tiny (~1.5 MB), separate model used only to detect *who* is speaking when.
// It has nothing to do with Whisper and is loaded lazily, once, on WASM — it's
// small enough that there's no need for the dtype/device tiers ASR gets.
const DIARIZATION_MODEL_ID = "onnx-community/pyannote-segmentation-3.0";

type DiarizationProcessor = Processor & {
  readonly sampling_rate: number;
};

let diarizer: { model: PreTrainedModel; processor: DiarizationProcessor } | null =
  null;

// Audio kept back from a `transcribe` so the following `diarize` can reuse it.
// The queue runs one job at a time, so a single slot is enough — and holding
// only the newest bounds this to one recording's worth even if a job dies
// between the two messages.
let retainedAudio: { jobId: string; audio: Float32Array } | null = null;

async function ensureDiarizer(): Promise<{
  model: PreTrainedModel;
  processor: DiarizationProcessor;
}> {
  if (diarizer) return diarizer;
  const [model, processor] = await Promise.all([
    AutoModelForAudioFrameClassification.from_pretrained(
      DIARIZATION_MODEL_ID,
      { device: "wasm", dtype: "q8" },
    ),
    AutoProcessor.from_pretrained(DIARIZATION_MODEL_ID),
  ]);
  diarizer = { model, processor: processor as DiarizationProcessor };
  return diarizer;
}

/** Below this there is no point retrying — something other than size is wrong. */
const MIN_DIARIZE_WINDOW_SECONDS = 5 * 60;

async function disposeDiarizer(): Promise<void> {
  const current = diarizer;
  diarizer = null;
  try {
    await current?.model.dispose();
  } catch {
    /* already torn down by the abort */
  }
}

/** Diarize the whole recording in windows of at most `windowSec`. */
async function runDiarization(
  audio: Float32Array,
  windowSec: number,
  onProgress: (progress: number) => void,
): Promise<SpeakerActivity[]> {
  const { model, processor } = await ensureDiarizer();
  const sampleRate = processor.sampling_rate;

  // Speaker indices only carry meaning within a single pass, so stitchWindows()
  // matches them across each seam using the overlap. A recording shorter than
  // the window takes one pass and needs no matching.
  const windows = planWindows(audio.length / sampleRate, windowSec);
  const parts: { window: (typeof windows)[number]; activity: SpeakerActivity[] }[] =
    [];
  for (const window of windows) {
    const start = Math.round(window.startSec * sampleRate);
    const end = Math.min(audio.length, Math.round(window.endSec * sampleRate));
    const windowAudio = audio.subarray(start, end);

    const inputs = await processor(windowAudio);
    const { logits } = await model(inputs);
    const [, numFrames, numClasses] = logits.dims as number[];
    parts.push({
      window,
      activity: decodeActivity(
        logits.data as Float32Array,
        numFrames,
        numClasses,
        windowAudio.length / sampleRate,
        start / sampleRate,
        window.index,
      ),
    });
    onProgress((window.index + 1) / windows.length);
  }
  return stitchWindows(parts);
}

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
      // Whatever the previous job left behind is dead weight now.
      retainedAudio = null;
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
      if (msg.retainAudio) retainedAudio = { jobId: msg.jobId, audio: msg.audio };
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

  if (msg.type === "diarize") {
    const audio =
      retainedAudio?.jobId === msg.jobId ? retainedAudio.audio : null;
    retainedAudio = null;
    if (!audio) {
      post({
        type: "error",
        jobId: msg.jobId,
        message: "Audio for this job is no longer available in the worker.",
      });
      return;
    }
    // How much audio fits in one pass depends on the device and on how much
    // the loaded Whisper model has already claimed — a 48-minute file failed
    // with kb-whisper-small resident but not with a smaller model. No fixed
    // window can be right for every combination, so on failure the window is
    // halved and the whole run retried.
    let windowSec = DIARIZE_WINDOW_SECONDS;
    let lastError: unknown = null;
    // A retry starts the pass over; holding progress at its high-water mark
    // keeps the bar from jumping back to zero while it catches up.
    let reported = 0;
    const report = (progress: number) => {
      if (progress <= reported) return;
      reported = progress;
      post({ type: "diarize-progress", jobId: msg.jobId, progress });
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        post({
          type: "diarize-result",
          jobId: msg.jobId,
          activity: await runDiarization(audio, windowSec, report),
        });
        return;
      } catch (err) {
        lastError = err;
        // An out-of-memory abort leaves the WASM runtime unusable, so the
        // retry needs a fresh session rather than the poisoned one.
        await disposeDiarizer();
        windowSec = Math.round(windowSec / 2);
        if (windowSec < MIN_DIARIZE_WINDOW_SECONDS) break;
      }
    }
    // A raw memory address rather than a message means a WASM abort, which is
    // almost always memory. Say something the user can act on.
    const raw = String((lastError as Error)?.message ?? lastError);
    post({
      type: "error",
      jobId: msg.jobId,
      message: /^\d+$/.test(raw)
        ? `Not enough memory for speaker separation, even in ${Math.round(
            (windowSec * 2) / 60,
          )}-minute chunks. A smaller Whisper model leaves more room for it.`
        : raw,
    });
    return;
  }
});
