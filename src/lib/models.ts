// Catalog of Whisper models that load & run in-browser via Transformers.js (ONNX).
// Sizes below are the ACTUAL total download (encoder_model + decoder_model_merged)
// measured from each model's Hugging Face repo, per quantization (dtype).

export type Dtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";
export type Backend = "webgpu" | "wasm";

export interface Tier {
  dtype: Dtype;
  /** Total download in MB (encoder + merged decoder). */
  sizeMB: number;
}

export type ModelGroup =
  | "Swedish — KB-Whisper"
  | "Multilingual — Whisper"
  | "English — Whisper";

export interface ModelOption {
  /** Hugging Face repo id passed to pipeline(). */
  id: string;
  name: string;
  group: ModelGroup;
  /** Short human label of language coverage. */
  language: string;
  blurb: string;
  /** Available quantizations, ordered small → large. */
  tiers: Tier[];
  /** Highlighted as a good starting point. */
  recommended?: boolean;
  /** Heavy models that realistically need a GPU (WebGPU). */
  gpuPreferred?: boolean;
}

export const DTYPE_LABEL: Record<Dtype, string> = {
  q4f16: "Balanced (GPU)",
  q4: "4-bit",
  q8: "Balanced (CPU)",
  fp16: "16-bit",
  fp32: "Full quality (largest)",
};

// NOTE on sizes: the "Balanced (GPU)" tier loads an fp32 encoder + a 4-bit (q4)
// decoder. On WebGPU the encoder MUST stay fp32 or Whisper emits a single token
// then stops (verified), so its size = encoder_fp32 (incl. external-data for big
// models) + decoder_merged_q4. The "Balanced (CPU)" (q8) tier is 8-bit both and
// is much smaller. "Full" (fp32) is offered only for the smaller models whose
// weights are inline.
export const MODELS: ModelOption[] = [
  // ── Swedish: KB-Whisper (KBLab / National Library of Sweden) ──────────────
  {
    id: "KBLab/kb-whisper-tiny",
    name: "KB-Whisper Tiny",
    group: "Swedish — KB-Whisper",
    language: "Swedish (also handles English)",
    blurb: "Fastest Swedish model. Great for quick drafts and weak hardware.",
    tiers: [
      { dtype: "q4f16", sizeMB: 120 },
      { dtype: "q8", sizeMB: 120 },
      { dtype: "fp32", sizeMB: 151 },
    ],
  },
  {
    id: "KBLab/kb-whisper-base",
    name: "KB-Whisper Base",
    group: "Swedish — KB-Whisper",
    language: "Swedish (also handles English)",
    blurb: "Good balance of speed and accuracy for Swedish.",
    tiers: [
      { dtype: "q4f16", sizeMB: 206 },
      { dtype: "q8", sizeMB: 182 },
      { dtype: "fp32", sizeMB: 291 },
    ],
    recommended: true,
  },
  {
    id: "KBLab/kb-whisper-small",
    name: "KB-Whisper Small",
    group: "Swedish — KB-Whisper",
    language: "Swedish (also handles English)",
    blurb: "Noticeably better Swedish accuracy. Worth it on a decent machine.",
    tiers: [
      { dtype: "q4f16", sizeMB: 586 },
      { dtype: "q8", sizeMB: 407 },
      { dtype: "fp32", sizeMB: 968 },
    ],
  },
  {
    id: "KBLab/kb-whisper-medium",
    name: "KB-Whisper Medium",
    group: "Swedish — KB-Whisper",
    language: "Swedish (also handles English)",
    blurb: "High Swedish accuracy. Large download — best with WebGPU.",
    tiers: [
      { dtype: "q4f16", sizeMB: 1699 },
      { dtype: "q8", sizeMB: 986 },
    ],
    gpuPreferred: true,
  },
  {
    id: "KBLab/kb-whisper-large",
    name: "KB-Whisper Large",
    group: "Swedish — KB-Whisper",
    language: "Swedish (also handles English)",
    blurb: "Best-in-class Swedish. Very large — WebGPU strongly recommended.",
    tiers: [
      { dtype: "q4f16", sizeMB: 3346 },
      { dtype: "q8", sizeMB: 1822 },
    ],
    gpuPreferred: true,
  },

  // ── Multilingual: standard OpenAI Whisper (~100 languages) ────────────────
  {
    id: "Xenova/whisper-tiny",
    name: "Whisper Tiny",
    group: "Multilingual — Whisper",
    language: "~100 languages",
    blurb: "Tiny multilingual model. Fastest, lowest accuracy.",
    tiers: [
      { dtype: "q4f16", sizeMB: 120 },
      { dtype: "q8", sizeMB: 41 },
      { dtype: "fp32", sizeMB: 151 },
    ],
  },
  {
    id: "Xenova/whisper-base",
    name: "Whisper Base",
    group: "Multilingual — Whisper",
    language: "~100 languages",
    blurb: "Balanced multilingual model. A solid default.",
    tiers: [
      { dtype: "q4f16", sizeMB: 206 },
      { dtype: "q8", sizeMB: 77 },
      { dtype: "fp32", sizeMB: 291 },
    ],
    recommended: true,
  },
  {
    id: "Xenova/whisper-small",
    name: "Whisper Small",
    group: "Multilingual — Whisper",
    language: "~100 languages",
    blurb: "Better multilingual accuracy at a larger size.",
    tiers: [
      { dtype: "q4f16", sizeMB: 586 },
      { dtype: "q8", sizeMB: 249 },
      { dtype: "fp32", sizeMB: 968 },
    ],
  },
  {
    id: "onnx-community/whisper-large-v3-turbo",
    name: "Whisper Large v3 Turbo",
    group: "Multilingual — Whisper",
    language: "~100 languages",
    blurb: "Near large-v3 accuracy at a fraction of the speed cost. WebGPU recommended.",
    tiers: [
      { dtype: "q4f16", sizeMB: 2882 },
      { dtype: "q8", sizeMB: 1085 },
    ],
    gpuPreferred: true,
  },

  // ── English-only: standard Whisper (slightly better on English) ───────────
  {
    id: "Xenova/whisper-tiny.en",
    name: "Whisper Tiny (English)",
    group: "English — Whisper",
    language: "English only",
    blurb: "English-only tiny model. Fastest for English.",
    tiers: [
      { dtype: "q4f16", sizeMB: 120 },
      { dtype: "q8", sizeMB: 41 },
      { dtype: "fp32", sizeMB: 151 },
    ],
  },
  {
    id: "Xenova/whisper-base.en",
    name: "Whisper Base (English)",
    group: "English — Whisper",
    language: "English only",
    blurb: "English-only base model. Good everyday choice for English.",
    tiers: [
      { dtype: "q4f16", sizeMB: 206 },
      { dtype: "q8", sizeMB: 77 },
      { dtype: "fp32", sizeMB: 291 },
    ],
  },
  {
    id: "Xenova/whisper-small.en",
    name: "Whisper Small (English)",
    group: "English — Whisper",
    language: "English only",
    blurb: "English-only small model. Highest English accuracy here.",
    tiers: [
      { dtype: "q4f16", sizeMB: 586 },
      { dtype: "q8", sizeMB: 249 },
      { dtype: "fp32", sizeMB: 968 },
    ],
  },
];

