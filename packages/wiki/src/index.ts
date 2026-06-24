import { join } from "node:path";
import type { Watch } from "../../core/src/types.ts";
import type { WikiCompileResult, WikiVaultConfig } from "./types.ts";
import { writeEpisodeSourceNote } from "./vault.ts";
import { applySafeProposals, buildWikiUpdateProposals, writePendingInbox } from "./proposal.ts";
import { renderHealthReport, lintVault } from "./lint.ts";
import { renderIndex, renderLogEntry } from "./render-index.ts";
import { updateManagedFile } from "./vault.ts";
import type { EpisodeProcessingResult } from "../../core/src/types.ts";

export async function compileEpisodeToWiki(input: {
  config: WikiVaultConfig;
  result: EpisodeProcessingResult;
  watch: Watch;
  transcriptProvider?: string;
  summaryModel?: string;
}): Promise<WikiCompileResult> {
  const now = input.config.now ?? new Date().toISOString();
  const source = await writeEpisodeSourceNote(input);
  const proposals = input.config.proposalProvider
    ? await input.config.proposalProvider.generateProposals({
      result: input.result,
      watch: input.watch,
      config: {
        vaultRoot: input.config.vaultRoot,
        autoApply: input.config.autoApply,
        minConfidence: input.config.minConfidence,
        minGroundedness: input.config.minGroundedness,
        now
      }
    })
    : buildWikiUpdateProposals({
      result: input.result,
      watch: input.watch,
      config: input.config
    });
  await writePendingInbox({
    vaultRoot: input.config.vaultRoot,
    proposals,
    now
  });
  const applied = input.config.autoApply
    ? await applySafeProposals({
      vaultRoot: input.config.vaultRoot,
      result: input.result,
      watch: input.watch,
      proposals,
      now
    })
    : [];
  const appliedPaths = applied.map((item) => item.path);
  const appliedHashes = Object.fromEntries(applied.map((item) => [item.path, item.contentHash]));
  const indexBody = renderIndex({
    sourceNotes: [source.relativePath],
    proposals,
    appliedPaths
  });
  await updateManagedFile({
    vaultRoot: input.config.vaultRoot,
    relativePath: "index.md",
    title: "PodcastNote Wiki",
    marker: "index",
    body: indexBody
  });
  const logBody = renderLogEntry({
    now,
    sourceNotePath: source.relativePath,
    proposals,
    appliedPaths
  });
  await updateManagedFile({
    vaultRoot: input.config.vaultRoot,
    relativePath: "log.md",
    title: "Knowledge Log",
    marker: "log",
    body: logBody
  });
  const issues = await lintVault(input.config.vaultRoot);
  await updateManagedFile({
    vaultRoot: input.config.vaultRoot,
    relativePath: "health.md",
    title: "Wiki Health",
    marker: "health",
    body: renderHealthReport(issues)
  });
  return {
    sourceNotePath: source.relativePath,
    sourceNoteHash: source.contentHash,
    sourceNoteStatus: source.status,
    proposals,
    appliedPaths,
    appliedHashes,
    healthPath: join(input.config.vaultRoot, "health.md"),
    logPath: join(input.config.vaultRoot, "log.md")
  };
}

export * from "./types.ts";
export * from "./vault.ts";
export * from "./proposal.ts";
export * from "./deepseek-tui-proposal-provider.ts";
export * from "./lint.ts";
export * from "./publish.ts";
