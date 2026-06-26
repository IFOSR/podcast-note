import type { Episode, EpisodeSummary, Source, TranscriptSegment, Watch } from "../../../../packages/core/src/types.ts";
import QRCode from "qrcode";
import { readFileSync } from "node:fs";
import { stableId } from "../../../../packages/core/src/format.ts";
import { createCommandLineInsightProvider, createCommandLineIntentAssistantProvider, createVolcengineTranscriptProvider } from "../../../../packages/ai/src/index.ts";
import type { IntentAssistantOutput } from "../../../../packages/ai/src/index.ts";
import { createRepositories, openPodcastNoteDb } from "../../../../packages/db/src/index.ts";
import {
  createWatch,
  createLocalSession,
  getInboxView,
  getSessionContext,
  listWatchCards,
  recordInsightFeedback,
  updateWatch,
  type SessionContext
} from "./m1-app.ts";
import { processSourceInputs } from "../../../worker/src/process-sources.ts";
import { runM1Once } from "../../../worker/src/m1-run-once.ts";
import { deliverPendingLarkEpisodeResultsToAllInstallations, deliverPendingWikiProposalSummaryToAllLarkInstallations } from "../../../worker/src/lark-delivery.ts";
import {
  buildLarkBotOpenUrl,
  createLarkBotClient,
  completeLarkBindSession,
  createLarkBindSession,
  latestLarkBotIntegrationStatus,
  larkAuthStatus,
  recordLarkBotInstalled,
  sanitizeLarkVerificationUrl
} from "../../../../packages/lark/src/index.ts";

const options = parseArgs(process.argv.slice(2));
const port = Number(options["port"] ?? process.env["PORT"] ?? 3000);
const host = options["host"] ?? process.env["HOST"] ?? "127.0.0.1";
const dbPath = options["db"] ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
const token = options["token"] ?? process.env["PODCAST_NOTE_SESSION_TOKEN"] ?? "local-dev-token";
const schedulerEnabled = booleanOption(options["scheduler"], process.env["PODCAST_NOTE_SCHEDULER_ENABLED"], true);
const schedulerIntervalMs = numberOption(options["scheduler-interval-ms"], process.env["PODCAST_NOTE_SCHEDULER_INTERVAL_MS"], 5 * 60 * 1000);
const schedulerPollingLimit = numberOption(options["scheduler-polling-limit"], process.env["PODCAST_NOTE_SCHEDULER_POLLING_LIMIT"], 20);
const schedulerProcessingLimit = numberOption(options["scheduler-processing-limit"], process.env["PODCAST_NOTE_SCHEDULER_PROCESSING_LIMIT"], 3);
const schedulerRunningJobTimeoutMs = numberOption(options["scheduler-running-job-timeout-ms"], process.env["PODCAST_NOTE_RUNNING_JOB_TIMEOUT_MS"], 90 * 60 * 1000);
const schedulerMaxAutomaticAttempts = numberOption(options["scheduler-max-automatic-attempts"], process.env["PODCAST_NOTE_MAX_AUTOMATIC_ATTEMPTS"], 3);
const now = new Date().toISOString();
const db = openPodcastNoteDb(dbPath);
const repos = createRepositories(db);
const session = createLocalSession({
  repositories: repos,
  user: {
    id: "user_local_preview",
    email: "local-preview@example.invalid",
    name: "Local Preview",
    timezone: "Asia/Shanghai"
  },
  token,
  now,
  expiresAt: "2099-01-01T00:00:00.000Z"
});
const context = getSessionContext({ repositories: repos, token, now }) ?? { session, user: session.user, workspace: session.workspace };
let schedulerRunning = false;
let schedulerTimer: ReturnType<typeof setInterval> | undefined;
normalizeExistingMonitorWatches(context);

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") {
        return json({ ok: true, app: "podcast-note", dbPath, workspaceId: context.workspace.id });
      }
      if (url.pathname === "/api/summary") {
        return json(summary(context));
      }
      if (url.pathname === "/api/agent-status") {
        return json({ ok: true, agentRun: currentImmediateAgentRun(context) });
      }
      if (url.pathname === "/api/assistant" && request.method === "POST") {
        const form = await formDataOrEmpty(request);
        const message = stringField(form, "message").trim();
        if (!message) throw new Error("请输入你想让 Podcast Note 帮你做什么。");
        const result = await analyzeUserIntent(context, message);
        return json({ ok: true, result, html: renderAssistantResult(result) });
      }
      if (url.pathname === "/api/monitor-fragments") {
        return json(monitorFragments(context));
      }
      if (url.pathname === "/api/integrations/feishu") {
        return json({ ok: true, integration: larkBotStatus() });
      }
      if (url.pathname === "/api/lark/bot-open-url") {
        const appId = larkAppIdOrFail();
        return json({ ok: true, bot_open_url: buildLarkBotOpenUrl(appId), app_id: appId });
      }
      if (url.pathname === "/api/lark/bot-installations" && request.method === "POST") {
        const form = await request.formData();
        recordLarkBotInstalled({
          repositories: repos,
          workspaceId: context.workspace.id,
          appId: stringField(form, "appId") || larkAppIdOrFail(),
          tenantKey: stringField(form, "tenantKey") || "tenant_local_preview",
          chatId: stringField(form, "chatId"),
          chatName: stringField(form, "chatName") || undefined,
          operatorOpenId: stringField(form, "operatorOpenId") || undefined
        });
        return flashRedirect("/integrations/feishu", "已记录飞书机器人目标群，可开始测试推送。");
      }
      if (url.pathname === "/api/lark/send-test-message" && request.method === "POST") {
        const status = larkBotStatus();
        if (!status.connected || !status.installation) throw new Error("请先把 Podcast Note 机器人加入飞书群，或手动记录 chat_id。");
        const client = createLarkBotClient({
          appId: larkAppIdOrFail(),
          appSecret: larkAppSecretOrFail()
        });
        await client.sendTextMessage({
          chatId: status.installation.chatId,
          text: "Podcast Note 已连接飞书。后续播客摘要、完整报告和核心音频片段会发送到这个群。"
        });
        return flashRedirect("/integrations/feishu", "测试消息已发送到飞书群。");
      }
      if (url.pathname === "/api/lark/debug-auth-url") {
        assertValidLarkRedirectUri(request);
        const bindSession = createLarkBindSession({
          repositories: repos,
          workspaceId: context.workspace.id,
          agentId: "podcast-note-debug-url",
          permissionPackage: "lark.agent.full_access",
          terminalFingerprint: "debug-url",
          appId: larkAppIdOrFail(),
          redirectUri: larkRedirectUri(request),
          scopes: larkOAuthScopes()
        });
        const safeUrl = sanitizeLarkVerificationUrl(bindSession.verificationUrl);
        return json({
          ok: true,
          bind_session_id: bindSession.id,
          verification_url: safeUrl,
          has_domain_scope: safeUrl.includes("domain:"),
          has_scope: new URL(safeUrl).searchParams.has("scope")
        });
      }
      if (url.pathname === "/api/lark/bind-sessions" && request.method === "POST") {
        assertValidLarkRedirectUri(request);
        const form = await formDataOrEmpty(request);
        const appId = stringField(form, "appId") || larkConfiguredAppId();
        const bindSession = createLarkBindSession({
          repositories: repos,
          workspaceId: context.workspace.id,
          agentId: "podcast-note-web-preview",
          permissionPackage: "lark.agent.full_access",
          terminalFingerprint: request.headers.get("user-agent") ?? undefined,
          appId: appId || larkAppIdOrFail(),
          redirectUri: larkRedirectUri(request),
          scopes: larkOAuthScopes()
        });
        return json({
          ok: true,
          bind_session_id: bindSession.id,
          verification_url: bindSession.verificationUrl,
          expires_at: bindSession.expiresAt,
          poll_interval_seconds: bindSession.pollIntervalSeconds
        });
      }
      if (url.pathname === "/api/lark/start-auth" && request.method === "POST") {
        assertValidLarkRedirectUri(request);
        const form = await request.formData();
        const appId = stringField(form, "appId") || larkConfiguredAppId();
        const bindSession = createLarkBindSession({
          repositories: repos,
          workspaceId: context.workspace.id,
          agentId: "podcast-note-web-preview",
          permissionPackage: "lark.agent.full_access",
          terminalFingerprint: request.headers.get("user-agent") ?? undefined,
          appId: appId || larkAppIdOrFail(),
          redirectUri: larkRedirectUri(request),
          scopes: larkOAuthScopes()
        });
        return redirect(`/integrations/feishu?bind_session_id=${encodeURIComponent(bindSession.id)}`);
      }
      if (url.pathname.startsWith("/api/lark/bind-sessions/")) {
        const bindSessionId = decodeURIComponent(url.pathname.slice("/api/lark/bind-sessions/".length));
        return json({ ok: true, ...larkAuthStatus({ repositories: repos, bindSessionId }) });
      }
      if (url.pathname === "/api/lark/oauth/callback") {
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";
        if (!code || !state) throw new Error("飞书 OAuth 回调缺少 code 或 state。");
        const completed = completeLarkBindSession({
          repositories: repos,
          signedState: state,
          code,
          tokenResult: devLarkTokenResult(code),
          userInfo: devLarkUserInfo()
        });
        return html(renderLarkCallbackSuccess(completed.connectionId));
      }
      if (url.pathname === "/api/run-once" && request.method === "POST") {
        throw new Error("Web 已禁用旧 run-once mock 队列。请使用“处理一个播客链接”或“监控一个目标”，它们会调用真实转录和真实 insight provider。");
      }
      if (url.pathname === "/api/process-link" && request.method === "POST") {
        const form = await request.formData();
        const podcastUrl = stringField(form, "podcastUrl");
        const result = await processWithRealProviders({
          context,
          name: titleFromInput(podcastUrl, "单次播客处理"),
          topic: immediateTopic(podcastUrl),
          mustInclude: [],
          sources: [podcastUrl],
          maxEpisodesPerSource: 1
        });
        return flashRedirect("/", `真实处理完成：处理 ${result.length} 集播客`);
      }
      if (url.pathname === "/api/monitor-target" && request.method === "POST") {
        const form = await request.formData();
        const target = stringField(form, "target");
        const channel = stringField(form, "channel");
        const keywords = stringField(form, "keywords");
        const maxEpisodes = Math.min(numberField(form, "maxEpisodes", 3), 10);
        const watchInput = {
          name: titleFromInput(channel || target, "目标监控"),
          topic: monitorTopic(target, channel, keywords),
          query: monitorQuery(target, channel, keywords),
          mustInclude: termsFromText(keywords),
          sources: [monitorQuery(target, channel, keywords)],
          maxEpisodesPerSource: maxEpisodes,
          frequency: frequencyField(form, "frequency"),
          backfillDays: maxEpisodes
        };
        const watch = upsertMonitorWatch(context, watchInput);
        const runId = repos.startProcessingRun({ watchId: watch.id, sources: watchInput.sources });
        void processMonitorRun({
          context,
          runId,
          ...watchInput
        });
        return flashRedirect("/monitor", "监控任务已创建，正在后台回看处理");
      }
      if (url.pathname === "/api/watches" && request.method === "POST") {
        const form = await request.formData();
        createWatch({
          repositories: repos,
          context,
          input: {
            name: stringField(form, "name"),
            query: stringField(form, "query"),
            includeTerms: stringField(form, "includeTerms"),
            excludeTerms: stringField(form, "excludeTerms"),
            minRelevanceScore: numberField(form, "minRelevanceScore", 0.6),
            frequency: frequencyField(form, "frequency"),
            backfillDays: numberField(form, "backfillDays", 30),
            outputLanguage: "zh-CN",
            enabled: true
          }
        });
        return flashRedirect("/monitor", "已添加关注主题");
      }
      if (url.pathname === "/api/feedback" && request.method === "POST") {
        const form = await request.formData();
        const action = stringField(form, "action") === "irrelevant" ? "irrelevant" : "saved";
        recordInsightFeedback({ repositories: repos, context, insightId: stringField(form, "insightId"), action });
        return flashRedirect("/", action === "saved" ? "已保存" : "已标记没用");
      }
      if (url.pathname === "/api/watch-action" && request.method === "POST") {
        const form = await request.formData();
        const watchId = stringField(form, "watchId");
        const action = stringField(form, "action");
        if (action === "pause" || action === "resume") {
          updateWatch({
            repositories: repos,
            context,
            watchId,
            input: { enabled: action === "resume" }
          });
          return flashRedirect("/monitor", action === "resume" ? "监控已开始" : "监控已暂停");
        }
        if (action === "delete") {
          const deleted = repos.deleteWatchForWorkspace(context.workspace.id, watchId);
          if (!deleted) throw new Error(`Watch not found in workspace ${context.workspace.id}: ${watchId}`);
          return flashRedirect("/monitor", "监控已删除");
        }
        if (action === "retry-episode") {
          const episodeId = stringField(form, "episodeId");
          const requeued = retryMonitorEpisode({ workspaceId: context.workspace.id, watchId, episodeId });
          if (requeued === 0) throw new Error(`No failed episode job found for retry: ${episodeId}`);
          void runMonitorSchedulerTick("manual");
          return flashRedirect("/monitor", "已重新发起该单集处理");
        }
        if (action === "retry-failed") {
          const requeued = retryFailedMonitorEpisodes({ workspaceId: context.workspace.id, watchId });
          if (requeued === 0) return flashRedirect("/monitor", "没有需要重试的失败单集");
          void runMonitorSchedulerTick("manual");
          return flashRedirect("/monitor", `已重新发起 ${requeued} 个失败单集`);
        }
        throw new Error(`Unsupported watch action: ${action}`);
      }
      if (url.pathname === "/") {
        const notice = noticeForRequest(request, url);
        return html(renderHome(context, notice.message, "process"), 200, notice.headers);
      }
      if (url.pathname === "/monitor") {
        const notice = noticeForRequest(request, url);
        return html(renderHome(context, notice.message, "monitor"), 200, notice.headers);
      }
      if (url.pathname === "/integrations/feishu") {
        const notice = noticeForRequest(request, url);
        return html(await renderFeishuIntegrationPage(context, request, url, notice.message), 200, notice.headers);
      }
      return html(renderNotFound(url.pathname), 404);
    } catch (error) {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      return html(renderError(error), 500);
    }
  }
});
server.ref();

if (schedulerEnabled) {
  startMonitorScheduler();
}

