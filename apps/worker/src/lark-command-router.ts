import { connectorFor, type ResolvedSource, type SourceConnector } from "../../../packages/connectors/src/index.ts";
import { episodeDedupeKey } from "../../../packages/core/src/dedupe.ts";
import { stableId } from "../../../packages/core/src/format.ts";
import type { Episode, Source, Watch } from "../../../packages/core/src/types.ts";
import type { createRepositories } from "../../../packages/db/src/repositories.ts";
import { recordLarkBotInstalled } from "../../../packages/lark/src/index.ts";
import type { LarkBotEventClient, LarkMessageReceivedEvent } from "./lark-bot-events.ts";

type Repositories = ReturnType<typeof createRepositories>;

export type LarkBotCommandResult = {
  handled: boolean;
  reply?: string;
  intentType?: string;
};

export type LarkBotCommandInput = {
  repositories: Repositories;
  workspaceId: string;
  appId: string;
  tenantKey?: string;
  client: LarkBotEventClient;
  event: LarkMessageReceivedEvent;
  connectorForInput?: (input: string) => SourceConnector;
  podcastSearch?: PodcastSearch;
  now?: string;
};

export type PodcastSearchInput = {
  query: string;
  platform?: Source["type"];
};

export type PodcastSearch = (input: PodcastSearchInput) => Promise<ResolvedSource[]>;

type ParsedLarkIntent =
  | { type: "process_episode"; url: string }
  | { type: "create_watch"; url: string }
  | { type: "search_watch"; query: string; platform?: Source["type"]; frequency: Watch["frequency"] }
  | { type: "status" }
  | { type: "retry_failed" }
  | { type: "pause_watch"; name: string }
  | { type: "resume_watch"; name: string }
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "unknown" };

export async function handleLarkBotCommand(input: LarkBotCommandInput): Promise<LarkBotCommandResult> {
  if (input.event.chat_type !== "p2p" || !input.event.chat_id) return { handled: false };
  bindPersonalChat(input);

  const intent = parseLarkBotIntent(input.event.content ?? "");
  if (intent.type === "confirm" || intent.type === "cancel") {
    return handlePendingDecision(input, intent.type);
  }
  if (intent.type === "unknown") return { handled: false };
  if (intent.type === "status") return sendStatus(input);
  if (intent.type === "retry_failed") return retryFailedJobs(input);
  if (intent.type === "pause_watch" || intent.type === "resume_watch") return updateWatchEnabled(input, intent);

  if (intent.type === "process_episode") {
    const connector = (input.connectorForInput ?? connectorFor)(intent.url);
    const resolved = await connector.resolveEpisode(intent.url);
    const episode = resolvedEpisodeToEpisode(resolved);
    input.repositories.upsertEpisode(episode);
    input.repositories.enqueueEpisodeProcessingJob({
      workspaceId: input.workspaceId,
      watchId: ensureImmediateWatch(input.repositories, input.workspaceId, episode).id,
      episodeId: episode.id,
      sourceUrl: episode.pageUrl,
      queuedAt: input.now,
      relevanceScore: 1,
      relevanceReason: { source: "lark-command", intent: intent.type }
    });
    const reply = [
      `已开始处理单集：${episode.title}`,
      "",
      "我会在后台转写音频、提炼核心内容；完成后会把摘要和核心片段推送到这个飞书私聊。"
    ].join("\n");
    await input.client.sendTextMessage({ chatId: input.event.chat_id, text: reply });
    return { handled: true, intentType: intent.type, reply };
  }

  if (intent.type === "create_watch") {
    const connector = (input.connectorForInput ?? connectorFor)(intent.url);
    const resolved = await connector.resolveSource(intent.url);
    const source = resolvedSourceToSource(resolved);
    input.repositories.upsertSource(source);
    const watch = ensureWatchForSource(input.repositories, input.workspaceId, resolved);
    const reply = watchCreatedReply(watch);
    await input.client.sendTextMessage({ chatId: input.event.chat_id, text: reply });
    return { handled: true, intentType: intent.type, reply };
  }

  return prepareSearchWatch(input, intent);
}

