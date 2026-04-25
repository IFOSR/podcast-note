import type { Episode } from "./types.ts";

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function episodeDedupeKey(episode: Pick<Episode, "guid" | "audioUrl" | "pageUrl" | "title">): string {
  if (episode.guid) return `guid:${episode.guid.trim().toLowerCase()}`;
  if (episode.audioUrl) return `audio:${stripTrackingParams(episode.audioUrl)}`;
  return `page:${stripTrackingParams(episode.pageUrl)}:${normalizeTitle(episode.title)}`;
}

export function stripTrackingParams(input: string): string {
  try {
    const url = new URL(input);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm|from|source|ref)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return input.trim();
  }
}

