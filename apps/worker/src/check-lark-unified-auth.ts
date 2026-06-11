import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import {
  completeLarkBindSession,
  createLarkBindSession,
  larkAgentFullAccessDomains,
  larkAuthStatus,
  sanitizeLarkVerificationUrl
} from "../../../packages/lark/src/index.ts";

const dbPath = join(await mkdtemp(join(tmpdir(), "podcast-note-lark-auth-")), "test.sqlite");
const repositories = createRepositories(openPodcastNoteDb(dbPath));
const user = repositories.upsertUser({
  id: "user_lark_auth_check",
  email: "lark-auth-check@example.invalid",
  name: "Lark Auth Check"
});
const workspace = repositories.ensurePersonalWorkspaceForUser(user.id);

const session = createLarkBindSession({
  repositories,
  workspaceId: workspace.id,
  agentId: "agent_terminal_001",
  permissionPackage: "lark.agent.full_access",
  terminalFingerprint: "macbook-test",
  appId: "cli_a_fake_app_id",
  redirectUri: "http://127.0.0.1:3000/api/lark/oauth/callback",
  now: "2026-06-06T08:00:00.000Z"
});

if (!session.id.startsWith("lbs_")) {
  throw new Error(`Unexpected bind session id: ${session.id}`);
}
if (!session.verificationUrl.includes("client_id=cli_a_fake_app_id")) {
  throw new Error(`Verification URL did not include app id: ${session.verificationUrl}`);
}
if (!session.verificationUrl.includes("redirect_uri=")) {
  throw new Error(`Verification URL did not include redirect_uri: ${session.verificationUrl}`);
}
if (!session.verificationUrl.includes("state=")) {
  throw new Error(`Verification URL did not include signed state: ${session.verificationUrl}`);
}
if (session.verificationUrl.includes("domain:")) {
  throw new Error(`Verification URL leaked internal domain aliases as OAuth scopes: ${session.verificationUrl}`);
}
if (!larkAgentFullAccessDomains.includes("im") || !larkAgentFullAccessDomains.includes("docs")) {
  throw new Error("Full access permission package missed expected domains.");
}

const legacyBadUrl = `${session.verificationUrl}&scope=${encodeURIComponent("domain:base domain:calendar im:message")}`;
const sanitizedLegacyUrl = sanitizeLarkVerificationUrl(legacyBadUrl);
if (sanitizedLegacyUrl.includes("domain:")) {
  throw new Error(`Legacy verification URL was not sanitized: ${sanitizedLegacyUrl}`);
}
if (!sanitizedLegacyUrl.includes("im%3Amessage") && !sanitizedLegacyUrl.includes("im:message")) {
  throw new Error(`Sanitizer should preserve non-domain scopes: ${sanitizedLegacyUrl}`);
}

const pending = larkAuthStatus({ repositories, bindSessionId: session.id, now: "2026-06-06T08:01:00.000Z" });
if (pending.status !== "pending") {
  throw new Error(`Expected pending status, got ${pending.status}`);
}

const completed = completeLarkBindSession({
  repositories,
  signedState: session.signedState,
  code: "fake_auth_code",
  now: "2026-06-06T08:02:00.000Z",
  tokenResult: {
    accessToken: "uat_fake",
    refreshToken: "urt_fake",
    accessTokenExpiresAt: "2026-06-06T10:02:00.000Z",
    refreshTokenExpiresAt: "2026-07-06T08:02:00.000Z"
  },
  userInfo: {
    tenantKey: "tenant_fake",
    openId: "ou_fake",
    unionId: "on_fake",
    name: "授权用户"
  }
});

if (!completed.connectionId.startsWith("lark_conn_")) {
  throw new Error(`Unexpected connection id: ${completed.connectionId}`);
}

const status = larkAuthStatus({ repositories, bindSessionId: session.id, now: "2026-06-06T08:03:00.000Z" });
if (status.status !== "completed") {
  throw new Error(`Expected completed status, got ${status.status}`);
}
if (status.status === "completed" && status.connectionId !== completed.connectionId) {
  throw new Error("Completed status did not return the saved connection id.");
}

const connection = repositories.getLarkConnection(completed.connectionId);
if (!connection) {
  throw new Error("Lark connection was not persisted.");
}
if (connection.encryptedAccessToken === "uat_fake" || connection.encryptedRefreshToken === "urt_fake") {
  throw new Error("Tokens must not be stored in plaintext.");
}
if (connection.permissionPackage !== "lark.agent.full_access") {
  throw new Error(`Unexpected permission package: ${connection.permissionPackage}`);
}

const latest = repositories.getLatestLarkConnectionForWorkspace(workspace.id);
if (latest?.id !== completed.connectionId) {
  throw new Error("Latest workspace Lark connection did not resolve.");
}

console.log("Lark unified auth check passed.");
