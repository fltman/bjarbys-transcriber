import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m))
      return m;
  }
  return "";
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Recorder({
  onRecorded,
  disabled,
}: {
  onRecorded: (blob: Blob, label: string) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  // Web Audio analysis for the live visualizer.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => stopEverything();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopEverything() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  }

  function drawLoop() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const bins = analyser.frequencyBinCount; // fftSize/2
    const data = new Uint8Array(bins);
    analyser.getByteFrequencyData(data);

    const bars = 40;
    const step = Math.floor(bins / bars);
    const gap = 3;
    const barW = (cssW - gap * (bars - 1)) / bars;
    const mid = cssH / 2;

    const grad = ctx.createLinearGradient(0, 0, cssW, 0);
    grad.addColorStop(0, "#0ea5e9");
    grad.addColorStop(1, "#22d3ee");
    ctx.fillStyle = grad;

    for (let i = 0; i < bars; i++) {
      // Average a few bins per bar; emphasise the speech range a little.
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j] ?? 0;
      const v = sum / step / 255; // 0..1
      const h = Math.max(2, v * (cssH - 4));
      const x = i * (barW + gap);
      const r = barW / 2;
      // rounded symmetric bar growing from the centre line
      ctx.beginPath();
      ctx.roundRect(x, mid - h / 2, barW, h, r);
      ctx.fill();
    }

    rafRef.current = requestAnimationFrame(drawLoop);
  }

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Microphone needs a secure context (HTTPS or localhost). It isn't available here.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up live analysis (does NOT route to speakers → no echo).
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const audioCtx = new AC();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;

      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        const stamp = new Date()
          .toLocaleString()
          .replace(/[/:,]/g, "-")
          .replace(/\s+/g, "_");
        onRecorded(blob, `recording_${stamp}`);
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
      rafRef.current = requestAnimationFrame(drawLoop);
    } catch (e) {
      setError(
        (e as Error)?.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : `Couldn't start recording: ${(e as Error)?.message ?? e}`,
      );
      stopEverything();
    }
  }

  function stop() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    // stream tracks are stopped after onstop fires (handled there indirectly)
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  return (
    <div className="flex flex-col items-center gap-5 py-8">
      {/* Live visualizer */}
      <div
        className={`flex h-24 w-full max-w-md items-center justify-center rounded-2xl border transition ${
          recording
            ? "border-sky-400/30 bg-sky-400/[0.04]"
            : "border-[var(--color-border)] bg-[var(--color-surface-2)]/40"
        }`}
      >
        {recording ? (
          <canvas ref={canvasRef} className="h-16 w-[92%]" />
        ) : (
          <p className="text-sm text-slate-500">
            Your voice will appear here as you speak
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={disabled}
        className={`relative flex size-20 items-center justify-center rounded-full text-white shadow-lg transition disabled:opacity-50 ${
          recording
            ? "rec-ring bg-red-500 hover:bg-red-600"
            : "bg-sky-500 hover:bg-sky-600"
        }`}
        aria-label={recording ? "Stop recording" : "Start recording"}
      >
        {recording ? <Square className="size-7" /> : <Mic className="size-8" />}
      </button>

      <div className="text-center">
        {recording ? (
          <p className="font-mono text-lg tabular-nums text-slate-100">
            {fmt(elapsed)}
          </p>
        ) : (
          <p className="text-sm font-medium text-slate-200">
            Record from your microphone
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          {recording
            ? "Recording… click to stop and transcribe"
            : "Click the mic, speak, then stop to add it to the queue"}
        </p>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  );
}
