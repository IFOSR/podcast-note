import type { ResolvedEpisode, ResolvedSource, SourceConnector } from "./types.ts";

const DEFAULT_ENDPOINT = "https://listen-api.listennotes.com/api/v2";

export const listenNotesConnector: SourceConnector = {
  type: "listennotes",
  canHandle(input: string): boolean {
    return input.startsWith("listennotes:") || /^https?:\/\/(www\.)?listennotes\.com\//i.test(input) || (input.trim().length > 0 && !isHttpUrl(input));
  },
  async resolveSource(input: string): Promise<ResolvedSource> {
    const id = listenNotesId(input);
    if (!apiKey()) {
      return {
        type: "listennotes",
        url: input,
        externalId: id,
        title: id ? `Listen Notes ${id}` : input,
        metadata: { resolver: "listennotes", mode: "metadata-only", query: id ? undefined : input }
      };
    }
    if (!id) {
      return {
        type: "listennotes",
        url: input,
        title: input,
        metadata: { resolver: "listennotes", mode: "search", query: input }
      };
    }
    const data = await listenNotesJson(`/podcasts/${encodeURIComponent(id)}`);
    return {
      type: "listennotes",
      url: input,
      canonicalUrl: data.website ?? data.listennotes_url,
      externalId: data.id ?? id,
      title: data.title,
      author: data.publisher,
      language: data.language,
      imageUrl: data.image,
      metadata: { resolver: "listennotes", totalEpisodes: data.total_episodes }
    };
  },
  async listEpisodes(source: ResolvedSource, options = {}): Promise<ResolvedEpisode[]> {
    const id = source.externalId ?? listenNotesId(source.url);
    if (!apiKey()) return [];
    if (!id) {
      const data = await listenNotesJson("/search", { q: source.url, type: "episode", sort_by_date: "1" });
      return ((data.results as Record<string, unknown>[] | undefined) ?? [])
        .map((episode) => episodeFromListenNotes(episode, source))
        .slice(0, options.limit ?? 10);
    }
    const data = await listenNotesJson(`/podcasts/${encodeURIComponent(id)}`, { sort: "recent_first" });
    return (data.episodes ?? [])
      .map((episode: Record<string, unknown>) => episodeFromListenNotes(episode, source))
      .slice(0, options.limit ?? 10);
  },
  async resolveEpisode(input: string): Promise<ResolvedEpisode> {
    const id = listenNotesId(input);
    if (!id) throw new Error(`Listen Notes episode requires an id: ${input}`);
    if (!apiKey()) {
      return {
        externalId: id,
        guid: id,
        title: `Listen Notes episode ${id}`,
        pageUrl: input,
        metadata: { resolver: "listennotes", mode: "metadata-only" }
      };
    }
    return episodeFromListenNotes(await listenNotesJson(`/episodes/${encodeURIComponent(id)}`), { type: "listennotes", url: input });
  }
};

function episodeFromListenNotes(episode: Record<string, unknown>, source: ResolvedSource): ResolvedEpisode {
  const audioUrl = stringField(episode, "audio") ?? stringField(episode, "audio_url");
  const pageUrl = stringField(episode, "link") ?? stringField(episode, "listennotes_url") ?? source.url;
  return {
    externalId: stringField(episode, "id"),
    guid: stringField(episode, "id") ?? pageUrl,
    title: stringField(episode, "title") ?? "Untitled Listen Notes episode",
    description: stripHtml(stringField(episode, "description") ?? stringField(episode, "description_original")),
    publishedAt: dateFromMs(numberField(episode, "pub_date_ms")),
    durationSec: numberField(episode, "audio_length_sec"),
    audioUrl,
    pageUrl,
    imageUrl: stringField(episode, "image") ?? source.imageUrl,
    language: source.language,
    metadata: { sourceTitle: source.title, resolver: "listennotes" }
  };
}

async function listenNotesJson(path: string, query: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const key = apiKey();
  if (!key) throw new Error("LISTEN_NOTES_API_KEY is required for Listen Notes API calls.");
  const endpoint = process.env["LISTEN_NOTES_API_BASE"] ?? DEFAULT_ENDPOINT;
  const url = new URL(`${endpoint}${path}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const response = await fetch(url, {
    headers: {
      "X-ListenAPI-Key": key,
      "user-agent": "PodcastNoteBot/0.1 (+https://example.invalid/podcast-note)"
    }
  });
  if (!response.ok) throw new Error(`Listen Notes API failed ${response.status} for ${path}`);
  return response.json() as Promise<Record<string, unknown>>;
}

function listenNotesId(input: string): string | undefined {
  if (input.startsWith("listennotes:")) return input.slice("listennotes:".length).replace(/^\/+/, "");
  try {
    const url = new URL(input);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1)?.replace(/\.html?$/i, "");
  } catch {
    return undefined;
  }
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

function apiKey(): string | undefined {
  return process.env["LISTEN_NOTES_API_KEY"];
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function dateFromMs(input?: number): string | undefined {
  return input ? new Date(input).toISOString() : undefined;
}

function stripHtml(input?: string): string | undefined {
  return input?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
