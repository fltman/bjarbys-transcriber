// Merge per-speaker activity spans onto Whisper's timestamped chunks.
import type { SpeakerActivity, TranscriptChunk } from "./protocol";

// The diarization model has no internal chunking of its own (unlike Whisper),
// so the worker splits audio into windows before running it.
//
// How much fits in one pass is not a property of the audio alone: the loaded
// Whisper model and a full PCM copy are resident at the same time, so a bigger
// ASR model lowers the ceiling. Measured in isolation, 60 min succeeded and
// 67 min aborted — but in the app a 48-minute file failed with kb-whisper-small
// loaded. This default is therefore a starting point, not a guarantee: the
// worker halves it and retries when a pass runs out of memory.
//
// Kept as large as is realistic, because each seam is a chance for
// stitchWindows() to mislabel a speaker who stays silent through the overlap.
export const DIARIZE_WINDOW_MINUTES = 25;
export const DIARIZE_WINDOW_SECONDS = DIARIZE_WINDOW_MINUTES * 60;

/**
 * How much consecutive windows overlap.
 *
 * The overlap exists purely to match speakers across the seam: if two labels
 * describe the same person, they are active at the same moments. Two minutes
 * is enough for both people to say something in most conversations, and costs
 * ~8% extra inference on a 25-minute window.
 */
export const DIARIZE_OVERLAP_SECONDS = 120;

/** A speaker pairing needs at least this much coincident speech to be believed. */
const MIN_MATCH_SECONDS = 1;

export interface DiarizationWindow {
  index: number;
  startSec: number;
  endSec: number;
}

/** Split a recording into overlapping windows the model can handle. */
export function planWindows(
  durationSec: number,
  windowSec = DIARIZE_WINDOW_SECONDS,
  overlapSec = DIARIZE_OVERLAP_SECONDS,
): DiarizationWindow[] {
  if (durationSec <= windowSec) {
    return [{ index: 0, startSec: 0, endSec: durationSec }];
  }
  const advance = Math.max(1, windowSec - overlapSec);
  const windows: DiarizationWindow[] = [];
  for (let start = 0; start < durationSec; start += advance) {
    const endSec = Math.min(durationSec, start + windowSec);
    windows.push({ index: windows.length, startSec: start, endSec });
    if (endSec >= durationSec) break;
  }
  return windows;
}

/** Total time both span lists are simultaneously active, within [from, to]. */
function coincidentSeconds(
  a: SpeakerActivity[],
  b: SpeakerActivity[],
  from: number,
  to: number,
): number {
  let total = 0;
  for (const x of a) {
    const xs = Math.max(x.start, from);
    const xe = Math.min(x.end, to);
    if (xe <= xs) continue;
    for (const y of b) {
      const s = Math.max(xs, y.start);
      const e = Math.min(xe, y.end);
      if (e > s) total += e - s;
    }
  }
  return total;
}

/**
 * Join per-window diarization into one timeline with consistent speaker ids.
 *
 * The model's speaker indices are only meaningful within a single pass, so
 * without this a long recording reports the same person under a new label in
 * every window. Windows are matched through their overlap by how much their
 * speakers talk at the same moments, which works because segmentation *within*
 * a window is reliable — measured as accurate windowed as not.
 *
 * Each window contributes spans only up to the middle of its overlap with the
 * next, so no stretch of audio is counted twice.
 */
