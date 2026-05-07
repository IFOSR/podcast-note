import type { SourceConnector } from "./types.ts";
import { manualConnector } from "./manual.ts";
import { appleConnector, spotifyConnector, xiaoyuzhouConnector, youtubeConnector } from "./platform.ts";
import { listenNotesConnector } from "./listennotes.ts";
import { rssConnector } from "./rss.ts";

export const connectors: SourceConnector[] = [rssConnector, listenNotesConnector, appleConnector, spotifyConnector, youtubeConnector, xiaoyuzhouConnector, manualConnector];

export function connectorFor(input: string): SourceConnector {
  const connector = connectors.find((candidate) => candidate.canHandle(input));
  if (!connector) throw new Error(`No connector can handle input: ${input}`);
  return connector;
}

export type { ListEpisodeOptions, ResolvedEpisode, ResolvedSource, SourceConnector } from "./types.ts";
export { manualConnector } from "./manual.ts";
export { listenNotesConnector } from "./listennotes.ts";
export { appleConnector, spotifyConnector, xiaoyuzhouConnector, youtubeConnector } from "./platform.ts";
export { parseRss, rssConnector } from "./rss.ts";

