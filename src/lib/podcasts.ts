// Podcast discovery + RSS parsing — fully client-side.
//  • Search uses Apple's iTunes Search API (CORS-enabled).
//  • Feed/episode audio usually can't be fetched cross-origin, so we route
//    those through a same-origin proxy (proxy.php on your LAMP server). The
//    transcription itself still happens locally in the browser.

export interface Podcast {
  id: number;
  title: string;
  author: string;
  feedUrl: string;
  artwork: string;
  episodeCount?: number;
}

export interface Episode {
  id: string;
  title: string;
  date: Date | null;
  durationSec: number | null;
  audioUrl: string;
  sizeBytes: number | null;
  mime: string | null;
}

/** Default same-origin proxy endpoint (shipped as proxy.php). */
export const DEFAULT_PROXY = "./proxy.php?url=";

export function proxied(url: string, proxyBase: string): string {
  return `${proxyBase}${encodeURIComponent(url)}`;
}

/** Fetch a URL directly; on CORS/network failure, retry through the proxy. */
async function fetchMaybeProxied(
  url: string,
  proxyBase: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    const res = await fetch(url, init);
    if (res.ok) return res;
    throw new Error(`HTTP ${res.status}`);
  } catch {
    const res = await fetch(proxied(url, proxyBase), init);
    if (!res.ok) {
      throw new Error(
        `Couldn't fetch this resource (HTTP ${res.status}). Podcast feeds/episodes need the proxy — make sure proxy.php is installed and PHP (with cURL) is enabled on your server.`,
      );
    }
    // If the "proxy" handed back the app's own HTML, proxy.php isn't running
    // (e.g. the SPA fallback served index.html). Fail with a clear message
    // instead of letting the audio decoder choke on HTML.
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html")) {
      throw new Error(
        "The podcast proxy isn't running: proxy.php returned a web page instead of media. Deploy proxy.php to your server (PHP + cURL), or run the dev server which proxies automatically.",
      );
    }
    return res;
  }
}

export async function searchPodcasts(
  term: string,
  proxyBase: string,
  limit = 24,
): Promise<Podcast[]> {
  const url = `https://itunes.apple.com/search?media=podcast&limit=${limit}&term=${encodeURIComponent(
    term,
  )}`;
  const res = await fetchMaybeProxied(url, proxyBase);
  const data = (await res.json()) as {
    results: Array<{
      collectionId: number;
      trackId?: number;
      collectionName: string;
      artistName: string;
      feedUrl?: string;
      artworkUrl600?: string;
      artworkUrl100?: string;
      trackCount?: number;
    }>;
  };
  return data.results
    .filter((r) => !!r.feedUrl)
    .map((r) => ({
      id: r.collectionId ?? r.trackId ?? Math.abs(hashString(r.feedUrl!)),
      title: r.collectionName,
      author: r.artistName,
      feedUrl: r.feedUrl!,
      artwork: r.artworkUrl600 ?? r.artworkUrl100 ?? "",
      episodeCount: r.trackCount,
    }));
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function text(el: Element | null | undefined): string {
  return el?.textContent?.trim() ?? "";
}

function firstTag(parent: Element, ...names: string[]): Element | null {
  for (const name of names) {
    const found = parent.getElementsByTagName(name)[0];
    if (found) return found;
  }
  return null;
}

function parseDuration(raw: string): number | null {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10); // plain seconds
  const parts = raw.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0); // HH:MM:SS or MM:SS
}

export async function fetchEpisodes(
  feedUrl: string,
  proxyBase: string,
): Promise<{ podcastTitle: string; episodes: Episode[] }> {
  const res = await fetchMaybeProxied(feedUrl, proxyBase);
  const xmlText = await res.text();
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");

  if (doc.querySelector("parsererror")) {
    throw new Error("This feed isn't valid RSS/XML.");
  }

  const channel = doc.querySelector("channel");
  const podcastTitle = text(channel ? firstTag(channel, "title") : null);

  const items = Array.from(doc.getElementsByTagName("item"));
  const episodes: Episode[] = items.map((item, idx) => {
    const enclosure = item.getElementsByTagName("enclosure")[0];
    const audioUrl = enclosure?.getAttribute("url") ?? "";
    const mime = enclosure?.getAttribute("type") ?? null;
    const lengthAttr = enclosure?.getAttribute("length");
    const durationEl = firstTag(item, "itunes:duration", "duration");
    const dateStr = text(firstTag(item, "pubDate"));
    const guid = text(firstTag(item, "guid")) || audioUrl || `ep-${idx}`;

    return {
      id: guid,
      title: text(firstTag(item, "title")) || `Episode ${idx + 1}`,
      date: dateStr ? new Date(dateStr) : null,
      durationSec: parseDuration(text(durationEl)),
      audioUrl,
      sizeBytes: lengthAttr ? parseInt(lengthAttr, 10) || null : null,
      mime,
    };
  });

  return {
    podcastTitle,
    episodes: episodes.filter((e) => e.audioUrl),
  };
}

/**
 * Download an episode's audio as a Blob. Tries a direct fetch first (works if
 * the host sends CORS headers) and falls back to the same-origin proxy if the
 * browser blocks the cross-origin read.
 */
export async function fetchEpisodeAudio(
  episode: Episode,
  proxyBase: string,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<Blob> {
  const res = await fetchMaybeProxied(episode.audioUrl, proxyBase);

  const total =
    episode.sizeBytes ??
    (res.headers.get("content-length")
      ? parseInt(res.headers.get("content-length")!, 10)
      : null);

  if (!res.body || !onProgress) {
    return await res.blob();
  }

  // Stream so we can report download progress for big episodes.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
  }
  return new Blob(chunks as BlobPart[], {
    type: episode.mime ?? "application/octet-stream",
  });
}

export function formatDuration(sec: number | null): string {
  if (sec == null) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