export const MODEL_GROUPS: ModelGroup[] = [
  "Swedish — KB-Whisper",
  "Multilingual — Whisper",
  "English — Whisper",
];

export function findModel(id: string): ModelOption | undefined {
  return MODELS.find((m) => m.id === id);
}

// ── Simple top-level "what language?" grouping ──────────────────────────────
export type Family = "swedish" | "multilingual" | "english";

export const FAMILY_META: Record<
  Family,
  { label: string; emoji: string; hint: string }
> = {
  swedish: { label: "Swedish", emoji: "🇸🇪", hint: "KB-Whisper" },
  multilingual: { label: "Any language", emoji: "🌍", hint: "~100 languages" },
  english: { label: "English", emoji: "🇬🇧", hint: "fastest for English" },
};

export const FAMILY_ORDER: Family[] = ["swedish", "multilingual", "english"];

export const FAMILY_DEFAULT_MODEL: Record<Family, string> = {
  swedish: "KBLab/kb-whisper-base",
  multilingual: "Xenova/whisper-base",
  english: "Xenova/whisper-base.en",
};

export function familyOf(modelId: string): Family {
  if (modelId.startsWith("KBLab/")) return "swedish";
  if (isEnglishOnly(modelId)) return "english";
  return "multilingual";
}

/** Whether a model id is English-only (its decoder has no language tokens). */
export function isEnglishOnly(id: string): boolean {
  return id.endsWith(".en");
}

// Which dtypes are SAFE on each backend.
//  • WebGPU: avoid 8-bit integer decoders — they produce gibberish on the
//    WebGPU backend (transformers.js issue #1317). Use 4-bit+fp16 or full.
//  • WASM/CPU: avoid fp16-based variants (slow / unsupported); 8-bit and 4-bit
//    integer are the sweet spot.
const WEBGPU_DTYPES: Dtype[] = ["q4f16", "fp32"];
const WASM_DTYPES: Dtype[] = ["q8", "q4", "fp32"];

/** The quantization tiers that are valid to run on the given backend. */
export function availableTiers(model: ModelOption, backend: Backend): Tier[] {
  const allow = backend === "webgpu" ? WEBGPU_DTYPES : WASM_DTYPES;
  return model.tiers.filter((t) => allow.includes(t.dtype));
}

/** Pick a sensible default dtype for a model given the active backend. */
export function defaultDtype(model: ModelOption, backend: Backend): Dtype {
  const tiers = availableTiers(model, backend);
  const has = (d: Dtype) => tiers.some((t) => t.dtype === d);
  if (backend === "webgpu") {
    if (has("q4f16")) return "q4f16"; // smallest + fast on GPU
    if (has("fp32")) return "fp32";
  } else {
    if (has("q8")) return "q8"; // best CPU sweet spot
    if (has("q4")) return "q4";
    if (has("fp32")) return "fp32";
  }
  // Fallback: first valid tier, else the model's smallest declared tier.
  return (tiers[0] ?? model.tiers[0]).dtype;
}

export function tierFor(model: ModelOption, dtype: Dtype): Tier | undefined {
  return model.tiers.find((t) => t.dtype === dtype);
}

export function formatSize(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}
