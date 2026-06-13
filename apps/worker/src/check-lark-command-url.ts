import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SourceConnector } from "../../../packages/connectors/src/index.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { handleLarkBotCommand } from "./lark-command-router.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-lark-command-url-"));
const dbPath = join(dir, "check.sqlite");

try {
  const repositories = createRepositories(openPodcastNoteDb(dbPath));
  const user = repositories.upsertUser({ id: "user_lark_command_url", email: "lark-command-url@example.invalid", name: "Lark Command URL" });
  const workspace = repositories.ensurePersonalWorkspaceForUser(user.id);
  const sentMessages: Array<{ chatId: string; text: string }> = [];
  const podcastUrl = "https://www.xiaoyuzhoufm.com/podcast/url-command";
  const episodeUrl = "https://www.xiaoyuzhoufm.com/episode/url-command-episode";
  const connector: SourceConnector = {
    type: "xiaoyuzhou",
    canHandle: () => true,
    async resolveSource() {
      return { type: "xiaoyuzhou", url: podcastUrl, title: "URL Command Podcast" };
    },
    async listEpisodes() {
      return [];
    },
    async resolveEpisode() {
      return {
        guid: "url-command-episode",
        title: "URL command episode",
        description: "A fixture episode created from a Lark message.",
        publishedAt: "2026-06-13T08:00:00.000Z",
        durationSec: 1800,
        audioUrl: "https://media.example.invalid/url-command-episode.mp3",
        pageUrl: episodeUrl,
        language: "zh-CN"
      };
    }
  };

  const episodeResult = await handleLarkBotCommand({
    repositories,
    workspaceId: workspace.id,
    appId: "cli_lark_command_url",
    tenantKey: "tenant_command",
    client: {
      sendTextMessage: async (input) => {
        sentMessages.push(input);
        return { messageId: `om_${sentMessages.length}` };
      }
    },
    event: {
      chat_id: "oc_command_url",
      chat_type: "p2p",
      sender_id: "ou_command_user",
      content: `帮我解析这期播客 ${episodeUrl}`,
      message_type: "text"
    },
    connectorForInput: () => connector,
    now: "2026-06-13T08:30:00.000Z"
  });

  const queued = repositories.listQueuedEpisodeProcessingJobs({ workspaceId: workspace.id, limit: 10 });
  if (!episodeResult.handled || queued.length !== 1 || queued[0]?.sourceUrl !== episodeUrl) {
    throw new Error(`Expected episode URL command to enqueue one processing job, got result=${JSON.stringify(episodeResult)} queued=${JSON.stringify(queued)}.`);
  }
  if (!sentMessages[0]?.text.includes("已开始处理单集") || !sentMessages[0]?.text.includes("URL command episode")) {
    throw new Error(`Expected episode processing reply, got ${JSON.stringify(sentMessages[0])}.`);
  }

  const watchResult = await handleLarkBotCommand({
    repositories,
    workspaceId: workspace.id,
    appId: "cli_lark_command_url",
    tenantKey: "tenant_command",
    client: {
      sendTextMessage: async (input) => {
        sentMessages.push(input);
        return { messageId: `om_${sentMessages.length}` };
      }
    },
    event: {
      chat_id: "oc_command_url",
      chat_type: "p2p",
      sender_id: "ou_command_user",
      content: `监控这个频道 ${podcastUrl}`,
      message_type: "text"
    },
    connectorForInput: () => connector,
    now: "2026-06-13T08:31:00.000Z"
  });
  const watches = repositories.listWatchesForWorkspace(workspace.id).filter((watch) => watch.query === podcastUrl);
  if (!watchResult.handled || watches.length !== 1 || watches[0]?.name !== "URL Command Podcast") {
    throw new Error(`Expected podcast URL command to create one watch, got result=${JSON.stringify(watchResult)} watches=${JSON.stringify(watches)}.`);
  }
  if (!sentMessages.at(-1)?.text.includes("已创建监控") || !sentMessages.at(-1)?.text.includes("URL Command Podcast")) {
    throw new Error(`Expected watch creation reply, got ${JSON.stringify(sentMessages.at(-1))}.`);
  }

  const installation = repositories.getLatestLarkBotInstallationForWorkspace(workspace.id, "cli_lark_command_url");
  if (!installation || installation.chatId !== "oc_command_url") {
    throw new Error(`Expected command to keep personal Lark installation bound, got ${JSON.stringify(installation)}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    queuedJobs: queued.length,
    watches: watches.length,
    replies: sentMessages.map((message) => message.text.split("\n")[0])
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
