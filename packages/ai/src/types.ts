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

export type IntentAssistantProvider = {
  name: string;
  model: string;
  analyze(input: IntentAssistantInput): Promise<IntentAssistantOutput>;
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

export type IntentAssistantInput = {
  message: string;
  outputLanguage: OutputLanguage;
  context?: {
    workspaceName?: string;
    activeWatches?: Array<{
      id: string;
      name: string;
      query: string;
      enabled: boolean;
      frequency: string;
    }>;
    recentEpisodes?: Array<{
      id: string;
      title: string;
      oneLiner?: string;
      pageUrl?: string;
      publishedAt?: string;
    }>;
  };
};

export type IntentAssistantIntent =
  | "process_episode"
  | "create_monitor"
  | "ask_knowledge"
  | "check_status"
  | "manage_monitor"
  | "help"
  | "unknown";

export type IntentAssistantOutput = {
  intent: IntentAssistantIntent;
  confidence: number;
  reasoning: string;
  answer: string;
  extracted: {
    url?: string;
    target?: string;
    channel?: string;
    keywords: string[];
    frequency?: "realtime" | "daily" | "weekly";
  };
  suggestedAction: {
    type: "none" | "submit_process_link" | "submit_monitor_target" | "open_monitor_page" | "open_feishu_page";
    label: string;
    payload: Record<string, string | number | boolean>;
  };
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
