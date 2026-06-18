import type { EpisodeDetail, EpisodeProcessingResult, Insight, Watch } from "../../../packages/core/src/types.ts";
import type { createRepositories, WikiUpdateProposalRecord } from "../../../packages/db/src/repositories.ts";

type Repositories = ReturnType<typeof createRepositories>;

export type LarkDeliveryClient = {
  sendTextMessage: (input: { chatId: string; text: string }) => Promise<{ messageId: string }>;
};

export type LarkDeliveryClientFactory = (installation: { chatId: string }) => LarkDeliveryClient;

type PendingWikiProposalSummaryItem = WikiUpdateProposalRecord & {
  episodeTitle?: string;
  timestamp?: string;
};

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

export function formatPendingWikiProposalSummaryForLark(input: {
  workspaceId: string;
  date: string;
  proposals: PendingWikiProposalSummaryItem[];
  maxItems?: number;
}): string {
  const sorted = [...input.proposals].sort((left, right) => {
    const typeOrder = proposalTypeWeight(left.proposalType) - proposalTypeWeight(right.proposalType);
    if (typeOrder !== 0) return typeOrder;
    return left.targetPath.localeCompare(right.targetPath);
  });
  const maxItems = input.maxItems ?? 10;
  const shown = sorted.slice(0, maxItems);
  const hidden = Math.max(0, sorted.length - shown.length);
  const countsByType = countBy(sorted, (proposal) => proposal.proposalType);
  const targetCount = new Set(sorted.map((proposal) => proposal.targetPath)).size;
  const lines = [
    "Podcast Note 知识库待审建议",
    "",
    `日期：${input.date}`,
    `Workspace：${input.workspaceId}`,
    `Pending proposals：${sorted.length}`,
    `影响页面：${targetCount}`,
    `类型分布：${formatTypeCounts(countsByType)}`,
    "",
    "待审列表：",
    shown.length > 0
      ? shown.map((proposal, index) => formatProposalSummaryLine(proposal, index)).join("\n\n")
      : "今日暂无 pending proposal。",
    hidden > 0 ? `\n还有 ${hidden} 条未展示，请在 Obsidian Inbox 或 CLI 查看完整列表。` : "",
    "",
    "操作：",
    "CLI 查看：bun apps/worker/src/cli.ts query wiki-proposals --status pending",
    "CLI 审批：bun apps/worker/src/cli.ts wiki:proposal-status <proposal_id> approved"
  ];
  return lines.filter((line) => line !== "").join("\n");
}

export async function deliverPendingWikiProposalSummaryOnceToLark(input: {
  repositories: Repositories;
  client: LarkDeliveryClient;
  workspaceId: string;
  chatId: string;
  now?: string;
  limit?: number;
  maxItems?: number;
}): Promise<
  | { status: "sent"; messageId: string; proposalCount: number; deliveryKey: string }
  | { status: "already_sent"; messageId: string; deliveredAt: string; proposalCount: number; deliveryKey: string }
  | { status: "skipped_empty"; proposalCount: 0; deliveryKey: string }
> {
  const date = isoDate(input.now ?? new Date().toISOString());
  const deliveryType = "wiki_pending_proposal_summary";
  const deliveryKey = `wiki-pending-proposals:${date}`;
  const proposals = listPendingWikiProposalsForDate(input.repositories, {
    workspaceId: input.workspaceId,
    date,
    limit: input.limit ?? 100
  });
  if (proposals.length === 0) {
    return { status: "skipped_empty", proposalCount: 0, deliveryKey };
  }
  const existing = input.repositories.getLarkDeliveryRecordByKey({
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    deliveryType,
    deliveryKey
  });
  if (existing) {
    return {
      status: "already_sent",
      messageId: existing.providerMessageId,
      deliveredAt: existing.deliveredAt,
      proposalCount: proposals.length,
      deliveryKey
    };
  }
  const enriched = enrichWikiProposalSummaryItems(input.repositories, input.workspaceId, proposals);
  const message = await input.client.sendTextMessage({
    chatId: input.chatId,
    text: formatPendingWikiProposalSummaryForLark({
      workspaceId: input.workspaceId,
      date,
      proposals: enriched,
      maxItems: input.maxItems
    })
  });
  input.repositories.createLarkDeliveryRecordByKey({
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    deliveryType,
    deliveryKey,
    providerMessageId: message.messageId
  });
  return { status: "sent", messageId: message.messageId, proposalCount: proposals.length, deliveryKey };
}

