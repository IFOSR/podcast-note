import { mockInsightProvider, type InsightProvider } from "../../../packages/ai/src/index.ts";
import { formatTimestamp, stableId } from "../../../packages/core/src/format.ts";
import { publishableInsight } from "../../../packages/core/src/groundedness.ts";
import { buildSemanticSegments } from "../../../packages/core/src/segmenting.ts";
import type { Episode, EpisodeProcessingResult, Insight, TranscriptSegment, Watch } from "../../../packages/core/src/types.ts";

export type ProcessTranscriptInput = {
  workspaceId: string;
  watch: Watch;
  episode: Episode;
  transcriptSegments: TranscriptSegment[];
};

export async function processTranscript(
  input: ProcessTranscriptInput,
  insightProvider: InsightProvider
): Promise<EpisodeProcessingResult> {
  const segments = buildSemanticSegments(input.transcriptSegments);
  const summary = await insightProvider.summarizeEpisode({
    episode: input.episode,
    segments,
    outputLanguage: input.watch.outputLanguage
  });
  const draftInsights = await insightProvider.extractWatchInsights({
    workspaceId: input.workspaceId,
    episode: input.episode,
    watch: input.watch,
    segments,
    outputLanguage: input.watch.outputLanguage
  });

  const insights = draftInsights.map((insight) =>
    publishableInsight(insight, segments, input.watch.minRelevanceScore)
  );

  return {
    episode: input.episode,
    summary,
    segments,
    insights
  };
}

export async function processTranscriptFixture(input: ProcessTranscriptInput): Promise<EpisodeProcessingResult> {
  return processTranscript(input, mockInsightProvider);
}

export function markdownReport(result: EpisodeProcessingResult, watch: Watch): string {
  const published = result.insights.filter((insight) => insight.status === "published");
  const draft = result.insights.filter((insight) => insight.status === "draft");
  const suppressed = result.insights.filter((insight) => insight.status === "suppressed");

  return [
    `# ${result.episode.title}`,
    "",
    `Watch: ${watch.name}`,
    `Episode: ${result.episode.pageUrl}`,
    "",
    "## One-Liner",
    "",
    result.summary.oneLiner,
    "",
    "## Overview",
    "",
    result.summary.overview,
    "",
    "## Published Insights",
    "",
    published.length > 0 ? published.map(renderInsight).join("\n\n") : "No published insights.",
    "",
    "## Draft / Low Confidence",
    "",
    draft.length > 0 ? draft.map(renderInsight).join("\n\n") : "No draft insights.",
    "",
    "## Suppressed",
    "",
    suppressed.length > 0 ? suppressed.map(renderInsight).join("\n\n") : "No suppressed insights.",
    ""
  ].join("\n");
}

export function demoWatch(): Watch {
  return {
    id: "watch_demo_ai_agents",
    workspaceId: "workspace_demo",
    name: "AI Agent Trends",
    type: "topic",
    query: "AI agent workflow commercialization",
    outputLanguage: "zh-CN",
    includeTerms: ["AI agent", "agent workflow", "MCP", "commercialization", "workflow"],
    excludeTerms: ["sports agent", "real estate agent"],
    expandedTerms: ["Claude Code", "OpenAI", "Anthropic", "automation"],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30
  };
}

export function episodeFromFixture(fixture: TranscriptFixture): Episode {
  return {
    id: stableId("ep", fixture.episode.pageUrl),
    title: fixture.episode.title,
    description: fixture.episode.description,
    publishedAt: fixture.episode.publishedAt,
    durationSec: fixture.episode.durationSec,
    audioUrl: fixture.episode.audioUrl,
    pageUrl: fixture.episode.pageUrl,
    language: fixture.episode.language
  };
}

export type TranscriptFixture = {
  episode: {
    title: string;
    description?: string;
    publishedAt?: string;
    durationSec?: number;
    audioUrl?: string;
    pageUrl: string;
    language?: string;
  };
  transcript: TranscriptSegment[];
};

function renderInsight(insight: Insight): string {
  return [
    `- Claim: ${insight.claim}`,
    `  Evidence: ${formatTimestamp(insight.timestampStartSec)}-${formatTimestamp(insight.timestampEndSec)} "${insight.evidenceExcerpt}"`,
    `  Scores: relevance=${insight.relevanceScore.toFixed(2)}, confidence=${insight.confidence.toFixed(2)}, groundedness=${(insight.groundednessScore ?? 0).toFixed(2)}`,
    `  Status: ${insight.status}`
  ].join("\n");
}
