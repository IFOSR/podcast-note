import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { createLarkBotClient, recordLarkBotInstalled } from "../../../packages/lark/src/index.ts";
import { deliverPendingLarkEpisodeResults } from "./lark-delivery.ts";
import { handleLarkBotCommand } from "./lark-command-router.ts";

export type LarkBotAddedEvent = {
  header?: {
    app_id?: string;
    tenant_key?: string;
    create_time?: string;
  };
  event?: {
    chat_id?: string;
    name?: string;
    operator_tenant_key?: string;
    operator_id?: {
      open_id?: string;
    };
  };
};

export type LarkMessageReceivedEvent = {
  chat_id?: string;
  chat_type?: "p2p" | "group" | string;
  content?: string;
  message_type?: string;
  sender_id?: string;
};

export type LarkBotEventClient = {
  sendTextMessage: (input: { chatId: string; text: string }) => Promise<{ messageId: string }>;
};

export type LarkMessageEventContext = {
  repositories?: ReturnType<typeof createRepositories>;
  workspaceId?: string;
  appId: string;
  tenantKey?: string;
  client: LarkBotEventClient;
  eventKey: string;
};

const defaultLarkEventStatusPath = ".runtime/lark-events-status.json";

export function recordLarkBotAddedEvent(input: {
  repositories: ReturnType<typeof createRepositories>;
  workspaceId: string;
  fallbackAppId: string;
  event: LarkBotAddedEvent;
}) {
  const appId = input.event.header?.app_id || input.fallbackAppId;
  const tenantKey = input.event.header?.tenant_key || input.event.event?.operator_tenant_key;
  const chatId = input.event.event?.chat_id;
  if (!tenantKey) throw new Error("Lark bot added event missed tenant_key.");
  if (!chatId) throw new Error("Lark bot added event missed chat_id.");
  return recordLarkBotInstalled({
    repositories: input.repositories,
    workspaceId: input.workspaceId,
    appId,
    tenantKey,
    chatId,
    chatName: input.event.event?.name,
    operatorOpenId: input.event.event?.operator_id?.open_id,
    now: timestampToIso(input.event.header?.create_time)
  });
}

export function larkBotAddedWelcomeText(chatName?: string): string {
  const target = chatName?.trim() || "当前飞书会话";
  return [
    `Podcast Note 已连接到「${target}」。`,
    "",
    "后续我会把播客处理结果发送到这里：",
    "1. 核心摘要",
    "2. 完整报告文件",
    "3. 可直接收听的核心音频片段",
    "",
    "现在可以回到 Podcast Note Web 端创建监控任务，或发送 /help 查看说明。"
  ].join("\n");
}

export function larkBotMessageReplyText(input: { chatType?: string; content?: string }): string {
  const content = input.content?.trim().toLowerCase() ?? "";
  if (input.chatType === "group") {
    if (content && !content.includes("/help") && !content.includes("帮助")) return "";
    return [
      "Podcast Note：这个群已可以接收播客处理结果。",
      "",
      "我会在后台处理完成后推送：核心摘要、完整报告文件、核心音频片段。",
      "配置监控任务请打开 Podcast Note Web 端。"
    ].join("\n");
  }
  return [
    "Podcast Note 个人接收已连接。",
    "",
    "后续播客摘要、完整报告和核心音频片段会直接推送到这个机器人私聊。",
    "你可以回到 Podcast Note Web 端创建或恢复监控任务。"
  ].join("\n");
}

export function recordLarkPersonalChatEvent(input: {
  repositories: ReturnType<typeof createRepositories>;
  workspaceId: string;
  appId: string;
  tenantKey: string;
  event: LarkMessageReceivedEvent;
}) {
  if (input.event.chat_type !== "p2p") {
    throw new Error(`Personal Lark binding requires p2p chat_type, got ${input.event.chat_type ?? "unknown"}.`);
  }
  if (!input.event.chat_id) throw new Error("Lark personal message event missed chat_id.");
  return recordLarkBotInstalled({
    repositories: input.repositories,
    workspaceId: input.workspaceId,
    appId: input.appId,
    tenantKey: input.tenantKey,
    chatId: input.event.chat_id,
    chatName: "个人播客助手",
    operatorOpenId: input.event.sender_id
  });
}

