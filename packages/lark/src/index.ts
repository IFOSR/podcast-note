import { createHash, createHmac, randomBytes } from "node:crypto";
import { stableId } from "../../core/src/format.ts";
import type { createRepositories } from "../../db/src/repositories.ts";

type Repositories = ReturnType<typeof createRepositories>;

export const larkAgentFullAccessDomains = [
  "docs",
  "drive",
  "wiki",
  "sheets",
  "slides",
  "base",
  "markdown",
  "im",
  "contact",
  "calendar",
  "task",
  "minutes",
  "vc",
  "mail"
] as const;

export type LarkPermissionPackage = "lark.agent.full_access" | "lark.agent.standard_access";

export type CreateLarkBindSessionInput = {
  repositories: Repositories;
  workspaceId: string;
  agentId: string;
  permissionPackage?: LarkPermissionPackage;
  terminalFingerprint?: string;
  appId: string;
  redirectUri: string;
  scopes?: string[];
  now?: string;
  ttlSeconds?: number;
  stateSecret?: string;
};

export type CreatedLarkBindSession = {
  id: string;
  signedState: string;
  verificationUrl: string;
  expiresAt: string;
  pollIntervalSeconds: number;
};

export type LarkTokenResult = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt?: string;
};

export type LarkUserInfo = {
  tenantKey: string;
  openId: string;
  unionId?: string;
  name?: string;
};

export type CompleteLarkBindSessionInput = {
  repositories: Repositories;
  signedState: string;
  code: string;
  now?: string;
  tokenResult: LarkTokenResult;
  userInfo: LarkUserInfo;
  stateSecret?: string;
  tokenSecret?: string;
};

export type LarkAuthStatus =
  | { status: "pending"; expiresAt: string }
  | { status: "expired"; expiresAt: string; message: string }
  | { status: "failed"; expiresAt: string; message: string }
  | {
      status: "completed";
      connectionId: string;
      user: {
        openId: string;
        name?: string;
        tenantKey: string;
      };
    };

const feishuOAuthAuthorizeUrl = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const feishuOpenApiBaseUrl = "https://open.feishu.cn";
const defaultStateSecret = "podcast-note-local-lark-state-secret";
const defaultTokenSecret = "podcast-note-local-token-secret";

export type LarkBotSetupCheck = {
  key: "app_id" | "app_secret" | "websocket" | "chat";
  label: string;
  ok: boolean;
  message: string;
};

export type LarkBotIntegrationStatus = {
  appId?: string;
  botOpenUrl?: string;
  connected: boolean;
  setupChecks: LarkBotSetupCheck[];
  installation?: {
    id: string;
    tenantKey: string;
    chatId: string;
    chatName?: string;
    updatedAt: string;
  };
};

export type LarkBotInstalledInput = {
  repositories: Repositories;
  workspaceId: string;
  appId: string;
  tenantKey: string;
  chatId: string;
  chatName?: string;
  operatorOpenId?: string;
  now?: string;
};

export type LarkBotClient = {
  getTenantAccessToken: () => Promise<{ tenantAccessToken: string; expireSeconds: number }>;
  sendTextMessage: (input: { chatId: string; text: string }) => Promise<{ messageId: string }>;
};

type Fetcher = typeof fetch;

export function createLarkBindSession(input: CreateLarkBindSessionInput): CreatedLarkBindSession {
  if (!input.appId.trim()) throw new Error("Lark app id is required.");
  if (!input.redirectUri.trim()) throw new Error("Lark OAuth redirect URI is required.");
  if (!input.repositories.getWorkspace(input.workspaceId)) {
    throw new Error(`Cannot create Lark bind session for missing workspace: ${input.workspaceId}`);
  }

  const now = input.now ?? new Date().toISOString();
  const ttlSeconds = input.ttlSeconds ?? 10 * 60;
  const expiresAt = new Date(Date.parse(now) + ttlSeconds * 1000).toISOString();
  const id = stableId("lbs", `${input.workspaceId}:${input.agentId}:${now}:${randomBytes(8).toString("hex")}`);
  const permissionPackage = input.permissionPackage ?? "lark.agent.full_access";
  const signedState = signState({
    bindSessionId: id,
    nonce: randomBytes(12).toString("hex"),
    agentId: input.agentId,
    permissionPackage,
    expiresAt
  }, input.stateSecret);
  const stateHash = hashValue(signedState);
  const verificationUrl = buildLarkOAuthUrl({
    appId: input.appId,
    redirectUri: input.redirectUri,
    scopes: input.scopes ?? [],
    signedState
  });

  input.repositories.createLarkBindSession({
    id,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    stateHash,
    permissionPackage,
    terminalFingerprint: input.terminalFingerprint,
    verificationUrl,
    expiresAt,
    createdAt: now
  });

  return {
    id,
    signedState,
    verificationUrl,
    expiresAt,
    pollIntervalSeconds: 2
  };
}

