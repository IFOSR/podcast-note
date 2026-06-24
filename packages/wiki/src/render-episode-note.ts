import type { WikiEpisodeContext } from "./types.ts";
import { formatTimestamp, frontmatter, isoDate, wikiLink } from "./format.ts";

export function renderEpisodeSourceNote(input: WikiEpisodeContext): string {
  const { result, watch } = input;
  const episode = result.episode;
  const processedAt = input.processedAt ?? new Date().toISOString();
  const published = result.insights.filter((insight) => insight.status === "published");
  const others = result.insights.filter((insight) => insight.status !== "published");
  const podcast = String(episode.metadata?.["podcastTitle"] ?? episode.metadata?.["feedTitle"] ?? episode.sourceId ?? "Unknown Podcast");
  const date = isoDate(episode.publishedAt, processedAt);

  return [
    frontmatter({
      type: "podcast_episode",
      episode_id: episode.id,
      source_id: episode.sourceId,
      watch_ids: [watch.id],
      title: episode.title,
      podcast: wikiLink(podcast),
      published_at: date,
      processed_at: processedAt,
      duration_sec: episode.durationSec,
      page_url: episode.pageUrl,
      audio_url: episode.audioUrl,
      transcript_provider: input.transcriptProvider,
      summary_model: input.summaryModel,
      tags: ["podcast/source"]
    }),
    "",
    `# ${episode.title}`,
    "",
    "<!-- podcast-note:start -->",
    "",
    "## 一句话",
    "",
    result.summary.oneLiner,
    "",
    "## 总结",
    "",
    result.summary.overview,
    "",
    "## 值得听吗",
    "",
    renderWorthListening(result.summary.worthListening),
    "",
    "## 章节",
    "",
    result.summary.chapters.length > 0
      ? result.summary.chapters.map((chapter) => `- ${formatTimestamp(chapter.startSec)}-${formatTimestamp(chapter.endSec)} ${chapter.title}: ${chapter.summary}`).join("\n")
      : "- 暂无章节。",
    "",
    "## Entities",
    "",
    result.summary.entities.length > 0
      ? result.summary.entities.map((entity) => `- ${wikiLink(entity.name)} (${entity.type}, mentions: ${entity.mentions})`).join("\n")
      : "- 暂无实体。",
    "",
    "## Insights",
    "",
    published.length > 0 ? published.map(renderInsight).join("\n\n") : "No published insights.",
    "",
    "## Draft / Low Confidence",
    "",
    others.length > 0 ? others.map(renderInsight).join("\n\n") : "No draft or suppressed insights.",
    "",
    "## Transcript Excerpts",
    "",
    result.segments.slice(0, 12).map((segment) => `- ${formatTimestamp(segment.startSec)}-${formatTimestamp(segment.endSec)} ${segment.textExcerpt}`).join("\n"),
    "",
    "<!-- podcast-note:end -->",
    ""
  ].join("\n");
}

function renderInsight(insight: WikiEpisodeContext["result"]["insights"][number]): string {
  const entities = insight.entities.length > 0 ? insight.entities.map((entity) => wikiLink(entity.name)).join(", ") : "None";
  return [
    `### ${insight.claim}`,
    "",
    `Claim:: ${insight.claim}`,
    `Evidence:: ${insight.evidenceExcerpt}`,
    `Timestamp:: ${formatTimestamp(insight.timestampStartSec)}-${formatTimestamp(insight.timestampEndSec)}`,
    `Entities:: ${entities}`,
    `Relevance:: ${insight.relevanceScore.toFixed(2)}`,
    `Confidence:: ${insight.confidence.toFixed(2)}`,
    `Groundedness:: ${(insight.groundednessScore ?? 0).toFixed(2)}`,
    `Promote:: ${insight.status === "published" ? "pending" : "no"}`,
    `InsightID:: ${insight.id}`
  ].join("\n");
}

function renderWorthListening(worth: WikiEpisodeContext["result"]["summary"]["worthListening"]): string {
  const segments = worth.bestSegments.length > 0
    ? worth.bestSegments.map((segment) => `- ${formatTimestamp(segment.startSec)}-${formatTimestamp(segment.endSec)} ${segment.reason}`).join("\n")
    : "- 暂无推荐片段。";
  return [
    `Recommendation:: ${worth.recommendation}`,
    `Reason:: ${worth.reason}`,
    "",
    segments
  ].join("\n");
}
