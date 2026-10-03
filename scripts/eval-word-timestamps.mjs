/**
 * Does attributing *words* beat attributing *phrase chunks*?
 *
 * One-off experiment, not a regression test. Transcribes the fixture twice with
 * the same model — once with phrase timestamps, once with word timestamps — runs
 * the shipping diarization over both, and scores each against the hand-labelled
 * ground truth. Holding the ASR model constant isolates granularity as the only
 * variable.
 *
 *   node --experimental-strip-types scripts/eval-word-timestamps.mjs <fixture-dir> [model]
 *
 * Defaults to whisper-large-v3-turbo_timestamped: the multilingual model this app
 * already offers, in the separately-exported build that carries cross-attentions.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  pipeline,
  AutoModelForAudioFrameClassification,
  AutoProcessor,
} from "@huggingface/transformers";
import {
  decodeActivity,
  planWindows,
  stitchWindows,
  assignSpeakers,
  smoothSpeakers,
} from "../src/lib/diarize.ts";

const dir = process.argv[2];
const asrModel = process.argv[3] ?? "onnx-community/whisper-large-v3-turbo_timestamped";
if (!dir) { console.error("usage: eval-word-timestamps.mjs <fixture-dir> [model]"); process.exit(1); }

function readCsv(path) {
  const raw = readFileSync(path, "utf-8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const delim = lines[0].includes(";") ? ";" : ",";
  const cols = lines[0].split(delim);
  return lines.slice(1).map((l) =>
    Object.fromEntries(cols.map((c, i) => [c.trim(), l.split(delim)[i]])));
}
function readWav(path) {
  const b = readFileSync(path);
  let o = 12, off = -1, size = 0;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4), s = b.readUInt32LE(o + 4);
    if (id === "data") { off = o + 8; size = s; break; }
    o += 8 + s + (s % 2);
  }
  const n = size / 2, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = b.readInt16LE(off + i * 2) / 32768;
  return a;
}

const labelsPath = ["labels.csv", "labels_TOFILL.csv"].map((f) => join(dir, f)).find(existsSync);
const rows = readCsv(labelsPath);
const audio = readWav(join(dir, "excerpt.wav"));

// Ground truth as time intervals, so any segmentation can be scored against it.
const truthSpans = rows
  .map((r) => ({ start: +r.rel_start, end: +r.rel_end, speaker: (r.speaker ?? "").trim().toUpperCase() }))
  .filter((s) => s.speaker === "I" || s.speaker === "S");

const words = (t) => (t || "").trim().split(/\s+/).filter(Boolean).length;
function truthAt(start, end) {
  let best = null, bestOverlap = 0;
  for (const s of truthSpans) {
    const o = Math.min(end, s.end) - Math.max(start, s.start);
    if (o > bestOverlap) { bestOverlap = o; best = s.speaker; }
  }
  return best;
}

// ── diarization: identical for both runs ───────────────────────────────────
const dModel = await AutoModelForAudioFrameClassification.from_pretrained(
  "onnx-community/pyannote-segmentation-3.0", { dtype: "q8" });
const dProc = await AutoProcessor.from_pretrained("onnx-community/pyannote-segmentation-3.0");
const sr = dProc.sampling_rate;
const parts = [];
for (const w of planWindows(audio.length / sr)) {
  const s = Math.round(w.startSec * sr), e = Math.min(audio.length, Math.round(w.endSec * sr));
  const { logits } = await dModel(await dProc(audio.subarray(s, e)));
  const [, nF, nC] = logits.dims;
  parts.push({ window: w, activity: decodeActivity(logits.data, nF, nC, (e - s) / sr, s / sr, w.index) });
}
const activity = stitchWindows(parts);

// ── ASR, twice ─────────────────────────────────────────────────────────────
console.log(`ASR model: ${asrModel}`);
const asr = await pipeline("automatic-speech-recognition", asrModel, { dtype: "q8" });

function score(units, label) {
  const predicted = smoothSpeakers(assignSpeakers(units, activity));
  const mass = new Map();
  predicted.forEach((p, i) => {
    const t = truthAt(units[i].timestamp[0], units[i].timestamp[1] ?? units[i].timestamp[0]);
    if (!t) return;
    const k = `${p.speaker}|${t}`;
    mass.set(k, (mass.get(k) ?? 0) + words(units[i].text));
  });
  const map = new Map();
  for (const id of new Set(predicted.map((p) => p.speaker))) {
    let best = null, bestN = -1;
    for (const t of ["I", "S"]) {
      const n = mass.get(`${id}|${t}`) ?? 0;
      if (n > bestN) { bestN = n; best = t; }
    }
    map.set(id, best);
  }
  let correct = 0, total = 0, unscored = 0;
  predicted.forEach((p, i) => {
    const u = units[i];
    const t = truthAt(u.timestamp[0], u.timestamp[1] ?? u.timestamp[0]);
    const w = words(u.text);
    if (!t) { unscored += w; return; }
    total += w;
    if (map.get(p.speaker) === t) correct += w;
  });
  const durs = units.map((u) => (u.timestamp[1] ?? u.timestamp[0]) - u.timestamp[0]).filter((d) => d > 0).sort((a, b) => a - b);
  console.log(`\n${label}`);
  console.log(`  units: ${units.length}   median span: ${durs.length ? durs[durs.length >> 1].toFixed(2) : "n/a"}s`);
  console.log(`  word accuracy: ${((100 * correct) / total).toFixed(1)}%  (${correct}/${total}${unscored ? `, ${unscored} unscored` : ""})`);
  return (100 * correct) / total;
}

const phrase = await asr(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true, language: "sv", task: "transcribe" });
const a = score(phrase.chunks ?? [], "PHRASE-level attribution (what ships today)");

const word = await asr(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: "word", language: "sv", task: "transcribe" });
const b = score(word.chunks ?? [], "WORD-level attribution (the proposed change)");

// Middle ground: keep phrase-sized units, but trim each to the span its words
// actually occupy. Long enough to diarize; without the padding that drags a
// short interjection onto whoever is talking around it.
const grouped = [];
for (const w of word.chunks ?? []) {
  const last = grouped[grouped.length - 1];
  const endsSentence = /[.!?]$/.test((w.text || "").trim());
  if (!last || last.done) grouped.push({ text: w.text, timestamp: [w.timestamp[0], w.timestamp[1]], done: endsSentence });
  else { last.text += w.text; last.timestamp[1] = w.timestamp[1] ?? last.timestamp[1]; last.done = endsSentence; }
}
const c = score(grouped.map(({ text, timestamp }) => ({ text, timestamp })),
  "TIGHTENED phrase units (word-derived spans, no padding)");

console.log(`\n=> word-level is ${(b - a >= 0 ? "+" : "")}${(b - a).toFixed(1)} pp vs phrase-level`);
console.log(`=> tightened  is ${(c - a >= 0 ? "+" : "")}${(c - a).toFixed(1)} pp vs phrase-level`);