export function completeLarkBindSession(input: CompleteLarkBindSessionInput): { connectionId: string } {
  const now = input.now ?? new Date().toISOString();
  const state = verifyState(input.signedState, input.stateSecret);
  const session = input.repositories.getLarkBindSessionByStateHash(hashValue(input.signedState));
  if (!session) throw new Error("Lark bind session was not found for OAuth state.");
  if (session.id !== state.bindSessionId) throw new Error("Lark OAuth state does not match bind session.");
  if (session.status !== "pending") throw new Error(`Lark bind session is not pending: ${session.status}`);
  if (Date.parse(session.expiresAt) <= Date.parse(now)) {
    input.repositories.expireLarkBindSession(session.id);
    throw new Error("Lark bind session has expired.");
  }
  if (!input.code.trim()) throw new Error("Lark OAuth code is required.");

  const connectionId = stableId("lark_conn", `${session.workspaceId}:${session.agentId}:${input.userInfo.tenantKey}:${input.userInfo.openId}`);
  input.repositories.createLarkConnection({
    id: connectionId,
    workspaceId: session.workspaceId,
    agentId: session.agentId,
    tenantKey: input.userInfo.tenantKey,
    openId: input.userInfo.openId,
    unionId: input.userInfo.unionId,
    userName: input.userInfo.name,
    permissionPackage: session.permissionPackage,
    encryptedAccessToken: encryptToken(input.tokenResult.accessToken, input.tokenSecret),
    encryptedRefreshToken: encryptToken(input.tokenResult.refreshToken, input.tokenSecret),
    accessTokenExpiresAt: input.tokenResult.accessTokenExpiresAt,
    refreshTokenExpiresAt: input.tokenResult.refreshTokenExpiresAt,
    createdAt: now
  });
  input.repositories.completeLarkBindSession({
    id: session.id,
    connectionId,
    completedAt: now
  });
  return { connectionId };
}

export function larkAuthStatus(input: {
  repositories: Repositories;
  bindSessionId: string;
  now?: string;
}): LarkAuthStatus {
  const now = input.now ?? new Date().toISOString();
  const session = input.repositories.getLarkBindSession(input.bindSessionId);
  if (!session) throw new Error(`Lark bind session not found: ${input.bindSessionId}`);
  if (session.status === "pending" && Date.parse(session.expiresAt) <= Date.parse(now)) {
    const expired = input.repositories.expireLarkBindSession(session.id);
    return {
      status: "expired",
      expiresAt: expired?.expiresAt ?? session.expiresAt,
      message: "授权二维码已过期，请重新开始飞书授权。"
    };
  }
  if (session.status === "pending") {
    return { status: "pending", expiresAt: session.expiresAt };
  }
  if (session.status === "expired") {
    return { status: "expired", expiresAt: session.expiresAt, message: session.error ?? "授权二维码已过期，请重新开始飞书授权。" };
  }
  if (session.status === "failed") {
    return { status: "failed", expiresAt: session.expiresAt, message: session.error ?? "飞书授权失败。" };
  }

  if (!session.connectionId) throw new Error(`Completed Lark bind session missed connection id: ${session.id}`);
  const connection = input.repositories.getLarkConnection(session.connectionId);
  if (!connection) throw new Error(`Lark connection not found: ${session.connectionId}`);
  return {
    status: "completed",
    connectionId: connection.id,
    user: {
      openId: connection.openId,
      name: connection.userName,
      tenantKey: connection.tenantKey
    }
  };
}

export function latestLarkIntegrationStatus(input: {
  repositories: Repositories;
  workspaceId: string;
}): { connected: false } | {
  connected: true;
  connectionId: string;
  userName?: string;
  openId: string;
  tenantKey: string;
  permissionPackage: string;
  updatedAt: string;
} {
  const connection = input.repositories.getLatestLarkConnectionForWorkspace(input.workspaceId);
  if (!connection) return { connected: false };
  return {
    connected: true,
    connectionId: connection.id,
    userName: connection.userName,
    openId: connection.openId,
    tenantKey: connection.tenantKey,
    permissionPackage: connection.permissionPackage,
    updatedAt: connection.updatedAt
  };
}

