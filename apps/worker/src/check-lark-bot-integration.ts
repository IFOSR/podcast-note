import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import {
  buildLarkBotOpenUrl,
  createLarkBotClient,
  latestLarkBotIntegrationStatus,
  recordLarkBotInstalled
} from "../../../packages/lark/src/index.ts";

const dbPath = join(await mkdtemp(join(tmpdir(), "podcast-note-lark-bot-")), "test.sqlite");
const repositories = createRepositories(openPodcastNoteDb(dbPath));
const user = repositories.upsertUser({
  id: "user_lark_bot_check",
  email: "lark-bot-check@example.invalid",
  name: "Lark Bot Check"
});
const workspace = repositories.ensurePersonalWorkspaceForUser(user.id);

const botOpenUrl = buildLarkBotOpenUrl("cli_a_fake_app_id");
if (botOpenUrl !== "https://applink.feishu.cn/client/bot/open?appId=cli_a_fake_app_id") {
  throw new Error(`Unexpected bot open AppLink: ${botOpenUrl}`);
}
if (botOpenUrl.includes("redirect_uri") || botOpenUrl.includes("oauth")) {
  throw new Error(`Bot AppLink must not depend on OAuth redirect: ${botOpenUrl}`);
}

const initialStatus = latestLarkBotIntegrationStatus({
  repositories,
  workspaceId: workspace.id,
  appId: "cli_a_fake_app_id",
  appSecretConfigured: true,
  websocketEnabled: true
});
if (initialStatus.connected) {
  throw new Error("Bot integration should not be connected before an install event records a chat_id.");
}
if (initialStatus.botOpenUrl !== botOpenUrl) {
  throw new Error(`Status returned the wrong AppLink: ${initialStatus.botOpenUrl}`);
}
if (!initialStatus.setupChecks.filter((check) => check.key !== "chat").every((check) => check.ok)) {
  throw new Error(`Expected configured checks to pass: ${JSON.stringify(initialStatus.setupChecks)}`);
}
if (initialStatus.setupChecks.find((check) => check.key === "chat")?.ok) {
  throw new Error("Chat check should wait for a bot install event before passing.");
}

const installed = recordLarkBotInstalled({
  repositories,
  workspaceId: workspace.id,
  appId: "cli_a_fake_app_id",
  tenantKey: "tenant_fake",
  chatId: "oc_fake_chat",
  chatName: "播客情报群",
  operatorOpenId: "ou_fake_operator",
  now: "2026-06-08T08:00:00.000Z"
});
if (!installed.id.startsWith("lark_bot_")) {
  throw new Error(`Unexpected installation id: ${installed.id}`);
}

const connectedStatus = latestLarkBotIntegrationStatus({
  repositories,
  workspaceId: workspace.id,
  appId: "cli_a_fake_app_id",
  appSecretConfigured: true,
  websocketEnabled: true
});
if (!connectedStatus.connected) {
  throw new Error("Bot integration should be connected after the install event is recorded.");
}
if (connectedStatus.connected && connectedStatus.installation?.chatId !== "oc_fake_chat") {
  throw new Error(`Connected status returned the wrong chat_id: ${connectedStatus.installation?.chatId}`);
}

const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
const client = createLarkBotClient({
  appId: "cli_a_fake_app_id",
  appSecret: "fake_secret",
  fetcher: async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/open-apis/auth/v3/tenant_access_token/internal")) {
      return new Response(JSON.stringify({
        code: 0,
        msg: "ok",
        tenant_access_token: "t-tenant-token",
        expire: 7200
      }));
    }
    if (String(url).includes("/open-apis/im/v1/messages?receive_id_type=chat_id")) {
      return new Response(JSON.stringify({
        code: 0,
        msg: "ok",
        data: { message_id: "om_fake_message" }
      }));
    }
    throw new Error(`Unexpected request URL: ${String(url)}`);
  }
});

const token = await client.getTenantAccessToken();
if (token.tenantAccessToken !== "t-tenant-token") {
  throw new Error("Tenant token was not parsed.");
}
const message = await client.sendTextMessage({ chatId: "oc_fake_chat", text: "Podcast Note 测试消息" });
if (message.messageId !== "om_fake_message") {
  throw new Error(`Unexpected message id: ${message.messageId}`);
}
if (requests.length !== 2) {
  throw new Error(`Expected token + message requests, got ${requests.length}`);
}
const messageBody = JSON.parse(String(requests[1]?.init?.body)) as { receive_id?: string; msg_type?: string; content?: string };
if (messageBody.receive_id !== "oc_fake_chat" || messageBody.msg_type !== "text") {
  throw new Error(`Unexpected message body: ${JSON.stringify(messageBody)}`);
}
if (!String(requests[1]?.init?.headers).includes("t-tenant-token")) {
  const headers = requests[1]?.init?.headers as Record<string, string>;
  if (headers?.["Authorization"] !== "Bearer t-tenant-token") {
    throw new Error("Message request did not use tenant access token.");
  }
}

console.log("Lark bot integration check passed.");