async function prepareSearchWatch(input: LarkBotCommandInput, intent: Extract<ParsedLarkIntent, { type: "search_watch" }>): Promise<LarkBotCommandResult> {
  const resolved = await resolvePodcastCandidate(input, intent);
  if (!resolved) {
    const platform = intent.platform === "xiaoyuzhou" ? "小宇宙" : "目标平台";
    const reply = [
      `我理解你想在${platform}监控：${intent.query}`,
      "",
      "但我还没有找到可以监控的真实频道链接，所以不会创建监控任务。",
      "请直接发送播客频道链接，或把节目名称说得更精确一些。"
    ].join("\n");
    await input.client.sendTextMessage({ chatId: input.event.chat_id!, text: reply });
    return { handled: true, intentType: intent.type, reply };
  }
  const source = resolvedSourceToSource(resolved);
  input.repositories.upsertSource(source);
  const pendingIntent = {
    type: "confirm_watch_source",
    source: resolved,
    frequency: intent.frequency,
    originalQuery: intent.query,
    platform: intent.platform
  };
  const pending = input.repositories.createLarkPendingIntent({
    workspaceId: input.workspaceId,
    chatId: input.event.chat_id!,
    senderOpenId: input.event.sender_id,
    intentType: pendingIntent.type,
    intent: pendingIntent,
    createdAt: input.now,
    expiresAt: new Date(Date.parse(input.now ?? new Date().toISOString()) + 10 * 60 * 1000).toISOString()
  });
  const reply = [
    "请确认创建监控任务：",
    "",
    `搜索词：${intent.query}`,
    `匹配频道：${resolved.title ?? hostLabel(resolved.url)}`,
    `频道链接：${resolved.url}`,
    `检查频率：${frequencyLabel(intent.frequency)}`,
    "",
    "回复「确认」创建，回复「取消」放弃。",
    `确认有效期至：${pending.expiresAt}`
  ].join("\n");
  await input.client.sendTextMessage({ chatId: input.event.chat_id, text: reply });
  return { handled: true, intentType: intent.type, reply };
}

export function parseLarkBotIntent(content: string): ParsedLarkIntent {
  const normalized = content.trim();
  if (/^(确认|确定|yes|ok)$/i.test(normalized)) return { type: "confirm" };
  if (/^(取消|不用了|算了|cancel)$/i.test(normalized)) return { type: "cancel" };
  if (/^(状态|进度|查看状态|任务状态)$/i.test(normalized)) return { type: "status" };
  if (/^(重试失败|重试失败任务|重新处理失败|retry failed)$/i.test(normalized)) return { type: "retry_failed" };
  const pauseName = watchNameAfterVerb(normalized, /(暂停|停止)\s*/u);
  if (pauseName) return { type: "pause_watch", name: pauseName };
  const resumeName = watchNameAfterVerb(normalized, /(恢复|开始|继续)\s*/u);
  if (resumeName) return { type: "resume_watch", name: resumeName };
  const url = firstHttpUrl(content);
  if (!url) {
    const search = searchWatchFromText(normalized);
    return search ? { type: "search_watch", ...search, frequency: frequencyFromText(normalized) } : { type: "unknown" };
  }
  if (isPodcastUrl(url)) return { type: "create_watch", url };
  return { type: "process_episode", url };
}

async function sendStatus(input: LarkBotCommandInput): Promise<LarkBotCommandResult> {
  const watches = input.repositories.listWatchesForWorkspace(input.workspaceId).filter((watch) => !watch.query.startsWith("即时处理："));
  const counts = jobCounts(input.repositories, input.workspaceId);
  const topWatches = watches.slice(0, 5).map((watch) => `- ${watch.name}：${watch.enabled ? "监控中" : "已暂停"}，频率 ${frequencyLabel(watch.frequency)}`).join("\n");
  const reply = [
    `监控任务：${watches.length} 个`,
    `队列状态：待处理 ${counts.queued}，运行中 ${counts.running}，失败 ${counts.failed}`,
    topWatches ? "" : undefined,
    topWatches || undefined
  ].filter((line): line is string => line !== undefined).join("\n");
  await input.client.sendTextMessage({ chatId: input.event.chat_id!, text: reply });
  return { handled: true, intentType: "status", reply };
}

async function retryFailedJobs(input: LarkBotCommandInput): Promise<LarkBotCommandResult> {
  const changed = input.repositories.retryFailedEpisodeProcessingJobsForWorkspace(input.workspaceId);
  const reply = changed > 0 ? `已重新发起 ${changed} 个失败任务。` : "当前没有失败任务需要重试。";
  await input.client.sendTextMessage({ chatId: input.event.chat_id!, text: reply });
  return { handled: true, intentType: "retry_failed", reply };
}

