import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { handleLarkBotCommand } from "./lark-command-router.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-lark-natural-watch-"));
const dbPath = join(dir, "check.sqlite");

try {
  const repositories = createRepositories(openPodcastNoteDb(dbPath));
  const user = repositories.upsertUser({ id: "user_lark_natural_watch", email: "lark-natural-watch@example.invalid", name: "Lark Natural Watch" });
  const workspace = repositories.ensurePersonalWorkspaceForUser(user.id);
  repositories.upsertSource({
    id: "src_sg101",
    type: "xiaoyuzhou",
    url: "https://www.xiaoyuzhoufm.com/podcast/sg101",
    title: "硅谷101"
  });
  repositories.upsertEpisode({
    id: "ep_sg101_latest",
    sourceId: "src_sg101",
    title: "E238｜AI First",
    publishedAt: "2026-06-01T08:00:00.000Z",
    audioUrl: "https://media.example.invalid/sg101.mp3",
    pageUrl: "https://www.xiaoyuzhoufm.com/episode/sg101",
    metadata: { sourceTitle: "硅谷101" }
  });
  const sentMessages: string[] = [];
  const client = {
    sendTextMessage: async (input: { chatId: string; text: string }) => {
      sentMessages.push(input.text);
      return { messageId: `om_${sentMessages.length}` };
    }
  };

  await handleLarkBotCommand({
    repositories,
    workspaceId: workspace.id,
    appId: "cli_lark_natural_watch",
    tenantKey: "tenant_natural",
    client,
    event: {
      chat_id: "oc_natural",
      chat_type: "p2p",
      sender_id: "ou_natural",
      content: "帮我监控硅谷101，实时检查",
      message_type: "text"
    },
    now: "2026-06-13T10:00:00.000Z"
  });
  await handleLarkBotCommand({
    repositories,
    workspaceId: workspace.id,
    appId: "cli_lark_natural_watch",
    tenantKey: "tenant_natural",
    client,
    event: {
      chat_id: "oc_natural",
      chat_type: "p2p",
      sender_id: "ou_natural",
      content: "确认",
      message_type: "text"
    },
    now: "2026-06-13T10:01:00.000Z"
  });

  const watches = repositories.listWatchesForWorkspace(workspace.id).filter((watch) => watch.name === "硅谷101");
  if (watches.length !== 1 || watches[0]?.query !== "https://www.xiaoyuzhoufm.com/podcast/sg101" || watches[0]?.frequency !== "realtime") {
    throw new Error(`Expected natural watch to resolve existing source URL and realtime frequency, got ${JSON.stringify(watches)}.`);
  }

  await handleLarkBotCommand({
    repositories,
    workspaceId: workspace.id,
    appId: "cli_lark_natural_watch",
    tenantKey: "tenant_natural",
    client,
    event: {
      chat_id: "oc_natural",
      chat_type: "p2p",
      sender_id: "ou_natural",
      content: "监控硅谷101",
      message_type: "text"
    },
    now: "2026-06-13T10:02:00.000Z"
  });
  await handleLarkBotCommand({
    repositories,
    workspaceId: workspace.id,
    appId: "cli_lark_natural_watch",
    tenantKey: "tenant_natural",
    client,
    event: {
      chat_id: "oc_natural",
      chat_type: "p2p",
      sender_id: "ou_natural",
      content: "确认",
      message_type: "text"
    },
    now: "2026-06-13T10:03:00.000Z"
  });
  const afterDuplicate = repositories.listWatchesForWorkspace(workspace.id).filter((watch) => watch.name === "硅谷101");
  if (afterDuplicate.length !== 1) {
    throw new Error(`Expected duplicate natural watch to reuse existing watch, got ${JSON.stringify(afterDuplicate)}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    watch: watches[0],
    replies: sentMessages.map((message) => message.split("\n")[0])
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
