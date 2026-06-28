import { useState } from "react";
import {
  ArrowLeft,
  CheckSquare,
  Loader2,
  Plus,
  Search,
  Square,
} from "lucide-react";
import {
  type Episode,
  type Podcast,
  fetchEpisodes,
  formatDuration,
  searchPodcasts,
} from "../lib/podcasts";

export function PodcastPanel({
  proxyBase,
  disabled,
  onEnqueue,
}: {
  proxyBase: string;
  disabled?: boolean;
  onEnqueue: (podcast: Podcast, episodes: Episode[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Podcast[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [podcast, setPodcast] = useState<Podcast | null>(null);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setPodcast(null);
    try {
      setResults(await searchPodcasts(query.trim(), proxyBase));
    } catch (err) {
      setError(`Search failed: ${(err as Error).message}`);
    } finally {
      setSearching(false);
    }
  }

  async function openPodcast(p: Podcast) {
    setPodcast(p);
    setLoadingEpisodes(true);
    setEpisodes([]);
    setSelected(new Set());
    setError(null);
    try {
      const { episodes } = await fetchEpisodes(p.feedUrl, proxyBase);
      setEpisodes(episodes);
    } catch (err) {
      setError(`Couldn't load episodes: ${(err as Error).message}`);
    } finally {
      setLoadingEpisodes(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === episodes.length
        ? new Set()
        : new Set(episodes.map((e) => e.id)),
    );
  }

  function enqueue() {
    if (!podcast) return;
    const chosen = episodes.filter((e) => selected.has(e.id));
    if (chosen.length) onEnqueue(podcast, chosen);
    setSelected(new Set());
  }

  // ── Episode list view ────────────────────────────────────────────────────
  if (podcast) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPodcast(null)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-white/5 hover:text-slate-200"
          >
            <ArrowLeft className="size-4" /> Back
          </button>
          {podcast.artwork && (
            <img
              src={podcast.artwork}
              alt=""
              className="size-12 rounded-lg object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-100">
              {podcast.title}
            </p>
            <p className="truncate text-xs text-slate-400">{podcast.author}</p>
          </div>
        </div>

        {loadingEpisodes && (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
            <Loader2 className="size-5 animate-spin" /> Loading episodes…
          </div>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}

        {!loadingEpisodes && episodes.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={toggleAll}
                className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white"
              >
                {selected.size === episodes.length ? (
                  <CheckSquare className="size-4" />
                ) : (
                  <Square className="size-4" />
                )}
                {selected.size === episodes.length
                  ? "Deselect all"
                  : "Select all"}
              </button>
              <span className="text-xs text-slate-500">
                {episodes.length} episodes
              </span>
            </div>

            <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1 scroll-thin">
              {episodes.map((ep) => {
                const on = selected.has(ep.id);
                return (
                  <li key={ep.id}>
                    <button
                      type="button"
                      onClick={() => toggle(ep.id)}
                      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                        on
                          ? "border-sky-400/50 bg-sky-400/10"
                          : "border-[var(--color-border)] hover:border-sky-400/30 hover:bg-white/[0.02]"
                      }`}
                    >
                      <span className="mt-0.5 text-sky-300">
                        {on ? (
                          <CheckSquare className="size-4" />
                        ) : (
                          <Square className="size-4 text-slate-500" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-100">
                          {ep.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {ep.date ? ep.date.toLocaleDateString() : ""}
                          {ep.date && ep.durationSec != null ? " · " : ""}
                          {ep.durationSec != null
                            ? formatDuration(ep.durationSec)
                            : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              disabled={disabled || selected.size === 0}
              onClick={enqueue}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="size-4" />
              Add {selected.size || ""} to transcription queue
            </button>
          </>
        )}

        {!loadingEpisodes && episodes.length === 0 && !error && (
          <p className="py-8 text-center text-sm text-slate-500">
            No playable episodes found in this feed.
          </p>
        )}
      </div>
    );
  }

  // ── Search view ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <form onSubmit={runSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a podcast by name…"
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] py-2.5 pl-9 pr-3 text-sm text-slate-100 outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20"
          />
        </div>
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-40"
        >
          {searching ? <Loader2 className="size-4 animate-spin" /> : "Search"}
        </button>
      </form>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {results.length > 0 && (
        <ul className="grid max-h-96 grid-cols-1 gap-2 overflow-y-auto pr-1 scroll-thin sm:grid-cols-2">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => openPodcast(p)}
                className="flex w-full items-center gap-3 rounded-xl border border-[var(--color-border)] p-2.5 text-left transition hover:border-sky-400/40 hover:bg-white/[0.02]"
              >
                {p.artwork ? (
                  <img
                    src={p.artwork}
                    alt=""
                    className="size-12 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="size-12 shrink-0 rounded-lg bg-white/5" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-100">
                    {p.title}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {p.author}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!searching && results.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-500">
          Find a show, pick episodes, and they’ll be transcribed locally — the
          audio is fetched through your own server, never a third party.
        </p>
      )}
    </div>
  );
}
