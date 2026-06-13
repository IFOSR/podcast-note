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
  const searchCalls: Array<{ query: string; platform?: string }> = [];
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
    podcastSearch: async (input) => {
      searchCalls.push(input);
      if (input.platform !== "xiaoyuzhou" || input.query !== "商业访谈录") return [];
      return [{
        type: "xiaoyuzhou",
        url: "https://www.xiaoyuzhoufm.com/podcast/business-interview",
        title: "商业访谈录",
        author: "商业访谈录"
      }];
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

  await handleLarkBotCommand({
    repositories,
    workspaceId: workspace.id,
    appId: "cli_lark_natural_watch",
    tenantKey: "tenant_natural",
    client,
    event: {
      chat_id: "oc_search",
      chat_type: "p2p",
      sender_id: "ou_natural",
      content: "小宇宙里面有一个商业访谈录，我看这个节目做的也都不错，你帮我把这个监控起来吧",
      message_type: "text"
    },
    podcastSearch: async (input) => {
      searchCalls.push(input);
      if (input.platform !== "xiaoyuzhou" || input.query !== "商业访谈录") return [];
      return [{
        type: "xiaoyuzhou",
        url: "https://www.xiaoyuzhoufm.com/podcast/business-interview",
        title: "商业访谈录",
        author: "商业访谈录"
      }];
    },
    now: "2026-06-13T10:04:00.000Z"
  });
  await handleLarkBotCommand({
    repositories,
    workspaceId: workspace.id,
    appId: "cli_lark_natural_watch",
    tenantKey: "tenant_natural",
    client,
    event: {
      chat_id: "oc_search",
      chat_type: "p2p",
      sender_id: "ou_natural",
      content: "确认",
      message_type: "text"
    },
    now: "2026-06-13T10:05:00.000Z"
  });
  const businessWatch = repositories.listWatchesForWorkspace(workspace.id).find((watch) => watch.name === "商业访谈录");
  if (!searchCalls.some((call) => call.platform === "xiaoyuzhou" && call.query === "商业访谈录")) {
    throw new Error(`Expected natural sentence to search Xiaoyuzhou by extracted podcast name, got ${JSON.stringify(searchCalls)}.`);
  }
  if (!businessWatch || businessWatch.query !== "https://www.xiaoyuzhoufm.com/podcast/business-interview") {
    throw new Error(`Expected natural sentence to create watch from resolved podcast URL, got ${JSON.stringify(businessWatch)}.`);
  }
  const badWatch = repositories.listWatchesForWorkspace(workspace.id).find((watch) => watch.query.includes("小宇宙里面有一个商业访谈录"));
  if (badWatch) {
    throw new Error(`Natural sentence must not be stored as the watch query, got ${JSON.stringify(badWatch)}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    watch: watches[0],
    replies: sentMessages.map((message) => message.split("\n")[0])
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
