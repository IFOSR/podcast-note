import type { EpisodeDetail, EpisodeProcessingResult, Insight, Watch } from "../../../packages/core/src/types.ts";
import type { createRepositories } from "../../../packages/db/src/repositories.ts";

type Repositories = ReturnType<typeof createRepositories>;

export type LarkDeliveryClient = {
  sendTextMessage: (input: { chatId: string; text: string }) => Promise<{ messageId: string }>;
};

export type LarkDeliveryClientFactory = (installation: { chatId: string }) => LarkDeliveryClient;

export function formatEpisodeResultForLark(input: {
  watch: Watch;
  result: EpisodeProcessingResult;
  maxInsights?: number;
}): string {
  const publishedInsights = input.result.insights
    .filter((insight) => insight.status === "published")
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, input.maxInsights ?? 5);
  const lines = [
    "Podcast Note 处理完成",
    "",
    `监控任务：${input.watch.name}`,
    `播客单集：${input.result.episode.title}`,
    "",
    `一句话摘要：${input.result.summary.oneLiner}`,
    "",
    "核心摘要：",
    input.result.summary.overview,
    "",
    "核心观点：",
    publishedInsights.length > 0
      ? publishedInsights.map((insight, index) => formatInsightLine(insight, index)).join("\n\n")
      : "暂无达到发布阈值的核心观点。",
    "",
    `原始链接：${input.result.episode.pageUrl}`,
    "",
    "本条为当前可用的文字摘要推送，已包含本次处理完成的核心结果。"
  ];
  return lines.join("\n");
}

export async function deliverEpisodeResultToLark(input: {
  client: LarkDeliveryClient;
  chatId: string;
  watch: Watch;
  result: EpisodeProcessingResult;
}): Promise<{ messageId: string }> {
  return input.client.sendTextMessage({
    chatId: input.chatId,
    text: formatEpisodeResultForLark({ watch: input.watch, result: input.result })
  });
}

export async function deliverEpisodeResultOnceToLark(input: {
  repositories: Repositories;
  client: LarkDeliveryClient;
  chatId: string;
  watch: Watch;
  result: EpisodeProcessingResult;
}): Promise<
  | { status: "sent"; messageId: string }
  | { status: "already_sent"; messageId: string; deliveredAt: string }
> {
  const deliveryType = "episode_summary";
  const existing = input.repositories.getLarkDeliveryRecord({
    workspaceId: input.watch.workspaceId,
    watchId: input.watch.id,
    episodeId: input.result.episode.id,
    chatId: input.chatId,
    deliveryType
  });
  if (existing) {
    return {
      status: "already_sent",
      messageId: existing.providerMessageId,
      deliveredAt: existing.deliveredAt
    };
  }
  const message = await deliverEpisodeResultToLark(input);
  input.repositories.createLarkDeliveryRecord({
    workspaceId: input.watch.workspaceId,
    watchId: input.watch.id,
    episodeId: input.result.episode.id,
    chatId: input.chatId,
    deliveryType,
    providerMessageId: message.messageId
  });
  return { status: "sent", messageId: message.messageId };
}

export async function deliverPendingLarkEpisodeResults(input: {
  repositories: Repositories;
  client: LarkDeliveryClient;
  workspaceId: string;
  chatId: string;
  limit?: number;
}): Promise<{ sent: number; skipped: number; considered: number }> {
  const details = input.repositories.listProcessedEpisodeDetailsForWorkspace({
    workspaceId: input.workspaceId,
    limit: input.limit ?? 50
  });
  let sent = 0;
  let skipped = 0;
  for (const detail of details) {
    const watch = watchFromEpisodeDetail(input.workspaceId, detail);
    if (!watch || !detail.summary) continue;
    const delivery = await deliverEpisodeResultOnceToLark({
      repositories: input.repositories,
      client: input.client,
      chatId: input.chatId,
      watch,
      result: {
        episode: detail.episode,
        summary: detail.summary,
        insights: detail.insights,
        segments: []
      }
    });
    if (delivery.status === "sent") sent += 1;
    else skipped += 1;
  }
  return { sent, skipped, considered: details.length };
}

export async function deliverEpisodeResultToAllLarkInstallations(input: {
  repositories: Repositories;
  clientFactory: LarkDeliveryClientFactory;
  workspaceId: string;
  appId?: string;
  watch: Watch;
  result: EpisodeProcessingResult;
}): Promise<{ installations: number; sent: number; skipped: number; failed: number }> {
  const installations = input.repositories.listActiveLarkBotInstallationsForWorkspace(input.workspaceId, input.appId);
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const installation of installations) {
    try {
      const delivery = await deliverEpisodeResultOnceToLark({
        repositories: input.repositories,
        client: input.clientFactory(installation),
        chatId: installation.chatId,
        watch: input.watch,
        result: input.result
      });
      if (delivery.status === "sent") sent += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({
        ok: false,
        message: "Lark delivery to installation failed",
        chatId: installation.chatId,
        episodeId: input.result.episode.id,
        watchId: input.watch.id,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }
  return { installations: installations.length, sent, skipped, failed };
}

export async function deliverPendingLarkEpisodeResultsToAllInstallations(input: {
  repositories: Repositories;
  clientFactory: LarkDeliveryClientFactory;
  workspaceId: string;
  appId?: string;
  limit?: number;
}): Promise<{ installations: number; sent: number; skipped: number; considered: number; failed: number }> {
  const installations = input.repositories.listActiveLarkBotInstallationsForWorkspace(input.workspaceId, input.appId);
  let sent = 0;
  let skipped = 0;
  let considered = 0;
  let failed = 0;
  for (const installation of installations) {
    try {
      const result = await deliverPendingLarkEpisodeResults({
        repositories: input.repositories,
        client: input.clientFactory(installation),
        workspaceId: input.workspaceId,
        chatId: installation.chatId,
        limit: input.limit
      });
      sent += result.sent;
      skipped += result.skipped;
      considered += result.considered;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({
        ok: false,
        message: "Lark pending delivery to installation failed",
        chatId: installation.chatId,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }
  return { installations: installations.length, sent, skipped, considered, failed };
}

function formatInsightLine(insight: Insight, index: number): string {
  return [
    `${index + 1}. ${insight.claim}`,
    `证据：${formatTimestamp(insight.timestampStartSec)}-${formatTimestamp(insight.timestampEndSec)} · ${insight.evidenceExcerpt}`
  ].join("\n");
}

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const restSeconds = safeSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${restSeconds.toString().padStart(2, "0")}`;
}

function watchFromEpisodeDetail(workspaceId: string, detail: EpisodeDetail): Watch | undefined {
  const firstInsight = detail.insights[0];
  if (!firstInsight) return undefined;
  return {
    id: firstInsight.watchId,
    workspaceId,
    name: "Podcast Note 监控任务",
    type: "podcast",
    query: detail.episode.pageUrl,
    outputLanguage: firstInsight.outputLanguage,
    includeTerms: [],
    excludeTerms: [],
    expandedTerms: [],
    minRelevanceScore: 0,
    frequency: "daily",
    backfillDays: 0,
    enabled: true
  };
}