export function stitchWindows(
  parts: { window: DiarizationWindow; activity: SpeakerActivity[] }[],
): SpeakerActivity[] {
  if (parts.length === 0) return [];
  if (parts.length === 1) return parts[0].activity;

  const speakersOf = (activity: SpeakerActivity[]) => {
    const map = new Map<number, SpeakerActivity[]>();
    for (const s of activity) {
      const list = map.get(s.speaker);
      if (list) list.push(s);
      else map.set(s.speaker, [s]);
    }
    return map;
  };

  // Canonical id per (window, local speaker), built left to right.
  const canonical = new Map<string, number>();
  let nextCanonical = 0;
  for (const id of speakersOf(parts[0].activity).keys()) {
    canonical.set(`0|${id}`, nextCanonical++);
  }

  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1];
    const cur = parts[i];
    const from = cur.window.startSec;
    const to = prev.window.endSec;

    const prevSpeakers = speakersOf(prev.activity);
    const curSpeakers = speakersOf(cur.activity);

    // Score every prev/current pairing by how much they overlap in time.
    const scores: { prev: number; cur: number; score: number }[] = [];
    for (const [p, pSpans] of prevSpeakers) {
      for (const [c, cSpans] of curSpeakers) {
        const score = coincidentSeconds(pSpans, cSpans, from, to);
        if (score >= MIN_MATCH_SECONDS) scores.push({ prev: p, cur: c, score });
      }
    }
    scores.sort((a, b) => b.score - a.score);

    // Greedy is sufficient: at most three speakers exist on either side.
    const takenPrev = new Set<number>();
    const takenCur = new Set<number>();
    for (const { prev: p, cur: c } of scores) {
      if (takenPrev.has(p) || takenCur.has(c)) continue;
      const inherited = canonical.get(`${i - 1}|${p}`);
      if (inherited === undefined) continue;
      canonical.set(`${i}|${c}`, inherited);
      takenPrev.add(p);
      takenCur.add(c);
    }
    // Anyone who didn't speak during the overlap is genuinely unknown — give
    // them a new label rather than guessing at a pairing.
    for (const c of curSpeakers.keys()) {
      if (!canonical.has(`${i}|${c}`)) canonical.set(`${i}|${c}`, nextCanonical++);
    }
  }

  const out: SpeakerActivity[] = [];
  for (let i = 0; i < parts.length; i++) {
    const { window, activity } = parts[i];
    // Own the audio up to the midpoint of each overlap, so no second is
    // represented by two windows at once.
    const ownStart =
      i === 0 ? window.startSec : (window.startSec + parts[i - 1].window.endSec) / 2;
    const ownEnd =
      i === parts.length - 1
        ? window.endSec
        : (parts[i + 1].window.startSec + window.endSec) / 2;

    for (const span of activity) {
      const start = Math.max(span.start, ownStart);
      const end = Math.min(span.end, ownEnd);
      if (end <= start) continue;
      const speaker = canonical.get(`${i}|${span.speaker}`);
      if (speaker === undefined) continue;
      out.push({ speaker, start, end });
    }
  }
  return out;
}

// With windowing, duration no longer risks a crash — this is just a sanity
// ceiling against pathological uploads (each window costs ~10-15s to
// diarize, so even this takes a couple of minutes).
export const MAX_DIARIZE_MINUTES = 240;
export const MAX_DIARIZE_SECONDS = MAX_DIARIZE_MINUTES * 60;

// pyannote 3.x emits a POWERSET, not one class per speaker: each of the 7
// classes is the *set* of locally-indexed speakers active in that frame.
//   0 = nobody   1/2/3 = one speaker   4/5/6 = two speaking at once
// So the class index is NOT a speaker id. Treating it as one (which is what
// the library's post_process_speaker_diarization helper does) turns silence
// into a speaker and turns overlapping speech into a phantom extra speaker —
// measured at 23% of a real two-person interview. Decode to per-speaker
// activity instead.
export const POWERSET: readonly (readonly number[])[] = [
  [], [0], [1], [2], [0, 1], [0, 2], [1, 2],
];
/** The model can represent at most this many distinct speakers per pass. */
export const MAX_LOCAL_SPEAKERS = 3;

/**
 * Turn raw frame logits into per-speaker active spans.
 *
 * Reads the flat tensor directly rather than via `.tolist()` — an hour of
 * audio is ~240k frames, and boxing that into nested JS arrays costs far more
 * memory than the browser has to spare here.
 */
