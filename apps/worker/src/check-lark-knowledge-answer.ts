import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import type { Episode, EpisodeProcessingResult, Watch } from "../../../packages/core/src/types.ts";
import { answerLarkKnowledgeQuestion, larkKnowledgeTypingIndicatorText, searchWorkspaceKnowledge } from "./lark-knowledge-answer.ts";
import { handleLarkMessageReceivedEvent } from "./lark-bot-events.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-lark-knowledge-"));
const dbPath = join(dir, "check.sqlite");

try {
  const repositories = createRepositories(openPodcastNoteDb(dbPath));
  const user = repositories.upsertUser({ id: "user_lark_knowledge", email: "lark-knowledge@example.invalid", name: "Lark Knowledge" });
  const workspace = repositories.ensurePersonalWorkspaceForUser(user.id);
  const watch: Watch = {
    id: "watch_lark_knowledge",
    workspaceId: workspace.id,
    name: "AI Agent 商业化",
    type: "topic",
    query: "AI Agent 商业化",
    outputLanguage: "zh-CN",
    includeTerms: ["AI Agent"],
    excludeTerms: [],
    expandedTerms: ["workflow", "企业工作流"],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30,
    enabled: true
  };
  const episode: Episode = {
    id: "episode_lark_knowledge",
    title: "Agent Workflow Evidence",
    publishedAt: "2026-06-18T08:00:00.000Z",
    durationSec: 1200,
    pageUrl: "https://example.invalid/agent-workflow",
    audioUrl: "https://example.invalid/agent-workflow.mp3"
  };
  const result: EpisodeProcessingResult = {
    episode,
    summary: {
      oneLiner: "AI Agent 商业化会转向企业工作流集成。",
      overview: "本集认为客户需要审计、权限和可控执行，所以 Agent 会嵌入企业工作流。",
      chapters: [{ title: "Workflow", startSec: 0, endSec: 600, summary: "讨论企业工作流集成。" }],
      worthListening: {
        recommendation: "listen_segments",
        reason: "有可引用证据。",
        bestSegments: [{ startSec: 90, endSec: 140, reason: "核心判断。" }]
      },
      entities: [{ name: "AI Agent", type: "concept", mentions: 3 }]
    },
    segments: [{
      index: 0,
      startSec: 90,
      endSec: 140,
      text: "AI Agent 产品竞争会转向企业工作流集成，因为客户需要审计和可控执行。",
      textExcerpt: "AI Agent 产品竞争会转向企业工作流集成。",
      title: "Workflow",
      summary: "企业工作流集成。"
    }],
    insights: [{
      id: "insight_lark_knowledge",
      workspaceId: workspace.id,
      watchId: watch.id,
      episodeId: episode.id,
      segmentIndex: 0,
      claim: "AI Agent 产品竞争转向企业工作流集成",
      evidenceExcerpt: "AI Agent 产品竞争会转向企业工作流集成，因为客户需要审计和可控执行。",
      timestampStartSec: 90,
      timestampEndSec: 140,
      entities: [{ name: "AI Agent", type: "concept" }],
      relevanceScore: 0.94,
      confidence: 0.92,
      groundednessScore: 0.9,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "smoke"
    }]
  };
  repositories.upsertWatch(watch);
  repositories.upsertEpisode(episode);
  repositories.saveProcessingResult(result, watch, "smoke");

  const matches = searchWorkspaceKnowledge({
    repositories,
    workspaceId: workspace.id,
    question: "AI Agent 商业化为什么会走向企业工作流？"
  });
  if (matches.length === 0 || matches[0]?.insight?.id !== "insight_lark_knowledge") {
    throw new Error(`Expected knowledge search to find published insight, got ${JSON.stringify(matches)}.`);
  }

  const sentMessages: string[] = [];
  const client = {
    sendTextMessage: async (input: { chatId: string; text: string }) => {
      sentMessages.push(input.text);
      return { messageId: `om_${sentMessages.length}` };
    }
  };

  const answer = await answerLarkKnowledgeQuestion({
    repositories,
    workspaceId: workspace.id,
    client,
    event: {
      chat_id: "oc_knowledge",
      chat_type: "p2p",
      sender_id: "ou_knowledge",
      content: "AI Agent 商业化为什么会走向企业工作流？",
      message_type: "text"
    }
  });
  if (!answer.handled || !sentMessages.at(-1)?.includes("根据已处理播客知识库") || !sentMessages.at(-1)?.includes("01:30-02:20")) {
    throw new Error(`Expected grounded knowledge answer, got result=${JSON.stringify(answer)} reply=${sentMessages.at(-1)}.`);
  }
  if (sentMessages.at(-2) !== larkKnowledgeTypingIndicatorText) {
    throw new Error(`Expected typing indicator before grounded answer, got ${JSON.stringify(sentMessages.slice(-2))}.`);
  }

  await handleLarkMessageReceivedEvent({
    context: {
      repositories,
      workspaceId: workspace.id,
      appId: "cli_lark_knowledge",
      tenantKey: "tenant_knowledge",
      client,
      eventKey: "im.message.receive_v1"
    },
    event: {
      chat_id: "oc_knowledge",
      chat_type: "p2p",
      sender_id: "ou_knowledge",
      content: "这个知识库里提到企业工作流了吗？",
      message_type: "text"
    }
  });
  if (sentMessages.at(-1)?.includes("个人接收已连接")) {
    throw new Error(`Question should not fall back to binding reply: ${sentMessages.at(-1)}.`);
  }
  if (sentMessages.at(-2) !== larkKnowledgeTypingIndicatorText) {
    throw new Error(`Expected typing indicator before routed knowledge answer, got ${JSON.stringify(sentMessages.slice(-2))}.`);
  }

  await handleLarkMessageReceivedEvent({
    context: {
      repositories,
      workspaceId: workspace.id,
      appId: "cli_lark_knowledge",
      tenantKey: "tenant_knowledge",
      client,
      eventKey: "im.message.receive_v1"
    },
    event: {
      chat_id: "oc_knowledge",
      chat_type: "p2p",
      sender_id: "ou_knowledge",
      content: "火星移民成本是多少？",
      message_type: "text"
    }
  });
  if (!sentMessages.at(-1)?.includes("知识库里还没有找到") || sentMessages.at(-1)?.includes("个人接收已连接")) {
    throw new Error(`No-hit question should return an explicit no-knowledge answer, got ${sentMessages.at(-1)}.`);
  }
  if (sentMessages.at(-2) !== larkKnowledgeTypingIndicatorText) {
    throw new Error(`Expected typing indicator before no-hit answer, got ${JSON.stringify(sentMessages.slice(-2))}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    matches: matches.length,
    replies: sentMessages.map((message) => message.split("\n")[0])
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