async function updateWatchEnabled(input: LarkBotCommandInput, intent: Extract<ParsedLarkIntent, { type: "pause_watch" | "resume_watch" }>): Promise<LarkBotCommandResult> {
  const watch = findWatchByName(input.repositories, input.workspaceId, intent.name);
  if (!watch) {
    const reply = `没有找到监控任务：${intent.name}`;
    await input.client.sendTextMessage({ chatId: input.event.chat_id!, text: reply });
    return { handled: true, intentType: intent.type, reply };
  }
  input.repositories.updateWatchForWorkspace(input.workspaceId, watch.id, { enabled: intent.type === "resume_watch" });
  const reply = `${intent.type === "resume_watch" ? "已恢复监控" : "已暂停监控"}：${watch.name}`;
  await input.client.sendTextMessage({ chatId: input.event.chat_id!, text: reply });
  return { handled: true, intentType: intent.type, reply };
}

async function handlePendingDecision(input: LarkBotCommandInput, decision: "confirm" | "cancel"): Promise<LarkBotCommandResult> {
  const pending = input.repositories.getLatestPendingLarkIntent({
    workspaceId: input.workspaceId,
    chatId: input.event.chat_id!,
    senderOpenId: input.event.sender_id,
    now: input.now
  });
  if (!pending) {
    const reply = "当前没有等待确认的任务。你可以直接发送播客链接，或说“监控 硅谷101”。";
    await input.client.sendTextMessage({ chatId: input.event.chat_id!, text: reply });
    return { handled: true, intentType: decision, reply };
  }
  if (decision === "cancel") {
    input.repositories.cancelLarkPendingIntent(pending.id, input.now, "user cancelled");
    const reply = "已取消这次操作。";
    await input.client.sendTextMessage({ chatId: input.event.chat_id!, text: reply });
    return { handled: true, intentType: decision, reply };
  }

  const intent = pending.intent as Partial<{
    type: "confirm_watch_source";
    source: ResolvedSource;
    frequency: Watch["frequency"];
  }>;
  if (intent.type !== "confirm_watch_source" || !intent.source?.url) {
    input.repositories.cancelLarkPendingIntent(pending.id, input.now, "unsupported pending intent");
    const reply = "这个待确认任务已经失效，请重新发送需求。";
    await input.client.sendTextMessage({ chatId: input.event.chat_id!, text: reply });
    return { handled: true, intentType: decision, reply };
  }
  const source = resolvedSourceToSource(intent.source);
  input.repositories.upsertSource(source);
  const watch = ensureWatchForSource(input.repositories, input.workspaceId, {
    ...intent.source,
    frequency: intent.frequency ?? "daily"
  });
  input.repositories.completeLarkPendingIntent(pending.id, input.now);
  const reply = watchCreatedReply(watch);
  await input.client.sendTextMessage({ chatId: input.event.chat_id!, text: reply });
  return { handled: true, intentType: decision, reply };
}

function bindPersonalChat(input: LarkBotCommandInput): void {
  recordLarkBotInstalled({
    repositories: input.repositories,
    workspaceId: input.workspaceId,
    appId: input.appId,
    tenantKey: input.tenantKey ?? "tenant_personal",
    chatId: input.event.chat_id!,
    chatName: "个人播客助手",
    operatorOpenId: input.event.sender_id
  });
}

function ensureImmediateWatch(repositories: Repositories, workspaceId: string, episode: Episode): Watch {
  const query = `即时处理：${episode.pageUrl}`;
  const existing = repositories.listWatchesForWorkspace(workspaceId).find((watch) => watch.query === query);
  if (existing) return existing;
  return repositories.createWatchForWorkspace(workspaceId, {
    id: stableId("watch", `${workspaceId}:lark-command:${episode.pageUrl}`),
    name: `飞书单集：${episode.title}`,
    type: "topic",
    query,
    outputLanguage: "zh-CN",
    includeTerms: [],
    excludeTerms: [],
    expandedTerms: [episode.pageUrl],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 1,
    enabled: true
  });
}

function ensureWatchForSource(repositories: Repositories, workspaceId: string, source: { url: string; title?: string; frequency?: Watch["frequency"] }): Watch {
  const existing = repositories.listWatchesForWorkspace(workspaceId).find((watch) => watch.query === source.url);
  if (existing) return existing;
  return repositories.createWatchForWorkspace(workspaceId, {
    id: stableId("watch", `${workspaceId}:lark-command-watch:${source.url}`),
    name: source.title ?? hostLabel(source.url),
    type: "podcast",
    query: source.url,
    outputLanguage: "zh-CN",
    includeTerms: [],
    excludeTerms: [],
    expandedTerms: [source.title ?? "", source.url].filter(Boolean),
    minRelevanceScore: 0.65,
    frequency: source.frequency ?? "daily",
    backfillDays: 3,
    enabled: true
  });
}