export function decodeActivity(
  logitsData: Float32Array,
  numFrames: number,
  numClasses: number,
  durationSec: number,
  windowStartSec: number,
  windowIndex: number,
): SpeakerActivity[] {
  const secondsPerFrame = numFrames > 0 ? durationSec / numFrames : 0;
  const out: SpeakerActivity[] = [];
  // Start frame of each speaker's currently-open span, or -1 when inactive.
  const openFrom: number[] = new Array(MAX_LOCAL_SPEAKERS).fill(-1);

  const close = (speaker: number, endFrame: number) => {
    const from = openFrom[speaker];
    if (from < 0) return;
    out.push({
      speaker: windowIndex * MAX_LOCAL_SPEAKERS + speaker,
      start: windowStartSec + from * secondsPerFrame,
      end: windowStartSec + endFrame * secondsPerFrame,
    });
    openFrom[speaker] = -1;
  };

  const active: boolean[] = new Array(MAX_LOCAL_SPEAKERS).fill(false);
  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * numClasses;
    let bestClass = 0;
    let bestScore = logitsData[offset];
    for (let k = 1; k < numClasses; k++) {
      if (logitsData[offset + k] > bestScore) {
        bestScore = logitsData[offset + k];
        bestClass = k;
      }
    }

    active.fill(false);
    for (const speaker of POWERSET[bestClass] ?? []) active[speaker] = true;

    for (let s = 0; s < MAX_LOCAL_SPEAKERS; s++) {
      if (active[s] && openFrom[s] < 0) openFrom[s] = frame;
      else if (!active[s] && openFrom[s] >= 0) close(s, frame);
    }
  }
  for (let s = 0; s < MAX_LOCAL_SPEAKERS; s++) close(s, numFrames);

  return out;
}

/**
 * Attributions at or below this margin are treated as uncertain — usually
 * because two people are talking across the chunk, not because the answer is
 * wrong. Consumers can filter on `speaker_conf` instead of guessing.
 */
export const LOW_CONFIDENCE = 0.35;

/**
 * End time of chunk `i`.
 *
 * Whisper may leave a trailing segment's end open (`timestamp[1]` is nullable),
 * so fall back to where the next chunk starts. Neither obvious shortcut works:
 * treating the span as zero-width overlaps nothing and silently drops the
 * attribution, while treating it as unbounded hands the chunk to whoever speaks
 * most through the entire rest of the recording.
 */
function chunkEnd(
  chunks: TranscriptChunk[],
  i: number,
  fallback?: number,
): number {
  const start = chunks[i].timestamp[0];
  const explicit = chunks[i].timestamp[1];
  if (explicit != null) return explicit;
  return Math.max(start, chunks[i + 1]?.timestamp[0] ?? fallback ?? start);
}

/**
 * Typical chunk length, used to bound a trailing chunk whose end is unknown.
 *
 * Without a bound, a transcript that Whisper truncated early (a repetition-loop
 * cutoff, say) would stretch its final chunk across every remaining minute of
 * speech and attribute it to whoever dominates that span.
 */
function typicalChunkSeconds(chunks: TranscriptChunk[]): number {
  const spans = chunks
    .filter((c) => c.timestamp[1] != null)
    .map((c) => (c.timestamp[1] as number) - c.timestamp[0])
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  if (spans.length === 0) return 5;
  return spans[Math.floor(spans.length / 2)];
}

/**
 * Assign each chunk the speaker who is active for the most of its duration.
 *
 * Weighted by total active time across the whole chunk rather than by a single
 * best-overlapping span: a speaker who holds the floor in three bursts should
 * beat one continuous interjection. Speakers can be active simultaneously, so
 * their spans legitimately overlap.
 */
