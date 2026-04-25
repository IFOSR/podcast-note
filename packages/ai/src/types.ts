import type { Episode, EpisodeSummary, Insight, OutputLanguage, SemanticSegment, TranscriptSegment, Watch } from "../../core/src/types.ts";

export type TranscriptProvider = {
  name: string;
  model: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionOutput>;
};

export type TranscriptionInput = {
  episode: Episode;
  audioUrl?: string;
  localFilePath?: string;
};

export type TranscriptionOutput = {
  language?: string;
  durationSec?: number;
  confidence?: number;
  segments: TranscriptSegment[];
};

export type InsightProvider = {
  name: string;
  model: string;
  summarizeEpisode(input: EpisodeSummaryInput): Promise<EpisodeSummary>;
  extractWatchInsights(input: WatchInsightInput): Promise<Insight[]>;
};

export type EpisodeSummaryInput = {
  episode: Episode;
  segments: SemanticSegment[];
  outputLanguage: OutputLanguage;
};

export type WatchInsightInput = {
  workspaceId: string;
  episode: Episode;
  watch: Watch;
  segments: SemanticSegment[];
  outputLanguage: OutputLanguage;
};

export const promptVersions = {
  watchExpand: "watch-expand-v1",
  metadataScore: "metadata-score-v1",
  segmentExtract: "segment-extract-v1",
  episodeSummary: "episode-summary-v1",
  watchInsight: "watch-insight-v1",
  groundednessJudge: "groundedness-judge-v1",
  briefDaily: "brief-daily-v1",
  briefWeekly: "brief-weekly-v1"
} as const;