function resolvedEpisodeToEpisode(resolved: {
  guid?: string;
  title: string;
  description?: string;
  publishedAt?: string;
  durationSec?: number;
  audioUrl?: string;
  pageUrl: string;
  language?: string;
  metadata?: Record<string, unknown>;
}): Episode {
  return {
    id: stableId("ep", episodeDedupeKey({
      guid: resolved.guid,
      audioUrl: resolved.audioUrl,
      pageUrl: resolved.pageUrl,
      title: resolved.title
    })),
    guid: resolved.guid,
    title: resolved.title,
    description: resolved.description,
    publishedAt: resolved.publishedAt,
    durationSec: resolved.durationSec,
    audioUrl: resolved.audioUrl,
    pageUrl: resolved.pageUrl,
    language: resolved.language,
    metadata: resolved.metadata
  };
}

function resolvedSourceToSource(resolved: {
  type: Source["type"];
  url: string;
  canonicalUrl?: string;
  externalId?: string;
  title?: string;
  author?: string;
  language?: string;
  metadata?: Record<string, unknown>;
}): Source {
  return {
    id: stableId("src", `${resolved.type}:${resolved.url}`),
    type: resolved.type,
    url: resolved.url,
    canonicalUrl: resolved.canonicalUrl,
    externalId: resolved.externalId,
    title: resolved.title,
    author: resolved.author,
    language: resolved.language,
    metadata: resolved.metadata
  };
}

function firstHttpUrl(content: string): string | undefined {
  return content.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[，。),]+$/u, "");
}

function searchWatchFromText(content: string): { query: string; platform?: Source["type"] } | undefined {
  if (!/(监控|关注|订阅)/.test(content)) return undefined;
  const platform = /小宇宙/.test(content) ? "xiaoyuzhou" : undefined;
  const explicit = content.match(/(?:叫|名叫|有一个|有个)\s*([^\s，,。；;、]+)(?:节目|播客|频道|账号)?/u)?.[1]
    ?? content.match(/(?:监控|关注|订阅)\s*([^\s，,。；;、]+)(?:节目|播客|频道|账号)?/u)?.[1];
  const query = (explicit ?? content)
    .replace(/^(帮我|请|我想|想要|我要)?\s*(监控|关注|订阅)\s*/u, "")
    .replace(/^(小宇宙|小宇宙里面|小宇宙里)\s*/u, "")
    .replace(/[，,。].*$/u, "")
    .replace(/(这个|频道|播客|节目|账号|有新节目.*|每天.*|每小时.*|实时.*|每周.*)$/u, "")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "");
  return query ? { query, platform } : undefined;
}

function frequencyFromText(content: string): Watch["frequency"] {
  if (/(实时|每小时|小时)/.test(content)) return "realtime";
  if (/(每周|周更|每星期)/.test(content)) return "weekly";
  return "daily";
}

function watchNameAfterVerb(content: string, verb: RegExp): string | undefined {
  if (!verb.test(content)) return undefined;
  const name = content.replace(verb, "").trim();
  return name || undefined;
}

function findWatchByName(repositories: Repositories, workspaceId: string, name: string): Watch | undefined {
  return repositories.listWatchesForWorkspace(workspaceId).find((watch) => watch.name === name || watch.query === name || watch.query.includes(name));
}

function jobCounts(repositories: Repositories, workspaceId: string): { queued: number; running: number; failed: number } {
  const counts = repositories.countEpisodeProcessingJobsByStatus(workspaceId);
  return { queued: counts.queued, running: counts.running, failed: counts.failed };
}

function isPodcastUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /xiaoyuzhoufm\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith("/podcast/");
  } catch {
    return false;
  }
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function frequencyLabel(frequency: Watch["frequency"]): string {
  if (frequency === "daily") return "每天";
  if (frequency === "realtime") return "每小时";
  return "每周";
}

