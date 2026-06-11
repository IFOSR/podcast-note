import type { EpisodeProcessingResult, Watch } from "../../../packages/core/src/types.ts";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { deliverEpisodeResultOnceToLark, deliverEpisodeResultToLark, deliverPendingLarkEpisodeResults, deliverPendingLarkEpisodeResultsToAllInstallations, formatEpisodeResultForLark } from "./lark-delivery.ts";

const watch: Watch = {
  id: "watch_delivery",
  workspaceId: "workspace_delivery",
  name: "小宇宙频道监控",
  type: "podcast",
  query: "https://www.xiaoyuzhoufm.com/podcast/example",
  outputLanguage: "zh-CN",
  includeTerms: [],
  excludeTerms: [],
  expandedTerms: [],
  minRelevanceScore: 0.6,
  frequency: "daily",
  backfillDays: 3,
  enabled: true
};

const result: EpisodeProcessingResult = {
  episode: {
    id: "episode_delivery",
    title: "E225｜SaaS业数千亿市值蒸发：AI如何变革组织架构?",
    pageUrl: "https://www.xiaoyuzhoufm.com/episode/example",
    audioUrl: "https://example.com/audio.mp3"
  },
  summary: {
    oneLiner: "AI 正在重塑 SaaS 的组织结构和价值分配。",
    overview: "这一集讨论了 AI 对 SaaS 公司估值、组织形态和团队协作方式的影响。",
    chapters: [],
    worthListening: {
      recommendation: "listen_segments",
      reason: "适合听核心片段。",
      bestSegments: []
    },
    entities: []
  },
  segments: [],
  insights: [
    {
      id: "insight_delivery_1",
      workspaceId: watch.workspaceId,
      watchId: watch.id,
      episodeId: "episode_delivery",
      claim: "AI 让 SaaS 的价值从席位授权转向业务结果。",
      evidenceExcerpt: "客户不再只为工具付费，而是为可度量的结果付费。",
      timestampStartSec: 120,
      timestampEndSec: 188,
      entities: [],
      relevanceScore: 0.91,
      confidence: 0.86,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "test",
      model: "test"
    }
  ]
};

const formatted = formatEpisodeResultForLark({ watch, result });
if (!formatted.includes("Podcast Note 处理完成")) {
  throw new Error(`Delivery message missed completion title: ${formatted}`);
}
if (!formatted.includes("AI 让 SaaS 的价值从席位授权转向业务结果")) {
  throw new Error(`Delivery message missed insight: ${formatted}`);
}
if (!formatted.includes("02:00-03:08")) {
  throw new Error(`Delivery message missed timestamp: ${formatted}`);
}
if (formatted.includes("将在后续版本") || formatted.includes("补充发送")) {
  throw new Error(`Delivery message should not promise follow-up file cards: ${formatted}`);
}

const sent: Array<{ chatId: string; text: string }> = [];
await deliverEpisodeResultToLark({
  client: {
    sendTextMessage: async (message) => {
      sent.push(message);
      return { messageId: "om_delivery" };
    }
  },
  chatId: "oc_delivery",
  watch,
  result
});

if (sent.length !== 1 || sent[0]?.chatId !== "oc_delivery") {
  throw new Error(`Expected one Lark delivery message, got ${JSON.stringify(sent)}`);
}

const repositories = createRepositories(openPodcastNoteDb(join(await mkdtemp(join(tmpdir(), "podcast-note-lark-delivery-")), "test.sqlite")));
const user = repositories.upsertUser({
  id: "user_lark_delivery",
  email: "lark-delivery@example.invalid",
  name: "Lark Delivery"
});
const workspace = repositories.ensurePersonalWorkspaceForUser(user.id);
const watchForDb = { ...watch, workspaceId: workspace.id };
repositories.upsertWatch(watchForDb);
repositories.upsertEpisode(result.episode);

const dedupedSent: Array<{ chatId: string; text: string }> = [];
const first = await deliverEpisodeResultOnceToLark({
  repositories,
  client: {
    sendTextMessage: async (message) => {
      dedupedSent.push(message);
      return { messageId: "om_first" };
    }
  },
  chatId: "oc_delivery",
  watch: watchForDb,
  result
});
if (first.status !== "sent" || dedupedSent.length !== 1) {
  throw new Error(`Expected first delivery to send, got ${JSON.stringify(first)} sent=${dedupedSent.length}`);
}

const second = await deliverEpisodeResultOnceToLark({
  repositories,
  client: {
    sendTextMessage: async (message) => {
      dedupedSent.push(message);
      return { messageId: "om_second" };
    }
  },
  chatId: "oc_delivery",
  watch: watchForDb,
  result
});
if (second.status !== "already_sent" || dedupedSent.length !== 1) {
  throw new Error(`Expected duplicate delivery to skip, got ${JSON.stringify(second)} sent=${dedupedSent.length}`);
}