console.log(JSON.stringify({
  ok: true,
  message: "Podcast Note preview server started",
  url: `http://${host}:${server.port}`,
  dbPath,
  workspaceId: context.workspace.id,
  scheduler: schedulerEnabled ? {
    enabled: true,
    intervalMs: schedulerIntervalMs,
    pollingLimit: schedulerPollingLimit,
    processingLimit: schedulerProcessingLimit
  } : { enabled: false }
}, null, 2));

async function processWithRealProviders(input: {
  context: SessionContext;
  name: string;
  topic: string;
  mustInclude: string[];
  sources: string[];
  maxEpisodesPerSource: number;
  frequency?: Watch["frequency"];
  backfillDays?: number;
}) {
  assertRealProcessingConfigured();
  const results = await processSourceInputs({
    options: {
      watch: {
        workspaceId: input.context.workspace.id,
        name: input.name,
        topic: input.topic,
        language: "zh-CN",
        mustInclude: input.mustInclude
      },
      sources: { sources: input.sources },
      outputDir: "outputs/web-preview",
      maxEpisodesPerSource: input.maxEpisodesPerSource
    },
    transcriptProvider: createVolcengineTranscriptProvider(),
    insightProvider: createCommandLineInsightProvider(),
    repositories: repos
  });
  if (input.frequency || input.backfillDays !== undefined) {
    const storedWatch = repos.listWatchesForWorkspace(input.context.workspace.id)
      .find((watch) => watch.name === input.name && watch.query === input.topic);
    if (storedWatch) {
      updateWatch({
        repositories: repos,
        context: input.context,
        watchId: storedWatch.id,
        input: {
          frequency: input.frequency,
          backfillDays: input.backfillDays,
          enabled: true
        }
      });
    }
  }
  return results;
}

async function analyzeUserIntent(inputContext: SessionContext, message: string): Promise<IntentAssistantOutput> {
  const provider = createCommandLineIntentAssistantProvider();
  return provider.analyze({
    message,
    outputLanguage: "zh-CN",
    context: {
      workspaceName: inputContext.workspace.name,
      activeWatches: listWatchCards({ repositories: repos, context: inputContext })
        .slice(0, 20)
        .map((watch) => ({
          id: watch.id,
          name: watch.name,
          query: watch.query,
          enabled: watch.enabled,
          frequency: watch.frequency
        })),
      recentEpisodes: recentAssistantEpisodes(inputContext)
    }
  });
}

function recentAssistantEpisodes(inputContext: SessionContext): Array<{
  id: string;
  title: string;
  oneLiner?: string;
  pageUrl?: string;
  publishedAt?: string;
}> {
  const rows = db.query(`
    select
      e.id,
      e.title,
      e.page_url,
      e.published_at,
      s.one_liner,
      max(coalesce(s.created_at, t.created_at, e.updated_at, '')) as updated_at
    from episodes e
    left join episode_summaries s on s.episode_id = e.id
    left join transcripts t on t.episode_id = e.id
    where exists (
      select 1
      from processing_episode_statuses pes
      join processing_runs pr on pr.id = pes.run_id
      join watches w on w.id = pr.watch_id
      where pes.episode_id = e.id
        and w.workspace_id = ?
    )
    group by e.id
    order by updated_at desc
    limit 8
  `).all(inputContext.workspace.id) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const item: {
      id: string;
      title: string;
      oneLiner?: string;
      pageUrl?: string;
      publishedAt?: string;
    } = {
      id: String(row["id"]),
      title: String(row["title"])
    };
    const oneLiner = optionalString(row["one_liner"]);
    const pageUrl = optionalString(row["page_url"]);
    const publishedAt = optionalString(row["published_at"]);
    if (oneLiner) item.oneLiner = oneLiner;
    if (pageUrl) item.pageUrl = pageUrl;
    if (publishedAt) item.publishedAt = publishedAt;
    return item;
  });
}

function upsertMonitorWatch(inputContext: SessionContext, input: {
  name: string;
  topic: string;
  query: string;
  mustInclude: string[];
  frequency?: Watch["frequency"];
  backfillDays?: number;
}): Watch {
  const watch = {
    id: stableId("watch", `${input.name}:${input.query}`),
    workspaceId: inputContext.workspace.id,
    name: input.name,
    type: "topic" as const,
    query: input.query,
    outputLanguage: "zh-CN" as const,
    includeTerms: input.mustInclude,
    excludeTerms: [],
    expandedTerms: [...new Set([input.topic, input.query, ...input.mustInclude])],
    minRelevanceScore: 0.65,
    frequency: input.frequency ?? "daily",
    backfillDays: input.backfillDays ?? 3,
    enabled: true
  };
  return repos.upsertWatch(watch);
}

function normalizeExistingMonitorWatches(inputContext: SessionContext): void {
  for (const watch of repos.listWatchesForWorkspace(inputContext.workspace.id)) {
    if (isImmediateTopic(watch.query)) continue;
    const normalizedQuery = extractFirstHttpUrl(watch.query) ?? watch.query;
    if (normalizedQuery === watch.query) continue;
    repos.upsertWatch({
      ...watch,
      query: normalizedQuery,
      expandedTerms: [...new Set([watch.query, normalizedQuery, ...watch.expandedTerms])]
    });
    console.log(JSON.stringify({
      ok: true,
      message: "Normalized monitor watch query",
      watchId: watch.id,
      from: watch.query,
      to: normalizedQuery
    }));
  }
}

function startMonitorScheduler(): void {
  void runMonitorSchedulerTick("startup");
  schedulerTimer = setInterval(() => {
    void runMonitorSchedulerTick("interval");
  }, schedulerIntervalMs);
  schedulerTimer.unref?.();
}

async function runMonitorSchedulerTick(reason: "startup" | "interval" | "manual"): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  const startedAt = new Date().toISOString();
  try {
    assertRealProcessingConfigured();
    const staleJobs = staleRunningMonitorJobs(context.workspace.id, new Date(startedAt));
    const requeuedStaleJobs = staleJobs.length ? repos.requeueStaleEpisodeProcessingJobs({
      workspaceId: context.workspace.id,
      staleBefore: startedAt,
      error: `Processing worker exceeded its stage timeout and was requeued.`,
      jobIds: staleJobs.map((job) => job.id),
      maxAttempts: schedulerMaxAutomaticAttempts
    }) : 0;
    const requeuedFailedJobs = requeueTransientFailedMonitorJobs(context.workspace.id);
    const result = await runM1Once({
      repositories: repos,
      workspaceId: context.workspace.id,
      now: startedAt,
      pollingEpisodeLimit: schedulerPollingLimit,
      processingLimit: schedulerProcessingLimit,
      transcriptProvider: createVolcengineTranscriptProvider(),
      insightProvider: createCommandLineInsightProvider()
    });
    const larkDelivery = await deliverPendingLarkResultsAfterMonitorTick();
    if (requeuedStaleJobs > 0 || requeuedFailedJobs > 0 || result.pollingJobs > 0 || result.queuedEpisodes > 0 || result.processedJobs > 0 || result.failedJobs > 0 || (larkDelivery?.sent ?? 0) > 0) {
      console.log(JSON.stringify({ ok: true, message: "Monitor scheduler tick completed", reason, requeuedStaleJobs, requeuedFailedJobs, larkDelivery, ...result }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      message: "Monitor scheduler tick failed",
      reason,
      error: error instanceof Error ? error.message : String(error)
    }));
  } finally {
    schedulerRunning = false;
  }
}

async function deliverPendingLarkResultsAfterMonitorTick(): Promise<{
  episodeResults: { installations: number; sent: number; skipped: number; considered: number; failed: number };
  wikiProposalSummary: { installations: number; sent: number; skipped: number; empty: number; proposalCount: number; failed: number };
} | undefined> {
  const appId = larkConfiguredAppId();
  const appSecret = larkConfiguredAppSecret();
  if (!appId || !appSecret) return undefined;
  const installations = repos.listActiveLarkBotInstallationsForWorkspace(context.workspace.id, appId);
  if (installations.length === 0) return undefined;
  try {
    const episodeResults = await deliverPendingLarkEpisodeResultsToAllInstallations({
      repositories: repos,
      clientFactory: () => createLarkBotClient({ appId, appSecret }),
      workspaceId: context.workspace.id,
      appId,
      limit: numberOption(undefined, process.env["LARK_DELIVER_PENDING_LIMIT"] ?? process.env["FEISHU_DELIVER_PENDING_LIMIT"], 50)
    });
    const wikiProposalSummary = await deliverPendingWikiProposalSummaryToAllLarkInstallations({
      repositories: repos,
      clientFactory: () => createLarkBotClient({ appId, appSecret }),
      workspaceId: context.workspace.id,
      appId,
      limit: numberOption(undefined, process.env["LARK_DELIVER_PENDING_PROPOSAL_LIMIT"] ?? process.env["FEISHU_DELIVER_PENDING_PROPOSAL_LIMIT"], 100)
    });
    return { episodeResults, wikiProposalSummary };
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      message: "Lark pending delivery after monitor tick failed",
      error: error instanceof Error ? error.message : String(error)
    }));
    return undefined;
  }
}

function staleRunningMonitorJobs(workspaceId: string, now: Date): Array<{ id: string; stage: string; elapsedMs: number; timeoutMs: number }> {
  const rows = db.query(`
    select
      j.id,
      j.started_at,
      coalesce(pes.stage, 'running') as stage,
      e.duration_sec
    from episode_processing_jobs j
    left join episodes e on e.id = j.episode_id
    left join processing_episode_statuses pes on pes.run_id = j.processing_run_id
    where j.workspace_id = ?
      and j.status = 'running'
      and j.started_at is not null
      and (
        pes.updated_at is null
        or pes.updated_at = (
          select max(pes2.updated_at)
          from processing_episode_statuses pes2
          where pes2.run_id = j.processing_run_id
        )
      )
  `).all(workspaceId) as Array<Record<string, unknown>>;
  return rows
    .map((row) => {
      const startedAt = parseStoredDate(String(row["started_at"])) ?? new Date(String(row["started_at"]));
      const elapsedMs = now.getTime() - startedAt.getTime();
      const stage = String(row["stage"]);
      const durationSec = nullableNumber(row["duration_sec"]);
      return {
        id: String(row["id"]),
        stage,
        elapsedMs,
        timeoutMs: processingStageTimeoutMs(stage, durationSec)
      };
    })
    .filter((job) => Number.isFinite(job.elapsedMs) && job.elapsedMs > job.timeoutMs);
}

function processingStageTimeoutMs(stage: string, durationSec?: number): number {
  const durationMs = Math.max(0, durationSec ?? 0) * 1000;
  if (stage === "transcribing") return Math.max(schedulerRunningJobTimeoutMs, durationMs * 2 + 30 * 60 * 1000);
  if (stage === "analyzing") return Math.max(schedulerRunningJobTimeoutMs, durationMs + 30 * 60 * 1000);
  if (stage === "resolved" || stage === "transcribed") return Math.max(30 * 60 * 1000, schedulerRunningJobTimeoutMs);
  return schedulerRunningJobTimeoutMs;
}

function requeueTransientFailedMonitorJobs(workspaceId: string): number {
  const result = db.query(`
    update episode_processing_jobs
    set status = 'queued',
      queued_at = ?,
      error = null,
      updated_at = datetime('now')
    where workspace_id = ?
      and status = 'failed'
      and attempts < ?
      and (
        error like '%403 Forbidden%'
        or error like '%用户额度不足%'
        or error like '%Reconnecting%'
        or error like '%rate limit%'
        or error like '%timeout%'
        or error like '%timed out%'
        or error like '%Unable to connect%'
        or error like '%typo in the url or port%'
      )
  `).run(new Date().toISOString(), workspaceId, schedulerMaxAutomaticAttempts);
  return result.changes;
}

function retryMonitorEpisode(input: { workspaceId: string; watchId: string; episodeId: string }): number {
  const result = db.query(`
    update episode_processing_jobs
    set status = 'queued',
      attempts = 0,
      processing_run_id = null,
      error = null,
      started_at = null,
      finished_at = null,
      queued_at = datetime('now'),
      updated_at = datetime('now')
    where workspace_id = ?
      and watch_id = ?
      and episode_id = ?
      and status in ('failed', 'running')
  `).run(input.workspaceId, input.watchId, input.episodeId);
  return result.changes;
}

function retryFailedMonitorEpisodes(input: { workspaceId: string; watchId: string }): number {
  const result = db.query(`
    update episode_processing_jobs
    set status = 'queued',
      attempts = 0,
      processing_run_id = null,
      error = null,
      started_at = null,
      finished_at = null,
      queued_at = datetime('now'),
      updated_at = datetime('now')
    where workspace_id = ?
      and watch_id = ?
      and status = 'failed'
  `).run(input.workspaceId, input.watchId);
  return result.changes;
}

async function processMonitorRun(input: {
  context: SessionContext;
  runId: string;
  name: string;
  topic: string;
  mustInclude: string[];
  sources: string[];
  maxEpisodesPerSource: number;
}): Promise<void> {
  try {
    assertRealProcessingConfigured();
    await processSourceInputs({
      options: {
        watch: {
          workspaceId: input.context.workspace.id,
          name: input.name,
          topic: input.topic,
          language: "zh-CN",
          mustInclude: input.mustInclude
        },
        sources: { sources: input.sources },
        outputDir: "outputs/web-preview",
        maxEpisodesPerSource: input.maxEpisodesPerSource,
        runId: input.runId
      },
      transcriptProvider: createVolcengineTranscriptProvider(),
      insightProvider: createCommandLineInsightProvider(),
      repositories: repos
    });
  } catch (error) {
    repos.failProcessingRun(input.runId, error instanceof Error ? error.message : String(error));
    console.error(error instanceof Error ? error.stack ?? error.message : error);
  }
}

function assertRealProcessingConfigured(): void {
  const hasVolcengineAuth = Boolean(process.env["VOLCENGINE_ASR_API_KEY"] || process.env["VOLCENGINE_ASR_APP_ID"]);
  const hasVolcengineToken = Boolean(process.env["VOLCENGINE_ASR_API_KEY"] || process.env["VOLCENGINE_ASR_ACCESS_TOKEN"]);
  if (!hasVolcengineAuth || !hasVolcengineToken) {
    throw new Error("真实处理未配置：需要 VOLCENGINE_ASR_API_KEY，或同时提供 VOLCENGINE_ASR_APP_ID 和 VOLCENGINE_ASR_ACCESS_TOKEN。本地 LLM 会按 DeepSeek TUI -> Kimi Code fallback 调用，Web 不再使用 mock 数据。");
  }
}

