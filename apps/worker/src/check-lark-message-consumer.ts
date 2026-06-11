import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { consumeLarkMessageEvents, larkMessageEventFromSdk, larkRawEventType } from "./lark-bot-events.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-lark-consumer-"));
const dbPath = join(dir, "test.sqlite");
const fakeLarkCli = join(dir, "lark-cli");
process.env["PODCAST_NOTE_LARK_EVENT_STATUS_PATH"] = join(dir, "lark-events-status.json");
const repositories = createRepositories(openPodcastNoteDb(dbPath));
const user = repositories.upsertUser({
  id: "user_lark_consumer_check",
  email: "lark-consumer-check@example.invalid",
  name: "Lark Consumer Check"
});
const workspace = repositories.ensurePersonalWorkspaceForUser(user.id);
const sentMessages: Array<{ chatId: string; text: string }> = [];

const sdkEvent = larkMessageEventFromSdk({
  message: {
    chat_id: "oc_sdk_personal",
    chat_type: "p2p",
    content: "{\"text\":\"/bind\"}",
    message_type: "text"
  },
  sender: {
    sender_id: {
      open_id: "ou_sdk_sender"
    }
  }
});
if (sdkEvent.chat_id !== "oc_sdk_personal" || sdkEvent.content !== "/bind" || sdkEvent.sender_id !== "ou_sdk_sender") {
  throw new Error(`Unexpected SDK message event mapping: ${JSON.stringify(sdkEvent)}`);
}

const flatSdkEvent = larkMessageEventFromSdk({
  message_id: "om_flat",
  chat_id: "oc_flat_personal",
  chat_type: "p2p",
  content: "{\"text\":\"/bind\"}",
  message_type: "text",
  sender_id: {
    open_id: "ou_flat_sender"
  }
});
if (flatSdkEvent.chat_id !== "oc_flat_personal" || flatSdkEvent.content !== "/bind" || flatSdkEvent.sender_id !== "ou_flat_sender") {
  throw new Error(`Unexpected flat SDK message event mapping: ${JSON.stringify(flatSdkEvent)}`);
}
if (larkRawEventType({ header: { event_type: "im.message.receive_v1" } }) !== "im.message.receive_v1") {
  throw new Error("Expected raw V2 event type to be detected.");
}
if (larkRawEventType({ event: { type: "message" } }) !== "message") {
  throw new Error("Expected raw V1 event type to be detected.");
}

writeFileSync(fakeLarkCli, [
  "#!/usr/bin/env bash",
  "echo '[event] ready event_key=im.message.receive_v1' >&2",
  "printf '%s\\n' '{\"chat_id\":\"oc_personal_consumer\",\"chat_type\":\"p2p\",\"content\":\"/bind\",\"message_type\":\"text\",\"sender_id\":\"ou_consumer\"}'"
].join("\n"));
chmodSync(fakeLarkCli, 0o755);

await consumeLarkMessageEvents({
  dbPath,
  workspaceId: workspace.id,
  appId: "cli_consumer_app",
  tenantKey: "tenant_consumer",
  larkCliPath: fakeLarkCli,
  client: {
    sendTextMessage: async (input) => {
      sentMessages.push(input);
      return { messageId: "om_consumer_reply" };
    }
  }
});

const installation = repositories.getLatestLarkBotInstallationForWorkspace(workspace.id, "cli_consumer_app");
if (!installation) throw new Error("Expected /bind p2p event to create a Lark bot installation.");
if (installation.chatId !== "oc_personal_consumer") {
  throw new Error(`Expected personal chat id to be persisted, got ${installation.chatId}`);
}
if (installation.chatName !== "个人播客助手") {
  throw new Error(`Expected personal chat display name, got ${installation.chatName}`);
}
if (installation.operatorOpenId !== "ou_consumer") {
  throw new Error(`Expected sender open_id to be persisted, got ${installation.operatorOpenId}`);
}
if (sentMessages.length !== 1 || !sentMessages[0]?.text.includes("个人接收已连接")) {
  throw new Error(`Expected one personal binding confirmation message, got ${JSON.stringify(sentMessages)}`);
}

const log = readFileSync(fakeLarkCli, "utf8");
if (!log.includes("im.message.receive_v1")) {
  throw new Error("Fake lark-cli script lost expected event key fixture.");
}

console.log("Lark message consumer check passed.");
