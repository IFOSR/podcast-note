import type { ResolvedEpisode, ResolvedSource, SourceConnector } from "./types.ts";
import { manualConnector } from "./manual.ts";

export const appleConnector: SourceConnector = platformConnector({
  type: "apple",
  hostPattern: /(^|\.)podcasts\.apple\.com$/i,
  title: "Apple Podcasts"
});

export const spotifyConnector: SourceConnector = platformConnector({
  type: "spotify",
  hostPattern: /(^|\.)open\.spotify\.com$/i,
  title: "Spotify"
});

export const youtubeConnector: SourceConnector = platformConnector({
  type: "youtube",
  hostPattern: /(^|\.)(youtube\.com|youtu\.be)$/i,
  title: "YouTube"
});

export const xiaoyuzhouConnector: SourceConnector = platformConnector({
  type: "xiaoyuzhou",
  hostPattern: /(^|\.)xiaoyuzhoufm\.com$/i,
  title: "Xiaoyuzhou"
});

function platformConnector(config: {
  type: "apple" | "spotify" | "youtube" | "xiaoyuzhou";
  hostPattern: RegExp;
  title: string;
}): SourceConnector {
  return {
    type: config.type,
    canHandle(input: string): boolean {
      return hostMatches(input, config.hostPattern);
    },
    async resolveSource(input: string): Promise<ResolvedSource> {
      const fallback = await manualConnector.resolveSource(input);
      return {
        ...fallback,
        type: config.type,
        externalId: platformExternalId(input),
        title: fallback.title ?? config.title,
        metadata: {
          ...fallback.metadata,
          platform: config.type,
          resolver: "platform-public-page"
        }
      };
    },
    async listEpisodes(source: ResolvedSource, options = {}): Promise<ResolvedEpisode[]> {
      if (config.type === "xiaoyuzhou" && isXiaoyuzhouPodcastUrl(source.url)) {
        const episodes = await xiaoyuzhouPodcastEpisodes(source.url);
        return episodes.slice(0, options.limit ?? 10);
      }
      const episode = await this.resolveEpisode(source.url);
      return [episode].slice(0, options.limit ?? 1);
    },
    async resolveEpisode(input: string): Promise<ResolvedEpisode> {
      const fallback = await manualConnector.resolveEpisode(input);
      return {
        ...fallback,
        externalId: platformExternalId(input),
        guid: fallback.guid ?? platformExternalId(input),
        metadata: {
          ...fallback.metadata,
          platform: config.type,
          resolver: "platform-public-page"
        }
      };
    }
  };
}

async function xiaoyuzhouPodcastEpisodes(input: string): Promise<ResolvedEpisode[]> {
  const html = await fetchHtml(input);
  const episodes = jsonObjectsByType(html, "EPISODE")
    .map((episode) => xiaoyuzhouEpisodeFromObject(episode, input))
    .filter((episode) => episode.audioUrl);
  return dedupeEpisodes(episodes);
}

function xiaoyuzhouEpisodeFromObject(input: Record<string, unknown>, sourceUrl: string): ResolvedEpisode {
  const id = stringField(input, "eid");
  const enclosure = recordField(input, "enclosure");
  const media = recordField(input, "media");
  const mediaSource = recordField(media, "source");
  const podcast = recordField(input, "podcast");
  const audioUrl = stringField(enclosure, "url") ?? stringField(mediaSource, "url");
  const pageUrl = id ? `https://www.xiaoyuzhoufm.com/episode/${id}` : sourceUrl;
  return {
    externalId: id,
    guid: id,
    title: stringField(input, "title") ?? "Untitled Xiaoyuzhou episode",
    description: stringField(input, "description"),
    publishedAt: stringField(input, "pubDate") ?? stringField(input, "datePublished"),
    durationSec: numberField(input, "duration"),
    audioUrl,
    pageUrl,
    imageUrl: stringField(recordField(podcast, "image"), "picUrl"),
    language: "zh-CN",
    metadata: {
      sourceTitle: stringField(podcast, "title"),
      platform: "xiaoyuzhou",
      resolver: "xiaoyuzhou-podcast-page"
    }
  };
}

function isXiaoyuzhouPodcastUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return /(^|\.)xiaoyuzhoufm\.com$/i.test(url.hostname) && url.pathname.startsWith("/podcast/");
  } catch {
    return false;
  }
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "PodcastNoteBot/0.1 (+https://example.invalid/podcast-note)"
    }
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}`);
  return response.text();
}

export function xiaoyuzhouEpisodesFromHtml(html: string, sourceUrl: string): ResolvedEpisode[] {
  return dedupeEpisodes(jsonObjectsByType(html, "EPISODE")
    .map((episode) => xiaoyuzhouEpisodeFromObject(episode, sourceUrl))
    .filter((episode) => episode.audioUrl));
}

function jsonObjectsByType(html: string, type: string): Array<Record<string, unknown>> {
  const objects: Array<Record<string, unknown>> = [];
  let index = 0;
  const needle = `"type":"${type}"`;
  while (index < html.length) {
    const typeIndex = html.indexOf(needle, index);
    if (typeIndex < 0) break;
    const start = html.lastIndexOf("{", typeIndex);
    if (start < 0) break;
    const end = matchingBraceIndex(html, start);
    if (end < 0) {
      index = typeIndex + needle.length;
      continue;
    }
    const parsed = parseJsonObject(html.slice(start, end + 1));
    if (parsed) objects.push(parsed);
    index = end + 1;
  }
  return objects;
}

function matchingBraceIndex(input: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function dedupeEpisodes(input: ResolvedEpisode[]): ResolvedEpisode[] {
  const seen = new Set<string>();
  const episodes: ResolvedEpisode[] = [];
  for (const episode of input) {
    const key = episode.guid ?? episode.pageUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    episodes.push(episode);
  }
  return episodes;
}

function parseJsonObject(input: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function recordField(input: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = input?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(input: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = input?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hostMatches(input: string, pattern: RegExp): boolean {
  try {
    return pattern.test(new URL(input).hostname);
  } catch {
    return false;
  }
}

function platformExternalId(input: string): string {
  try {
    const url = new URL(input);
    const idFromQuery = url.searchParams.get("i") ?? url.searchParams.get("si") ?? url.searchParams.get("v");
    if (idFromQuery) return idFromQuery;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1) ?? input;
  } catch {
    return input;
  }
}
