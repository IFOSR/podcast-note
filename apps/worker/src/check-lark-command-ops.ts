import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stableId } from "../../../packages/core/src/format.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { handleLarkBotCommand } from "./lark-command-router.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-lark-command-ops-"));
const dbPath = join(dir, "check.sqlite");

try {
  const repositories = createRepositories(openPodcastNoteDb(dbPath));
  const user = repositories.upsertUser({ id: "user_lark_command_ops", email: "lark-command-ops@example.invalid", name: "Lark Command Ops" });
  const workspace = repositories.ensurePersonalWorkspaceForUser(user.id);
  const watch = repositories.createWatchForWorkspace(workspace.id, {
    id: "watch_ops_sg101",
    name: "硅谷101",
    type: "topic",
    query: "https://www.xiaoyuzhoufm.com/podcast/sg101",
    outputLanguage: "zh-CN",
    includeTerms: [],
    excludeTerms: [],
    expandedTerms: ["硅谷101"],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 3,
    enabled: true
  });
  repositories.upsertEpisode({
    id: "ep_ops_failed",
    title: "Ops failed episode",
    publishedAt: "2026-06-10T08:00:00.000Z",
    audioUrl: "https://media.example.invalid/ops-failed.mp3",
    pageUrl: "https://www.xiaoyuzhoufm.com/episode/ops-failed"
  });
  const failedJob = repositories.enqueueEpisodeProcessingJob({
    workspaceId: workspace.id,
    watchId: watch.id,
    episodeId: "ep_ops_failed",
    sourceUrl: "https://www.xiaoyuzhoufm.com/episode/ops-failed"
  });
  repositories.failEpisodeProcessingJob(failedJob.id, "transient timeout");

  const sentMessages: string[] = [];
  const client = {
    sendTextMessage: async (input: { chatId: string; text: string }) => {
      sentMessages.push(input.text);
      return { messageId: `om_${sentMessages.length}` };
    }
  };
  async function send(content: string) {
    return handleLarkBotCommand({
      repositories,
      workspaceId: workspace.id,
      appId: "cli_lark_command_ops",
      tenantKey: "tenant_ops",
      client,
      event: {
        chat_id: "oc_ops",
        chat_type: "p2p",
        sender_id: "ou_ops",
        content,
        message_type: "text"
      },
      now: "2026-06-13T11:00:00.000Z"
    });
  }

  const statusResult = await send("状态");
  if (!statusResult.handled || !sentMessages.at(-1)?.includes("监控任务") || !sentMessages.at(-1)?.includes("失败 1")) {
    throw new Error(`Expected status reply to summarize watches and failures, got ${sentMessages.at(-1)}.`);
  }

  const retryResult = await send("重试失败");
  const retriedJob = repositories.getEpisodeProcessingJob(failedJob.id);
  if (!retryResult.handled || retriedJob?.status !== "queued" || !sentMessages.at(-1)?.includes("已重新发起 1 个失败任务")) {
    throw new Error(`Expected retry command to requeue failed job, got result=${JSON.stringify(retryResult)} job=${JSON.stringify(retriedJob)} reply=${sentMessages.at(-1)}.`);
  }

  const pauseResult = await send("暂停 硅谷101");
  const paused = repositories.getWatchForWorkspace(workspace.id, watch.id);
  if (!pauseResult.handled || paused?.enabled !== false || !sentMessages.at(-1)?.includes("已暂停监控")) {
    throw new Error(`Expected pause command to disable watch, got ${JSON.stringify(paused)} reply=${sentMessages.at(-1)}.`);
  }

  const resumeResult = await send("恢复 硅谷101");
  const resumed = repositories.getWatchForWorkspace(workspace.id, watch.id);
  if (!resumeResult.handled || resumed?.enabled !== true || !sentMessages.at(-1)?.includes("已恢复监控")) {
    throw new Error(`Expected resume command to enable watch, got ${JSON.stringify(resumed)} reply=${sentMessages.at(-1)}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    watchId: watch.id,
    failedJobId: stableId("epjob", `${workspace.id}:${watch.id}:ep_ops_failed`),
    replies: sentMessages.map((message) => message.split("\n")[0])
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
