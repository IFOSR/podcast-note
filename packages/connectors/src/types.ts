import type { SourceType } from "../../core/src/types.ts";

export type ResolvedSource = {
  type: SourceType;
  url: string;
  canonicalUrl?: string;
  externalId?: string;
  title?: string;
  author?: string;
  language?: string;
  imageUrl?: string;
  metadata?: Record<string, unknown>;
};

export type ResolvedEpisode = {
  externalId?: string;
  guid?: string;
  title: string;
  description?: string;
  publishedAt?: string;
  durationSec?: number;
  audioUrl?: string;
  pageUrl: string;
  imageUrl?: string;
  language?: string;
  metadata?: Record<string, unknown>;
};

export type ListEpisodeOptions = {
  since?: Date;
  limit?: number;
};

export type SourceConnector = {
  type: SourceType;
  canHandle(input: string): boolean;
  resolveSource(input: string): Promise<ResolvedSource>;
  listEpisodes(source: ResolvedSource, options?: ListEpisodeOptions): Promise<ResolvedEpisode[]>;
  resolveEpisode(input: string): Promise<ResolvedEpisode>;
};

