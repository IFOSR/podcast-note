import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCodexInsightProvider, createVolcengineTranscriptProvider } from "../../../packages/ai/src/index.ts";
import { connectorFor } from "../../../packages/connectors/src/index.ts";
import type { Episode } from "../../../packages/core/src/types.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { processSources } from "./process-sources.ts";
import { runM1Once } from "./m1-run-once.ts";
import { consumeLarkBotAddedEvents, consumeLarkMessageEvents } from "./lark-bot-events.ts";
import { createLarkBotClient, recordLarkBotInstalled } from "../../../packages/lark/src/index.ts";
import { deliverPendingLarkEpisodeResultsToAllInstallations } from "./lark-delivery.ts";

const command = process.argv[2] ?? "help";

if (command === "demo") {
  fail("The demo command is disabled because runtime commands must not use mock providers. Use process-sources, transcribe-url, or m1:run-once with real provider credentials.");
} else if (command === "process-transcript") {
  fail("process-transcript is disabled because it reads local transcript fixtures. Use transcribe-url or process-sources so ASR runs through the real Volcengine provider.");
} else if (command === "transcribe-url") {
  const inputUrl = process.argv[3];
  if (!inputUrl) {
    fail("Usage: bun apps/worker/src/cli.ts transcribe-url <public-audio-or-episode-url>");
  }
  const provider = volcengineTranscriptProviderOrFail();
  try {
    const episode = await episodeFromUrl(inputUrl);
    if (!episode.audioUrl) {
      fail(`No public audio URL could be resolved from ${inputUrl}. Provide a direct .mp3/.wav/.ogg/.raw URL.`);
    }
    const result = await provider.transcribe({
      episode,
      audioUrl: episode.audioUrl
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "resolve-audio-url") {
  const inputUrl = process.argv[3];
  if (!inputUrl) {
    fail("Usage: bun apps/worker/src/cli.ts resolve-audio-url <public-audio-or-episode-url>");
  }
  try {
    const episode = await episodeFromUrl(inputUrl);
    console.log(JSON.stringify(episode, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "query") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const entity = process.argv[3] ?? "help";
    const repos = createRepositories(openPodcastNoteDb(dbPath));
    const limit = numberFlagValue("--limit") ?? 20;
    const format = flagValue("--format") ?? "table";
    let rows: unknown;

    if (entity === "episodes") {
      rows = repos.listProcessedEpisodes({ limit });
    } else if (entity === "runs") {
      rows = repos.listProcessingRuns({ limit });
    } else if (entity === "insights") {
      rows = repos.listInsights({
        watchId: flagValue("--watch-id"),
        episodeId: flagValue("--episode-id"),
        limit
      });
    } else {
      fail("Usage: bun apps/worker/src/cli.ts query <episodes|runs|insights> [--db storage/podcast-note.sqlite] [--limit 20] [--format json] [--watch-id id] [--episode-id id]");
    }

    printRows(rows, format);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "export") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const entity = process.argv[3] ?? "help";
    const repos = createRepositories(openPodcastNoteDb(dbPath));
    const limit = numberFlagValue("--limit") ?? 100;
    const outputPath = flagValue("--output");
    let rows: unknown;

    if (entity === "episodes") {
      rows = repos.listProcessedEpisodes({ limit });
    } else if (entity === "runs") {
      rows = repos.listProcessingRuns({ limit });
    } else if (entity === "insights") {
      rows = repos.listInsights({
        watchId: flagValue("--watch-id"),
        episodeId: flagValue("--episode-id"),
        limit
      });
    } else {
      fail("Usage: bun apps/worker/src/cli.ts export <episodes|runs|insights> [--db storage/podcast-note.sqlite] [--limit 100] [--output export.json] [--watch-id id] [--episode-id id]");
    }

    const json = `${JSON.stringify(rows, null, 2)}\n`;
    if (outputPath) {
      await writeFile(resolve(outputPath), json, "utf8");
      console.log(`Exported ${Array.isArray(rows) ? rows.length : 0} ${entity} row(s) to ${outputPath}.`);
    } else {
      console.log(json);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "process-sources") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const db = openPodcastNoteDb(dbPath);
    const results = await processSources({
      options: readProcessSourcesOptions(),
      transcriptProvider: volcengineTranscriptProviderOrFail(),
      insightProvider: codexInsightProviderOrFail(),
      repositories: createRepositories(db)
    });
    console.log(
      [
        `Processed ${results.length} episode${results.length === 1 ? "" : "s"}.`,
        `SQLite: ${dbPath}`,
        ...results.map((result) => `- ${result.episodeTitle}: ${result.outputDir}`)
      ].join("\n")
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "m1:run-once") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const result = await runM1Once({
      repositories: createRepositories(openPodcastNoteDb(dbPath)),
      workspaceId: flagValue("--workspace-id"),
      now: flagValue("--now"),
      transcriptProvider: volcengineTranscriptProviderOrFail(),
      insightProvider: codexInsightProviderOrFail(),
      pollingEpisodeLimit: numberFlagValue("--polling-limit"),
      processingLimit: numberFlagValue("--processing-limit")
    });
    console.log(JSON.stringify({ ok: true, dbPath, ...result }, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "lark:events") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const workspaceId = flagValue("--workspace-id") ?? process.env["PODCAST_NOTE_WORKSPACE_ID"];
    const appId = flagValue("--app-id") ?? process.env["LARK_APP_ID"] ?? process.env["FEISHU_APP_ID"];
    const appSecret = process.env["LARK_APP_SECRET"] ?? process.env["FEISHU_APP_SECRET"];
    if (!workspaceId) fail("Usage: bun apps/worker/src/cli.ts lark:events --workspace-id <workspace_id> [--db storage/podcast-note.sqlite]");
    if (!appId) fail("Missing LARK_APP_ID or FEISHU_APP_ID.");
    if (!appSecret) fail("Missing LARK_APP_SECRET or FEISHU_APP_SECRET.");
    const eventKey = flagValue("--event-key");
    if (eventKey === "im.chat.member.bot.added_v1") {
      await consumeLarkBotAddedEvents({
        dbPath,
        workspaceId,
        appId,
        appSecret,
        eventKey
      });
      process.exit(0);
    }
    await consumeLarkMessageEvents({
      dbPath,
      workspaceId,
      appId,
      appSecret,
      tenantKey: "tenant_personal",
      eventKey: eventKey ?? "im.message.receive_v1"
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "lark:deliver-pending") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const workspaceId = flagValue("--workspace-id") ?? process.env["PODCAST_NOTE_WORKSPACE_ID"];
    const appId = flagValue("--app-id") ?? process.env["LARK_APP_ID"] ?? process.env["FEISHU_APP_ID"];
    const appSecret = process.env["LARK_APP_SECRET"] ?? process.env["FEISHU_APP_SECRET"];
    if (!workspaceId) fail("Usage: bun apps/worker/src/cli.ts lark:deliver-pending --workspace-id <workspace_id> [--db storage/podcast-note.sqlite]");
    if (!appId) fail("Missing LARK_APP_ID or FEISHU_APP_ID.");
    if (!appSecret) fail("Missing LARK_APP_SECRET or FEISHU_APP_SECRET.");
    const repositories = createRepositories(openPodcastNoteDb(dbPath));
    const installations = repositories.listActiveLarkBotInstallationsForWorkspace(workspaceId, appId);
    if (installations.length === 0) fail(`No active Lark bot installation found for workspace ${workspaceId}.`);
    const result = await deliverPendingLarkEpisodeResultsToAllInstallations({
      repositories,
      clientFactory: () => createLarkBotClient({ appId, appSecret }),
      workspaceId,
      appId,
      limit: numberFlagValue("--limit") ?? 50
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "lark:bind-chat") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const workspaceId = flagValue("--workspace-id") ?? process.env["PODCAST_NOTE_WORKSPACE_ID"];
    const appId = flagValue("--app-id") ?? process.env["LARK_APP_ID"] ?? process.env["FEISHU_APP_ID"];
    const chatId = flagValue("--chat-id");
    const chatName = flagValue("--chat-name") ?? "个人播客助手";
    const tenantKey = flagValue("--tenant-key") ?? "tenant_personal";
    const operatorOpenId = flagValue("--operator-open-id");
    if (!workspaceId) fail("Usage: bun apps/worker/src/cli.ts lark:bind-chat --workspace-id <workspace_id> --chat-id <oc_chat_id> [--db storage/podcast-note.sqlite]");
    if (!appId) fail("Missing LARK_APP_ID or FEISHU_APP_ID.");
    if (!chatId) fail("Missing --chat-id.");
    const repositories = createRepositories(openPodcastNoteDb(dbPath));
    const installation = recordLarkBotInstalled({
      repositories,
      workspaceId,
      appId,
      tenantKey,
      chatId,
      chatName,
      operatorOpenId
    });
    console.log(JSON.stringify({ ok: true, dbPath, installation }, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "lark:ws-check") {
  try {
    const appId = flagValue("--app-id") ?? process.env["LARK_APP_ID"] ?? process.env["FEISHU_APP_ID"];
    const appSecret = process.env["LARK_APP_SECRET"] ?? process.env["FEISHU_APP_SECRET"];
    if (!appId) fail("Missing LARK_APP_ID or FEISHU_APP_ID.");
    if (!appSecret) fail("Missing LARK_APP_SECRET or FEISHU_APP_SECRET.");
    const result = await checkLarkWebSocketEndpoint({ appId, appSecret });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else {
  console.log(
    [
      "Podcast Note worker CLI",
      "",
      "Commands:",
      "  demo  # disabled; mock providers are not allowed in runtime commands",
      "  process-transcript <fixture.json>  # disabled; use real ASR commands instead",
      "  resolve-audio-url <public-audio-or-episode-url>",
      "  transcribe-url <public-audio-or-episode-url>",
      "  query <episodes|runs|insights> [--db storage/podcast-note.sqlite] [--limit 20] [--format json] [--watch-id id] [--episode-id id]",
      "  export <episodes|runs|insights> [--db storage/podcast-note.sqlite] [--limit 100] [--output export.json] [--watch-id id] [--episode-id id]",
      "  process-sources [--watch inputs/watch.json] [--sources inputs/sources.json] [--output outputs] [--db storage/podcast-note.sqlite]",
      "  m1:run-once [--db storage/podcast-note.sqlite] [--workspace-id id] [--now ISO] [--polling-limit 100] [--processing-limit 10]",
      "  lark:events [--db storage/podcast-note.sqlite] --workspace-id id [--event-key im.chat.member.bot.added_v1]",
      "  lark:ws-check",
      "  lark:bind-chat [--db storage/podcast-note.sqlite] --workspace-id id --chat-id oc_xxx",
      "  lark:deliver-pending [--db storage/podcast-note.sqlite] --workspace-id id [--limit 50]"
    ].join("\n")
  );
}

function printRows(rows: unknown, format: string): void {
  if (format === "json") {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (!Array.isArray(rows)) {
    console.log(String(rows));
    return;
  }
  if (rows.length === 0) {
    console.log("No rows.");
    return;
  }
  for (const row of rows as Array<Record<string, unknown>>) {
    const id = String(row["id"] ?? "");
    const title = row["title"] ?? row["claim"] ?? row["status"] ?? "";
    const status = row["status"] ? ` status=${row["status"]}` : "";
    const count = row["episodeCount"] !== undefined ? ` episodes=${row["episodeCount"]}` : "";
    console.log(`- ${id}${status}${count} ${String(title).slice(0, 140)}`.trim());
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function codexInsightProviderOrFail() {
  try {
    return createCodexInsightProvider();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function volcengineTranscriptProviderOrFail() {
  try {
    return createVolcengineTranscriptProvider();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

async function episodeFromUrl(inputUrl: string): Promise<Episode> {
  if (isDirectAudioUrl(inputUrl)) {
    return {
      id: "manual_transcription",
      title: "Manual transcription",
      pageUrl: inputUrl,
      audioUrl: inputUrl
    };
  }

  const resolved = await connectorFor(inputUrl).resolveEpisode(inputUrl);
  return {
    id: "manual_transcription",
    title: resolved.title,
    description: resolved.description,
    publishedAt: resolved.publishedAt,
    durationSec: resolved.durationSec,
    pageUrl: resolved.pageUrl,
    audioUrl: resolved.audioUrl,
    language: resolved.language,
    metadata: resolved.metadata
  };
}

function isDirectAudioUrl(inputUrl: string): boolean {
  try {
    return /\.(mp3|wav|ogg|raw)$/i.test(new URL(inputUrl).pathname);
  } catch {
    return false;
  }
}

function readProcessSourcesOptions() {
  return {
    watchPath: flagValue("--watch") ?? "inputs/watch.json",
    sourcesPath: flagValue("--sources") ?? "inputs/sources.json",
    outputDir: flagValue("--output") ?? "outputs",
    maxEpisodesPerSource: numberFlagValue("--max-episodes") ?? 10
  };
}

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`Missing value for ${name}.`);
  return value;
}

async function checkLarkWebSocketEndpoint(input: { appId: string; appSecret: string }) {
  const response = await fetch("https://open.feishu.cn/callback/ws/endpoint", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "locale": "zh"
    },
    body: JSON.stringify({
      AppID: input.appId,
      AppSecret: input.appSecret
    })
  });
  const json = await response.json() as {
    code?: number;
    msg?: string;
    data?: {
      URL?: string;
      ClientConfig?: unknown;
    };
  };
  const parsed = json.data?.URL ? new URL(json.data.URL) : undefined;
  return {
    ok: response.ok && json.code === 0 && Boolean(parsed),
    status: response.status,
    code: json.code,
    msg: json.msg,
    ws: parsed ? {
      protocol: parsed.protocol,
      host: parsed.host,
      pathname: parsed.pathname,
      queryKeys: [...parsed.searchParams.keys()]
    } : undefined,
    clientConfig: json.data?.ClientConfig
  };
}

function numberFlagValue(name: string): number | undefined {
  const value = flagValue(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`${name} must be a positive integer.`);
  return parsed;
}
