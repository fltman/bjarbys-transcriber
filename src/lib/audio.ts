// Decode any browser-supported audio OR video file into the mono 16 kHz
// Float32Array that Whisper expects. Video containers (mp4/mov/webm) work
// because the Web Audio decoder extracts and decodes their audio track.

export const WHISPER_SAMPLE_RATE = 16000;

// Extensions we advertise as supported. The real test is whether the browser
// can decode the bytes — this list just drives the file picker / hints.
export const AUDIO_EXTS = [
  "mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac", "weba", "webm",
];
export const VIDEO_EXTS = ["mp4", "mov", "m4v", "webm", "mkv", "avi", "ogv"];
export const ACCEPTED_EXTS = Array.from(
  new Set([...AUDIO_EXTS, ...VIDEO_EXTS]),
);

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** True if the file type/extension is one we advertise support for. */
export function isLikelySupported(file: File): boolean {
  if (file.type.startsWith("audio/") || file.type.startsWith("video/")) {
    return true;
  }
  return ACCEPTED_EXTS.includes(extOf(file.name));
}

type AudioCtor = typeof AudioContext;

function getAudioContext(): AudioContext {
  const Ctor: AudioCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: AudioCtor })
      .webkitAudioContext;
  return new Ctor();
}

/**
 * Decode a media file/blob to a 16 kHz mono Float32Array.
 * Throws a friendly Error if the browser cannot decode the container/codec.
 */
export async function decodeToPCM(file: Blob): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const ctx = getAudioContext();
  let decoded: AudioBuffer;
  try {
    // Pass a copy — decodeAudioData detaches the ArrayBuffer it receives.
    decoded = await ctx.decodeAudioData(buf.slice(0));
  } catch {
    throw new Error(
      "This file's audio couldn't be decoded by the browser. Try MP3, WAV, M4A, OGG, FLAC, or an MP4/MOV/WebM video.",
    );
  } finally {
    void ctx.close();
  }

  if (
    decoded.sampleRate === WHISPER_SAMPLE_RATE &&
    decoded.numberOfChannels === 1
  ) {
    return decoded.getChannelData(0).slice();
  }
  return await resampleToMono16k(decoded);
}

/** Downmix to mono and resample to 16 kHz via an OfflineAudioContext. */
async function resampleToMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  const frames = Math.max(
    1,
    Math.ceil(buffer.duration * WHISPER_SAMPLE_RATE),
  );
  const offline = new OfflineAudioContext(1, frames, WHISPER_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

export function durationOf(pcm: Float32Array): number {
  return pcm.length / WHISPER_SAMPLE_RATE;
}