export async function handleLarkMessageReceivedEvent(input: {
  context: LarkMessageEventContext;
  event: LarkMessageReceivedEvent;
}): Promise<void> {
  if (input.context.repositories && input.context.workspaceId) {
    const command = await handleLarkBotCommand({
      repositories: input.context.repositories,
      workspaceId: input.context.workspaceId,
      appId: input.context.appId,
      tenantKey: input.context.tenantKey,
      client: input.context.client,
      event: input.event
    });
    if (command.handled) return;
  }
  const reply = larkBotMessageReplyText({
    chatType: input.event.chat_type,
    content: input.event.content
  });
  if (!reply || !input.event.chat_id) return;
  let bound = false;
  if (input.event.chat_type === "p2p" && input.context.repositories && input.context.workspaceId) {
    recordLarkPersonalChatEvent({
      repositories: input.context.repositories,
      workspaceId: input.context.workspaceId,
      appId: input.context.appId,
      tenantKey: input.context.tenantKey ?? "tenant_personal",
      event: input.event
    });
    bound = true;
    writeLarkEventStatus({
      state: "bound",
      eventKey: input.context.eventKey,
      transport: "sdk-ws",
      lastEventAt: new Date().toISOString(),
      lastChatId: input.event.chat_id,
      lastChatType: input.event.chat_type,
      lastContent: input.event.content
    });
  }
  const message = await input.context.client.sendTextMessage({ chatId: input.event.chat_id, text: reply });
  console.log(JSON.stringify({
    ok: true,
    event: input.context.eventKey,
    chatId: input.event.chat_id,
    chatType: input.event.chat_type,
    bound,
    messageId: message.messageId
  }));
  if (bound && input.context.repositories && input.context.workspaceId) {
    deliverPendingAfterBind({
      context: input.context,
      chatId: input.event.chat_id
    }).catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        message: "Lark pending delivery after bind failed",
        chatId: input.event.chat_id,
        error: error instanceof Error ? error.message : String(error)
      }));
    });
  }
}

export async function consumeLarkBotAddedEvents(options: {
  dbPath: string;
  workspaceId: string;
  appId: string;
  appSecret?: string;
  eventKey?: string;
  larkCliPath?: string;
}): Promise<void> {
  const repositories = createRepositories(openPodcastNoteDb(options.dbPath));
  const eventKey = options.eventKey ?? "im.chat.member.bot.added_v1";
  const client = options.appSecret ? createLarkBotClient({ appId: options.appId, appSecret: options.appSecret }) : undefined;
  await consumeLarkEvent({
    eventKey,
    larkCliPath: options.larkCliPath,
    onLine: async (line) => {
      const event = JSON.parse(line) as LarkBotAddedEvent;
      const installation = recordLarkBotAddedEvent({
        repositories,
        workspaceId: options.workspaceId,
        fallbackAppId: options.appId,
        event
      });
      if (client) {
        await client.sendTextMessage({
          chatId: installation.chatId,
          text: larkBotAddedWelcomeText(installation.chatName)
        });
      }
      console.log(JSON.stringify({
        ok: true,
        event: eventKey,
        chatId: installation.chatId,
        chatName: installation.chatName,
        tenantKey: installation.tenantKey,
        welcomeSent: Boolean(client)
      }));
    }
  });
}

export async function consumeLarkMessageEvents(options: {
  dbPath?: string;
  workspaceId?: string;
  appId: string;
  appSecret?: string;
  tenantKey?: string;
  eventKey?: string;
  larkCliPath?: string;
  client?: LarkBotEventClient;
}): Promise<void> {
  if (!options.appSecret && !options.client) throw new Error("Lark app secret is required when no Lark event client is provided.");
  const client = options.client ?? createLarkBotClient({ appId: options.appId, appSecret: options.appSecret! });
  const repositories = options.dbPath && options.workspaceId ? createRepositories(openPodcastNoteDb(options.dbPath)) : undefined;
  const eventKey = options.eventKey ?? "im.message.receive_v1";
  const context: LarkMessageEventContext = {
    repositories,
    workspaceId: options.workspaceId,
    appId: options.appId,
    tenantKey: options.tenantKey,
    client,
    eventKey
  };
  if (!options.larkCliPath && process.env["PODCAST_NOTE_LARK_EVENT_TRANSPORT"] !== "lark-cli") {
    await consumeLarkMessageEventsWithSdk({
      appId: options.appId,
      appSecret: options.appSecret!,
      context
    });
    return;
  }
  await consumeLarkEvent({
    eventKey,
    larkCliPath: options.larkCliPath,
    onLine: async (line) => {
      const event = JSON.parse(line) as LarkMessageReceivedEvent;
      await handleLarkMessageReceivedEvent({ context, event });
    }
  });
}

