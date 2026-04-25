import type { SourceConnector } from "./types.ts";
import { manualConnector } from "./manual.ts";
import { rssConnector } from "./rss.ts";

export const connectors: SourceConnector[] = [rssConnector, manualConnector];

export function connectorFor(input: string): SourceConnector {
  const connector = connectors.find((candidate) => candidate.canHandle(input));
  if (!connector) throw new Error(`No connector can handle input: ${input}`);
  return connector;
}

export type { ListEpisodeOptions, ResolvedEpisode, ResolvedSource, SourceConnector } from "./types.ts";
export { manualConnector } from "./manual.ts";
export { parseRss, rssConnector } from "./rss.ts";

