import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-wiki-archive-"));
const dbPath = join(dir, "check.sqlite");
const vaultRoot = join(dir, "vault");

try {
  const repos = createRepositories(openPodcastNoteDb(dbPath));
  const user = repos.upsertUser({ id: "user_wiki_archive", email: "wiki-archive@example.invalid", name: "Wiki Archive" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  repos.upsertWatch({
    id: "watch_wiki_archive",
    workspaceId: workspace.id,
    name: "Archive Watch",
    type: "topic",
    query: "Archive",
    outputLanguage: "zh-CN",
    includeTerms: [],
    excludeTerms: [],
    expandedTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30,
    enabled: true
  });
  repos.upsertEpisode({
    id: "episode_wiki_archive",
    title: "Archive Evidence",
    pageUrl: "https://example.invalid/wiki-archive",
    audioUrl: "https://example.invalid/wiki-archive.mp3"
  });
  repos.saveProcessingResult({
    episode: { id: "episode_wiki_archive", title: "Archive Evidence", pageUrl: "https://example.invalid/wiki-archive", audioUrl: "https://example.invalid/wiki-archive.mp3" },
    summary: { oneLiner: "Archive.", overview: "Archive.", chapters: [], worthListening: { recommendation: "listen_segments", reason: "Archive.", bestSegments: [] }, entities: [] },
    segments: [{ index: 0, startSec: 0, endSec: 60, text: "应归档旧结论。", textExcerpt: "应归档旧结论。", title: "Archive", summary: "Archive." }],
    insights: [{
      id: "insight_wiki_archive",
      workspaceId: workspace.id,
      watchId: "watch_wiki_archive",
      episodeId: "episode_wiki_archive",
      segmentIndex: 0,
      claim: "应归档旧结论",
      evidenceExcerpt: "应归档旧结论。",
      timestampStartSec: 0,
      timestampEndSec: 60,
      entities: [],
      relevanceScore: 0.8,
      confidence: 0.7,
      groundednessScore: 0.8,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "check"
    }]
  }, {
    id: "watch_wiki_archive",
    workspaceId: workspace.id,
    name: "Archive Watch",
    type: "topic",
    query: "Archive",
    outputLanguage: "zh-CN",
    includeTerms: [],
    excludeTerms: [],
    expandedTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily",
    backfillDays: 30,
    enabled: true
  }, "check");
  mkdirSync(join(vaultRoot, "40 Claims"), { recursive: true });
  writeFileSync(join(vaultRoot, "40 Claims", "应归档旧结论.md"), [
    "---",
    "type: claim",
    "status: deprecated",
    "---",
    "",
    "# 应归档旧结论",
    "",
    "<!-- podcast-note:start -->",
    "## 支持证据",
    "",
    "- old evidence (insight_id: insight_wiki_archive)",
    "<!-- podcast-note:end -->",
    "",
    "用户手写备注必须保留。"
  ].join("\n"), { flag: "w" });
  const page = repos.upsertWikiPage({
    workspaceId: workspace.id,
    vaultRoot,
    path: "40 Claims/应归档旧结论.md",
    pageType: "claim",
    title: "应归档旧结论",
    status: "deprecated",
    sourceCount: 1,
    confidenceScore: 0.2,
    freshnessScore: 0.2,
    contradictionCount: 0,
    lastSupportedAt: "2025-01-01T00:00:00.000Z",
    contentHash: "old_hash"
  });
  repos.upsertWikiPageEvidence({
    workspaceId: workspace.id,
    pageId: page.id,
    insightId: "insight_wiki_archive",
    episodeId: "episode_wiki_archive",
    watchId: "watch_wiki_archive",
    supportType: "supporting",
    claim: "应归档旧结论",
    evidenceExcerpt: "应归档旧结论。",
    observedAt: "2025-01-01T00:00:00.000Z"
  });
  repos.upsertWikiUpdateProposal({
    id: "wiki_prop_archive_apply",
    workspaceId: workspace.id,
    episodeId: "episode_wiki_archive",
    insightId: "insight_wiki_archive",
    targetPath: "40 Claims/应归档旧结论.md",
    proposalType: "archive_page",
    title: "建议归档：应归档旧结论",
    rationale: "长期无新支持。",
    patch: {
      section: "frontmatter",
      operation: "move",
      targetPath: "80 Archive/Claims/应归档旧结论.md",
      frontmatter: { status: "archived" },
      citations: [{ episodeId: "episode_wiki_archive", insightId: "insight_wiki_archive" }]
    },
    status: "approved"
  });

  await $`bun apps/worker/src/cli.ts wiki:apply-proposals --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --status approved --now 2026-06-26T12:00:00.000Z`;
  if (existsSync(join(vaultRoot, "40 Claims", "应归档旧结论.md"))) throw new Error("Expected original claim page to be moved.");
  const archivedPath = join(vaultRoot, "80 Archive", "Claims", "应归档旧结论.md");
  const archived = await readFile(archivedPath, "utf8");
  if (!archived.includes("status: archived")) throw new Error(`Expected archived status frontmatter, got ${archived}`);
  if (!archived.includes("用户手写备注必须保留。")) throw new Error("Archive move lost user-written content.");
  const updatedPage = repos.getWikiPageByPath({ workspaceId: workspace.id, vaultRoot, path: "80 Archive/Claims/应归档旧结论.md" });
  if (!updatedPage || updatedPage.status !== "archived") throw new Error(`Expected archived registry page, got ${JSON.stringify(updatedPage)}`);
  const oldPage = repos.getWikiPageByPath({ workspaceId: workspace.id, vaultRoot, path: "40 Claims/应归档旧结论.md" });
  if (oldPage) throw new Error(`Archive should remove old active registry path, got ${JSON.stringify(oldPage)}`);
  const evidence = repos.listWikiPageEvidence({ workspaceId: workspace.id });
  if (!evidence.some((item) => item.pageId === updatedPage.id && item.insightId === "insight_wiki_archive")) {
    throw new Error(`Archive should preserve evidence registry on archived page, got ${JSON.stringify(evidence)}`);
  }

  console.log(JSON.stringify({ ok: true, archivedPath: "80 Archive/Claims/应归档旧结论.md" }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
