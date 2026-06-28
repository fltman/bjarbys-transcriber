// Turn a Whisper result into downloadable transcript formats.
import type { TranscriptResult } from "./protocol";

export type ExportFormat = "txt" | "srt" | "vtt" | "json";

export const EXPORT_FORMATS: { value: ExportFormat; label: string; ext: string }[] =
  [
    { value: "txt", label: "Plain text (.txt)", ext: "txt" },
    { value: "srt", label: "Subtitles (.srt)", ext: "srt" },
    { value: "vtt", label: "WebVTT (.vtt)", ext: "vtt" },
    { value: "json", label: "JSON (.json)", ext: "json" },
  ];

export function mimeFor(format: ExportFormat): string {
  switch (format) {
    case "json":
      return "application/json";
    case "vtt":
      return "text/vtt";
    default:
      return "text/plain;charset=utf-8";
  }
}

export function extFor(format: ExportFormat): string {
  return EXPORT_FORMATS.find((f) => f.value === format)!.ext;
}

/** Replace a filename's extension (or append one if absent). */
export function withExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${ext}`;
}

function pad(n: number, width = 2): string {
  return Math.floor(n).toString().padStart(width, "0");
}

/** Format seconds as HH:MM:SS,mmm (SRT) or HH:MM:SS.mmm (VTT). */
function stamp(seconds: number, msSep: "," | "."): string {
  const s = Math.max(0, seconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(sec)}${msSep}${pad(ms, 3)}`;
}

export function toTxt(result: TranscriptResult): string {
  return result.text.trim() + "\n";
}

function cuesFrom(result: TranscriptResult): TranscriptResult["chunks"] {
  const chunks = result.chunks?.filter((c) => c.text.trim().length > 0) ?? [];
  if (chunks.length > 0) return chunks;
  // No timestamps available — emit one cue spanning the whole text.
  return [{ text: result.text.trim(), timestamp: [0, null] }];
}

export function toSrt(result: TranscriptResult): string {
  const cues = cuesFrom(result);
  return (
    cues
      .map((c, i) => {
        const start = c.timestamp[0] ?? 0;
        const end = c.timestamp[1] ?? start + 2;
        return `${i + 1}\n${stamp(start, ",")} --> ${stamp(end, ",")}\n${c.text.trim()}\n`;
      })
      .join("\n") + "\n"
  );
}

export function toVtt(result: TranscriptResult): string {
  const cues = cuesFrom(result);
  const body = cues
    .map((c) => {
      const start = c.timestamp[0] ?? 0;
      const end = c.timestamp[1] ?? start + 2;
      return `${stamp(start, ".")} --> ${stamp(end, ".")}\n${c.text.trim()}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${body}\n`;
}

export function toJson(result: TranscriptResult): string {
  return JSON.stringify(result, null, 2) + "\n";
}

export function render(result: TranscriptResult, format: ExportFormat): string {
  switch (format) {
    case "srt":
      return toSrt(result);
    case "vtt":
      return toVtt(result);
    case "json":
      return toJson(result);
    default:
      return toTxt(result);
  }
}

/** Trigger a browser download of `text` as `filename`. */
export function downloadText(
  filename: string,
  text: string,
  format: ExportFormat,
): void {
  const blob = new Blob([text], { type: mimeFor(format) });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
