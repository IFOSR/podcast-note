export type SourceType =
  | "rss"
  | "listennotes"
  | "xiaoyuzhou"
  | "apple"
  | "spotify"
  | "youtube"
  | "manual";

export type User = {
  id: string;
  email?: string;
  name?: string;
  timezone: string;
};

export type Workspace = {
  id: string;
  ownerUserId: string;
  name: string;
  type: "personal";
};

export type WatchType = "topic" | "podcast" | "entity" | "mixed";
export type OutputLanguage = "zh-CN" | "en" | "source";

export type Watch = {
  id: string;
  workspaceId: string;
  name: string;
  type: WatchType;
  query: string;
  outputLanguage: OutputLanguage;
  includeTerms: string[];
  excludeTerms: string[];
  expandedTerms: string[];
  minRelevanceScore: number;
  frequency: "realtime" | "daily" | "weekly";
  backfillDays: number;
  enabled: boolean;
};

export type Source = {
  id: string;
  type: SourceType;
  url: string;
  canonicalUrl?: string;
  externalId?: string;
  title?: string;
  author?: string;
  language?: string;
};

export type Episode = {
  id: string;
  sourceId?: string;
  guid?: string;
  title: string;
  description?: string;
  publishedAt?: string;
  durationSec?: number;
  audioUrl?: string;
  pageUrl: string;
  language?: string;
  checksum?: string;
  metadata?: Record<string, unknown>;
};

export type TranscriptSegment = {
  startSec: number;
  endSec: number;
  text: string;
  speaker?: string;
  confidence?: number;
};

export type SemanticSegment = {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
  textExcerpt: string;
  title?: string;
  summary?: string;
};

export type EpisodeSummary = {
  oneLiner: string;
  overview: string;
  chapters: Array<{
    title: string;
    startSec: number;
    endSec: number;
    summary: string;
  }>;
  worthListening: {
    recommendation: "listen_full" | "listen_segments" | "skip";
    reason: string;
    bestSegments: Array<{ startSec: number; endSec: number; reason: string }>;
  };
  entities: Array<{ name: string; type: string; mentions: number }>;
};

export type Insight = {
  id: string;
  workspaceId: string;
  watchId: string;
  episodeId: string;
  segmentIndex?: number;
  claim: string;
  evidenceExcerpt: string;
  reasoning?: string;
  implication?: string;
  timestampStartSec: number;
  timestampEndSec: number;
  entities: Array<{ name: string; type: string }>;
  relevanceScore: number;
  confidence: number;
  groundednessScore?: number;
  outputLanguage: OutputLanguage;
  status: "draft" | "published" | "suppressed" | "retracted";
  promptVersion: string;
  model: string;
};

export type EpisodeProcessingResult = {
  episode: Episode;
  summary: EpisodeSummary;
  segments: SemanticSegment[];
  insights: Insight[];
};

