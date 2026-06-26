import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createCommandLineInsightProvider, createCommandLineJsonProvider, createVolcengineTranscriptProvider } from "../../../packages/ai/src/index.ts";
import { connectorFor } from "../../../packages/connectors/src/index.ts";
import type { Episode } from "../../../packages/core/src/types.ts";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { processSources } from "./process-sources.ts";
import { runM1Once } from "./m1-run-once.ts";
import { consumeLarkBotAddedEvents, consumeLarkMessageEvents } from "./lark-bot-events.ts";
import { createLarkBotClient, recordLarkBotInstalled } from "../../../packages/lark/src/index.ts";
import { deliverPendingLarkEpisodeResultsToAllInstallations, deliverPendingWikiProposalSummaryToAllLarkInstallations } from "./lark-delivery.ts";
import { buildSemanticSegments } from "../../../packages/core/src/segmenting.ts";
import {
  applyWikiUpdateProposals,
  compileEpisodeToWiki,
  createDeepSeekTuiWikiProposalProvider,
  lintVault,
  publishMarkdownToLark,
  renderHealthReport,
  updateManagedFile
} from "../../../packages/wiki/src/index.ts";
import { recordAppliedWikiProposalRegistry, recordCompiledWikiRegistry } from "./wiki-registry.ts";
import { buildWikiFeed } from "./wiki-feed.ts";
import { synthesizeWikiProposals } from "./wiki-synthesis.ts";
import { buildWikiDecayProposals } from "./wiki-decay.ts";
import { scanWikiConflictProposals } from "./wiki-conflict.ts";
import { askWiki, askWikiWithLlm } from "./wiki-ask.ts";

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
    } else if (entity === "wiki-exports") {
      rows = repos.listWikiExports({
        workspaceId: flagValue("--workspace-id"),
        episodeId: flagValue("--episode-id"),
        exportType: flagValue("--type") as Parameters<typeof repos.listWikiExports>[0]["exportType"],
        limit
      });
    } else if (entity === "wiki-proposals") {
      rows = repos.listWikiUpdateProposals({
        workspaceId: flagValue("--workspace-id"),
        episodeId: flagValue("--episode-id"),
        status: flagValue("--status") as Parameters<typeof repos.listWikiUpdateProposals>[0]["status"],
        limit
      });
    } else {
      fail("Usage: bun apps/worker/src/cli.ts query <episodes|runs|insights|wiki-exports|wiki-proposals> [--db storage/podcast-note.sqlite] [--limit 20] [--format json]");
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
    } else if (entity === "obsidian") {
      const vaultRoot = flagValue("--vault") ?? process.env["PODCAST_NOTE_OBSIDIAN_VAULT"];
      const workspaceId = flagValue("--workspace-id") ?? process.env["PODCAST_NOTE_WORKSPACE_ID"] ?? "workspace_local";
      if (!vaultRoot) fail("Usage: bun apps/worker/src/cli.ts export obsidian --vault <path> [--workspace-id id] [--db storage/podcast-note.sqlite]");
      rows = await exportProcessedEpisodesToObsidian({
        repositories: repos,
        vaultRoot,
        workspaceId,
        limit,
        autoApply: booleanFlag("--auto-apply") ?? envBoolean("PODCAST_NOTE_WIKI_AUTO_APPLY"),
        wikiProposalProvider: wikiProposalProvider()
      });
    } else if (entity === "wiki-exports") {
      rows = repos.listWikiExports({
        workspaceId: flagValue("--workspace-id"),
        episodeId: flagValue("--episode-id"),
        exportType: flagValue("--type") as Parameters<typeof repos.listWikiExports>[0]["exportType"],
        limit
      });
    } else if (entity === "wiki-proposals") {
      rows = repos.listWikiUpdateProposals({
        workspaceId: flagValue("--workspace-id"),
        episodeId: flagValue("--episode-id"),
        status: flagValue("--status") as Parameters<typeof repos.listWikiUpdateProposals>[0]["status"],
        limit
      });
    } else {
      fail("Usage: bun apps/worker/src/cli.ts export <episodes|runs|insights|obsidian|wiki-exports|wiki-proposals> [--db storage/podcast-note.sqlite] [--limit 100] [--output export.json]");
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
      insightProvider: commandLineInsightProviderOrFail(),
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
} else if (command === "wiki:proposal-status") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const id = process.argv[3];
    const status = process.argv[4] as "pending" | "approved" | "applied" | "rejected" | "failed" | undefined;
    if (!id || !status) fail("Usage: bun apps/worker/src/cli.ts wiki:proposal-status <proposal_id> <pending|approved|applied|rejected|failed> [--db storage/podcast-note.sqlite]");
    const repos = createRepositories(openPodcastNoteDb(dbPath));
    const row = repos.updateWikiUpdateProposalStatus(id, status);
    if (!row) fail(`Proposal not found: ${id}`);
    console.log(JSON.stringify({ ok: true, proposal: row }, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "wiki:apply-proposals") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const vaultRoot = flagValue("--vault") ?? process.env["PODCAST_NOTE_OBSIDIAN_VAULT"];
    const workspaceId = flagValue("--workspace-id") ?? process.env["PODCAST_NOTE_WORKSPACE_ID"] ?? "workspace_local";
    if (!vaultRoot) fail("Usage: bun apps/worker/src/cli.ts wiki:apply-proposals --vault <path> [--workspace-id id] [--status approved|pending]");
    const status = (flagValue("--status") ?? "approved") as Parameters<ReturnType<typeof createRepositories>["listWikiUpdateProposals"]>[0]["status"];
    const repos = createRepositories(openPodcastNoteDb(dbPath));
    const proposals = repos.listWikiUpdateProposals({ workspaceId, status, limit: numberFlagValue("--limit") ?? 100 });
    const applied = await applyWikiUpdateProposals({
      vaultRoot,
      proposals,
      now: flagValue("--now")
    });
    for (const item of applied) {
      repos.updateWikiUpdateProposalStatus(item.proposal.id, item.proposal.status);
      if (item.proposal.status === "applied" && item.contentHash) {
        repos.recordWikiExport({
          workspaceId,
          vaultRoot,
          episodeId: item.proposal.episodeId,
          exportType: "wiki_page",
          filePath: item.path,
          contentHash: item.contentHash,
          status: "written"
        });
        recordAppliedWikiProposalRegistry({
          repositories: repos,
          workspaceId,
          vaultRoot,
          proposal: item.proposal,
          path: item.path,
          contentHash: item.contentHash,
          observedAt: flagValue("--now")
        });
      }
    }
    const issues = await lintVault(vaultRoot);
    await updateManagedFile({
      vaultRoot,
      relativePath: "health.md",
      title: "Wiki Health",
      marker: "health",
      body: renderHealthReport(issues)
    });
    await updateManagedFile({
      vaultRoot,
      relativePath: "log.md",
      title: "Knowledge Log",
      marker: "log",
      body: [
        `## ${flagValue("--now") ?? new Date().toISOString()}`,
        "",
        `- Applied proposals: ${applied.length}`,
        ...applied.map((item) => `- Updated: ${item.path}`)
      ].join("\n")
    });
    console.log(JSON.stringify({
      ok: true,
      applied: applied.map((item) => ({
        proposalId: item.proposal.id,
        path: item.path,
        status: item.proposal.status
      }))
    }, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "wiki:feed") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const workspaceId = flagValue("--workspace-id") ?? process.env["PODCAST_NOTE_WORKSPACE_ID"] ?? "workspace_local";
    const repos = createRepositories(openPodcastNoteDb(dbPath));
    const feed = buildWikiFeed({
      repositories: repos,
      workspaceId,
      vaultRoot: flagValue("--vault"),
      limit: numberFlagValue("--limit") ?? 100
    });
    console.log(JSON.stringify(feed, null, flagValue("--format") === "json" ? 2 : 0));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "wiki:ask") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const workspaceId = flagValue("--workspace-id") ?? process.env["PODCAST_NOTE_WORKSPACE_ID"] ?? "workspace_local";
    const question = decodeCliText(flagValue("--question") ?? process.argv[3] ?? "");
    if (!question) fail("Usage: bun apps/worker/src/cli.ts wiki:ask --question <question> [--workspace-id id] [--vault path]");
    const repos = createRepositories(openPodcastNoteDb(dbPath));
    const result = hasFlag("--llm")
      ? await askWikiWithLlm({
        repositories: repos,
        workspaceId,
        vaultRoot: flagValue("--vault"),
        question,
        llm: createCommandLineJsonProvider({}, "wiki"),
        candidateLimit: numberFlagValue("--limit") ?? 20,
        citationLimit: 5
      })
      : askWiki({
        repositories: repos,
        workspaceId,
        vaultRoot: flagValue("--vault"),
        question,
        limit: numberFlagValue("--limit") ?? 5
      });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "wiki:synthesize") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const workspaceId = flagValue("--workspace-id") ?? process.env["PODCAST_NOTE_WORKSPACE_ID"] ?? "workspace_local";
    const vaultRoot = flagValue("--vault") ?? process.env["PODCAST_NOTE_OBSIDIAN_VAULT"];
    if (!vaultRoot) fail("Usage: bun apps/worker/src/cli.ts wiki:synthesize --vault <path> [--workspace-id id] [--since-days 7]");
    const repos = createRepositories(openPodcastNoteDb(dbPath));
    const proposals = synthesizeWikiProposals({
      repositories: repos,
      workspaceId,
      vaultRoot,
      now: flagValue("--now"),
      limit: numberFlagValue("--limit") ?? 100
    });
    for (const proposal of proposals) {
      repos.upsertWikiUpdateProposal({
        id: proposal.id,
        workspaceId: proposal.workspaceId,
        episodeId: proposal.episodeId,
        insightId: proposal.insightId,
        targetPath: proposal.targetPath,
        proposalType: proposal.proposalType,
        title: proposal.title,
        rationale: proposal.rationale,
        patch: proposal.patch as unknown as Record<string, unknown>,
        status: proposal.status
      });
    }
    console.log(JSON.stringify({ ok: true, proposalCount: proposals.length, proposals }, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "wiki:decay") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const workspaceId = flagValue("--workspace-id") ?? process.env["PODCAST_NOTE_WORKSPACE_ID"] ?? "workspace_local";
    const vaultRoot = flagValue("--vault") ?? process.env["PODCAST_NOTE_OBSIDIAN_VAULT"];
    if (!vaultRoot) fail("Usage: bun apps/worker/src/cli.ts wiki:decay --vault <path> [--workspace-id id] [--stale-days 90]");
    const repos = createRepositories(openPodcastNoteDb(dbPath));
    const proposals = buildWikiDecayProposals({
      repositories: repos,
      workspaceId,
      vaultRoot,
      now: flagValue("--now"),
      staleDays: numberFlagValue("--stale-days") ?? 90,
      limit: numberFlagValue("--limit") ?? 200
    });
    for (const proposal of proposals) {
      repos.upsertWikiUpdateProposal({
        id: proposal.id,
        workspaceId: proposal.workspaceId,
        episodeId: proposal.episodeId,
        insightId: proposal.insightId,
        targetPath: proposal.targetPath,
        proposalType: proposal.proposalType,
        title: proposal.title,
        rationale: proposal.rationale,
        patch: proposal.patch as unknown as Record<string, unknown>,
        status: proposal.status
      });
    }
    console.log(JSON.stringify({ ok: true, proposalCount: proposals.length, proposals }, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "wiki:conflict") {
  try {
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const workspaceId = flagValue("--workspace-id") ?? process.env["PODCAST_NOTE_WORKSPACE_ID"] ?? "workspace_local";
    const vaultRoot = flagValue("--vault") ?? process.env["PODCAST_NOTE_OBSIDIAN_VAULT"];
    if (!vaultRoot) fail("Usage: bun apps/worker/src/cli.ts wiki:conflict --vault <path> [--workspace-id id]");
    const repos = createRepositories(openPodcastNoteDb(dbPath));
    const proposals = scanWikiConflictProposals({
      repositories: repos,
      workspaceId,
      vaultRoot,
      now: flagValue("--now"),
      limit: numberFlagValue("--limit") ?? 200
    });
    for (const proposal of proposals) {
      repos.upsertWikiUpdateProposal({
        id: proposal.id,
        workspaceId: proposal.workspaceId,
        episodeId: proposal.episodeId,
        insightId: proposal.insightId,
        targetPath: proposal.targetPath,
        proposalType: proposal.proposalType,
        title: proposal.title,
        rationale: proposal.rationale,
        patch: proposal.patch as unknown as Record<string, unknown>,
        status: proposal.status
      });
    }
    console.log(JSON.stringify({ ok: true, proposalCount: proposals.length, proposals }, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "wiki:brief") {
  try {
    const vaultRoot = flagValue("--vault") ?? process.env["PODCAST_NOTE_OBSIDIAN_VAULT"];
    if (!vaultRoot) fail("Usage: bun apps/worker/src/cli.ts wiki:brief --vault <path> [--topic title] [--period weekly|topic]");
    const topic = decodeCliText(flagValue("--topic") ?? "PodcastNote Brief");
    const period = flagValue("--period") ?? "weekly";
    const date = (flagValue("--date") ?? new Date().toISOString()).slice(0, 10);
    const relativePath = period === "topic"
      ? `50 Briefs/Topic/${date} - ${topic}.md`
      : `50 Briefs/Weekly/${date} - ${topic}.md`;
    const health = await readOptional(resolve(vaultRoot, "health.md"));
    const log = await readOptional(resolve(vaultRoot, "log.md"));
    const body = [
      `BriefType:: ${period}`,
      `Topic:: ${topic}`,
      `Date:: ${date}`,
      "",
      "## 本期知识变化",
      "",
      extractRecentBullets(log ?? ""),
      "",
      "## Health",
      "",
      extractHealthSummary(health ?? ""),
      "",
      "## 来源与时间戳",
      "",
      "- 详见 Obsidian vault 的 `10 Sources/Podcasts` source notes 和 synthesis 页面引用。"
    ].join("\n");
    const write = await updateManagedFile({
      vaultRoot,
      relativePath,
      title: topic,
      marker: "brief",
      body
    });
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"];
    if (dbPath) {
      const workspaceId = flagValue("--workspace-id") ?? process.env["PODCAST_NOTE_WORKSPACE_ID"] ?? "workspace_local";
      const repos = createRepositories(openPodcastNoteDb(dbPath));
      repos.recordWikiExport({
        workspaceId,
        vaultRoot,
        exportType: "brief",
        filePath: write.relativePath,
        contentHash: write.contentHash,
        status: write.status
      });
    }
    console.log(JSON.stringify({ ok: true, path: write.relativePath, status: write.status }, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "lark:publish-markdown") {
  try {
    const markdownPath = process.argv[3];
    if (!markdownPath) fail("Usage: bun apps/worker/src/cli.ts lark:publish-markdown <markdown-path> --target <doc-target> [--title title] [--db storage/podcast-note.sqlite]");
    const target = flagValue("--target");
    if (!target) fail("M4 publisher adapter is configured by --target. Use a lark-cli target or a file:// path in smoke tests.");
    const title = flagValue("--title");
    const result = await publishMarkdownToLark({
      markdownPath: resolve(markdownPath),
      title,
      target,
      publisher: {
        publishMarkdown: async (input) => {
          if (input.target?.startsWith("file://")) {
            const output = resolve(input.target.slice("file://".length));
            await writeFile(output, input.markdown, "utf8");
            return { providerDocumentId: output, url: output };
          }
          return publishWithLarkCli({
            target: input.target ?? "create:",
            title: input.title,
            markdownPath: resolve(markdownPath)
          });
        }
      }
    });
    const dbPath = flagValue("--db") ?? process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite";
    const workspaceId = flagValue("--workspace-id") ?? process.env["PODCAST_NOTE_WORKSPACE_ID"] ?? "workspace_local";
    const repos = createRepositories(openPodcastNoteDb(dbPath));
    repos.recordWikiExport({
      workspaceId,
      vaultRoot: target,
      exportType: "lark_doc",
      filePath: result.url ?? result.providerDocumentId,
      contentHash: result.id,
      status: "written"
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
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
      insightProvider: commandLineInsightProviderOrFail(),
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
    const episodeResults = await deliverPendingLarkEpisodeResultsToAllInstallations({
      repositories,
      clientFactory: () => createLarkBotClient({ appId, appSecret }),
      workspaceId,
      appId,
      limit: numberFlagValue("--limit") ?? 50
    });
    const wikiProposalSummary = await deliverPendingWikiProposalSummaryToAllLarkInstallations({
      repositories,
      clientFactory: () => createLarkBotClient({ appId, appSecret }),
      workspaceId,
      appId,
      limit: numberFlagValue("--proposal-limit") ?? 100
    });
    console.log(JSON.stringify({ ok: true, episodeResults, wikiProposalSummary }, null, 2));
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
      "  export <episodes|runs|insights|obsidian|wiki-exports|wiki-proposals> [--db storage/podcast-note.sqlite] [--limit 100] [--output export.json]",
      "  process-sources [--watch inputs/watch.json] [--sources inputs/sources.json] [--output outputs] [--obsidian-vault path] [--wiki-auto-apply] [--db storage/podcast-note.sqlite]",
      "  wiki:proposal-status <proposal_id> <pending|approved|applied|rejected|failed>",
      "  wiki:apply-proposals --vault <path> [--workspace-id id] [--status approved|pending]",
      "  wiki:feed --vault <path> [--workspace-id id]",
      "  wiki:ask --question <question> [--workspace-id id] [--vault path] [--llm]",
      "  wiki:synthesize --vault <path> [--workspace-id id]",
      "  wiki:decay --vault <path> [--workspace-id id] [--stale-days 90]",
      "  wiki:conflict --vault <path> [--workspace-id id]",
      "  wiki:brief --vault <path> [--topic title] [--period weekly|topic]",
      "  lark:publish-markdown <markdown-path> --target <file://path|create:|folder:token|wiki:space|update:doc> [--title title]",
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

function commandLineInsightProviderOrFail() {
  try {
    return createCommandLineInsightProvider();
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
    obsidianVault: flagValue("--obsidian-vault") ?? flagValue("--vault"),
    wikiAutoApply: booleanFlag("--wiki-auto-apply"),
    wikiMinConfidence: decimalFlagValue("--wiki-min-confidence"),
    wikiMinGroundedness: decimalFlagValue("--wiki-min-groundedness"),
    wikiProposalProvider: wikiProposalProviderName(),
    maxEpisodesPerSource: numberFlagValue("--max-episodes") ?? 10
  };
}

function wikiProposalProviderName(): "deepseek-tui" | undefined {
  const provider = flagValue("--wiki-proposal-provider") ?? process.env["PODCAST_NOTE_WIKI_PROPOSAL_PROVIDER"];
  if (!provider) return undefined;
  if (provider === "deepseek-tui") return provider;
  fail(`Unsupported wiki proposal provider: ${provider}. Supported: deepseek-tui.`);
}

function wikiProposalProvider() {
  const provider = wikiProposalProviderName();
  if (provider === "deepseek-tui") return createDeepSeekTuiWikiProposalProvider();
  return undefined;
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

function decimalFlagValue(name: string): number | undefined {
  const value = flagValue(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) fail(`${name} must be a decimal between 0 and 1.`);
  return parsed;
}

function booleanFlag(name: string): boolean | undefined {
  return process.argv.includes(name) ? true : undefined;
}

function envBoolean(name: string): boolean | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  return value === "1" || value.toLowerCase() === "true";
}

function publishWithLarkCli(input: {
  target: string;
  title: string;
  markdownPath: string;
}): { providerDocumentId: string; url?: string } {
  const [mode, rawTarget = ""] = input.target.split(/:(.*)/s);
  const command = mode === "update" ? "+update" : "+create";
  const args = ["docs", command, "--markdown", `@${input.markdownPath}`];
  if (command === "+update") {
    if (!rawTarget) fail("For lark-cli update, use --target update:<doc-token-or-url>.");
    args.push("--doc", rawTarget, "--mode", "overwrite", "--new-title", input.title);
  } else {
    args.push("--title", input.title);
    if (mode === "wiki") {
      if (!rawTarget) fail("For lark-cli wiki create, use --target wiki:<space-id>.");
      args.push("--wiki-space", rawTarget);
    } else if (mode === "folder") {
      if (!rawTarget) fail("For lark-cli folder create, use --target folder:<folder-token>.");
      args.push("--folder-token", rawTarget);
    } else if (mode !== "create" && mode !== "") {
      fail("Unsupported --target. Use file://path, create:, folder:<token>, wiki:<space-id>, or update:<doc>.");
    }
  }
  const result = spawnSync("lark-cli", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    fail(`lark-cli docs ${command} failed: ${result.stderr || result.stdout}`);
  }
  const output = (result.stdout || "").trim();
  const extractedDocumentId = extractLarkDocumentId(output) ?? output.slice(0, 200);
  const providerDocumentId = extractedDocumentId || "lark-cli-doc";
  return {
    providerDocumentId,
    url: extractLarkUrl(output)
  };
}

function extractLarkUrl(output: string): string | undefined {
  return output.match(/https:\/\/[^\s"']+/)?.[0];
}

function extractLarkDocumentId(output: string): string | undefined {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    return String(parsed["document_id"] ?? parsed["doc_token"] ?? parsed["token"] ?? parsed["url"] ?? "") || undefined;
  } catch {
    return output.match(/(?:docx?|token|document_id)["':=\s]+([A-Za-z0-9_-]{8,})/)?.[1];
  }
}

async function exportProcessedEpisodesToObsidian(input: {
  repositories: ReturnType<typeof createRepositories>;
  vaultRoot: string;
  workspaceId: string;
  limit: number;
  autoApply?: boolean;
  wikiProposalProvider?: ReturnType<typeof createDeepSeekTuiWikiProposalProvider>;
}) {
  const details = input.repositories.listProcessedEpisodeDetailsForWorkspace({
    workspaceId: input.workspaceId,
    limit: input.limit
  });
  const rows = [];
  for (const detail of details) {
    const watchId = detail.insights[0]?.watchId;
    if (!watchId || !detail.summary) continue;
    const watch = input.repositories.getWatchForWorkspace(input.workspaceId, watchId);
    if (!watch) continue;
    const compiled = await compileEpisodeToWiki({
      config: {
        vaultRoot: input.vaultRoot,
        autoApply: input.autoApply,
        proposalProvider: input.wikiProposalProvider
      },
      watch,
      result: {
        episode: detail.episode,
        summary: detail.summary,
        segments: buildSemanticSegments(detail.transcript?.segments ?? []),
        insights: detail.insights
      }
    });
    input.repositories.recordWikiExport({
      workspaceId: input.workspaceId,
      vaultRoot: input.vaultRoot,
      episodeId: detail.episode.id,
      watchId,
      exportType: "source_note",
      filePath: compiled.sourceNotePath,
      contentHash: compiled.sourceNoteHash,
      status: compiled.sourceNoteStatus
    });
    for (const proposal of compiled.proposals) {
      input.repositories.upsertWikiUpdateProposal({
        id: proposal.id,
        workspaceId: proposal.workspaceId,
        episodeId: proposal.episodeId,
        insightId: proposal.insightId,
        targetPath: proposal.targetPath,
        proposalType: proposal.proposalType,
        title: proposal.title,
        rationale: proposal.rationale,
        patch: proposal.patch as unknown as Record<string, unknown>,
        status: proposal.status
      });
    }
    recordCompiledWikiRegistry({
      repositories: input.repositories,
      vaultRoot: input.vaultRoot,
      watch,
      result: {
        episode: detail.episode,
        summary: detail.summary,
        segments: buildSemanticSegments(detail.transcript?.segments ?? []),
        insights: detail.insights
      },
      compiled
    });
    rows.push({
      episodeId: detail.episode.id,
      title: detail.episode.title,
      sourceNotePath: compiled.sourceNotePath,
      proposalCount: compiled.proposals.length,
      appliedCount: compiled.appliedPaths.length
    });
  }
  return rows;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function extractRecentBullets(content: string): string {
  const bullets = content.split("\n").filter((line) => line.startsWith("- ")).slice(-12);
  return bullets.length > 0 ? bullets.join("\n") : "- 暂无已记录变更。";
}

function extractHealthSummary(content: string): string {
  const lines = content.split("\n").filter((line) => /^(Score|Errors|Warnings)::/.test(line));
  return lines.length > 0 ? lines.join("\n") : "Score:: unknown";
}

function decodeCliText(value: string): string {
  if (!value.includes("\\u")) return value;
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}
