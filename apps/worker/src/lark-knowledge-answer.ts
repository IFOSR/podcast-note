import type { Episode, Insight, Watch } from "../../../packages/core/src/types.ts";
import type { createRepositories } from "../../../packages/db/src/index.ts";
import type { LarkBotEventClient, LarkMessageReceivedEvent } from "./lark-bot-events.ts";

type Repositories = ReturnType<typeof createRepositories>;

export type LarkKnowledgeAnswerResult = {
  handled: boolean;
  reply?: string;
  matches?: KnowledgeMatch[];
};

export type LarkKnowledgeAnswerInput = {
  repositories: Repositories;
  workspaceId: string;
  client: LarkBotEventClient;
  event: LarkMessageReceivedEvent;
  maxEpisodes?: number;
  maxMatches?: number;
};

type KnowledgeDoc = {
  kind: "insight" | "summary";
  episode: Episode;
  watch?: Watch;
  insight?: Insight;
  title: string;
  body: string;
  evidence?: string;
  timestampStartSec?: number;
  timestampEndSec?: number;
};

export type KnowledgeMatch = KnowledgeDoc & {
  score: number;
};

const noAnswerHelp = [
  "你可以：",
  "1. 发送播客单集链接，我会先处理并沉淀进知识库。",
  "2. 说「监控 节目名」创建持续监控任务。",
  "3. 发送「状态」查看已有监控和处理队列。"
].join("\n");

export const larkKnowledgeTypingIndicatorText = "⌨️ 正在敲键盘，我在检索播客知识库...";

export async function answerLarkKnowledgeQuestion(input: LarkKnowledgeAnswerInput): Promise<LarkKnowledgeAnswerResult> {
  if (input.event.chat_type !== "p2p" || !input.event.chat_id) return { handled: false };
  const question = normalizeQuestion(input.event.content ?? "");
  if (!question || isBindingOrHelpMessage(question)) return { handled: false };

  await input.client.sendTextMessage({
    chatId: input.event.chat_id,
    text: larkKnowledgeTypingIndicatorText
  });

  const matches = searchWorkspaceKnowledge({
    repositories: input.repositories,
    workspaceId: input.workspaceId,
    question,
    maxEpisodes: input.maxEpisodes,
    maxMatches: input.maxMatches
  });
  const reply = matches.length > 0
    ? renderKnowledgeAnswer({ question, matches })
    : renderNoKnowledgeAnswer(question);

  await input.client.sendTextMessage({ chatId: input.event.chat_id, text: reply });
  return { handled: true, reply, matches };
}

export function searchWorkspaceKnowledge(input: {
  repositories: Repositories;
  workspaceId: string;
  question: string;
  maxEpisodes?: number;
  maxMatches?: number;
}): KnowledgeMatch[] {
  const queryTerms = queryTermsFor(input.question);
  if (queryTerms.length === 0) return [];
  const details = input.repositories.listProcessedEpisodeDetailsForWorkspace({
    workspaceId: input.workspaceId,
    limit: input.maxEpisodes ?? 80
  });
  const watchById = new Map(input.repositories.listWatchesForWorkspace(input.workspaceId).map((watch) => [watch.id, watch]));
  const docs = details.flatMap((detail): KnowledgeDoc[] => {
    const insightDocs = detail.insights.map((insight) => ({
      kind: "insight" as const,
      episode: detail.episode,
      watch: watchById.get(insight.watchId),
      insight,
      title: insight.claim,
      body: [
        insight.claim,
        insight.evidenceExcerpt,
        insight.reasoning,
        insight.implication,
        ...insight.entities.map((entity) => `${entity.name} ${entity.type}`)
      ].filter(Boolean).join("\n"),
      evidence: insight.evidenceExcerpt,
      timestampStartSec: insight.timestampStartSec,
      timestampEndSec: insight.timestampEndSec
    }));
    const summaryDoc = detail.summary ? [{
      kind: "summary" as const,
      episode: detail.episode,
      title: detail.summary.oneLiner,
      body: [
        detail.summary.oneLiner,
        detail.summary.overview,
        ...detail.summary.chapters.map((chapter) => `${chapter.title} ${chapter.summary}`),
        ...detail.summary.entities.map((entity) => `${entity.name} ${entity.type}`)
      ].join("\n"),
      evidence: detail.summary.overview
    }] : [];
    return [...insightDocs, ...summaryDoc];
  });

  return docs
    .map((doc) => ({ ...doc, score: scoreDoc(doc, queryTerms) }))
    .filter((match) => match.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.maxMatches ?? 4);
}