export function buildLarkBotOpenUrl(appId: string): string {
  const trimmed = appId.trim();
  if (!trimmed) throw new Error("Lark app id is required.");
  const url = new URL("https://applink.feishu.cn/client/bot/open");
  url.searchParams.set("appId", trimmed);
  return url.toString();
}

export function latestLarkBotIntegrationStatus(input: {
  repositories: Repositories;
  workspaceId: string;
  appId?: string;
  appSecretConfigured: boolean;
  websocketEnabled: boolean;
}): LarkBotIntegrationStatus {
  const appId = input.appId?.trim() || undefined;
  const installation = input.repositories.getLatestLarkBotInstallationForWorkspace(input.workspaceId, appId);
  const setupChecks: LarkBotSetupCheck[] = [
    {
      key: "app_id",
      label: "App ID",
      ok: Boolean(appId),
      message: appId ? "已配置" : "缺少 LARK_APP_ID 或 FEISHU_APP_ID"
    },
    {
      key: "app_secret",
      label: "App Secret",
      ok: input.appSecretConfigured,
      message: input.appSecretConfigured ? "已配置，后端可换取 tenant_access_token" : "缺少 LARK_APP_SECRET 或 FEISHU_APP_SECRET"
    },
    {
      key: "websocket",
      label: "长连接事件",
      ok: input.websocketEnabled,
      message: input.websocketEnabled ? "使用长连接接收机器人入群/消息事件，不需要公网回调地址" : "未启用长连接事件消费"
    },
    {
      key: "chat",
      label: "目标会话",
      ok: Boolean(installation),
      message: installation ? `已绑定 ${installation.chatName ?? installation.chatId}` : "等待个人私聊绑定"
    }
  ];

  return {
    appId,
    botOpenUrl: appId ? buildLarkBotOpenUrl(appId) : undefined,
    connected: Boolean(installation),
    setupChecks,
    installation: installation ? {
      id: installation.id,
      tenantKey: installation.tenantKey,
      chatId: installation.chatId,
      chatName: installation.chatName,
      updatedAt: installation.updatedAt
    } : undefined
  };
}

export function recordLarkBotInstalled(input: LarkBotInstalledInput) {
  if (!input.appId.trim()) throw new Error("Lark app id is required.");
  if (!input.tenantKey.trim()) throw new Error("Lark tenant key is required.");
  if (!input.chatId.trim()) throw new Error("Lark chat_id is required.");
  if (!input.repositories.getWorkspace(input.workspaceId)) {
    throw new Error(`Cannot record Lark bot install for missing workspace: ${input.workspaceId}`);
  }
  const now = input.now ?? new Date().toISOString();
  const id = stableId("lark_bot", `${input.workspaceId}:${input.appId}:${input.tenantKey}:${input.chatId}`);
  return input.repositories.upsertLarkBotInstallation({
    id,
    workspaceId: input.workspaceId,
    appId: input.appId,
    tenantKey: input.tenantKey,
    chatId: input.chatId,
    chatName: input.chatName,
    operatorOpenId: input.operatorOpenId,
    installedAt: now
  });
}