export async function deliverPendingWikiProposalSummaryToAllLarkInstallations(input: {
  repositories: Repositories;
  clientFactory: LarkDeliveryClientFactory;
  workspaceId: string;
  appId?: string;
  now?: string;
  limit?: number;
  maxItems?: number;
}): Promise<{ installations: number; sent: number; skipped: number; empty: number; proposalCount: number; failed: number }> {
  const installations = input.repositories.listActiveLarkBotInstallationsForWorkspace(input.workspaceId, input.appId);
  let sent = 0;
  let skipped = 0;
  let empty = 0;
  let proposalCount = 0;
  let failed = 0;
  for (const installation of installations) {
    try {
      const result = await deliverPendingWikiProposalSummaryOnceToLark({
        repositories: input.repositories,
        client: input.clientFactory(installation),
        workspaceId: input.workspaceId,
        chatId: installation.chatId,
        now: input.now,
        limit: input.limit,
        maxItems: input.maxItems
      });
      proposalCount = Math.max(proposalCount, result.proposalCount);
      if (result.status === "sent") sent += 1;
      else if (result.status === "already_sent") skipped += 1;
      else empty += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({
        ok: false,
        message: "Lark pending wiki proposal summary delivery failed",
        chatId: installation.chatId,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }
  return { installations: installations.length, sent, skipped, empty, proposalCount, failed };
}

function formatInsightLine(insight: Insight, index: number): string {
  return [
    `${index + 1}. ${insight.claim}`,
    `证据：${formatTimestamp(insight.timestampStartSec)}-${formatTimestamp(insight.timestampEndSec)} · ${insight.evidenceExcerpt}`
  ].join("\n");
}

function listPendingWikiProposalsForDate(repositories: Repositories, input: {
  workspaceId: string;
  date: string;
  limit: number;
}): WikiUpdateProposalRecord[] {
  return repositories
    .listWikiUpdateProposals({
      workspaceId: input.workspaceId,
      status: "pending",
      limit: input.limit
    })
    .filter((proposal) => isoDate(proposal.createdAt) === input.date || isoDate(proposal.updatedAt) === input.date);
}

function enrichWikiProposalSummaryItems(
  repositories: Repositories,
  workspaceId: string,
  proposals: WikiUpdateProposalRecord[]
): PendingWikiProposalSummaryItem[] {
  const detailByEpisode = new Map<string, EpisodeDetail | undefined>();
  return proposals.map((proposal) => {
    if (!detailByEpisode.has(proposal.episodeId)) {
      detailByEpisode.set(proposal.episodeId, repositories.getEpisodeDetailForWorkspace({
        workspaceId,
        episodeId: proposal.episodeId
      }));
    }
    const detail = detailByEpisode.get(proposal.episodeId);
    const insight = proposal.insightId
      ? detail?.insights.find((item) => item.id === proposal.insightId)
      : undefined;
    return {
      ...proposal,
      episodeTitle: detail?.episode.title,
      timestamp: insight ? `${formatTimestamp(insight.timestampStartSec)}-${formatTimestamp(insight.timestampEndSec)}` : undefined
    };
  });
}

function formatProposalSummaryLine(proposal: PendingWikiProposalSummaryItem, index: number): string {
  return [
    `${index + 1}. ${proposal.title}`,
    `类型：${proposal.proposalType} · 目标：${proposal.targetPath}`,
    proposal.episodeTitle ? `来源：${proposal.episodeTitle}` : `EpisodeID：${proposal.episodeId}`,
    proposal.timestamp ? `时间戳：${proposal.timestamp}` : undefined,
    proposal.insightId ? `InsightID：${proposal.insightId}` : undefined,
    `ProposalID：${proposal.id}`
  ].filter(Boolean).join("\n");
}

function proposalTypeWeight(type: WikiUpdateProposalRecord["proposalType"]): number {
  const weights: Record<WikiUpdateProposalRecord["proposalType"], number> = {
    flag_conflict: 0,
    revise_summary: 1,
    create_page: 2,
    append_evidence: 3,
    add_crosslink: 4
  };
  return weights[type];
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function formatTypeCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0
    ? entries.map(([type, count]) => `${type} ${count}`).join(" / ")
    : "none";
}

function isoDate(input: string): string {
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? input.slice(0, 10) : date.toISOString().slice(0, 10);
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
