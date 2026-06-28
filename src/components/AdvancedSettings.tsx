import {
  type Backend,
  type Dtype,
  DTYPE_LABEL,
  MODEL_GROUPS,
  MODELS,
  availableTiers,
  findModel,
  formatSize,
  isEnglishOnly,
} from "../lib/models";
import { EXPORT_FORMATS, type ExportFormat } from "../lib/exporters";
import { type DeviceMode, LANGUAGES, type Settings } from "../lib/settings";
import { Field, Select } from "./ui";

export function AdvancedSettings({
  settings,
  onChange,
  resolvedDevice,
  webgpuAvailable,
  disabled,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  resolvedDevice: Backend;
  webgpuAvailable: boolean;
  disabled?: boolean;
}) {
  const model = findModel(settings.modelId)!;
  const tiers = availableTiers(model, resolvedDevice);
  const englishOnly = isEnglishOnly(settings.modelId);
  const currentTier = tiers.find((t) => t.dtype === settings.dtype) ?? tiers[0];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Model" hint={model.language}>
        <Select
          value={settings.modelId}
          disabled={disabled}
          onChange={(e) => onChange({ modelId: e.target.value })}
        >
          {MODEL_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {MODELS.filter((m) => m.group === group).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.recommended ? "  ★" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      <Field
        label="Quality / size"
        hint={currentTier ? `${formatSize(currentTier.sizeMB)} download` : ""}
      >
        <Select
          value={settings.dtype}
          disabled={disabled}
          onChange={(e) => onChange({ dtype: e.target.value as Dtype })}
        >
          {tiers.map((t) => (
            <option key={t.dtype} value={t.dtype}>
              {DTYPE_LABEL[t.dtype]} — {formatSize(t.sizeMB)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Run on"
        hint={webgpuAvailable ? "WebGPU detected" : "WebGPU unavailable"}
      >
        <Select
          value={settings.deviceMode}
          disabled={disabled}
          onChange={(e) => onChange({ deviceMode: e.target.value as DeviceMode })}
        >
          <option value="auto">Auto ({webgpuAvailable ? "GPU" : "CPU"})</option>
          <option value="webgpu" disabled={!webgpuAvailable}>
            GPU — WebGPU{webgpuAvailable ? "" : " (not available)"}
          </option>
          <option value="wasm">CPU — WASM</option>
        </Select>
      </Field>

      <Field label="Output format" hint="auto-saved per file">
        <Select
          value={settings.exportFormat}
          onChange={(e) =>
            onChange({ exportFormat: e.target.value as ExportFormat })
          }
        >
          {EXPORT_FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Language" hint={englishOnly ? "English-only model" : ""}>
        <Select
          value={settings.language ?? ""}
          disabled={disabled || englishOnly}
          onChange={(e) =>
            onChange({ language: e.target.value === "" ? null : e.target.value })
          }
        >
          {LANGUAGES.map((l) => (
            <option key={l.label} value={l.code ?? ""}>
              {l.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Task" hint="translate → English">
        <Select
          value={settings.task}
          disabled={disabled || englishOnly}
          onChange={(e) =>
            onChange({ task: e.target.value as "transcribe" | "translate" })
          }
        >
          <option value="transcribe">Transcribe (same language)</option>
          <option value="translate">Translate to English</option>
        </Select>
      </Field>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-300 sm:col-span-2">
        <input
          type="checkbox"
          checked={settings.autoDownload}
          onChange={(e) => onChange({ autoDownload: e.target.checked })}
          className="size-4 rounded border-[var(--color-border)] bg-[var(--color-surface-2)] accent-sky-500"
        />
        Automatically download each transcript when it finishes
      </label>
    </div>
  );
}