function renderKnowledgeAnswer(input: { question: string; matches: KnowledgeMatch[] }): string {
  const rows = input.matches.map((match, index) => {
    const source = [
      match.episode.title,
      match.watch?.name,
      match.timestampStartSec !== undefined ? formatTimestampRange(match.timestampStartSec, match.timestampEndSec) : undefined
    ].filter(Boolean).join(" · ");
    return [
      `${index + 1}. ${match.title}`,
      match.evidence ? `证据：${clip(match.evidence, 220)}` : undefined,
      `来源：${source}`,
      `链接：${match.episode.pageUrl}`
    ].filter(Boolean).join("\n");
  }).join("\n\n");
  return [
    "根据已处理播客知识库，找到这些相关材料：",
    "",
    rows,
    "",
    "回答范围仅限当前已处理并发布的播客摘要和 insight。你可以继续追问更具体的问题。"
  ].join("\n");
}

function renderNoKnowledgeAnswer(question: string): string {
  return [
    `知识库里还没有找到和「${clip(question, 60)}」直接相关的已处理播客材料。`,
    "",
    noAnswerHelp
  ].join("\n");
}

function scoreDoc(doc: KnowledgeDoc, queryTerms: string[]): number {
  const haystack = normalizeForSearch([
    doc.title,
    doc.body,
    doc.episode.title,
    doc.watch?.name,
    doc.watch?.query
  ].filter(Boolean).join("\n"));
  let lexicalScore = 0;
  for (const term of queryTerms) {
    if (haystack.includes(term)) lexicalScore += term.length > 3 ? 2 : 1;
  }
  if (lexicalScore === 0) return 0;
  let score = lexicalScore;
  if (doc.kind === "insight" && doc.insight) {
    score += 4;
    score += Math.min(2, doc.insight.relevanceScore);
    score += Math.min(1, doc.insight.confidence);
    if ((doc.insight.groundednessScore ?? 0) >= 0.8) score += 0.5;
  }
  return score;
}

function queryTermsFor(question: string): string[] {
  const normalized = normalizeForSearch(question);
  const terms = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_-]*/g)) {
    if (match[0].length >= 2) terms.add(match[0]);
  }
  for (const match of normalized.matchAll(/\p{Script=Han}+/gu)) {
    const compact = stripChineseStopwords(match[0]);
    if (compact.length >= 2) terms.add(compact);
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= compact.length - size; index += 1) {
        terms.add(compact.slice(index, index + size));
      }
    }
  }
  return Array.from(terms).filter((term) => term.length >= 2);
}

function normalizeQuestion(content: string): string {
  return content.trim().replace(/^["'“”]+|["'“”]+$/g, "");
}

function normalizeForSearch(input: string): string {
  return input.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, " ");
}

function stripChineseStopwords(input: string): string {
  return input
    .replace(/(帮我|请问|请|一下|知识库|播客|里面|关于|对于|有没有|是否|什么|哪些|怎么|为什么|如何|多少|观点|结论|总结|情况|内容|讲了|提到|相关|直接)/gu, "")
    .trim();
}

function isBindingOrHelpMessage(content: string): boolean {
  return /^(\/bind|绑定|bind)$/i.test(content) || /^(\/help|help|帮助)$/i.test(content);
}

function formatTimestampRange(startSec: number, endSec?: number): string {
  const start = formatTimestamp(startSec);
  return endSec && endSec > startSec ? `${start}-${formatTimestamp(endSec)}` : start;
}

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minute = Math.floor(seconds / 60).toString().padStart(2, "0");
  const second = (seconds % 60).toString().padStart(2, "0");
  return `${minute}:${second}`;
}

function clip(input: string, maxLength: number): string {
  const compact = input.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
}