export function assignSpeakers(
  chunks: TranscriptChunk[],
  activity: SpeakerActivity[],
): TranscriptChunk[] {
  if (activity.length === 0) return chunks;

  // Group spans by speaker, each list sorted by start time.
  const bySpeaker = new Map<number, SpeakerActivity[]>();
  for (const span of activity) {
    const list = bySpeaker.get(span.speaker);
    if (list) list.push(span);
    else bySpeaker.set(span.speaker, [span]);
  }
  for (const list of bySpeaker.values()) list.sort((a, b) => a.start - b.start);

  /** First index whose span could still overlap `from` (spans are sorted). */
  function firstCandidate(list: SpeakerActivity[], from: number): number {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].end <= from) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Speakers are renumbered 1, 2, 3... in the order they first speak, so the
  // output stays readable regardless of the model's internal indices.
  const seenIds: number[] = [];

  // Bounds for a final chunk with an open end: never past the last speech, and
  // never longer than a typical utterance.
  const lastActivityEnd = activity.reduce((max, s) => Math.max(max, s.end), 0);
  const typicalSeconds = typicalChunkSeconds(chunks);

  return chunks.map((chunk, chunkIndex) => {
    const start = chunk.timestamp[0];
    const end = chunkEnd(
      chunks,
      chunkIndex,
      Math.min(lastActivityEnd, start + typicalSeconds),
    );

    let topId: number | null = null;
    let topTime = 0;
    let secondTime = 0;

    for (const [id, list] of bySpeaker) {
      let total = 0;
      for (let i = firstCandidate(list, start); i < list.length; i++) {
        const span = list[i];
        if (span.start >= end) break;
        total += Math.min(end, span.end) - Math.max(start, span.start);
      }
      if (total > topTime) {
        secondTime = topTime;
        topTime = total;
        topId = id;
      } else if (total > secondTime) {
        secondTime = total;
      }
    }

    // Nobody was speaking here — say so rather than inventing an attribution.
    if (topId === null || topTime <= 0) {
      return { ...chunk, speaker: null, speaker_conf: 0 };
    }

    let index = seenIds.indexOf(topId);
    if (index === -1) {
      index = seenIds.length;
      seenIds.push(topId);
    }
    const confidence = (topTime - secondTime) / topTime;
    return {
      ...chunk,
      speaker: index + 1,
      speaker_conf: Math.round(confidence * 100) / 100,
    };
  });
}

// Brief overlapping speech or backchannels ("mhm") are often misclassified
// by the model as a distinct extra speaker for a moment. A short run
// sandwiched between two identical-speaker runs is almost always this, not
// a real third speaker, so it's folded into the surrounding one.
const SMOOTH_MAX_RUN_SECONDS = 2.5;

interface SpeakerRun {
  speaker: number | null | undefined;
  startIndex: number;
  endIndex: number;
  durationSec: number;
}

function runsOf(chunks: TranscriptChunk[]): SpeakerRun[] {
  const runs: SpeakerRun[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const speaker = chunks[i].speaker;
    const last = runs[runs.length - 1];
    if (last && last.speaker === speaker) {
      last.endIndex = i;
    } else {
      runs.push({ speaker, startIndex: i, endIndex: i, durationSec: 0 });
    }
  }
  for (const run of runs) {
    const start = chunks[run.startIndex].timestamp[0];
    run.durationSec = chunkEnd(chunks, run.endIndex) - start;
  }
  return runs;
}

/**
 * Merge short, isolated speaker runs into their surrounding speaker when both
 * neighboring runs agree. Only touches runs bounded on both sides by the same
 * speaker — never guesses between two different neighbors.
 *
 * Only *low-confidence* runs are merged: if the model was clearly sure it
 * heard someone else for a moment, that's a real interjection and gets to
 * stand. Chunks with no detected speech are left alone rather than having
 * speech invented for them.
 */
export function smoothSpeakers(chunks: TranscriptChunk[]): TranscriptChunk[] {
  const runs = runsOf(chunks);
  const result = chunks.map((c) => ({ ...c }));

  for (let i = 1; i < runs.length - 1; i++) {
    const prev = runs[i - 1];
    const cur = runs[i];
    const next = runs[i + 1];
    if (cur.speaker == null) continue;
    const uncertain = chunks
      .slice(cur.startIndex, cur.endIndex + 1)
      .every((c) => (c.speaker_conf ?? 0) <= LOW_CONFIDENCE);
    if (
      cur.durationSec < SMOOTH_MAX_RUN_SECONDS &&
      uncertain &&
      prev.speaker != null &&
      prev.speaker === next.speaker &&
      cur.speaker !== prev.speaker
    ) {
      for (let idx = cur.startIndex; idx <= cur.endIndex; idx++) {
        result[idx].speaker = prev.speaker;
      }
    }
  }
  return result;
}
