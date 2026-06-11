import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import {
  larkBotAddedWelcomeText,
  larkBotMessageReplyText,
  recordLarkPersonalChatEvent,
  recordLarkBotAddedEvent
} from "./lark-bot-events.ts";

const dbPath = join(await mkdtemp(join(tmpdir(), "podcast-note-lark-events-")), "test.sqlite");
const repositories = createRepositories(openPodcastNoteDb(dbPath));
const user = repositories.upsertUser({
  id: "user_lark_events_check",
  email: "lark-events-check@example.invalid",
  name: "Lark Events Check"
});
const workspace = repositories.ensurePersonalWorkspaceForUser(user.id);

const installation = recordLarkBotAddedEvent({
  repositories,
  workspaceId: workspace.id,
  fallbackAppId: "cli_a_fallback",
  event: {
    header: {
      app_id: "cli_a_event_app",
      tenant_key: "tenant_event",
      create_time: "1780905600000"
    },
    event: {
      chat_id: "oc_event_chat",
      name: "播客情报群",
      operator_id: { open_id: "ou_operator" }
    }
  }
});

if (installation.appId !== "cli_a_event_app") {
  throw new Error(`Expected event app id, got ${installation.appId}`);
}
if (installation.tenantKey !== "tenant_event" || installation.chatId !== "oc_event_chat") {
  throw new Error(`Unexpected installation target: ${JSON.stringify(installation)}`);
}
if (installation.operatorOpenId !== "ou_operator") {
  throw new Error("Operator open_id was not persisted.");
}
if (!installation.installedAt.startsWith("2026-06-08")) {
  throw new Error(`Event timestamp was not converted to ISO: ${installation.installedAt}`);
}

const welcome = larkBotAddedWelcomeText("播客情报群");
if (!welcome.includes("Podcast Note 已连接") || !welcome.includes("核心音频片段")) {
  throw new Error(`Unexpected welcome text: ${welcome}`);
}

const p2pReply = larkBotMessageReplyText({
  chatType: "p2p",
  content: "你好"
});
if (!p2pReply.includes("个人接收已连接")) {
  throw new Error(`P2P reply should confirm personal binding: ${p2pReply}`);
}

const personalInstallation = recordLarkPersonalChatEvent({
  repositories,
  workspaceId: workspace.id,
  appId: "cli_a_personal_app",
  tenantKey: "tenant_event",
  event: {
    chat_id: "oc_personal_chat",
    chat_type: "p2p",
    sender_id: "ou_personal_user",
    content: "/bind"
  }
});
if (personalInstallation.chatId !== "oc_personal_chat" || personalInstallation.chatName !== "个人播客助手") {
  throw new Error(`Unexpected personal chat installation: ${JSON.stringify(personalInstallation)}`);
}

const groupReply = larkBotMessageReplyText({
  chatType: "group",
  content: "/help"
});
if (!groupReply.includes("这个群已可以接收")) {
  throw new Error(`Group reply should explain delivery status: ${groupReply}`);
}

console.log("Lark bot events check passed.");