const savedResult: EpisodeProcessingResult = {
  ...result,
  insights: result.insights.map((insight) => ({
    ...insight,
    workspaceId: workspace.id,
    watchId: watchForDb.id
  }))
};
repositories.saveProcessingResult(savedResult, watchForDb, "test");
const pendingResult: EpisodeProcessingResult = {
  ...savedResult,
  episode: {
    id: "episode_pending_delivery",
    title: "新生成但还没有推送的单集",
    pageUrl: "https://www.xiaoyuzhoufm.com/episode/pending-delivery",
    audioUrl: "https://example.com/pending-delivery.mp3"
  },
  insights: savedResult.insights.map((insight) => ({
    ...insight,
    id: "insight_pending_delivery_1",
    episodeId: "episode_pending_delivery"
  }))
};
repositories.upsertEpisode(pendingResult.episode);
repositories.saveProcessingResult(pendingResult, watchForDb, "test");

const pendingSent: Array<{ chatId: string; text: string }> = [];
const pending = await deliverPendingLarkEpisodeResults({
  repositories,
  client: {
    sendTextMessage: async (message) => {
      pendingSent.push(message);
      return { messageId: `om_pending_${pendingSent.length}` };
    }
  },
  workspaceId: workspace.id,
  chatId: "oc_delivery",
  limit: 10
});
if (pending.sent !== 1 || pending.skipped !== 1 || pending.considered !== 2 || pendingSent.length !== 1) {
  throw new Error(`Expected pending delivery to send only undelivered result, got ${JSON.stringify(pending)} sent=${pendingSent.length}`);
}
if (!pendingSent[0]?.text.includes("新生成但还没有推送的单集")) {
  throw new Error(`Pending delivery missed the new episode content: ${JSON.stringify(pendingSent)}`);
}

const secondChatSent: Array<{ chatId: string; text: string }> = [];
const secondChat = await deliverPendingLarkEpisodeResults({
  repositories,
  client: {
    sendTextMessage: async (message) => {
      secondChatSent.push(message);
      return { messageId: `om_second_chat_${secondChatSent.length}` };
    }
  },
  workspaceId: workspace.id,
  chatId: "oc_delivery_colleague",
  limit: 10
});
if (secondChat.sent !== 2 || secondChat.skipped !== 0 || secondChat.considered !== 2 || secondChatSent.length !== 2) {
  throw new Error(`Expected a different Lark chat to receive all processed results once, got ${JSON.stringify(secondChat)} sent=${secondChatSent.length}`);
}

const secondChatAgain = await deliverPendingLarkEpisodeResults({
  repositories,
  client: {
    sendTextMessage: async (message) => {
      secondChatSent.push(message);
      return { messageId: `om_second_chat_again_${secondChatSent.length}` };
    }
  },
  workspaceId: workspace.id,
  chatId: "oc_delivery_colleague",
  limit: 10
});
if (secondChatAgain.sent !== 0 || secondChatAgain.skipped !== 2 || secondChatSent.length !== 2) {
  throw new Error(`Expected duplicate delivery to colleague chat to skip all results, got ${JSON.stringify(secondChatAgain)} sent=${secondChatSent.length}`);
}

repositories.upsertLarkBotInstallation({
  id: "lark_bot_owner",
  workspaceId: workspace.id,
  appId: "cli_delivery_app",
  tenantKey: "tenant_delivery",
  chatId: "oc_owner",
  chatName: "Owner",
  installedAt: "2026-06-11T00:00:00.000Z"
});
repositories.upsertLarkBotInstallation({
  id: "lark_bot_colleague",
  workspaceId: workspace.id,
  appId: "cli_delivery_app",
  tenantKey: "tenant_delivery",
  chatId: "oc_colleague",
  chatName: "Colleague",
  installedAt: "2026-06-11T00:01:00.000Z"
});
const allInstallationsSent: Array<{ chatId: string; text: string }> = [];
const allInstallations = await deliverPendingLarkEpisodeResultsToAllInstallations({
  repositories,
  clientFactory: () => ({
    sendTextMessage: async (message) => {
      allInstallationsSent.push(message);
      return { messageId: `om_all_${allInstallationsSent.length}` };
    }
  }),
  workspaceId: workspace.id,
  appId: "cli_delivery_app",
  limit: 10
});
if (allInstallations.installations !== 2 || allInstallations.sent !== 4 || allInstallations.skipped !== 0 || allInstallations.considered !== 4 || allInstallationsSent.length !== 4) {
  throw new Error(`Expected all active Lark installations to receive all results once, got ${JSON.stringify(allInstallations)} sent=${allInstallationsSent.length}`);
}
const allInstallationsAgain = await deliverPendingLarkEpisodeResultsToAllInstallations({
  repositories,
  clientFactory: () => ({
    sendTextMessage: async (message) => {
      allInstallationsSent.push(message);
      return { messageId: `om_all_again_${allInstallationsSent.length}` };
    }
  }),
  workspaceId: workspace.id,
  appId: "cli_delivery_app",
  limit: 10
});
if (allInstallationsAgain.sent !== 0 || allInstallationsAgain.skipped !== 4 || allInstallationsSent.length !== 4) {
  throw new Error(`Expected repeated all-installation delivery to skip all results, got ${JSON.stringify(allInstallationsAgain)} sent=${allInstallationsSent.length}`);
}

console.log("Lark delivery check passed.");