async function resolvePodcastCandidate(input: LarkBotCommandInput, intent: Extract<ParsedLarkIntent, { type: "search_watch" }>): Promise<ResolvedSource | undefined> {
  const source = input.repositories.findSourceByTitle(intent.query);
  if (source && (!intent.platform || source.type === intent.platform)) return source;
  const results = await (input.podcastSearch ?? defaultPodcastSearch)({
    query: intent.query,
    platform: intent.platform
  });
  return results.find((result) => isPodcastSourceUrl(result.url) && (!intent.platform || result.type === intent.platform)) ?? results.find((result) => isPodcastSourceUrl(result.url));
}

async function defaultPodcastSearch(input: PodcastSearchInput): Promise<ResolvedSource[]> {
  if (!input.platform || input.platform === "xiaoyuzhou") {
    const xiaoyuzhou = await searchXiaoyuzhouPodcasts(input.query);
    if (xiaoyuzhou.length > 0 || input.platform === "xiaoyuzhou") return xiaoyuzhou;
  }
  const candidates = candidateUrlsFromText(input.query);
  const sources: ResolvedSource[] = [];
  for (const url of candidates) {
    const connector = connectorFor(url);
    if (input.platform && connector.type !== input.platform) continue;
    try {
      sources.push(await connector.resolveSource(url));
    } catch {
      // Search is best-effort; unresolved candidates are ignored.
    }
  }
  return sources;
}

async function searchXiaoyuzhouPodcasts(query: string): Promise<ResolvedSource[]> {
  const accessToken = process.env["XIAOYUZHOU_ACCESS_TOKEN"] ?? process.env["XIAOYUZHOUFM_ACCESS_TOKEN"];
  if (!accessToken) return [];
  const response = await fetch("https://api.xiaoyuzhoufm.com/v1/search/create", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "accept-language": "zh-Hans-CN;q=1.0",
      "abtest-info": "{\"old_user_discovery_feed\":\"enable\"}",
      "app-buildno": "1576",
      "app-permissions": "4",
      "app-version": "2.57.1",
      "bundleid": "app.podcast.cosmos",
      "content-type": "application/json",
      "host": "api.xiaoyuzhoufm.com",
      "local-time": new Date().toISOString(),
      "market": "AppStore",
      "model": "iPhone14,2",
      "os": "ios",
      "os-version": "17.4.1",
      "timezone": "Asia/Shanghai",
      "user-agent": "Xiaoyuzhou/2.57.1 (build:1576; iOS 17.4.1)",
      "wificonnected": "true",
      "x-custom-xiaoyuzhou-app-dev": "",
      "x-jike-access-token": accessToken,
      "x-jike-device-id": process.env["XIAOYUZHOU_DEVICE_ID"] ?? process.env["XIAOYUZHOUFM_DEVICE_ID"] ?? "81ADBFD6-6921-482B-9AB9-A29E7CC7BB55"
    },
    body: JSON.stringify({ keyword: query, type: "PODCAST" })
  });
  if (!response.ok) return [];
  const payload = await response.json() as { data?: Array<Record<string, unknown>> };
  return (payload.data ?? [])
    .map((item) => {
      const pid = stringField(item, "pid");
      if (!pid) return undefined;
      return {
        type: "xiaoyuzhou" as const,
        url: `https://www.xiaoyuzhoufm.com/podcast/${pid}`,
        canonicalUrl: `https://www.xiaoyuzhoufm.com/podcast/${pid}`,
        externalId: pid,
        title: stringField(item, "title"),
        author: stringField(item, "author"),
        language: "zh-CN",
        metadata: {
          resolver: "xiaoyuzhou-search",
          brief: stringField(item, "brief"),
          subscriptionCount: numberField(item, "subscriptionCount"),
          episodeCount: numberField(item, "episodeCount"),
          latestEpisodePubDate: stringField(item, "latestEpisodePubDate")
        }
      } satisfies ResolvedSource;
    })
    .filter((source): source is ResolvedSource => source !== undefined);
}

function candidateUrlsFromText(input: string): string[] {
  return Array.from(input.matchAll(/https?:\/\/[^\s<>"']+/gi), (match) => match[0]);
}

function isPodcastSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (/xiaoyuzhoufm\.com$/i.test(parsed.hostname)) return parsed.pathname.startsWith("/podcast/");
    return true;
  } catch {
    return false;
  }
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function watchCreatedReply(watch: Watch): string {
  return [
    `已创建监控：${watch.name}`,
    "",
    `频道链接：${watch.query}`,
    `检查频率：${frequencyLabel(watch.frequency)}`,
    "有新节目处理完成后，我会把结果推送到这个飞书私聊。"
  ].join("\n");
}