async function consumeLarkMessageEventsWithSdk(options: {
  appId: string;
  appSecret: string;
  context: LarkMessageEventContext;
}): Promise<void> {
  let Lark: any;
  try {
    Lark = await import("@larksuiteoapi/node-sdk");
  } catch (error) {
    throw new Error(`Missing @larksuiteoapi/node-sdk. Run "bun install" before starting Lark WebSocket events. ${error instanceof Error ? error.message : String(error)}`);
  }
  let ready = false;
  const wsClient = new Lark.WSClient({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel: process.env["PODCAST_NOTE_LARK_WS_DEBUG"] === "1" ? Lark.LoggerLevel?.debug : Lark.LoggerLevel?.info,
    onReady: () => {
      ready = true;
      console.error(`[event] ready event_key=${options.context.eventKey} transport=sdk-ws`);
      writeLarkEventStatus({
        state: "ready",
        eventKey: options.context.eventKey,
        transport: "sdk-ws",
        readyAt: new Date().toISOString()
      });
    },
    onError: (error: unknown) => {
      console.error(`[event] sdk-ws error: ${error instanceof Error ? error.message : String(error)}`);
      writeLarkEventStatus({
        state: ready ? "error_after_ready" : "error",
        eventKey: options.context.eventKey,
        transport: "sdk-ws",
        lastErrorAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : String(error)
      });
      if (!ready) process.exitCode = 1;
    },
    onReconnecting: () => {
      console.error(`[event] sdk-ws reconnecting event_key=${options.context.eventKey}`);
    },
    onReconnected: () => {
      console.error(`[event] ready event_key=${options.context.eventKey} transport=sdk-ws reconnect=true`);
    }
  });
  const eventDispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data: any) => {
      console.error(`[event] received event_key=${options.context.eventKey} transport=sdk-ws`);
      console.error(`[event] raw_keys=${Object.keys(data ?? {}).join(",")}`);
      const event = larkMessageEventFromSdk(data);
      writeLarkEventStatus({
        state: "received",
        eventKey: options.context.eventKey,
        transport: "sdk-ws",
        lastEventAt: new Date().toISOString(),
        lastRawKeys: Object.keys(data ?? {}),
        lastChatId: event.chat_id,
        lastChatType: event.chat_type,
        lastContent: event.content
      });
      await handleLarkMessageReceivedEvent({
        context: options.context,
        event
      });
    }
  });
  installRawLarkEventProbe({
    eventDispatcher,
    context: options.context
  });
  console.error(`[event] starting event_key=${options.context.eventKey} transport=sdk-ws`);
  await wsClient.start({ eventDispatcher });
  const keepAlive = setInterval(() => {
    if (process.exitCode) clearInterval(keepAlive);
  }, 60 * 60 * 1000);
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      clearInterval(keepAlive);
      wsClient.close?.({});
      resolve();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  });
}

