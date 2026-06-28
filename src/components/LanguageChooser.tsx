import { type Family, FAMILY_META, FAMILY_ORDER } from "../lib/models";

export function LanguageChooser({
  value,
  onChange,
  disabled,
}: {
  value: Family;
  onChange: (family: Family) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {FAMILY_ORDER.map((family) => {
        const meta = FAMILY_META[family];
        const active = value === family;
        return (
          <button
            key={family}
            type="button"
            disabled={disabled}
            onClick={() => onChange(family)}
            className={`flex flex-col items-center gap-1 rounded-2xl border px-3 py-4 transition disabled:opacity-50 ${
              active
                ? "border-sky-400/60 bg-sky-400/10 shadow-[0_0_0_1px_rgba(56,189,248,0.25)]"
                : "border-[var(--color-border)] bg-[var(--color-surface)]/60 hover:border-sky-400/30 hover:bg-white/[0.03]"
            }`}
          >
            <span className="text-3xl leading-none">{meta.emoji}</span>
            <span
              className={`text-sm font-semibold ${active ? "text-sky-200" : "text-slate-200"}`}
            >
              {meta.label}
            </span>
            <span className="text-[11px] text-slate-500">{meta.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
