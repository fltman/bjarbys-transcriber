import type { Dtype } from "./models";
import type { ExportFormat } from "./exporters";

export type DeviceMode = "auto" | "webgpu" | "wasm";

export interface Settings {
  modelId: string;
  dtype: Dtype;
  deviceMode: DeviceMode;
  language: string | null;
  task: "transcribe" | "translate";
  exportFormat: ExportFormat;
  autoDownload: boolean;
}

export const LANGUAGES: { code: string | null; label: string }[] = [
  { code: null, label: "Auto-detect" },
  { code: "sv", label: "Swedish" },
  { code: "en", label: "English" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "pt", label: "Portuguese" },
];