function monitorQuery(target: string, channel: string, keywords: string): string {
  if (isHttpUrl(channel)) return channel;
  if (isHttpUrl(target)) return target;
  const urlFromChannel = extractFirstHttpUrl(channel);
  if (urlFromChannel) return urlFromChannel;
  const urlFromTarget = extractFirstHttpUrl(target);
  if (urlFromTarget) return urlFromTarget;
  return [target, channel, keywords].filter(Boolean).join(" ");
}

function monitorTopic(target: string, channel: string, keywords: string): string {
  return [target, channel, keywords].filter(Boolean).join(" / ");
}

function immediateTopic(podcastUrl: string): string {
  return `即时处理：${podcastUrl}`;
}

function isImmediateTopic(query: string): boolean {
  return query.startsWith("即时处理：");
}

function titleFromInput(input: string, fallback: string): string {
  if (!input) return fallback;
  if (!isHttpUrl(input)) return input.slice(0, 40);
  try {
    const url = new URL(input);
    return url.hostname.replace(/^www\./, "") || input.slice(0, 40);
  } catch {
    return input.slice(0, 40);
  }
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

function extractFirstHttpUrl(input: string): string | undefined {
  const match = input.match(/https?:\/\/[^\s，,]+/i);
  return match?.[0];
}

function termsFromText(input: string): string[] {
  return input.split(/[,，\n]/).map((term) => term.trim()).filter(Boolean);
}

function summary(context: SessionContext) {
  const watches = listWatchCards({ repositories: repos, context });
  const inbox = getInboxView({ repositories: repos, context, limit: 20 });
  const usageEvents = repos.listUsageEvents({ workspaceId: context.workspace.id, userId: context.user.id, limit: 20 });
  return {
    ok: true,
    workspace: context.workspace,
    user: context.user,
    watches,
    inbox: inbox.items,
    episodeReports: immediateEpisodeReports(context),
    agentRun: currentImmediateAgentRun(context),
    usageEventCount: usageEvents.length
  };
}

type StoredTranscriptView = {
  id: string;
  episodeId: string;
  provider: string;
  model: string;
  language?: string;
  segments: TranscriptSegment[];
  confidence?: number;
  durationSec?: number;
};

type EpisodeReport = {
  episode: Episode;
  source?: Source;
  summary?: EpisodeSummary;
  transcript?: StoredTranscriptView;
  insights: Array<ReturnType<typeof summary>["episodeReports"][number]["insights"][number]>;
  player: {
    audioUrl?: string;
    pageUrl: string;
    durationSec?: number;
  };
};

type WatchProgress = {
  status: string;
  statusLabel: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  sources: string[];
  discoveredCount: number;
  latestPollCandidateCount?: number;
  latestPollQueuedCount?: number;
  latestPollCheckedAt?: string;
  currentEpisodeTitle?: string;
  currentStage?: string;
  currentStageStatus?: string;
  currentStageError?: string;
  updatedAt?: string;
  episodes: Array<{
    id: string;
    title?: string;
    stage: string;
    status: string;
    error?: string;
    publishedAt?: string;
    updatedAt?: string;
  }>;
};

function immediateEpisodeReports(context: SessionContext): EpisodeReport[] {
  return immediateProcessedEpisodeIds(context)
    .map((episodeId) => repos.getEpisodeDetailForWorkspace({
      workspaceId: context.workspace.id,
      userId: context.user.id,
      episodeId
    }) ?? processedEpisodeDetail(episodeId))
    .filter((report) => report !== undefined);
}

function immediateProcessedEpisodeIds(context: SessionContext): string[] {
  const rows = db.query(`
    select e.id
    from episodes e
    left join episode_summaries s on s.episode_id = e.id
    left join transcripts t on t.episode_id = e.id
    where (s.id is not null or t.id is not null)
      and exists (
        select 1
        from processing_episode_statuses pes
        join processing_runs pr on pr.id = pes.run_id
        join watches w on w.id = pr.watch_id
        where pes.episode_id = e.id
          and w.workspace_id = ?
          and w.query like '即时处理：%'
      )
      and not exists (
        select 1
        from insights i
        join watches w on w.id = i.watch_id
        where i.episode_id = e.id
          and w.workspace_id = ?
          and w.query not like '即时处理：%'
      )
      and not exists (
        select 1
        from processing_episode_statuses pes
        join processing_runs pr on pr.id = pes.run_id
        join watches w on w.id = pr.watch_id
        where pes.episode_id = e.id
          and w.workspace_id = ?
          and w.query not like '即时处理：%'
      )
    group by e.id
    order by max(coalesce(s.created_at, ''), coalesce(t.created_at, ''), coalesce(e.updated_at, '')) desc
    limit 20
  `).all(context.workspace.id, context.workspace.id, context.workspace.id) as Array<Record<string, unknown>>;
  return rows.map((row) => String(row["id"]));
}

function watchEpisodeReports(context: SessionContext, watchId: string): EpisodeReport[] {
  const rows = db.query(`
    select e.id as episode_id, e.published_at, max(ready.updated_at) as updated_at
    from (
      select i.episode_id, i.created_at as updated_at
      from insights i
      where i.workspace_id = ? and i.watch_id = ? and i.status = 'published'
      union all
      select pes.episode_id, pes.updated_at as updated_at
      from processing_episode_statuses pes
      join processing_runs pr on pr.id = pes.run_id
      where pr.watch_id = ? and pes.stage = 'exported' and pes.status = 'completed'
    ) ready
    join episodes e on e.id = ready.episode_id
    group by e.id
    order by datetime(coalesce(e.published_at, max(ready.updated_at))) desc, max(ready.updated_at) desc
    limit 20
  `).all(context.workspace.id, watchId, watchId) as Array<Record<string, unknown>>;
  return rows
    .map((row) => String(row["episode_id"]))
    .map((episodeId) => repos.getEpisodeDetailForWorkspace({
      workspaceId: context.workspace.id,
      userId: context.user.id,
      episodeId
    }) ?? processedEpisodeDetail(episodeId))
    .filter((report) => report !== undefined);
}

function watchProgress(watchId: string): WatchProgress | undefined {
  const run = db.query(`
    select * from processing_runs
    where watch_id = ?
    order by started_at desc, id desc
    limit 1
  `).get(watchId) as Record<string, unknown> | null;
  if (!run) return undefined;
  const statusRows = db.query(`
    select
      pes.*,
      e.title as episode_title,
      e.published_at as episode_published_at,
      e.duration_sec as episode_duration_sec,
      max(coalesce(s.created_at, ''), coalesce(i.created_at, '')) as latest_result_at
    from processing_episode_statuses pes
    left join episodes e on e.id = pes.episode_id
    left join episode_summaries s on s.episode_id = pes.episode_id
    left join insights i on i.episode_id = pes.episode_id
    where pes.run_id = ?
    group by pes.run_id, pes.episode_id
    order by pes.updated_at desc
  `).all(String(run["id"])) as Array<Record<string, unknown>>;
  const normalizedRows = statusRows.map(normalizeProgressStatusRow);
  const current = normalizedRows[0];
  const status = String(run["status"]);
  const latestPoll = db.query(`
    select * from watch_polls where watch_id = ? order by checked_at desc, id desc limit 1
  `).get(watchId) as Record<string, unknown> | null;
  const normalizedStatus = normalizedRows.some((row) => row.status === "completed") && !normalizedRows.some((row) => row.status === "running")
    ? "completed"
    : status;
  return {
    status: normalizedStatus,
    statusLabel: runStatusLabel(normalizedStatus),
    startedAt: optionalString(run["started_at"]),
    finishedAt: optionalString(run["finished_at"]),
    error: optionalString(run["error"]),
    sources: parseJsonArray(run["input_sources_json"]),
    discoveredCount: statusRows.length,
    latestPollCandidateCount: latestPoll ? nullableNumber(latestPoll["candidate_count"]) : undefined,
    latestPollQueuedCount: latestPoll ? nullableNumber(latestPoll["queued_count"]) : undefined,
    latestPollCheckedAt: latestPoll ? optionalString(latestPoll["checked_at"]) : undefined,
    currentEpisodeTitle: current?.title,
    currentStage: current?.stage,
    currentStageStatus: current?.status,
    currentStageError: current?.error,
    updatedAt: current?.updatedAt ?? optionalString(run["finished_at"]) ?? optionalString(run["started_at"]),
    episodes: normalizedRows
  };
}

function normalizeProgressStatusRow(row: Record<string, unknown>): WatchProgress["episodes"][number] {
  const stage = String(row["stage"]);
  const status = String(row["status"]);
  const error = optionalString(row["error"]);
  const updatedAt = optionalString(row["updated_at"]);
  const latestResultAt = optionalString(row["latest_result_at"]);
  if (latestResultAt && updatedAt && Date.parse(latestResultAt) >= Date.parse(updatedAt) && status === "failed") {
    return {
      id: String(row["episode_id"]),
      title: optionalString(row["episode_title"]),
      stage: "analyzed",
      status: "completed",
      publishedAt: optionalString(row["episode_published_at"]),
      updatedAt: latestResultAt
    };
  }
  return {
    id: String(row["episode_id"]),
    title: optionalString(row["episode_title"]),
    stage,
    status,
    error,
    publishedAt: optionalString(row["episode_published_at"]),
    updatedAt
  };
}

function processedEpisodeDetail(episodeId: string): EpisodeReport | undefined {
  const episodeRow = db.query("select * from episodes where id = ?").get(episodeId) as Record<string, unknown> | null;
  if (!episodeRow) return undefined;
  const episode = episodeFromRow(episodeRow);
  const sourceRow = episode.sourceId
    ? db.query("select * from sources where id = ?").get(episode.sourceId) as Record<string, unknown> | null
    : null;
  const summaryRow = db.query(`
    select * from episode_summaries where episode_id = ? order by created_at desc limit 1
  `).get(episodeId) as Record<string, unknown> | null;
  const transcriptRow = db.query(`
    select * from transcripts where episode_id = ? order by created_at desc limit 1
  `).get(episodeId) as Record<string, unknown> | null;
  if (!summaryRow && !transcriptRow) return undefined;
  const transcript = transcriptRow ? transcriptFromRow(transcriptRow) : undefined;
  return {
    episode,
    source: sourceRow ? sourceFromRow(sourceRow) : undefined,
    summary: summaryRow ? summaryFromRow(summaryRow) : undefined,
    transcript,
    insights: [],
    player: {
      audioUrl: episode.audioUrl,
      pageUrl: episode.pageUrl,
      durationSec: episode.durationSec ?? transcript?.durationSec
    }
  };
}

type AgentRun = {
  id: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  sources: string[];
  currentStage?: string;
  currentStageStatus?: string;
  currentStageError?: string;
  updatedAt?: string;
};

function currentImmediateAgentRun(context: SessionContext): AgentRun | undefined {
  const row = db.query(`
    select pr.*
    from processing_runs pr
    join watches w on w.id = pr.watch_id
    where w.workspace_id = ?
      and w.query like '即时处理：%'
      and pr.status = 'running'
    order by pr.started_at desc, pr.id desc
    limit 1
  `).get(context.workspace.id) as Record<string, unknown> | null;
  if (!row) return undefined;
  const status = db.query(`
    select * from processing_episode_statuses
    where run_id = ?
    order by updated_at desc
    limit 1
  `).get(String(row["id"])) as Record<string, unknown> | null;
  return {
    id: String(row["id"]),
    status: String(row["status"]),
    startedAt: optionalString(row["started_at"]),
    finishedAt: optionalString(row["finished_at"]),
    error: optionalString(row["error"]),
    sources: parseJsonArray(row["input_sources_json"]),
    currentStage: status ? String(status["stage"]) : undefined,
    currentStageStatus: status ? String(status["status"]) : undefined,
    currentStageError: status ? optionalString(status["error"]) : undefined,
    updatedAt: status ? optionalString(status["updated_at"]) : undefined
  };
}

function hasRunningMonitorRun(context: SessionContext): boolean {
  const row = db.query(`
    select 1
    from processing_runs pr
    join watches w on w.id = pr.watch_id
    where w.workspace_id = ?
      and w.query not like '即时处理：%'
      and pr.status = 'running'
      and datetime(pr.started_at) >= datetime('now', '-12 hours')
    limit 1
  `).get(context.workspace.id) as Record<string, unknown> | null;
  return Boolean(row);
}

function monitorFragments(context: SessionContext) {
  const watches = listWatchCards({ repositories: repos, context }).filter((watch) => !isImmediateTopic(watch.query));
  return {
    ok: true,
    hasRunning: hasRunningMonitorRun(context),
    watches: watches.map((watch) => {
      const reports = watchEpisodeReports(context, watch.id);
      return {
        id: watch.id,
        outputCount: reports.length,
        progressHtml: renderWatchProgress(watch.id, watchProgress(watch.id), reports.length),
        outputCountHtml: `${reports.length} 条产出`,
        emptyHtml: reports.length ? "" : `<div class="empty" data-watch-empty="${escapeHtml(watch.id)}">这个监控任务还没有产出内容。</div>`,
        outputs: reports.map((report) => ({
          id: report.episode.id,
          html: renderWatchOutput(report)
        }))
      };
    })
  };
}

function renderHome(context: SessionContext, notice: string | null | undefined, page: "process" | "monitor"): string {
  const data = summary(context);
  const isMonitorPage = page === "monitor";
  const shouldPollMonitor = isMonitorPage && hasRunningMonitorRun(context);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Podcast Note 本地试用</title>
  <style>
    :root { color-scheme: light; --bg: #f5f7fb; --card: #ffffff; --text: #172033; --muted: #667085; --line: #e5e7eb; --blue: #2563eb; --blue-soft: #eff6ff; --green: #047857; --red: #b42318; --ink: #0f172a; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, #e0f2fe, transparent 32rem), var(--bg); color: var(--text); }
    main { max-width: 1060px; margin: 0 auto; padding: 30px 18px 56px; }
    header { margin-bottom: 22px; }
    h1 { font-size: 34px; margin: 0 0 8px; letter-spacing: -0.035em; color: var(--ink); }
    h2 { font-size: 19px; margin: 0 0 8px; color: var(--ink); }
    h3 { font-size: 16px; margin: 0 0 8px; }
    p { line-height: 1.55; }
    .muted { color: var(--muted); }
    .small { font-size: 13px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: var(--blue-soft); color: #1d4ed8; font-weight: 700; font-size: 12px; }
    .nav { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
    .nav a { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #d0d5dd; border-radius: 999px; padding: 8px 13px; color: #344054; background: #ffffff; font-weight: 800; text-decoration: none; }
    .nav a.active { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
    .notice { margin: 0 0 16px; padding: 12px 14px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1e40af; border-radius: 12px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(280px, 1fr)); gap: 16px; align-items: start; }
    .stack { display: grid; gap: 16px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 18px; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06); }
    label { display: block; font-weight: 700; font-size: 13px; margin: 12px 0 6px; }
    input, select, textarea { width: 100%; border: 1px solid #d0d5dd; border-radius: 12px; padding: 11px 12px; font: inherit; background: white; color: var(--text); }
    textarea { min-height: 104px; resize: vertical; line-height: 1.55; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    button, .button { display: inline-flex; justify-content: center; align-items: center; border: 0; border-radius: 10px; padding: 10px 14px; background: var(--blue); color: white; font-weight: 800; text-decoration: none; cursor: pointer; }
    button[disabled] { cursor: wait; opacity: 0.58; filter: grayscale(0.2); }
    .spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.5); border-top-color: white; border-radius: 999px; margin-right: 8px; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .secondary { background: #f2f4f7; color: #344054; border: 1px solid #d0d5dd; }
    .danger { background: #fff1f0; color: var(--red); border: 1px solid #fecdca; }
    .link-button { background: transparent; color: #1d4ed8; border: 1px solid #bfdbfe; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .watch { padding: 12px; border: 1px solid var(--line); border-radius: 14px; margin-top: 10px; background: #fcfcfd; }
    .watch summary { cursor: pointer; list-style-position: inside; }
    .watch-head { display: inline-flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .watch-body { display: grid; gap: 12px; margin-top: 12px; }
    .watch-output { border: 1px solid #dbeafe; border-radius: 14px; background: #ffffff; padding: 12px; }
    .watch-output summary { cursor: pointer; font-weight: 800; }
    .watch-output .report { margin: 12px 0 0; box-shadow: none; }
    .progress-box { display: grid; gap: 10px; border: 1px solid #dbeafe; border-radius: 14px; padding: 12px; background: #f8fbff; }
    .progress-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .progress-item { border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff; padding: 10px; }
    .progress-item strong { display: block; margin-bottom: 4px; }
    .episode-progress { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
    .episode-progress li { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: start; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff; padding: 10px; }
    .episode-progress strong { display: block; margin-bottom: 3px; }
    .stage-chip { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 8px; background: #eef2ff; color: #344054; font-size: 12px; font-weight: 800; white-space: nowrap; }
    .stage-chip.running { background: #eff6ff; color: #1d4ed8; }
    .stage-chip.completed { background: #ecfdf3; color: #047857; }
    .stage-chip.failed { background: #fff1f0; color: #b42318; }
    .hint { border: 1px dashed #bfdbfe; border-radius: 12px; padding: 10px; background: #ffffff; color: #475467; }
    .pill { display: inline-block; padding: 3px 8px; border-radius: 999px; background: #ecfdf3; color: var(--green); font-size: 12px; font-weight: 800; }
    .pill.paused { background: #f2f4f7; color: #475467; }
    .empty { border: 1px dashed #cbd5e1; border-radius: 16px; padding: 18px; background: #f8fafc; }
    .agent-panel { border: 1px solid #c7d2fe; background: linear-gradient(180deg, #ffffff, #f8fbff); }
    .agent-steps { display: grid; gap: 10px; margin: 14px 0 0; padding: 0; list-style: none; }
    .agent-step { display: grid; grid-template-columns: 28px 1fr; gap: 10px; align-items: start; padding: 10px; border: 1px solid #e5e7eb; border-radius: 14px; background: #ffffff; }
    .step-dot { width: 22px; height: 22px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; background: #e5e7eb; color: #475467; font-size: 12px; font-weight: 900; }
    .agent-step.done .step-dot { background: #dcfce7; color: #047857; }
    .agent-step.active .step-dot { background: #dbeafe; color: #1d4ed8; animation: pulse 1.2s ease-in-out infinite; }
    .agent-step.failed .step-dot { background: #fee2e2; color: #b42318; }
    .agent-step strong { display: block; margin-bottom: 3px; }
    .agent-live { display: none; margin-top: 10px; color: #1d4ed8; font-weight: 800; }
    .agent-live.active { display: block; }
    .assistant-card { border-color: #bae6fd; background: linear-gradient(135deg, #ffffff 0%, #f0f9ff 100%); }
    .assistant-examples { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .assistant-example { border: 1px solid #bfdbfe; background: #ffffff; color: #1d4ed8; border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 800; cursor: pointer; }
    .assistant-result { display: none; margin-top: 14px; border: 1px solid #dbeafe; border-radius: 16px; padding: 14px; background: #ffffff; }
    .assistant-result.active { display: grid; gap: 10px; }
    .assistant-result.loading { color: #1d4ed8; font-weight: 800; }
    .typing-indicator { display: inline-flex; align-items: center; gap: 8px; }
    .typing-keyboard { display: inline-block; transform-origin: 50% 80%; animation: keyboard-tap 0.55s ease-in-out infinite; }
    .assistant-answer { margin: 0; white-space: pre-wrap; }
    .assistant-facts { display: flex; gap: 8px; flex-wrap: wrap; }
    .assistant-json { display: none; }
    .assistant-action-form { display: inline-flex; margin: 0; }
    @keyframes pulse { 50% { transform: scale(1.08); } }
    @keyframes keyboard-tap { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(2px) rotate(-5deg); } }
    .report { border: 1px solid #bfdbfe; background: #ffffff; border-radius: 18px; padding: 18px; margin-bottom: 16px; }
    .report-head { display: grid; gap: 8px; margin-bottom: 14px; }
    .report-title { font-size: 22px; margin: 0; letter-spacing: -0.02em; }
    .episode-description { display: grid; gap: 12px; border: 1px solid #e0e7ff; border-radius: 16px; padding: 14px; background: linear-gradient(180deg, #ffffff, #f8fbff); color: #344054; }
    .episode-description h4 { margin: 0; color: #0f172a; font-size: 14px; letter-spacing: 0.01em; }
    .episode-description p { margin: 0; }
    .description-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .description-section { border: 1px solid #e5e7eb; border-radius: 14px; padding: 12px; background: #ffffff; }
    .description-section.wide { grid-column: 1 / -1; }
    .description-section ol, .description-section ul { margin: 8px 0 0; padding-left: 22px; }
    .description-section li { margin: 5px 0; line-height: 1.55; }
    .description-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .description-link { display: inline-flex; max-width: 100%; overflow-wrap: anywhere; color: #1d4ed8; font-weight: 700; }
    .player { display: grid; gap: 8px; padding: 12px; border: 1px solid #dbeafe; border-radius: 14px; background: #f8fbff; }
    .player audio { width: 100%; }
    .seek { border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; padding: 4px 8px; border-radius: 999px; font-size: 12px; font-weight: 900; cursor: pointer; }
    .seek:hover { background: #dbeafe; }
    .summary-box { display: grid; gap: 10px; background: #f8fbff; border: 1px solid #dbeafe; border-radius: 14px; padding: 14px; margin: 12px 0; }
    .summary-box p { margin: 0; }
    .section-title { margin: 18px 0 10px; font-size: 15px; color: #0f172a; }
    .chapters { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
    .chapter { border: 1px solid #e5e7eb; border-radius: 12px; padding: 10px 12px; background: #fcfcfd; }
    .chapter strong { display: block; margin-bottom: 4px; }
    .timestamp { font-variant-numeric: tabular-nums; color: #1d4ed8; font-weight: 800; }
    .entity-list { display: flex; gap: 8px; flex-wrap: wrap; }
    .entity { padding: 4px 8px; border-radius: 999px; background: #f2f4f7; color: #344054; font-size: 12px; font-weight: 700; }
    .insight { border: 1px solid #dbeafe; background: #ffffff; border-radius: 16px; padding: 16px; margin-bottom: 14px; }
    .insight.compact { margin-bottom: 10px; background: #fdfefe; }
    .score { color: #1d4ed8; font-weight: 800; }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 12px; }
    .quote { border-left: 4px solid #93c5fd; padding: 10px 12px; background: #f8fbff; border-radius: 8px; color: #344054; }
    code { background: #eef2ff; color: #344054; border-radius: 6px; padding: 1px 5px; }
    pre { background: #101828; color: #f9fafb; border-radius: 12px; padding: 12px; overflow: auto; }
    .full { margin-top: 16px; }
    details.helper { margin-top: 16px; border: 1px dashed #d0d5dd; background: #fcfcfd; color: #475467; }
    details.helper summary { cursor: pointer; font-weight: 800; color: #344054; }
    details.helper ul { margin: 10px 0 0; padding-left: 20px; }
    details.helper code { background: #f2f4f7; color: #344054; }
    a { color: #1d4ed8; }
    @media (max-width: 820px) { header, .grid, .row, .progress-grid { grid-template-columns: 1fr; display: grid; } }
  </style>
</head>
<body>
<main>
  <header>
    <span class="badge">Local preview</span>
    <h1>Podcast Note</h1>
    <p class="muted">${isMonitorPage ? "监控任务是长期任务：填写目标站点或平台、频道或主播、可选关键词和运行频率。" : "即时处理是一次性任务：粘贴一个具体播客链接，直接开始转写、总结和提炼核心观点。"}</p>
    <nav class="nav" aria-label="页面导航"><a class="${isMonitorPage ? "" : "active"}" href="/">即时处理</a><a class="${isMonitorPage ? "active" : ""}" href="/monitor">监控任务</a><a href="/integrations/feishu">飞书集成</a></nav>
  </header>
  ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
  ${renderAssistantPanel()}
  ${isMonitorPage ? `
  <section class="card">
    <h2>监控一个目标</h2>
    <p class="muted small">填写目标站点或平台名称，以及对应频道名称或主播名称。关键词可选，多个关键词用逗号分割；提交后会按真实处理链路立即回看指定集数。</p>
    <form method="post" action="/api/monitor-target" data-monitor-form>
      <label for="target">目标站点 / 平台名称</label>
      <input id="target" name="target" placeholder="小宇宙 / Apple Podcasts / Listen Notes / example.com" required />
      <label for="channel">频道链接 / 频道名称 / 主播名称</label>
      <input id="channel" name="channel" placeholder="优先填频道链接；也可填：半拿铁 / Lex Fridman / 具体主播名" required />
      <label for="monitorKeywords">关键词（可选，多个用逗号分割）</label>
      <input id="monitorKeywords" name="keywords" placeholder="AI组织, agent workflow" />
      <div class="row">
        <div><label for="frequency">频率</label><select id="frequency" name="frequency"><option value="daily">每天</option><option value="weekly">每周</option><option value="realtime">实时</option></select></div>
        <div><label for="maxEpisodes">回看集数</label><input id="maxEpisodes" name="maxEpisodes" type="number" min="1" max="10" value="3" /></div>
      </div>
      <p><button type="submit" data-idle-label="开始监控" data-busy-label="正在创建">开始监控</button></p>
    </form>
  </section>
  <section class="card full">
    <h2>监控任务</h2>
    ${renderWatches(data.watches, context)}
  </section>` : `
  <section class="card">
    <h2>处理一个播客链接</h2>
    <p class="muted small">粘贴 RSS、Apple Podcasts、Spotify、YouTube、小宇宙、Listen Notes 或单集页面链接。这个入口只做一次即时处理，不创建监控任务。</p>
    <form method="post" action="/api/process-link" data-processing-form>
      <label for="podcastUrl">播客链接</label>
      <input id="podcastUrl" name="podcastUrl" placeholder="https://example.com/feed.xml" required />
      <p><button type="submit" data-idle-label="立即处理" data-busy-label="正在处理">立即处理</button></p>
    </form>
  </section>`}
  ${isMonitorPage ? "" : `<details class="card full agent-panel" id="agent-status">
    <summary><strong>Agent 执行过程</strong><span class="muted small"> ${escapeHtml(agentSummary(data.agentRun))}</span></summary>
    ${renderAgentRun(data.agentRun)}
  </details>`}
  ${isMonitorPage ? "" : `<section class="card full">
    <h2>结果</h2>
    ${renderResults(data.episodeReports)}
  </section>`}
</main>
<script>
  const stageLabels = {
    submitted: ["接收任务", "读取你提交的播客链接或监控目标。"],
    resolving: ["解析来源", "识别平台、抓取公开页面或 RSS，并找到可处理的单集。"],
    resolved: ["解析来源", "识别平台、抓取公开页面或 RSS，并找到可处理的单集。"],
    transcribing: ["转写音频", "把公开音频交给火山引擎 ASR，生成带时间戳的转录文本。"],
    transcribed: ["转写音频", "把公开音频交给火山引擎 ASR，生成带时间戳的转录文本。"],
    analyzing: ["提炼内容", "按语义分段，生成总结、章节、核心观点和证据。"],
    analyzed: ["提炼内容", "按语义分段，生成总结、章节、核心观点和证据。"],
    exported: ["生成报告", "保存结果，并在下方结果区展示可核验的单集报告。"],
    failed: ["处理失败", "处理过程中出现错误，页面会显示具体错误。"]
  };

  const orderedStages = ["submitted", "resolved", "transcribing", "analyzing", "exported"];

  document.querySelectorAll("[data-processing-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!(form instanceof HTMLFormElement)) return;
      const button = form.querySelector("button[type='submit']");
      const isMonitorForm = form.getAttribute("action") === "/api/monitor-target";
      setBusyButton(button, true);
      if (!isMonitorForm) {
        renderLiveAgentStatus("submitted", "running", "Agent 已接收任务，开始处理。长音频转写和分析可能需要几分钟。");
      }
      try {
        const response = await fetch(form.action, { method: "POST", body: new FormData(form), redirect: "manual" });
        if (response.status >= 300 && response.status < 400) {
          window.location.href = response.headers.get("Location") || "/";
          return;
        }
        if (!response.ok) {
          document.open();
          document.write(await response.text());
          document.close();
          return;
        }
        window.location.reload();
      } catch (error) {
        if (!isMonitorForm) {
          renderLiveAgentStatus("failed", "failed", error instanceof Error ? error.message : String(error));
        }
        setBusyButton(button, false);
      }
    });
  });

  document.querySelectorAll("[data-monitor-form]").forEach((form) => {
    form.addEventListener("submit", () => {
      if (!(form instanceof HTMLFormElement)) return;
      setBusyButton(form.querySelector("button[type='submit']"), true);
    });
  });

  document.querySelectorAll("[data-assistant-example]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector("[data-assistant-form] textarea[name='message']");
      if (!(input instanceof HTMLTextAreaElement) || !(button instanceof HTMLElement)) return;
      input.value = button.getAttribute("data-assistant-example") || "";
      input.focus();
    });
  });

  document.querySelectorAll("[data-assistant-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!(form instanceof HTMLFormElement)) return;
      const resultBox = document.querySelector("[data-assistant-result]");
      const button = form.querySelector("button[type='submit']");
      setBusyButton(button, true);
      setAssistantResult('<span class="typing-indicator"><span class="typing-keyboard" aria-hidden="true">⌨️</span><span>正在敲键盘，Podcast Note 正在回答...</span></span>', "loading");
      try {
        const response = await fetch("/api/assistant", { method: "POST", body: new FormData(form), headers: { accept: "application/json" } });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "意图分析失败");
        }
        const data = await response.json();
        setAssistantResult(typeof data.html === "string" ? data.html : "没有返回可展示的结果。", "");
        resultBox?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (error) {
        setAssistantResult('<p class="assistant-answer">分析失败：' + escapeClientHtml(error instanceof Error ? error.message : String(error)) + '</p>', "");
      } finally {
        setBusyButton(button, false);
      }
    });
  });

  function setAssistantResult(html, className) {
    const resultBox = document.querySelector("[data-assistant-result]");
    if (!(resultBox instanceof HTMLElement)) return;
    resultBox.className = "assistant-result active" + (className ? " " + className : "");
    resultBox.innerHTML = html;
  }

  function escapeClientHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function setBusyButton(button, busy) {
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = busy;
    button.innerHTML = busy
      ? '<span class="spinner"></span>' + (button.getAttribute("data-busy-label") || "处理中")
      : (button.getAttribute("data-idle-label") || "提交");
  }

  function renderLiveAgentStatus(stage, status, message) {
    const panel = document.getElementById("agent-status");
    if (!panel) return;
    if (panel instanceof HTMLDetailsElement) panel.open = true;
    panel.innerHTML = '<summary><strong>Agent 执行过程</strong><span class="muted small"> 正在处理</span></summary>' + agentStatusHtml(stage, status, message, true);
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function agentStatusHtml(stage, status, message, live) {
    const stageIndex = orderedStages.indexOf(stage);
    const normalizedIndex = stageIndex >= 0 ? stageIndex : 0;
    const steps = orderedStages.map((item, index) => {
      const [title, description] = stageLabels[item];
      const state = status === "failed" && index === normalizedIndex ? "failed" : index < normalizedIndex || status === "completed" ? "done" : index === normalizedIndex ? "active" : "";
      return '<li class="agent-step ' + state + '"><span class="step-dot">' + (state === "done" ? "✓" : index + 1) + '</span><div><strong>' + title + '</strong><span class="muted small">' + description + '</span></div></li>';
    }).join("");
    return '<p class="muted">' + message + '</p><p class="agent-live active">处理中，请不要重复提交。完成后页面会自动刷新。</p><ol class="agent-steps">' + steps + '</ol>';
  }

  document.addEventListener("click", (event) => {
    const button = event.target instanceof HTMLElement ? event.target.closest("[data-seek]") : null;
    if (!(button instanceof HTMLElement)) return;
    const playerId = button.getAttribute("data-player");
    const seconds = Number(button.getAttribute("data-seek"));
    const player = playerId ? document.getElementById(playerId) : null;
    if (!(player instanceof HTMLAudioElement) || !Number.isFinite(seconds)) return;
    player.currentTime = Math.max(0, seconds);
    player.play().catch(() => {});
    player.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  function startMonitorPolling() {
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const response = await fetch("/api/monitor-fragments", { headers: { accept: "application/json" } });
          if (response.ok) {
            const data = await response.json();
            applyMonitorFragments(data);
            if (!data.hasRunning) {
              stopped = true;
              return;
            }
          }
        } catch {
          // Keep the current UI stable; the next poll can recover.
        }
      }
      window.setTimeout(poll, 5000);
    };
    window.setTimeout(poll, 1500);
  }

  function applyMonitorFragments(data) {
    if (!data || !Array.isArray(data.watches)) return;
    data.watches.forEach((watch) => {
      const root = document.querySelector('[data-watch-id="' + cssEscape(watch.id) + '"]');
      if (!root) return;
      replaceHtml(root.querySelector("[data-watch-progress]"), watch.progressHtml);
      replaceText(root.querySelector("[data-watch-output-count]"), watch.outputCountHtml);

      const outputsRoot = root.querySelector("[data-watch-outputs]");
      if (outputsRoot && Array.isArray(watch.outputs)) {
        const empty = root.querySelector("[data-watch-empty]");
        if (empty && watch.outputs.length > 0) empty.remove();
        watch.outputs.forEach((output) => {
          if (!output || !output.id || !output.html) return;
          if (outputsRoot.querySelector('[data-output-id="' + cssEscape(output.id) + '"]')) return;
          outputsRoot.insertAdjacentHTML("beforeend", output.html);
        });
      }
    });
  }

  function replaceHtml(target, html) {
    if (!target || typeof html !== "string" || target.innerHTML === html) return;
    target.innerHTML = html;
  }

  function replaceText(target, text) {
    if (!target || typeof text !== "string" || target.textContent === text) return;
    target.textContent = text;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(value));
    return String(value).replace(/["\\\\]/g, "\\\\$&");
  }

  ${shouldPollMonitor ? "startMonitorPolling();" : ""}
</script>
</body>
</html>`;
}

async function renderFeishuIntegrationPage(context: SessionContext, request: Request, url: URL, notice: string | null | undefined): Promise<string> {
  void request;
  void url;
  const integration = larkBotStatus();
  const eventStatus = readLarkEventRuntimeStatus();
  const botOpenUrl = integration.botOpenUrl;
  const qrUrl = botOpenUrl ? await qrImageUrl(botOpenUrl) : undefined;
  const configuredAppId = larkConfiguredAppId();
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>飞书集成 · Podcast Note</title>
  <style>
    :root { color-scheme: light; --bg: #f5f7fb; --card: #ffffff; --text: #172033; --muted: #667085; --line: #e5e7eb; --blue: #2563eb; --blue-soft: #eff6ff; --green: #047857; --red: #b42318; --ink: #0f172a; --amber: #b54708; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, #e0f2fe, transparent 32rem), var(--bg); color: var(--text); }
    main { max-width: 960px; margin: 0 auto; padding: 30px 18px 56px; }
    h1 { font-size: 34px; margin: 0 0 8px; letter-spacing: -0.035em; color: var(--ink); }
    h2 { font-size: 20px; margin: 0 0 8px; color: var(--ink); }
    p { line-height: 1.55; }
    .muted { color: var(--muted); }
    .small { font-size: 13px; }
    .nav { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0 22px; }
    .nav a { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #d0d5dd; border-radius: 999px; padding: 8px 13px; color: #344054; background: #ffffff; font-weight: 800; text-decoration: none; }
    .nav a.active { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 18px; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06); margin-bottom: 16px; }
    .notice { margin: 0 0 16px; padding: 12px 14px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1e40af; border-radius: 12px; }
    .status { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 7px 11px; font-weight: 900; font-size: 13px; }
    .connected { color: #047857; background: #ecfdf3; }
    .pending { color: #1d4ed8; background: #eff6ff; }
    .missing { color: #b42318; background: #fff1f0; }
    .warning { color: var(--amber); background: #fffaeb; }
    button, .button { display: inline-flex; justify-content: center; align-items: center; border: 0; border-radius: 10px; padding: 10px 14px; background: var(--blue); color: white; font-weight: 800; text-decoration: none; cursor: pointer; }
    .secondary { background: #f2f4f7; color: #344054; border: 1px solid #d0d5dd; }
    input { width: 100%; border: 1px solid #d0d5dd; border-radius: 10px; padding: 10px 12px; font: inherit; }
    label { display: grid; gap: 6px; font-weight: 800; color: #344054; }
    code { background: #eef2ff; color: #344054; border-radius: 6px; padding: 1px 5px; }
    pre { background: #101828; color: #f9fafb; border-radius: 12px; padding: 12px; overflow: auto; white-space: pre-wrap; }
    .auth-box { display: grid; gap: 12px; border: 1px dashed #bfdbfe; border-radius: 16px; padding: 16px; background: #f8fbff; }
    .qr { width: 204px; height: 204px; border-radius: 18px; border: 1px solid #dbeafe; background: #fff; padding: 12px; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08); }
    .qr img { display: block; width: 100%; height: 100%; }
    .row { display: grid; grid-template-columns: 230px 1fr; gap: 16px; align-items: start; }
    .setup-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }
    .setup-step { border: 1px solid #e5e7eb; border-radius: 14px; padding: 12px; background: #fcfcfd; }
    .setup-step strong { display: block; margin-bottom: 4px; }
    .path-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }
    .path-card { border: 1px solid #dbeafe; border-radius: 16px; padding: 14px; background: #ffffff; }
    .path-card h3 { margin: 0 0 8px; font-size: 17px; color: var(--ink); }
    .path-card ol { margin: 0; padding-left: 20px; color: #344054; line-height: 1.65; }
    .path-card.personal { border-color: #bfdbfe; background: #f8fbff; }
    .path-card.team { border-color: #bbf7d0; background: #f0fdf4; }
    .checks { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 14px; }
    .check { border: 1px solid #e5e7eb; border-radius: 14px; padding: 12px; background: #fcfcfd; }
    .check.ok { border-color: #bbf7d0; background: #f0fdf4; }
    .check.fail { border-color: #fecaca; background: #fff7f7; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0; }
    a { color: #1d4ed8; }
    @media (max-width: 720px) { .row, .setup-steps, .checks, .form-grid, .path-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<main>
  <header>
    <h1>扫码接入 Podcast Note 机器人</h1>
    <p class="muted">用户用飞书扫码后，先走个人私聊接收：给 Podcast Note 机器人发一条消息即可绑定。团队群聊接收先暂缓，后续再开放。</p>
    <nav class="nav"><a href="/">即时处理</a><a href="/monitor">监控任务</a><a class="active" href="/integrations/feishu">飞书集成</a></nav>
  </header>
  ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
  <section class="card">
    <h2>连接状态</h2>
    ${integration.connected ? `
      <p><span class="status connected">已连接</span></p>
      <p class="muted">机器人已绑定到飞书目标会话：${escapeHtml(integration.installation?.chatName ?? integration.installation?.chatId ?? "")} · 企业：${escapeHtml(integration.installation?.tenantKey ?? "")}</p>
      <p class="small muted">chat_id: <code>${escapeHtml(integration.installation?.chatId ?? "")}</code></p>
      <form method="post" action="/api/lark/send-test-message"><button type="submit">发送测试消息</button></form>
    ` : `
      <p><span class="status warning">等待绑定目标会话</span></p>
      <p class="muted">飞书用户扫码打开机器人入口后，进入机器人私聊并发送 <code>/bind</code> 或任意消息。后台通过消息事件拿到私聊 <code>chat_id</code> 后就会变为已连接。</p>
    `}
    ${eventStatus ? `
      <div class="setup-step">
        <strong>事件监听诊断</strong>
        <p class="small muted">状态：<code>${escapeHtml(String(eventStatus.state ?? "unknown"))}</code> · 更新时间：${escapeHtml(String(eventStatus.updatedAt ?? ""))}</p>
        ${eventStatus.state === "ready" ? `<p class="small muted">长连接已就绪，但还没有收到任何 <code>im.message.receive_v1</code> 消息事件。如果你已经发送 /bind，请检查飞书开发者后台是否订阅了「接收消息 v2.0 / im.message.receive_v1」，并确认权限 <code>im:message.p2p_msg:readonly</code> 已开通并发布生效。</p>` : ""}
        ${eventStatus.lastRawKeys ? `<p class="small muted">最近事件字段：<code>${escapeHtml(Array.isArray(eventStatus.lastRawKeys) ? eventStatus.lastRawKeys.join(",") : String(eventStatus.lastRawKeys))}</code></p>` : ""}
        ${eventStatus.lastChatId ? `<p class="small muted">最近 chat_id：<code>${escapeHtml(String(eventStatus.lastChatId))}</code></p>` : ""}
        ${eventStatus.lastError ? `<p class="small muted">最近错误：<code>${escapeHtml(String(eventStatus.lastError))}</code></p>` : ""}
      </div>
    ` : `<p class="small muted">尚未发现本地事件监听状态文件，请确认 <code>./scripts/podcast-note restart</code> 已启动飞书事件 worker。</p>`}
    <div class="checks">
      ${integration.setupChecks.map((check) => `<div class="check ${check.ok ? "ok" : "fail"}"><strong>${escapeHtml(check.label)}</strong><p class="small muted">${escapeHtml(check.message)}</p></div>`).join("")}
    </div>
  </section>
  <section class="card">
    <h2>扫码后如何接收 Podcast Note</h2>
    ${configuredAppId && botOpenUrl && qrUrl ? `
      <div class="auth-box">
        <div class="row">
          <div class="qr"><img alt="飞书扫码打开 Podcast Note 机器人" src="${escapeHtml(qrUrl)}" /></div>
          <div>
            <h3>用飞书扫码</h3>
            <p class="muted">二维码会打开飞书里的 Podcast Note 机器人。当前优先支持个人模式：在机器人私聊里发一条消息，系统会绑定这个私聊 <code>chat_id</code> 作为推送目标。</p>
            <p><a href="${escapeHtml(botOpenUrl)}" target="_blank" rel="noreferrer">无法扫码？打开机器人入口链接</a></p>
            <p class="small muted">App ID: <code>${escapeHtml(configuredAppId)}</code></p>
          </div>
        </div>
      </div>
      <div class="path-grid">
        <div class="path-card personal">
          <h3>当前推荐：个人私聊接收</h3>
          <ol>
            <li>用飞书扫码打开 Podcast Note 机器人。</li>
            <li>进入机器人私聊后，发送 <code>/bind</code> 或任意消息。</li>
            <li>后台通过消息事件记录这个私聊 <code>chat_id</code>。</li>
            <li>后续播客摘要、报告和音频片段直接推送到你的机器人私聊。</li>
          </ol>
        </div>
        <div class="path-card team">
          <h3>暂缓开放：团队群聊接收</h3>
          <ol>
            <li>用飞书扫码打开 Podcast Note 机器人。</li>
            <li>在飞书里把机器人添加到目标团队群。</li>
            <li>后台通过机器人入群事件记录群聊 <code>chat_id</code>。</li>
            <li>该能力先保留为企业团队模式，当前建议先使用个人私聊。</li>
          </ol>
        </div>
      </div>
      <div class="setup-steps">
        <div class="setup-step"><strong>1. 扫码打开机器人</strong><span class="small muted">不走 OAuth，不需要 redirect_uri。</span></div>
        <div class="setup-step"><strong>2. 发送绑定消息</strong><span class="small muted">在机器人私聊里发送 /bind 或任意消息。</span></div>
        <div class="setup-step"><strong>3. 长连接完成绑定</strong><span class="small muted">后台收到事件后记录 chat_id 并开始推送。</span></div>
      </div>
    ` : !configuredAppId ? `
      <p><span class="status missing">管理员未完成应用配置</span></p>
      <p class="muted">请在 <code>.env</code> 中配置 <code>LARK_APP_ID=cli_xxx</code> 和 <code>LARK_APP_SECRET</code> 后重启服务。</p>
    ` : ""}
    <p class="small muted">长连接模式不要求公网回调地址；部署机器只需要能访问飞书开放平台，并开启应用的机器人与事件权限。</p>
  </section>
  <section class="card">
    <h2>本地验证入口</h2>
    <p class="muted">真实生产环境由飞书长连接事件自动写入 <code>chat_id</code>。部署前如果要验证消息 API，可以在这里手动填入个人私聊或团队群聊的 <code>chat_id</code>。</p>
    <form method="post" action="/api/lark/bot-installations">
      <input type="hidden" name="appId" value="${escapeHtml(configuredAppId ?? "")}" />
      <div class="form-grid">
        <label>tenant_key<input name="tenantKey" placeholder="tenant_xxx，本地可先填 tenant_local_preview" value="tenant_local_preview" /></label>
        <label>chat_id<input name="chatId" placeholder="oc_xxx" required /></label>
        <label>会话名称<input name="chatName" placeholder="我的播客助手 / 播客情报群" /></label>
        <label>operator_open_id<input name="operatorOpenId" placeholder="ou_xxx，可选" /></label>
      </div>
      <button type="submit" class="secondary">手动记录目标会话</button>
    </form>
  </section>
  <section class="card">
    <h2>飞书端标准呈现</h2>
    <p class="muted">飞书侧只保留接收、阅读、收听，不在消息里做保存/不相关反馈。</p>
    <pre>处理完成提示
-> 今日核心摘要
-> 完整报告文件卡
-> 核心音频片段文件卡</pre>
    <p class="small muted">原型文件：<code>docs/lark-experience-prototype.html</code></p>
  </section>
</main>
</body>
</html>`;
}

function renderAssistantPanel(): string {
  return `<section class="card assistant-card full">
    <h2>智能问答与意图识别</h2>
    <p class="muted small">直接说你想做什么。Podcast Note 会先用本地 DeepSeek TUI 判断意图，失败时自动 fallback 到本地 Kimi Code。</p>
    <form data-assistant-form>
      <label for="assistantMessage">你想让 Podcast Note 帮你做什么？</label>
      <textarea id="assistantMessage" name="message" placeholder="例如：帮我监控小宇宙的硅谷101，每天检查 AI Agent 相关内容。"></textarea>
      <div class="assistant-examples" aria-label="示例问题">
        <button class="assistant-example" type="button" data-assistant-example="这个播客链接帮我处理一下：https://example.com/episode">处理一个链接</button>
        <button class="assistant-example" type="button" data-assistant-example="帮我监控小宇宙的硅谷101，每天检查 AI Agent">创建监控</button>
        <button class="assistant-example" type="button" data-assistant-example="现在有哪些监控任务？">查询状态</button>
        <button class="assistant-example" type="button" data-assistant-example="最近播客里关于 AI Agent 商业化有什么结论？">问知识库</button>
      </div>
      <p><button type="submit" data-idle-label="分析意图" data-busy-label="正在分析">分析意图</button></p>
    </form>
    <div class="assistant-result" data-assistant-result></div>
  </section>`;
}

function renderAssistantResult(result: IntentAssistantOutput): string {
  const extracted = result.extracted;
  const facts = [
    `意图：${intentLabel(result.intent)}`,
    `置信度：${Math.round(result.confidence * 100)}%`,
    extracted.url ? `链接：${extracted.url}` : "",
    extracted.target ? `目标：${extracted.target}` : "",
    extracted.channel ? `频道：${extracted.channel}` : "",
    extracted.keywords.length ? `关键词：${extracted.keywords.join(", ")}` : "",
    extracted.frequency ? `频率：${frequencyLabel(extracted.frequency)}` : ""
  ].filter(Boolean);
  return `
    <div class="assistant-facts">${facts.map((fact) => `<span class="pill paused">${escapeHtml(fact)}</span>`).join("")}</div>
    <p class="assistant-answer">${escapeHtml(result.answer)}</p>
    ${result.reasoning ? `<p class="muted small">判断依据：${escapeHtml(result.reasoning)}</p>` : ""}
    ${renderAssistantAction(result.suggestedAction)}
  `;
}

function renderAssistantAction(action: IntentAssistantOutput["suggestedAction"]): string {
  if (action.type === "submit_process_link" && typeof action.payload["podcastUrl"] === "string") {
    return `<form class="assistant-action-form" method="post" action="/api/process-link">
      <input type="hidden" name="podcastUrl" value="${escapeHtml(action.payload["podcastUrl"])}" />
      <button type="submit">${escapeHtml(action.label || "立即处理这个链接")}</button>
    </form>`;
  }
  if (action.type === "submit_monitor_target") {
    return `<form class="assistant-action-form" method="post" action="/api/monitor-target">
      <input type="hidden" name="target" value="${escapeHtml(action.payload["target"] ?? "")}" />
      <input type="hidden" name="channel" value="${escapeHtml(action.payload["channel"] ?? action.payload["target"] ?? "")}" />
      <input type="hidden" name="keywords" value="${escapeHtml(action.payload["keywords"] ?? "")}" />
      <input type="hidden" name="frequency" value="${escapeHtml(action.payload["frequency"] ?? "daily")}" />
      <input type="hidden" name="maxEpisodes" value="${escapeHtml(action.payload["maxEpisodes"] ?? 3)}" />
      <button type="submit">${escapeHtml(action.label || "创建监控任务")}</button>
    </form>`;
  }
  if (action.type === "open_monitor_page") {
    return `<p><a class="button secondary" href="/monitor">${escapeHtml(action.label || "打开监控任务")}</a></p>`;
  }
  if (action.type === "open_feishu_page") {
    return `<p><a class="button secondary" href="/integrations/feishu">${escapeHtml(action.label || "打开飞书集成")}</a></p>`;
  }
  return "";
}

function intentLabel(intent: IntentAssistantOutput["intent"]): string {
  if (intent === "process_episode") return "处理播客链接";
  if (intent === "create_monitor") return "创建监控";
  if (intent === "ask_knowledge") return "知识问答";
  if (intent === "check_status") return "查询状态";
  if (intent === "manage_monitor") return "管理监控";
  if (intent === "help") return "使用帮助";
  return "未知";
}

async function renderLarkBindSessionBox(bindSession: NonNullable<ReturnType<typeof repos.getLarkBindSession>>, status: ReturnType<typeof larkAuthStatus> | undefined): Promise<string> {
  const label = status?.status ?? bindSession.status;
  const safeVerificationUrl = sanitizeLarkVerificationUrl(bindSession.verificationUrl);
  const qrUrl = await qrImageUrl(safeVerificationUrl);
  return `<div class="auth-box">
    <p><span class="status ${label === "completed" ? "connected" : label === "pending" ? "pending" : "missing"}">授权状态：${escapeHtml(label)}</span></p>
    ${label === "pending" ? `
      <div class="row">
        <div class="qr"><img alt="飞书扫码接入 Podcast Note 机器人" src="${escapeHtml(qrUrl)}" /></div>
        <div>
          <h3>请用飞书扫码接入机器人</h3>
          <p class="muted">二维码会打开飞书授权页。确认后，Podcast Note 会完成企业连接，后续即可把摘要、报告和音频片段推送到飞书。</p>
          <p><a href="${escapeHtml(safeVerificationUrl)}" target="_blank" rel="noreferrer">无法扫码？打开接入链接</a></p>
          <p class="small muted">过期时间：${escapeHtml(bindSession.expiresAt)}</p>
          <p class="small muted">bind_session_id: <code>${escapeHtml(bindSession.id)}</code></p>
        </div>
      </div>
      <script>
        setTimeout(async () => {
          try {
            const response = await fetch("/api/lark/bind-sessions/${encodeURIComponent(bindSession.id)}");
            if (response.ok) {
              const data = await response.json();
              if (data.status === "completed" || data.status === "expired" || data.status === "failed") window.location.reload();
            }
          } catch {}
        }, 2000);
      </script>
    ` : ""}
    ${status?.status === "completed" ? `<p class="muted">连接 ID：<code>${escapeHtml(status.connectionId)}</code></p>` : ""}
  </div>`;
}

function renderResults(reports: ReturnType<typeof summary>["episodeReports"]): string {
  if (reports.length === 0) {
    return `<div class="empty"><h3>还没有结果</h3><p class="muted">任务完成后，这里会显示单集总结、章节、核心观点和证据。</p></div>`;
  }
  return reports.map(renderEpisodeReport).join("");
}

function renderAgentRun(run: ReturnType<typeof summary>["agentRun"]): string {
  if (!run) {
    return `<div class="empty"><h3>当前没有正在处理的即时任务</h3><p class="muted">粘贴播客链接并点击“立即处理”后，这里才会展示本次任务的实时执行过程。历史处理结果只展示在下方结果区。</p></div>`;
  }
  const stage = run?.currentStage ?? (run ? "submitted" : "submitted");
  const status = run?.status === "completed" ? "completed" : run?.status === "failed" ? "failed" : run ? "running" : "idle";
  const currentIndex = Math.max(0, agentStageIndex(stage));
  const message = agentRunMessage(run, status);
  const steps = agentStages.map((item, index) => {
    const state = status === "failed" && index === currentIndex
      ? "failed"
      : status === "completed" || index < currentIndex
        ? "done"
        : status === "running" && index === currentIndex
          ? "active"
          : "";
    return `<li class="agent-step ${state}"><span class="step-dot">${state === "done" ? "✓" : index + 1}</span><div><strong>${escapeHtml(item.title)}</strong><span class="muted small">${escapeHtml(item.description)}</span></div></li>`;
  }).join("");
  return `<p class="muted">${escapeHtml(message)}</p>${status === "running" ? `<p class="agent-live active">处理中，请不要重复提交。长音频转写和内容分析可能需要几分钟。</p>` : ""}<ol class="agent-steps">${steps}</ol>`;
}

function agentSummary(run: ReturnType<typeof summary>["agentRun"]): string {
  if (!run) return "当前无任务";
  if (run.status === "completed") return "最近一次已完成";
  if (run.status === "failed") return "最近一次失败";
  return `正在${stageLabel(run.currentStage)}`;
}

const agentStages = [
  { key: "submitted", title: "接收任务", description: "读取你提交的播客链接或监控目标。" },
  { key: "resolved", title: "解析来源", description: "识别平台、抓取公开页面或 RSS，并找到可处理的单集和音频直链。" },
  { key: "transcribing", title: "转写音频", description: "把公开音频交给火山引擎 ASR，生成带时间戳的转录文本。" },
  { key: "analyzing", title: "提炼内容", description: "按语义分段，生成总结、章节、核心观点和证据。" },
  { key: "exported", title: "生成报告", description: "保存结果，并在下方结果区展示可核验的单集报告。" }
] as const;

function agentStageIndex(stage: string): number {
  if (stage === "transcribed") return 2;
  if (stage === "analyzed") return 3;
  if (stage === "failed") return 4;
  return agentStages.findIndex((item) => item.key === stage);
}

function agentRunMessage(run: AgentRun, status: string): string {
  const source = run.sources[0] ? `输入：${run.sources[0]}` : "输入已记录";
  if (status === "completed") return `${source}。最近一次处理已完成：已解析来源、转写音频、提炼内容并生成报告。`;
  if (status === "failed") return `${source}。处理失败：${run.error ?? run.currentStageError ?? "未知错误"}`;
  return `${source}。当前阶段：${stageLabel(run.currentStage)}。`;
}

function stageLabel(stage?: string): string {
  if (!stage) return "接收任务";
  if (stage === "resolved") return "解析来源完成";
  if (stage === "transcribing") return "正在转写音频";
  if (stage === "transcribed") return "转写完成";
  if (stage === "analyzing") return "正在提炼内容";
  if (stage === "analyzed") return "内容提炼完成";
  if (stage === "exported") return "报告已生成";
  if (stage === "failed") return "处理失败";
  return stage;
}

function renderEpisodeReport(report: ReturnType<typeof summary>["episodeReports"][number]): string {
  const summary = report.summary;
  const worthListening = summary?.worthListening;
  const entities = summary?.entities ?? [];
  const playerId = `player-${safeDomId(report.episode.id)}`;
  const publishedAt = episodePublishedTimeLabel(report.episode.publishedAt);
  const processedAt = latestReportUpdatedAt(report);
  return `<article class="report">
    <div class="report-head">
      <div class="meta"><span class="pill">${escapeHtml(report.source?.title ?? report.source?.type ?? "播客")}</span>${publishedAt ? `<span class="pill">节目发布时间：${escapeHtml(publishedAt)}</span>` : ""}${processedAt ? `<span class="pill paused">处理时间：${escapeHtml(processedAt)}</span>` : ""}<span class="pill paused">${escapeHtml(report.transcript?.language ?? report.episode.language ?? "unknown")}</span>${report.player.durationSec ? `<span class="pill paused">${escapeHtml(formatDuration(report.player.durationSec))}</span>` : ""}</div>
      <h3 class="report-title">${escapeHtml(report.episode.title)}</h3>
      ${renderEpisodeDescription(report.episode.description)}
      <div class="actions"><a class="button secondary" href="${escapeHtml(report.player.pageUrl)}" target="_blank" rel="noreferrer">打开原文</a>${report.player.audioUrl ? `<a class="button secondary" href="${escapeHtml(report.player.audioUrl)}" target="_blank" rel="noreferrer">打开音频</a>` : ""}</div>
    </div>
    ${report.player.audioUrl ? `<div class="player"><strong>音频核验</strong><audio id="${escapeHtml(playerId)}" controls preload="metadata" src="${escapeHtml(report.player.audioUrl)}"></audio><p class="muted small">点击章节或核心观点旁的时间戳，会跳到对应音频片段播放，用来核对总结和证据是否准确。</p></div>` : `<div class="empty">这集没有可直接播放的公开音频 URL，无法在页面内核验音频片段。</div>`}
    ${summary ? `<div class="summary-box">
      <p><strong>一句话总结：</strong>${escapeHtml(summary.oneLiner)}</p>
      <p><strong>内容总结：</strong>${escapeHtml(summary.overview)}</p>
      ${worthListening ? `<p><strong>是否值得听：</strong>${escapeHtml(recommendationLabel(worthListening.recommendation))}。${escapeHtml(worthListening.reason)}</p>` : ""}
      ${worthListening?.bestSegments?.length ? `<p><strong>推荐跳听：</strong>${worthListening.bestSegments.map((segment) => `${renderSeekButton(playerId, segment.startSec, `${formatTimestamp(segment.startSec)}-${formatTimestamp(segment.endSec)}`)} ${escapeHtml(segment.reason)}`).join("；")}</p>` : ""}
    </div>` : `<div class="empty">这集已经生成核心观点，但还没有 episode-level 总结。</div>`}
    ${entities.length ? `<h4 class="section-title">关键实体</h4><div class="entity-list">${entities.slice(0, 18).map((entity) => `<span class="entity">${escapeHtml(entity.name)}${entity.type ? ` · ${escapeHtml(entity.type)}` : ""}${typeof entity.mentions === "number" ? ` ×${entity.mentions}` : ""}</span>`).join("")}</div>` : ""}
    ${summary?.chapters?.length ? `<h4 class="section-title">章节与段落摘要</h4><ol class="chapters">${summary.chapters.map((chapter) => `<li class="chapter"><strong>${renderSeekButton(playerId, chapter.startSec, formatTimestamp(chapter.startSec))} ${escapeHtml(chapter.title)}</strong><span>${escapeHtml(chapter.summary)}</span></li>`).join("")}</ol>` : ""}
    <h4 class="section-title">核心观点与证据</h4>
    ${report.insights.length ? report.insights.map((item) => renderInsight(item, report.player.pageUrl, playerId)).join("") : `<div class="empty">${summary ? "这条历史处理结果保留了总结、章节和音频核验，但当前数据库里没有保留核心观点记录。" : "没有达到发布阈值的核心观点。"}</div>`}
  </article>`;
}

function renderEpisodeDescription(description?: string): string {
  const parsed = parseEpisodeDescription(description);
  if (!parsed) return "";
  const sections = [
    parsed.intro ? renderDescriptionSection("节目简介", `<p>${escapeHtml(parsed.intro)}</p>`, true) : "",
    parsed.catalog.length ? renderDescriptionSection("目录", `<ol>${parsed.catalog.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`) : "",
    parsed.highlights.length ? renderDescriptionSection("本期要点", `<ol>${parsed.highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`, true) : "",
    parsed.links.length ? renderDescriptionSection("相关链接", `<ul>${parsed.links.map((link) => `<li><a class="description-link" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(link)}</a></li>`).join("")}</ul>`) : "",
    parsed.account ? renderDescriptionSection("公众号", `<p>${escapeHtml(parsed.account)}</p>`) : "",
    parsed.keywords.length ? renderDescriptionSection("关键词", `<div class="description-tags">${parsed.keywords.map((keyword) => `<span class="entity">${escapeHtml(keyword)}</span>`).join("")}</div>`, true) : "",
    parsed.remaining.length ? renderDescriptionSection("补充信息", `<ul>${parsed.remaining.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`, true) : ""
  ].filter(Boolean).join("");
  return `<section class="episode-description" aria-label="节目简介"><div class="description-grid">${sections}</div></section>`;
}

function renderDescriptionSection(title: string, body: string, wide = false): string {
  return `<section class="description-section${wide ? " wide" : ""}"><h4>${escapeHtml(title)}</h4>${body}</section>`;
}

function parseEpisodeDescription(description?: string): {
  intro?: string;
  catalog: string[];
  highlights: string[];
  links: string[];
  account?: string;
  keywords: string[];
  remaining: string[];
} | undefined {
  const text = normalizeDescriptionText(description);
  if (!text) return undefined;
  const introMatch = text.match(/(?:节目简介|简介)[：:]\s*([\s\S]*?)(?=\s*(?:目录|本期要点|要点|原文链接|公众号|关键词)[：:]|$)/);
  const catalogMatch = text.match(/目录[：:]\s*([\s\S]*?)(?=\s*(?:本期要点|要点|原文链接|公众号|关键词)[：:]|$)/);
  const highlightsMatch = text.match(/(?:本期要点|要点)[：:]\s*([\s\S]*?)(?=\s*(?:原文链接|公众号|关键词)[：:]|$)/);
  const links = [...text.matchAll(/https?:\/\/[^\s，。；、)）]+/g)].map((match) => trimTrailingPunctuation(match[0]));
  const account = text.match(/公众号[：:]\s*([^。；\n]+)/)?.[1]?.trim();
  const keywordBlock = text.match(/关键词[：:]\s*([\s\S]*?)$/)?.[1]?.trim();
  const intro = cleanDescriptionValue(introMatch?.[1]);
  const catalog = numberedItems(catalogMatch?.[1]);
  const highlights = numberedItems(highlightsMatch?.[1]);
  const keywords = keywordBlock
    ? keywordBlock.split(/[，,、；;\s]+/).map((item) => item.trim()).filter(Boolean).slice(0, 18)
    : [];
  const structured = Boolean(intro || catalog.length || highlights.length || links.length || account || keywords.length);
  if (!structured) {
    return {
      intro: undefined,
      catalog: [],
      highlights: [],
      links: [],
      account: undefined,
      keywords: [],
      remaining: paragraphItems(text)
    };
  }
  return {
    intro,
    catalog,
    highlights,
    links,
    account,
    keywords,
    remaining: []
  };
}

function normalizeDescriptionText(description?: string): string {
  return (description ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanDescriptionValue(value?: string): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function numberedItems(value?: string): string[] {
  const cleaned = cleanDescriptionValue(value);
  if (!cleaned) return [];
  const matches = [...cleaned.matchAll(/(?:^|\s)(?:\d+|[一二三四五六七八九十]+)[.、]\s*([\s\S]*?)(?=\s+(?:\d+|[一二三四五六七八九十]+)[.、]\s*|$)/g)]
    .map((match) => match[1]?.trim())
    .filter((item): item is string => Boolean(item));
  if (matches.length) return matches;
  return paragraphItems(cleaned);
}

function paragraphItems(value: string): string[] {
  return value.split(/\n+|[；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[，。；、.)）]+$/g, "");
}

function renderInsight(item: ReturnType<typeof summary>["episodeReports"][number]["insights"][number], _pageUrl: string, playerId: string): string {
  return `<article class="insight compact"><div class="meta">${renderSeekButton(playerId, item.timestampStartSec, `${formatTimestamp(item.timestampStartSec)}-${formatTimestamp(item.timestampEndSec)}`)}<span class="score">与处理目标匹配度 ${Math.round(item.relevanceScore * 100)}%</span>${item.feedbackAction ? `<span class="pill">${feedbackLabel(item.feedbackAction)}</span>` : ""}</div><h3>${escapeHtml(item.claim)}</h3>${item.implication ? `<p><strong>为什么重要：</strong>${escapeHtml(item.implication)}</p>` : ""}<p class="quote"><strong>证据：</strong>${escapeHtml(item.evidenceExcerpt)}</p><div class="actions"><form method="post" action="/api/feedback"><input type="hidden" name="insightId" value="${escapeHtml(item.id)}"/><input type="hidden" name="action" value="saved"/><button type="submit">保存</button></form><form method="post" action="/api/feedback"><input type="hidden" name="insightId" value="${escapeHtml(item.id)}"/><input type="hidden" name="action" value="irrelevant"/><button class="danger" type="submit">没用</button></form></div></article>`;
}

function renderWatches(watches: ReturnType<typeof summary>["watches"], context: SessionContext): string {
  const monitorWatches = watches.filter((watch) => !isImmediateTopic(watch.query));
  if (monitorWatches.length === 0) {
    return `<div class="empty">还没有监控。填写上面的监控目标后会自动创建。</div>`;
  }
  return monitorWatches.map((watch) => {
    const reports = watchEpisodeReports(context, watch.id);
    const progress = watchProgress(watch.id);
    const display = watchDisplayInfo(watch);
    return `<details class="watch" data-watch-id="${escapeHtml(watch.id)}">
      <summary><span class="watch-head"><strong>${escapeHtml(display.title)}</strong><span class="pill ${watch.enabled ? "" : "paused"}">${watch.enabled ? "监控中" : "已停止"}</span><span class="muted small">${escapeHtml(display.platform)}</span><span class="muted small">频率：${escapeHtml(frequencyLabel(watch.frequency))}</span><span class="muted small" data-watch-output-count>累计产出：${reports.length} 条</span></span></summary>
      <div class="watch-body">
        <p class="muted small">频道链接：${display.url ? `<a href="${escapeHtml(display.url)}" target="_blank" rel="noreferrer">${escapeHtml(display.url)}</a>` : escapeHtml(watch.query)}</p>
        <p class="small">类型：${escapeHtml(watch.type)} · 关键词：${escapeHtml(watch.includeTermText || "未设置")} · 初次回看窗口：${escapeHtml(watch.backfillDays)} 天</p>
        <div class="actions">${renderWatchAction(watch, watch.enabled ? "pause" : "resume", watch.enabled ? "停止" : "开始", watch.enabled ? "link-button" : "secondary")} ${renderWatchAction(watch, "delete", "删除", "danger")}</div>
        <div data-watch-progress>${renderWatchProgress(watch.id, progress, reports.length)}</div>
        ${reports.length ? "" : `<div class="empty" data-watch-empty="${escapeHtml(watch.id)}">这个监控任务还没有产出内容。</div>`}
        <p class="muted small">结果排序：按节目发布时间倒序；没有发布时间时再按处理完成时间兜底。</p>
        <div class="stack" data-watch-outputs>${reports.map((report) => renderWatchOutput(report)).join("")}</div>
      </div>
    </details>`;
  }).join("");
}

function watchDisplayInfo(watch: ReturnType<typeof summary>["watches"][number]): { title: string; platform: string; url?: string } {
  const url = extractFirstHttpUrl(watch.query) ?? (isHttpUrl(watch.query) ? watch.query : undefined);
  const source = url ? sourceForUrl(url) : undefined;
  const episodeSourceTitle = source?.id ? latestEpisodeSourceTitle(source.id) : undefined;
  const sourceTitle = source?.title && !looksLikeHostname(source.title) ? source.title : undefined;
  const watchName = watch.name && !looksLikeHostname(watch.name) ? watch.name : undefined;
  return {
    title: episodeSourceTitle ?? sourceTitle ?? watchName ?? urlHostLabel(url ?? watch.query),
    platform: platformLabel(source?.type ?? platformFromUrl(url ?? watch.query)),
    url
  };
}

function sourceForUrl(url: string): Source | undefined {
  const row = db.query(`
    select * from sources
    where url = ? or canonical_url = ?
    order by updated_at desc
    limit 1
  `).get(url, url) as Record<string, unknown> | null;
  return row ? sourceFromRow(row) : undefined;
}

function latestEpisodeSourceTitle(sourceId: string): string | undefined {
  const row = db.query(`
    select json_extract(metadata_json, '$.sourceTitle') as source_title
    from episodes
    where source_id = ?
      and json_extract(metadata_json, '$.sourceTitle') is not null
    order by updated_at desc
    limit 1
  `).get(sourceId) as Record<string, unknown> | null;
  return optionalString(row?.["source_title"]);
}

function looksLikeHostname(value: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.trim());
}

function urlHostLabel(input: string): string {
  try {
    return new URL(input).hostname.replace(/^www\./, "");
  } catch {
    return input;
  }
}

function platformFromUrl(input: string): string {
  try {
    return new URL(input).hostname;
  } catch {
    return "source";
  }
}

function platformLabel(type: string): string {
  if (type === "xiaoyuzhou" || /xiaoyuzhoufm\.com/i.test(type)) return "小宇宙";
  if (type === "rss") return "RSS";
  if (type === "listennotes") return "Listen Notes";
  if (type === "apple") return "Apple Podcasts";
  if (type === "spotify") return "Spotify";
  if (type === "youtube") return "YouTube";
  return type;
}

function renderWatchAction(watch: ReturnType<typeof summary>["watches"][number], action: string, label: string, className: string): string {
  return `<form method="post" action="/api/watch-action"><input type="hidden" name="watchId" value="${escapeHtml(watch.id)}"/><input type="hidden" name="action" value="${escapeHtml(action)}"/><button class="${escapeHtml(className)}" type="submit">${escapeHtml(label)}</button></form>`;
}

function renderWatchOutput(report: ReturnType<typeof summary>["episodeReports"][number]): string {
  const publishedAt = episodePublishedTimeLabel(report.episode.publishedAt);
  const processedAt = latestReportUpdatedAt(report);
  const timeMeta = [publishedAt ? `节目发布时间：${publishedAt}` : undefined, processedAt ? `处理时间：${processedAt}` : undefined]
    .filter((item): item is string => item !== undefined)
    .join(" · ");
  return `<details class="watch-output" data-output-id="${escapeHtml(report.episode.id)}"><summary><span>${escapeHtml(report.episode.title)}</span>${timeMeta ? `<span class="muted small"> · ${escapeHtml(timeMeta)}</span>` : ""}${report.summary?.oneLiner ? `<span class="muted small"> · ${escapeHtml(report.summary.oneLiner)}</span>` : ""}</summary>${renderEpisodeReport(report)}</details>`;
}

function renderWatchProgress(watchId: string, progress: WatchProgress | undefined, outputCount: number): string {
  if (!progress) {
    return `<div class="progress-box"><strong>回看处理进度</strong><p class="muted small">还没有执行记录。创建监控或下次调度后，这里会显示正在解析的平台、正在处理的播客和已产出的内容。</p></div>`;
  }
  const sourceText = progress.sources.length ? progress.sources.join("；") : "未记录";
  const currentTarget = progress.currentEpisodeTitle ?? progress.sources[0] ?? "还没有进入具体单集";
  const latestPollText = progress.latestPollCheckedAt
    ? `最近检查：${progress.latestPollCheckedAt} · 候选 ${progress.latestPollCandidateCount ?? 0} 集 · 新入库 ${progress.latestPollQueuedCount ?? 0} 集`
    : `最近检查：暂无记录`;
  const isRunning = progress.status === "running" || progress.episodes.some((episode) => episode.status === "running");
  const hasFailedEpisodes = !isRunning && progress.episodes.some((episode) => episode.status === "failed");
  const retryFailedAction = hasFailedEpisodes
    ? `<form method="post" action="/api/watch-action"><input type="hidden" name="watchId" value="${escapeHtml(watchId)}"/><input type="hidden" name="action" value="retry-failed"/><button class="secondary" type="submit">重试失败项</button></form>`
    : "";
  const runningHint = isRunning
    ? `<div class="hint">当前单集正在处理中。长音频转写可能需要较长时间；如果瞬时网络或服务错误导致卡住，系统会按阶段和音频时长自动重试。</div>`
    : "";
  const failureHint = hasFailedEpisodes
    ? `<p class="muted small">失败处理：系统会按阶段和音频时长判断是否卡死；瞬时网络或服务错误会自动重试，达到自动重试上限后可点击“重新处理本集”或“重试失败项”手动重新发起。</p>`
    : "";
  const noOutputHint = outputCount === 0
    && !isRunning
    ? `<div class="hint">这次回看已经执行，但没有产出内容。通常表示系统还没有从“${escapeHtml(sourceText)}”解析到具体可处理的单集；请优先提供频道页、RSS 或单集链接，或者配置 Listen Notes 搜索能力。</div>`
    : "";
  return `<div class="progress-box">
    <div class="actions"><strong>回看处理进度</strong><span class="pill ${progress.status === "failed" ? "paused" : ""}">${escapeHtml(progress.statusLabel)}</span>${retryFailedAction}</div>
    <div class="progress-grid">
      <div class="progress-item"><strong>解析目标</strong><span class="muted small">${escapeHtml(sourceText)}</span></div>
      <div class="progress-item"><strong>当前处理</strong><span class="muted small">${escapeHtml(currentTarget)}</span></div>
      <div class="progress-item"><strong>最近检查</strong><span class="muted small">${escapeHtml(latestPollText)} · 累计产出 ${escapeHtml(outputCount)} 条</span></div>
    </div>
    ${renderEpisodeProgress(watchId, progress.episodes)}
    <p class="muted small">状态：${escapeHtml(progress.statusLabel)}${progress.currentStage ? ` · 阶段：${escapeHtml(stageLabel(progress.currentStage))}` : ""}${progress.updatedAt ? ` · 更新时间：${escapeHtml(progress.updatedAt)}` : ""}</p>
    ${runningHint}
    ${failureHint}
    ${progress.error || progress.currentStageError ? `<div class="hint">最近错误：${escapeHtml(progress.error ?? progress.currentStageError)}</div>` : noOutputHint}
  </div>`;
}

function renderEpisodeProgress(watchId: string, episodes: WatchProgress["episodes"]): string {
  if (episodes.length === 0) {
    return `<div class="hint">任务已创建，正在解析目标站点和频道。解析到单集后，这里会逐条显示每集的转写、分析和报告生成进度。</div>`;
  }
  return `<div>
    <strong>单集处理进度</strong>
    <ol class="episode-progress">${episodes.map((episode) => {
      const title = episode.title ?? episode.id;
      const label = `${stageLabel(episode.stage)}${episode.status === "running" ? "中" : ""}`;
      const error = episode.error ? `<div class="hint">错误：${escapeHtml(episode.error)}</div>` : "";
      const timeMeta = [
        episode.publishedAt ? `节目发布时间：${episodePublishedTimeLabel(episode.publishedAt)}` : undefined,
        episode.updatedAt ? `系统更新时间：${episode.updatedAt}` : undefined
      ].filter((item): item is string => item !== undefined).join(" · ");
      const retryAction = episode.status === "failed"
        ? `<form method="post" action="/api/watch-action"><input type="hidden" name="watchId" value="${escapeHtml(watchId)}"/><input type="hidden" name="action" value="retry-episode"/><input type="hidden" name="episodeId" value="${escapeHtml(episode.id)}"/><button class="secondary" type="submit">重新处理本集</button></form>`
        : "";
      return `<li>
        <div><strong>${escapeHtml(title)}</strong><span class="muted small">${timeMeta ? escapeHtml(timeMeta) : "等待处理"}</span>${error}</div>
        <div class="actions"><span class="stage-chip ${escapeHtml(episode.status)}">${escapeHtml(label)}</span>${retryAction}</div>
      </li>`;
    }).join("")}</ol>
  </div>`;
}

function feedbackLabel(action: string): string {
  if (action === "saved") return "已保存";
  if (action === "irrelevant") return "已标记没用";
  if (action === "wrong") return "已标记错误";
  if (action === "archived") return "已归档";
  return action;
}

function frequencyLabel(frequency: Watch["frequency"]): string {
  if (frequency === "realtime") return "实时（M1 本地预览会按每天运行）";
  if (frequency === "weekly") return "每周";
  return "每天";
}

function runStatusLabel(status: string): string {
  if (status === "completed") return "回看完成";
  if (status === "failed") return "回看失败";
  if (status === "running") return "正在回看";
  return status;
}

function recommendationLabel(recommendation: string): string {
  if (recommendation === "listen_full") return "建议完整听";
  if (recommendation === "listen_segments") return "建议跳听重点片段";
  if (recommendation === "skip") return "可以跳过";
  return recommendation;
}

function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  return `时长 ${formatTimestamp(seconds)}`;
}

function episodePublishedTimeLabel(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = parseStoredDate(value);
  if (!parsed) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  }).format(parsed);
}

function latestReportUpdatedAt(report: ReturnType<typeof summary>["episodeReports"][number]): string | undefined {
  const candidates = [
    report.summary?.createdAt,
    ...report.insights.map((insight) => insight.createdAt)
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const latest = candidates
    .map((value) => ({ value, time: parseStoredDate(value)?.getTime() ?? NaN }))
    .filter((item) => Number.isFinite(item.time))
    .sort((left, right) => right.time - left.time)[0]?.value;
  return episodePublishedTimeLabel(latest);
}

function parseStoredDate(value: string): Date | undefined {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function renderSeekButton(playerId: string, seconds: number, label: string): string {
  return `<button class="seek" type="button" data-player="${escapeHtml(playerId)}" data-seek="${escapeHtml(Math.max(0, Math.floor(seconds)))}" title="跳到该音频片段播放">${escapeHtml(label)}</button>`;
}

function safeDomId(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseJsonArray<T = string>(value: unknown): T[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T extends Record<string, unknown>>(value: unknown): T | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : undefined;
  } catch {
    return undefined;
  }
}

function episodeFromRow(row: Record<string, unknown>): Episode {
  return {
    id: String(row["id"]),
    sourceId: optionalString(row["source_id"]),
    guid: optionalString(row["guid"]),
    title: String(row["title"]),
    description: optionalString(row["description"]),
    publishedAt: optionalString(row["published_at"]),
    durationSec: optionalNumber(row["duration_sec"]),
    audioUrl: optionalString(row["audio_url"]),
    pageUrl: String(row["page_url"]),
    language: optionalString(row["language"]),
    checksum: optionalString(row["checksum"]),
    metadata: parseJsonObject(row["metadata_json"])
  };
}

function sourceFromRow(row: Record<string, unknown>): Source {
  return {
    id: String(row["id"]),
    type: String(row["type"]) as Source["type"],
    url: String(row["url"]),
    canonicalUrl: optionalString(row["canonical_url"]),
    externalId: optionalString(row["external_id"]),
    title: optionalString(row["title"]),
    author: optionalString(row["author"]),
    language: optionalString(row["language"]),
    imageUrl: optionalString(row["image_url"]),
    metadata: parseJsonObject(row["metadata_json"])
  };
}

function summaryFromRow(row: Record<string, unknown>): EpisodeSummary {
  return {
    oneLiner: String(row["one_liner"]),
    overview: String(row["overview"]),
    chapters: parseJsonArray(row["chapters_json"]),
    worthListening: parseJsonObject(row["worth_listening_json"]) as EpisodeSummary["worthListening"],
    entities: parseJsonArray(row["entities_json"])
  };
}

function transcriptFromRow(row: Record<string, unknown>): StoredTranscriptView {
  return {
    id: String(row["id"]),
    episodeId: String(row["episode_id"]),
    provider: String(row["provider"]),
    model: String(row["model"]),
    language: optionalString(row["language"]),
    segments: parseJsonArray(row["segments_json"]),
    confidence: optionalNumber(row["confidence"]),
    durationSec: optionalNumber(row["duration_sec"])
  };
}

function renderNotFound(pathname: string): string {
  return `<!doctype html><h1>Not found</h1><p>${escapeHtml(pathname)}</p><p><a href="/">Back home</a></p>`;
}

function renderLarkCallbackSuccess(connectionId: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>飞书授权成功</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f7fb;color:#172033;margin:0;display:grid;place-items:center;min-height:100vh}.card{max-width:560px;background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:24px;box-shadow:0 12px 28px rgba(15,23,42,.08)}code{background:#eef2ff;border-radius:6px;padding:1px 5px}</style></head><body><main class="card"><h1>飞书授权成功</h1><p>你已经完成 Podcast Note 与飞书账号的绑定，可以回到飞书集成页面继续配置推送。</p><p>connection_id: <code>${escapeHtml(connectionId)}</code></p><p><a href="/integrations/feishu">返回飞书集成</a></p></main></body></html>`;
}

async function qrImageUrl(value: string): Promise<string> {
  const svg = await QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: {
      dark: "#111827",
      light: "#ffffff"
    }
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function larkAppIdOrFail(): string {
  const appId = larkConfiguredAppId();
  if (!appId) throw new Error("缺少 LARK_APP_ID 或 FEISHU_APP_ID，无法打开飞书机器人接入入口。");
  return appId;
}

function larkConfiguredAppId(): string | undefined {
  return process.env["LARK_APP_ID"] ?? process.env["FEISHU_APP_ID"];
}

function larkConfiguredAppSecret(): string | undefined {
  return process.env["LARK_APP_SECRET"] ?? process.env["FEISHU_APP_SECRET"];
}

function larkAppSecretOrFail(): string {
  const appSecret = larkConfiguredAppSecret();
  if (!appSecret) throw new Error("缺少 LARK_APP_SECRET 或 FEISHU_APP_SECRET，无法向飞书发送机器人消息。");
  return appSecret;
}

function larkWebsocketEnabled(): boolean {
  return booleanOption(
    undefined,
    process.env["LARK_WEBSOCKET_ENABLED"] ?? process.env["FEISHU_WEBSOCKET_ENABLED"],
    true
  );
}

function larkBotStatus() {
  return latestLarkBotIntegrationStatus({
    repositories: repos,
    workspaceId: context.workspace.id,
    appId: larkConfiguredAppId(),
    appSecretConfigured: Boolean(larkConfiguredAppSecret()),
    websocketEnabled: larkWebsocketEnabled()
  });
}

function readLarkEventRuntimeStatus(): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(".runtime/lark-events-status.json", "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function larkOAuthScopes(): string[] {
  const raw = process.env["LARK_OAUTH_SCOPES"] ?? process.env["FEISHU_OAUTH_SCOPES"] ?? "";
  return raw.split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope && !scope.startsWith("domain:"));
}

function larkRedirectUri(request: Request): string {
  return process.env["LARK_OAUTH_REDIRECT_URI"] ?? process.env["FEISHU_OAUTH_REDIRECT_URI"] ?? `${new URL(request.url).origin}/api/lark/oauth/callback`;
}

function assertValidLarkRedirectUri(request: Request): void {
  const check = larkRedirectUriCheck(request);
  if (!check.ok) throw new Error(check.message);
}

function larkRedirectUriCheck(request: Request): { ok: true } | { ok: false; message: string } {
  const redirectUri = larkRedirectUri(request);
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return { ok: false, message: `飞书 OAuth 回调地址不是合法 URL：${redirectUri}` };
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (parsed.protocol !== "https:" || localHosts.has(parsed.hostname)) {
    return {
      ok: false,
      message: `当前回调地址 ${redirectUri} 不能用于飞书手机扫码。飞书会校验 redirect_uri，且手机无法访问你电脑上的 localhost/127.0.0.1。`
    };
  }
  return { ok: true };
}

function devLarkTokenResult(code: string) {
  const now = Date.now();
  return {
    accessToken: `dev_access_${code}`,
    refreshToken: `dev_refresh_${code}`,
    accessTokenExpiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString()
  };
}

function devLarkUserInfo() {
  return {
    tenantKey: process.env["LARK_DEV_TENANT_KEY"] ?? process.env["FEISHU_DEV_TENANT_KEY"] ?? "tenant_local_preview",
    openId: process.env["LARK_DEV_OPEN_ID"] ?? process.env["FEISHU_DEV_OPEN_ID"] ?? "ou_local_preview",
    unionId: process.env["LARK_DEV_UNION_ID"] ?? process.env["FEISHU_DEV_UNION_ID"],
    name: process.env["LARK_DEV_USER_NAME"] ?? process.env["FEISHU_DEV_USER_NAME"] ?? "Local Preview Lark User"
  };
}

function renderError(error: unknown): string {
  return `<!doctype html><h1>Podcast Note error</h1><pre>${escapeHtml(error instanceof Error ? error.stack ?? error.message : String(error))}</pre><p><a href="/">Back home</a></p>`;
}

function html(body: string, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...extraHeaders
    }
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location: encodeURI(location) } });
}

function flashRedirect(location: string, message: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      "set-cookie": `${flashCookieName()}=${encodeURIComponent(message)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=60`
    }
  });
}

function noticeForRequest(request: Request, url: URL): { message: string | null; headers?: HeadersInit } {
  const cookieNotice = cookieValue(request.headers.get("cookie"), flashCookieName());
  const queryNotice = url.searchParams.get("notice");
  const message = decodeMaybeEncoded(cookieNotice ?? queryNotice);
  if (!cookieNotice) return { message };
  return {
    message,
    headers: {
      "set-cookie": `${flashCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    }
  };
}

function flashCookieName(): string {
  return "podcast_note_notice";
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return parts.join("=");
  }
  return undefined;
}

function decodeMaybeEncoded(input: string | null | undefined): string | null {
  if (!input) return null;
  let output = input;
  for (let i = 0; i < 2; i += 1) {
    if (!/%[0-9a-f]{2}/i.test(output)) break;
    try {
      const decoded = decodeURIComponent(output);
      if (decoded === output) break;
      output = decoded;
    } catch {
      break;
    }
  }
  return output;
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    parsed[arg.slice(2)] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
  }
  return parsed;
}

function booleanOption(optionValue: string | undefined, envValue: string | undefined, fallback: boolean): boolean {
  const value = optionValue ?? envValue;
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function numberOption(optionValue: string | undefined, envValue: string | undefined, fallback: number): number {
  const value = optionValue ?? envValue;
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringField(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function numberField(form: FormData, name: string, fallback: number): number {
  const value = Number(form.get(name));
  return Number.isFinite(value) ? value : fallback;
}

function frequencyField(form: FormData, name: string): Watch["frequency"] {
  const value = stringField(form, name);
  if (value === "weekly" || value === "realtime") return value;
  return "daily";
}

async function formDataOrEmpty(request: Request): Promise<FormData> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    return request.formData();
  }
  return new FormData();
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
