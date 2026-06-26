import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";
import { compileEpisodeToWiki } from "../../../packages/wiki/src/index.ts";
import type { Episode, EpisodeProcessingResult, Watch } from "../../../packages/core/src/types.ts";
import { recordCompiledWikiRegistry } from "./wiki-registry.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-wiki-registry-"));

try {
  const db = openPodcastNoteDb(join(dir, "check.sqlite"));
  const repos = createRepositories(db);
  const user = repos.upsertUser({ id: "user_wiki_registry", email: "wiki-registry@example.invalid", name: "Wiki Registry" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const vaultRoot = join(dir, "vault");

  const watch: Watch = {
    id: "watch_wiki_registry",
    workspaceId: workspace.id,
    name: "AI Agent 商业化",
    type: "topic",
    query: "AI Agent 商业化",
    outputLanguage: "zh-CN",
    includeTerms: ["AI Agent"],
    excludeTerms: [],
    expandedTerms: ["workflow"],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30,
    enabled: true
  };
  const episode: Episode = {
    id: "episode_wiki_registry",
    title: "AI Agent Workflow",
    publishedAt: "2026-06-20T00:00:00.000Z",
    durationSec: 600,
    pageUrl: "https://example.invalid/wiki-registry",
    audioUrl: "https://example.invalid/wiki-registry.mp3"
  };
  const result: EpisodeProcessingResult = {
    episode,
    summary: {
      oneLiner: "AI Agent 商业化转向企业工作流。",
      overview: "企业客户需要审计和可控执行。",
      chapters: [{ title: "Workflow", startSec: 0, endSec: 120, summary: "工作流集成。" }],
      worthListening: {
        recommendation: "listen_segments",
        reason: "有明确证据。",
        bestSegments: [{ startSec: 0, endSec: 120, reason: "核心观点。" }]
      },
      entities: [{ name: "OpenAI", type: "company", mentions: 1 }]
    },
    segments: [{
      index: 0,
      startSec: 0,
      endSec: 120,
      text: "AI Agent 产品竞争转向企业工作流集成。",
      textExcerpt: "AI Agent 产品竞争转向企业工作流集成。",
      title: "Workflow",
      summary: "工作流集成。"
    }],
    insights: [{
      id: "insight_wiki_registry",
      workspaceId: workspace.id,
      watchId: watch.id,
      episodeId: episode.id,
      segmentIndex: 0,
      claim: "AI Agent 产品竞争转向企业工作流集成",
      evidenceExcerpt: "AI Agent 产品竞争转向企业工作流集成。",
      reasoning: "直接陈述。",
      implication: "企业工作流成为竞争焦点。",
      timestampStartSec: 0,
      timestampEndSec: 120,
      entities: [{ name: "OpenAI", type: "company" }],
      relevanceScore: 0.93,
      confidence: 0.91,
      groundednessScore: 0.9,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "check"
    }]
  };

  repos.upsertWatch(watch);
  repos.upsertEpisode(episode);
  repos.saveProcessingResult(result, watch, "check");

  const compiled = await compileEpisodeToWiki({
    config: { vaultRoot, autoApply: true, now: "2026-06-20T12:00:00.000Z" },
    result,
    watch,
    summaryModel: "check"
  });

  repos.recordWikiExport({
    workspaceId: workspace.id,
    vaultRoot,
    episodeId: episode.id,
    watchId: watch.id,
    exportType: "source_note",
    filePath: compiled.sourceNotePath,
    contentHash: compiled.sourceNoteHash,
    status: compiled.sourceNoteStatus
  });
  for (const proposal of compiled.proposals) {
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
  recordCompiledWikiRegistry({
    repositories: repos,
    vaultRoot,
    watch,
    result,
    compiled,
    observedAt: "2026-06-20T12:00:00.000Z"
  });

  const pages = repos.listWikiPages({ workspaceId: workspace.id, vaultRoot });
  const evidence = repos.listWikiPageEvidence({ workspaceId: workspace.id });
  const claimPage = pages.find((page) => page.pageType === "claim");
  if (!claimPage) throw new Error(`Expected at least one claim page, got ${JSON.stringify(pages)}.`);
  if (claimPage.status !== "active" || claimPage.freshnessScore !== 1) {
    throw new Error(`Expected active fresh claim page, got ${JSON.stringify(claimPage)}.`);
  }
  if (!evidence.some((item) => item.pageId === claimPage.id && item.insightId === "insight_wiki_registry" && item.supportType === "supporting")) {
    throw new Error(`Expected supporting evidence for claim page, got ${JSON.stringify(evidence)}.`);
  }
  if (!pages.some((page) => page.pageType === "concept") || !pages.some((page) => page.pageType === "entity")) {
    throw new Error(`Expected concept and entity pages in registry, got ${JSON.stringify(pages)}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    pageCount: pages.length,
    evidenceCount: evidence.length,
    claimPage: claimPage.path
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