export function createLarkBotClient(input: {
  appId: string;
  appSecret: string;
  fetcher?: Fetcher;
  baseUrl?: string;
}): LarkBotClient {
  const appId = input.appId.trim();
  const appSecret = input.appSecret.trim();
  if (!appId) throw new Error("Lark app id is required.");
  if (!appSecret) throw new Error("Lark app secret is required.");
  const fetcher = input.fetcher ?? fetch;
  const baseUrl = (input.baseUrl ?? feishuOpenApiBaseUrl).replace(/\/$/, "");
  let cachedToken: { tenantAccessToken: string; expiresAtMs: number; expireSeconds: number } | undefined;

  async function getTenantAccessToken() {
    const nowMs = Date.now();
    if (cachedToken && cachedToken.expiresAtMs - nowMs > 60_000) {
      return {
        tenantAccessToken: cachedToken.tenantAccessToken,
        expireSeconds: cachedToken.expireSeconds
      };
    }
    const response = await fetcher(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    });
    const payload = await parseLarkJson(response);
    const token = stringPayloadField(payload, "tenant_access_token");
    const expireSeconds = numberPayloadField(payload, "expire", 7200);
    cachedToken = {
      tenantAccessToken: token,
      expireSeconds,
      expiresAtMs: nowMs + expireSeconds * 1000
    };
    return { tenantAccessToken: token, expireSeconds };
  }

  async function sendTextMessage(input: { chatId: string; text: string }) {
    if (!input.chatId.trim()) throw new Error("Lark chat_id is required.");
    if (!input.text.trim()) throw new Error("Lark text message is required.");
    const token = await getTenantAccessToken();
    const response = await fetcher(`${baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token.tenantAccessToken}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        receive_id: input.chatId,
        msg_type: "text",
        content: JSON.stringify({ text: input.text })
      })
    });
    const payload = await parseLarkJson(response);
    const data = objectPayloadField(payload, "data");
    return { messageId: stringPayloadField(data, "message_id") };
  }

  return { getTenantAccessToken, sendTextMessage };
}

export function sanitizeLarkOAuthScopes(scopes: string[]): string[] {
  return scopes.map((scope) => scope.trim()).filter((scope) => scope && !scope.startsWith("domain:"));
}

export function sanitizeLarkVerificationUrl(input: string): string {
  const url = new URL(input);
  const scope = url.searchParams.get("scope");
  if (!scope) return url.toString();
  const scopes = sanitizeLarkOAuthScopes(scope.split(/\s+/));
  if (scopes.length > 0) {
    url.searchParams.set("scope", scopes.join(" "));
  } else {
    url.searchParams.delete("scope");
  }
  return url.toString();
}

function buildLarkOAuthUrl(input: {
  appId: string;
  redirectUri: string;
  scopes: string[];
  signedState: string;
}): string {
  const url = new URL(feishuOAuthAuthorizeUrl);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  const scopes = sanitizeLarkOAuthScopes(input.scopes);
  if (scopes.length > 0) {
    url.searchParams.set("scope", scopes.join(" "));
  }
  url.searchParams.set("state", input.signedState);
  return url.toString();
}

function signState(payload: {
  bindSessionId: string;
  nonce: string;
  agentId: string;
  permissionPackage: string;
  expiresAt: string;
}, secret = defaultStateSecret): string {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = hmac(body, secret);
  return `${body}.${signature}`;
}

function verifyState(signedState: string, secret = defaultStateSecret): {
  bindSessionId: string;
  nonce: string;
  agentId: string;
  permissionPackage: string;
  expiresAt: string;
} {
  const [body, signature] = signedState.split(".");
  if (!body || !signature) throw new Error("Invalid Lark OAuth state.");
  if (hmac(body, secret) !== signature) throw new Error("Invalid Lark OAuth state signature.");
  const parsed = JSON.parse(base64UrlDecode(body)) as {
    bindSessionId?: string;
    nonce?: string;
    agentId?: string;
    permissionPackage?: string;
    expiresAt?: string;
  };
  if (!parsed.bindSessionId || !parsed.nonce || !parsed.agentId || !parsed.permissionPackage || !parsed.expiresAt) {
    throw new Error("Invalid Lark OAuth state payload.");
  }
  return {
    bindSessionId: parsed.bindSessionId,
    nonce: parsed.nonce,
    agentId: parsed.agentId,
    permissionPackage: parsed.permissionPackage,
    expiresAt: parsed.expiresAt
  };
}

function encryptToken(token: string, secret = defaultTokenSecret): string {
  const mask = hmac(token, secret).slice(0, 16);
  return `enc:${mask}:${base64UrlEncode(token)}`;
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

async function parseLarkJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Lark API returned non-JSON response with status ${response.status}.`);
  }
  const code = Number(payload["code"] ?? 0);
  if (!response.ok || code !== 0) {
    const msg = typeof payload["msg"] === "string" ? payload["msg"] : response.statusText;
    throw new Error(`Lark API request failed: code=${code}, message=${msg}`);
  }
  return payload;
}

function stringPayloadField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Lark API response missed ${key}.`);
  }
  return value;
}

function numberPayloadField(payload: Record<string, unknown>, key: string, fallback: number): number {
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function objectPayloadField(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Lark API response missed ${key}.`);
  }
  return value as Record<string, unknown>;
}
