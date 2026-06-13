import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { handleLarkBotCommand } from "./lark-command-router.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-lark-command-confirm-"));
const dbPath = join(dir, "check.sqlite");

try {
  const repositories = createRepositories(openPodcastNoteDb(dbPath));
  const user = repositories.upsertUser({ id: "user_lark_command_confirm", email: "lark-command-confirm@example.invalid", name: "Lark Command Confirm" });
  const workspace = repositories.ensurePersonalWorkspaceForUser(user.id);
  const sentMessages: string[] = [];
  const client = {
    sendTextMessage: async (input: { chatId: string; text: string }) => {
      sentMessages.push(input.text);
      return { messageId: `om_${sentMessages.length}` };
    }
  };

  const pendingResult = await handleLarkBotCommand({
    repositories,
    workspaceId: workspace.id,
    appId: "cli_lark_command_confirm",
    tenantKey: "tenant_confirm",
    client,
    event: {
      chat_id: "oc_confirm",
      chat_type: "p2p",
      sender_id: "ou_confirm",
      content: "监控硅谷101",
      message_type: "text"
    },
    now: "2026-06-13T09:00:00.000Z"
  });
  if (!pendingResult.handled || !pendingResult.reply?.includes("还没有找到可以监控的真实频道链接")) {
    throw new Error(`Expected unresolved natural text to avoid creating a watch, got result=${JSON.stringify(pendingResult)}.`);
  }
  const unresolvedWatches = repositories.listWatchesForWorkspace(workspace.id).filter((watch) => watch.query === "硅谷101");
  if (unresolvedWatches.length !== 0) {
    throw new Error(`Unresolved natural text must not create a text-query watch, got ${JSON.stringify(unresolvedWatches)}.`);
  }

  repositories.upsertSource({
    id: "src_confirm_sg101",
    type: "xiaoyuzhou",
    url: "https://www.xiaoyuzhoufm.com/podcast/sg101",
    title: "硅谷101"
  });
  const resolvedPendingResult = await handleLarkBotCommand({
    repositories,
    workspaceId: workspace.id,
    appId: "cli_lark_command_confirm",
    tenantKey: "tenant_confirm",
    client,
    event: {
      chat_id: "oc_confirm",
      chat_type: "p2p",
      sender_id: "ou_confirm",
      content: "监控硅谷101",
      message_type: "text"
    },
    now: "2026-06-13T09:00:30.000Z"
  });
  const pending = repositories.getLatestPendingLarkIntent({
    workspaceId: workspace.id,
    chatId: "oc_confirm",
    senderOpenId: "ou_confirm",
    now: "2026-06-13T09:01:00.000Z"
  });
  if (!resolvedPendingResult.handled || !pending || pending.intentType !== "confirm_watch_source") {
    throw new Error(`Expected resolved natural monitor text to create pending source intent, got result=${JSON.stringify(resolvedPendingResult)} pending=${JSON.stringify(pending)}.`);
  }
  if (!sentMessages.at(-1)?.includes("请确认") || !sentMessages.at(-1)?.includes("硅谷101") || !sentMessages.at(-1)?.includes("xiaoyuzhoufm.com/podcast/sg101")) {
    throw new Error(`Expected confirmation reply, got ${sentMessages.at(-1)}.`);
  }

  const confirmResult = await handleLarkBotCommand({
    repositories,
    workspaceId: workspace.id,
    appId: "cli_lark_command_confirm",
    tenantKey: "tenant_confirm",
    client,
    event: {
      chat_id: "oc_confirm",
      chat_type: "p2p",
      sender_id: "ou_confirm",
      content: "确认",
      message_type: "text"
    },
    now: "2026-06-13T09:02:00.000Z"
  });
  const watches = repositories.listWatchesForWorkspace(workspace.id).filter((watch) => watch.name === "硅谷101" && watch.query === "https://www.xiaoyuzhoufm.com/podcast/sg101");
  const completed = repositories.getLatestPendingLarkIntent({
    workspaceId: workspace.id,
    chatId: "oc_confirm",
    senderOpenId: "ou_confirm",
    now: "2026-06-13T09:03:00.000Z"
  });
  if (!confirmResult.handled || watches.length !== 1 || completed) {
    throw new Error(`Expected confirmation to create watch and complete pending intent, got result=${JSON.stringify(confirmResult)} watches=${JSON.stringify(watches)} pending=${JSON.stringify(completed)}.`);
  }
  if (!sentMessages.at(-1)?.includes("已创建监控") || !sentMessages.at(-1)?.includes("硅谷101")) {
    throw new Error(`Expected confirmed creation reply, got ${sentMessages.at(-1)}.`);
  }

  await handleLarkBotCommand({
    repositories,
    workspaceId: workspace.id,
    appId: "cli_lark_command_confirm",
    tenantKey: "tenant_confirm",
    client,
    event: {
      chat_id: "oc_confirm_cancel",
      chat_type: "p2p",
      sender_id: "ou_confirm",
      content: "监控 AI炼金术",
      message_type: "text"
    },
    podcastSearch: async () => [{
      type: "xiaoyuzhou",
      url: "https://www.xiaoyuzhoufm.com/podcast/ai-alchemy",
      title: "AI炼金术"
    }],
    now: "2026-06-13T09:04:00.000Z"
  });
  const cancelResult = await handleLarkBotCommand({
    repositories,
    workspaceId: workspace.id,
    appId: "cli_lark_command_confirm",
    tenantKey: "tenant_confirm",
    client,
    event: {
      chat_id: "oc_confirm_cancel",
      chat_type: "p2p",
      sender_id: "ou_confirm",
      content: "取消",
      message_type: "text"
    },
    now: "2026-06-13T09:05:00.000Z"
  });
  const cancelledPending = repositories.getLatestPendingLarkIntent({
    workspaceId: workspace.id,
    chatId: "oc_confirm_cancel",
    senderOpenId: "ou_confirm",
    now: "2026-06-13T09:06:00.000Z"
  });
  if (!cancelResult.handled || cancelledPending) {
    throw new Error(`Expected cancel to clear pending intent, got result=${JSON.stringify(cancelResult)} pending=${JSON.stringify(cancelledPending)}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    watchCount: watches.length,
    replies: sentMessages.map((message) => message.split("\n")[0])
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
