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