function writeLarkEventStatus(status: Record<string, unknown>) {
  try {
    const statusPath = process.env["PODCAST_NOTE_LARK_EVENT_STATUS_PATH"] || defaultLarkEventStatusPath;
    mkdirSync(dirname(statusPath), { recursive: true });
    writeFileSync(statusPath, JSON.stringify({
      updatedAt: new Date().toISOString(),
      ...status
    }, null, 2));
  } catch (error) {
    console.error(`[event] failed to write status: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function deliverPendingAfterBind(input: {
  context: LarkMessageEventContext;
  chatId: string;
}) {
  if (!input.context.repositories || !input.context.workspaceId) return;
  const result = await deliverPendingLarkEpisodeResults({
    repositories: input.context.repositories,
    client: input.context.client,
    workspaceId: input.context.workspaceId,
    chatId: input.chatId,
    limit: Number(process.env["LARK_BIND_DELIVER_PENDING_LIMIT"] ?? process.env["FEISHU_BIND_DELIVER_PENDING_LIMIT"] ?? 20)
  });
  console.log(JSON.stringify({
    ok: true,
    message: "Delivered pending Lark episode results after bind",
    chatId: input.chatId,
    ...result
  }));
}

function installRawLarkEventProbe(input: {
  eventDispatcher: any;
  context: LarkMessageEventContext;
}) {
  const originalInvoke = input.eventDispatcher.invoke?.bind(input.eventDispatcher);
  if (!originalInvoke) return;
  input.eventDispatcher.invoke = async (raw: any, params: any) => {
    const eventType = larkRawEventType(raw);
    console.error(`[event] raw_event type=${eventType ?? "unknown"} keys=${Object.keys(raw ?? {}).join(",")}`);
    writeLarkEventStatus({
      state: "raw_received",
      eventKey: input.context.eventKey,
      transport: "sdk-ws",
      lastEventAt: new Date().toISOString(),
      lastRawEventType: eventType,
      lastRawKeys: Object.keys(raw ?? {})
    });
    const result = await originalInvoke(raw, params);
    if (eventType && eventType !== "im.message.receive_v1" && eventType.includes("message")) {
      const event = larkMessageEventFromSdk(raw);
      if (event.chat_id && event.chat_type) {
        console.error(`[event] fallback_message_parse type=${eventType} chat_id=${event.chat_id} chat_type=${event.chat_type}`);
        await handleLarkMessageReceivedEvent({ context: input.context, event });
      }
    }
    return result;
  };
}

export function larkRawEventType(raw: any): string | undefined {
  return raw?.header?.event_type
    ?? raw?.event?.type
    ?? raw?.type
    ?? raw?.schema;
}

export function larkMessageEventFromSdk(data: any): LarkMessageReceivedEvent {
  const event = data?.event ?? data;
  const message = event?.message ?? data?.message ?? event ?? {};
  const sender = event?.sender ?? data?.sender ?? {};
  return {
    chat_id: message.chat_id ?? event?.chat_id,
    chat_type: message.chat_type ?? event?.chat_type,
    content: larkTextContentFromSdk(message.content ?? event?.content),
    message_type: message.message_type ?? event?.message_type,
    sender_id: sender.sender_id?.open_id ?? sender.sender_id?.user_id ?? sender.sender_id?.union_id
      ?? event?.sender_id?.open_id ?? event?.sender_id?.user_id ?? event?.sender_id?.union_id
      ?? event?.sender_id
  };
}

function larkTextContentFromSdk(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed?.text === "string") return parsed.text;
  } catch {
    return content;
  }
  return content;
}

export async function consumeLarkBotInteractionEvents(options: {
  dbPath: string;
  workspaceId: string;
  appId: string;
  appSecret: string;
  larkCliPath?: string;
}): Promise<void> {
  await Promise.all([
    consumeLarkBotAddedEvents({
      dbPath: options.dbPath,
      workspaceId: options.workspaceId,
      appId: options.appId,
      appSecret: options.appSecret,
      eventKey: "im.chat.member.bot.added_v1",
      larkCliPath: options.larkCliPath
    }),
    consumeLarkMessageEvents({
      dbPath: options.dbPath,
      workspaceId: options.workspaceId,
      appId: options.appId,
      appSecret: options.appSecret,
      tenantKey: "tenant_personal",
      eventKey: "im.message.receive_v1",
      larkCliPath: options.larkCliPath
    })
  ]);
}

async function consumeLarkEvent(options: {
  eventKey: string;
  larkCliPath?: string;
  onLine: (line: string) => Promise<void>;
}): Promise<void> {
  const child = spawn(options.larkCliPath ?? "lark-cli", ["event", "consume", options.eventKey, "--as", "bot"], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdin?.write("\n");

  let stdoutBuffer = "";
  let lineQueue = Promise.resolve();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      lineQueue = lineQueue.then(() => options.onLine(trimmed)).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
      });
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    process.stderr.write(chunk);
  });

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`lark-cli event consumer exited with code ${code}`));
    });
  });
  await lineQueue;
}

function timestampToIso(timestampMs: string | undefined): string | undefined {
  if (!timestampMs) return undefined;
  const numeric = Number(timestampMs);
  if (!Number.isFinite(numeric)) return undefined;
  return new Date(numeric).toISOString();
}
