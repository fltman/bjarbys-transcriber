# Bjarbys Transcriber

[![Support me on Patreon](https://img.shields.io/badge/Patreon-Support%20my%20work-FF424D?style=flat&logo=patreon&logoColor=white)](https://www.patreon.com/AndersBjarby)

Private, **in-browser** audio &amp; video transcription. The Whisper model runs
entirely on the user's machine via [Transformers.js](https://github.com/huggingface/transformers.js)
(WebGPU, with a WASM/CPU fallback). **Nothing is uploaded** and **nothing needs
to be installed** — just open the page.

## Features

- 🎙️ **Three sources, one queue** — drop **multiple audio/video files**, record
  from the **microphone**, or search a **podcast** by name and pick episodes.
  Everything feeds a single queue that transcribes sequentially and (optionally)
  **auto-downloads** each transcript.
- 🇸🇪 **Swedish that actually works** — choose **KB-Whisper** (KBLab / National
  Library of Sweden) tiny → large, alongside standard multilingual and
  English-only Whisper models.
- 🎚️ **Pick your model & size** — every model offers quantization tiers with the
  real download size shown; backend-aware so you can't pick a broken combo.
- 🎬 **Audio _and_ video** — MP3, WAV, M4A, OGG, FLAC and MP4 / MOV / WebM
  (the browser extracts the audio track).
- 📝 **Export** to `.txt`, `.srt`, `.vtt`, or `.json` (with timestamps).
- 🗣️ **Speaker separation** (optional, experimental) — labels each line
  `Speaker 1`, `Speaker 2`, … via
  [pyannote](https://huggingface.co/pyannote/segmentation-3.0). Off by default;
  see [the caveats](#speaker-separation) before relying on it.
- 🔒 **Private by design** — transcription is 100% local; models download once
  from the Hugging Face CDN and cache in your browser.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build & deploy to a LAMP server

```bash
npm run build    # outputs static files to dist/
```

Copy the **contents of `dist/`** into your Apache web root (or a subfolder).
A ready-to-use **`.htaccess`** and the podcast **`proxy.php`** are included in
`public/` and are emitted into `dist/` by the build.

- **HTTPS is required** for the microphone (`getUserMedia`) and WebGPU. The
  `.htaccess` force-redirects to HTTPS (localhost is exempt).
- **No COOP/COEP headers needed** for WebGPU or single-threaded WASM — they're
  left commented out in `.htaccess`.
- **Serving from a subfolder?** Set `base: '/yourpath/'` in `vite.config.ts`,
  rebuild, and adjust the `RewriteBase` / fallback lines in `.htaccess`.

### Podcasts &amp; `proxy.php`

Searching uses Apple's iTunes API (CORS-enabled, direct). Most podcast hosts,
however, block cross-origin reads of their RSS/audio, so the app first tries a
**direct fetch** and falls back to a **same-origin proxy** — `proxy.php` — which
your own server fetches through. This keeps it private to your server (no
third-party CORS proxy). `proxy.php` needs PHP with cURL and includes basic
SSRF protection; harden it (e.g. a host allow-list) before public exposure. If
you don't deploy `proxy.php`, file and microphone transcription still work, and
podcasts work for any host that happens to send CORS headers.

## Models

| Group | Models | Notes |
|---|---|---|
| **Swedish — KB-Whisper** | tiny · base · small · medium · large | Best Swedish accuracy. `large`/`medium` are big — use WebGPU. |
| **Multilingual — Whisper** | tiny · base · small · large-v3-turbo | ~100 languages. Turbo is the fast flagship (WebGPU). |
| **English — Whisper** | tiny · base · small (`.en`) | Slightly better on English. |

Quantization: **4-bit (q4f16)** is the small/fast default on **WebGPU**;
**8-bit (q8)** is the default on **CPU/WASM** (an 8-bit *decoder* misbehaves on
WebGPU, so it's offered only on CPU); **full (fp32)** is available for the
smaller models.

### Speaker separation

Ticking **Separate speakers** additionally loads
[`onnx-community/pyannote-segmentation-3.0`](https://huggingface.co/onnx-community/pyannote-segmentation-3.0)
— an ONNX build of [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0),
about 1.5 MB, MIT. It runs on WASM alongside Whisper and needs no extra
dependency. Each chunk in the `.json` export then carries `speaker` and
`speaker_conf`, and the other formats prefix each line with `Speaker N:`.

**Measured accuracy: 94.7%** of words attributed to the correct speaker, on a
hand-labelled 12-minute two-person Swedish interview (231 utterances, 2116
words). Lines where no speaker was detected count as wrong. Reproduce with `scripts/eval-diarization.mjs` — see
[Evaluating speaker separation](#evaluating-speaker-separation).

That figure is for a clean recording of two people. Known limits:

- **At most 3 speakers.** The model reports speaker activity as a *powerset*
  over three local speakers, so a fourth voice cannot be represented at all.
- **Long recordings are stitched, not seamless.** A single pass eventually
  exhausts the browser's WASM memory, so audio is diarized in windows that
  overlap by two minutes, and speakers are matched across each seam by who is
  talking at the same moments. How much fits in one pass depends on the device
  and on how much the chosen Whisper model has already claimed, so the window
  starts at 25 minutes and halves on retry if a pass runs out of memory. A 67-minute two-person interview comes
  out as 2 speakers. But someone who stays silent through an entire overlap
  cannot be matched and is given a fresh label rather than a guessed one, so
  very long or very lopsided recordings may still show extra speakers.
- **Short interjections are the main error.** Half of the wrong words sit in
  utterances under 1.5 s — typically a backchannel ("Just det.") spoken over
  someone still talking. A chunk's audio is dominated by the other speaker
  even though the transcribed words are the interjector's, so time-weighted
  attribution gets it wrong, sometimes confidently. See
  [Why not word-level timestamps?](#why-not-word-level-timestamps) — the
  obvious fix was measured and makes attribution worse, not better.
- **`speaker_conf`** is the margin between the top two speakers' talk time
  within a chunk. Low values mean overlapping speech rather than a wrong
  answer; `speaker` is `null` where no speech was detected at all. About half
  the errors above are already flagged this way.

### Why not word-level timestamps?

The natural fix for the interjection errors above looks like attributing
*words* rather than phrase chunks: `return_timestamps: 'word'` gives spans
around 0.2 s against ~2 s for phrase chunks, easily fine enough to isolate a
half-second "Just det." It was tried, measured, and **it makes attribution
worse.**

Transcribing the fixture twice with the same model and diarizing both, so
granularity is the only variable (`scripts/eval-word-timestamps.mjs`):

| attribution | units | median span | word accuracy |
|---|---|---|---|
| phrase-level (what ships) | 288 | 1.94 s | **98.4%** |
| word-level | 1996 | 0.20 s | 94.7% (−3.7 pp) |
| words regrouped into sentences | 201 | 2.80 s | 97.7% (−0.7 pp) |

The padding really does cause the interjection errors — but it also does
useful work everywhere else. A two-second span covers roughly 120 diarization
frames and averages out noise; a 0.2 s word covers about 12 and can land
entirely on a glitch. Removing the padding loses more than it recovers, so
phrase-sized units are the right granularity and the errors above are the
price of it.

(Those percentages are not comparable to the 94.7% quoted earlier: this
experiment uses a different ASR model and scores against time intervals rather
than per labelled utterance. Only the three rows are comparable to each other.)

The availability problem below is therefore moot — but it is recorded because
it took a while to establish, and "just use word timestamps" is an obvious
thing to suggest.

Word timestamps are derived from the decoder's **cross-attentions**, and the
ONNX models this app loads are not exported with them:

```
Model outputs must contain cross attentions to extract timestamps.
This is most likely because the model was not exported with `output_attentions=True`.
```

Having `alignment_heads` in `generation_config.json` is not sufficient — every
model here declares it and still fails. What the export needs is the
cross-attentions themselves, and each candidate was checked:

| build | word timestamps |
|---|---|
| `KBLab/kb-whisper-*` | ✗ no cross-attentions |
| `onnx-community/kb-whisper-*-ONNX` | ✗ no cross-attentions |
| `pappa1337/kb-whisper-{tiny,small}-onnx-words` | ✗ won't load — transformers.js reports `Unsupported model type: whisper` |
| `onnx-community/whisper-*_timestamped` (13 of them) | ✓ works, verified |

So the blocker is specific: **no working KB-Whisper build exposes
cross-attentions.** The `_timestamped` variants that do work include
multilingual ones, and those *can* transcribe Swedish — this is a real option,
not an impossibility. It just means giving up KB-Whisper's Swedish accuracy for
generic Whisper, plus re-downloading a different model. Whether better speaker
attribution outweighs worse transcription has not been measured.

Exporting KB-Whisper with `output_attentions=True` would remove that
obstacle — but the measurement above says it would not be worth doing, since
finer spans attribute worse. `speaker_conf` already flags roughly half of these
errors, and that remains the sensible mitigation.

### Evaluating speaker separation

`scripts/eval-diarization.mjs` scores the shipping code against a hand-labelled
fixture, so changes to diarization can be measured instead of eyeballed.

```bash
node --experimental-strip-types scripts/eval-diarization.mjs <fixture-dir> [windowMinutes]
```

The fixture lives outside the repo — real recordings are usually confidential —
and the directory needs two files:

| file | contents |
|---|---|
| `labels.csv` | `idx;time_in_clip;speaker;text;dur_s;rel_start;rel_end;…`, one row per utterance, `speaker` hand-filled (`,` or `;` separated) |
| `excerpt.wav` | the same audio, 16 kHz mono |

It reports word-level accuracy, the number of distinct speakers, speaker changes
landing on a window boundary, and duplicated spans. Pass `windowMinutes` to force
the windowed path on a short clip — handy for exercising boundary behaviour
without labelling hours of audio.

## How it works

`src/worker.ts` runs the Transformers.js ASR pipeline in a Web Worker. Audio is
decoded to mono 16 kHz PCM on the main thread (`src/lib/audio.ts`) and
transferred to the worker. Long audio is chunked (`chunk_length_s: 30`) with a
5 s stride. See `src/lib/models.ts` for the model catalog.

With speaker separation on, the worker runs the pyannote model over the same
PCM and decodes its powerset output into per-speaker activity spans — silence
and simultaneous speech are *not* speakers, which is easy to get wrong.
`src/lib/diarize.ts` then attributes each Whisper chunk to whoever holds the
floor longest across it, and merges away brief low-confidence blips.

## License

[MIT](LICENSE) © 2026 Anders Bjarby. The models are downloaded at runtime from
Hugging Face and carry their own licenses (OpenAI Whisper and KB-Whisper are
both Apache-2.0). Speaker separation additionally downloads the
[pyannote segmentation](https://huggingface.co/onnx-community/pyannote-segmentation-3.0)
model, which is MIT-licensed.
