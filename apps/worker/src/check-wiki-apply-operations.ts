import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-wiki-apply-ops-"));
const dbPath = join(dir, "check.sqlite");
const vaultRoot = join(dir, "vault");

try {
  const repos = createRepositories(openPodcastNoteDb(dbPath));
  const user = repos.upsertUser({ id: "user_wiki_apply_ops", email: "wiki-apply-ops@example.invalid", name: "Wiki Apply Ops" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = {
    id: "watch_wiki_apply_ops",
    workspaceId: workspace.id,
    name: "Apply Ops",
    type: "topic" as const,
    query: "AI Agent",
    outputLanguage: "zh-CN",
    includeTerms: [],
    excludeTerms: [],
    expandedTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily" as const,
    backfillDays: 30,
    enabled: true
  };
  repos.upsertWatch(watch);
  repos.upsertEpisode({
    id: "episode_wiki_apply_ops",
    title: "Apply Ops Evidence",
    pageUrl: "https://example.invalid/apply-ops",
    audioUrl: "https://example.invalid/apply-ops.mp3"
  });
  repos.saveProcessingResult({
    episode: { id: "episode_wiki_apply_ops", title: "Apply Ops Evidence", pageUrl: "https://example.invalid/apply-ops", audioUrl: "https://example.invalid/apply-ops.mp3" },
    summary: { oneLiner: "Apply.", overview: "Apply.", chapters: [], worthListening: { recommendation: "listen_segments", reason: "Apply.", bestSegments: [] }, entities: [] },
    segments: [{ index: 0, startSec: 0, endSec: 60, text: "Apply ops.", textExcerpt: "Apply ops.", title: "Apply", summary: "Apply." }],
    insights: [{
      id: "insight_wiki_apply_ops",
      workspaceId: workspace.id,
      watchId: watch.id,
      episodeId: "episode_wiki_apply_ops",
      segmentIndex: 0,
      claim: "AI Agent 商业化转向企业工作流",
      evidenceExcerpt: "AI Agent 商业化转向企业工作流。",
      timestampStartSec: 0,
      timestampEndSec: 60,
      entities: [],
      relevanceScore: 0.9,
      confidence: 0.88,
      groundednessScore: 0.86,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "check"
    }]
  }, watch, "check");

  mkdirSync(join(vaultRoot, "20 Concepts"), { recursive: true });
  mkdirSync(join(vaultRoot, "40 Claims"), { recursive: true });
  writeFileSync(join(vaultRoot, "20 Concepts", "AI Agent 商业化.md"), [
    "---",
    "type: concept",
    "status: active",
    "---",
    "",
    "# AI Agent 商业化",
    "",
    "<!-- podcast-note:start -->",
    "",
    "## 当前综合判断",
    "",
    "旧综合判断。",
    "",
    "<!-- podcast-note:end -->",
    "",
    "用户手写分析必须保留。"
  ].join("\n"));
  writeFileSync(join(vaultRoot, "40 Claims", "旧结论.md"), [
    "---",
    "type: claim",
    "status: active",
    "freshness_score: 1",
    "---",
    "",
    "# 旧结论",
    "",
    "用户备注。"
  ].join("\n"));
  repos.upsertWikiPage({
    workspaceId: workspace.id,
    vaultRoot,
    path: "20 Concepts/AI Agent 商业化.md",
    pageType: "concept",
    title: "AI Agent 商业化",
    status: "active",
    sourceCount: 1,
    confidenceScore: 0.88,
    freshnessScore: 1
  });
  const claimPage = repos.upsertWikiPage({
    workspaceId: workspace.id,
    vaultRoot,
    path: "40 Claims/旧结论.md",
    pageType: "claim",
    title: "旧结论",
    status: "active",
    sourceCount: 1,
    confidenceScore: 0.5,
    freshnessScore: 1
  });
  repos.upsertWikiPageEvidence({
    workspaceId: workspace.id,
    pageId: claimPage.id,
    insightId: "insight_wiki_apply_ops",
    episodeId: "episode_wiki_apply_ops",
    watchId: watch.id,
    supportType: "supporting",
    claim: "旧结论",
    evidenceExcerpt: "旧结论。",
    observedAt: "2026-01-01T00:00:00.000Z"
  });
  repos.upsertWikiUpdateProposal({
    id: "wiki_prop_apply_replace",
    workspaceId: workspace.id,
    episodeId: "episode_wiki_apply_ops",
    insightId: "insight_wiki_apply_ops",
    targetPath: "20 Concepts/AI Agent 商业化.md",
    proposalType: "refresh_synthesis",
    title: "更新综合判断",
    rationale: "测试 managed section 替换。",
    patch: {
      section: "当前综合判断",
      operation: "replace_managed_section",
      markdown: "新综合判断。\n\n- AI Agent 商业化转向企业工作流 (insight_id: insight_wiki_apply_ops)",
      citations: [{ episodeId: "episode_wiki_apply_ops", insightId: "insight_wiki_apply_ops" }]
    },
    status: "approved"
  });
  repos.upsertWikiUpdateProposal({
    id: "wiki_prop_apply_stale",
    workspaceId: workspace.id,
    episodeId: "episode_wiki_apply_ops",
    insightId: "insight_wiki_apply_ops",
    targetPath: "40 Claims/旧结论.md",
    proposalType: "mark_stale",
    title: "标记衰退：旧结论",
    rationale: "测试 frontmatter 更新。",
    patch: {
      section: "frontmatter",
      operation: "set_frontmatter",
      frontmatter: { status: "stale", freshness_score: 0.4 },
      citations: [{ episodeId: "episode_wiki_apply_ops", insightId: "insight_wiki_apply_ops" }]
    },
    status: "approved"
  });

  await $`bun apps/worker/src/cli.ts wiki:apply-proposals --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --status approved --now 2026-06-26T12:00:00.000Z`;
  const concept = await readFile(join(vaultRoot, "20 Concepts", "AI Agent 商业化.md"), "utf8");
  if (!concept.includes("新综合判断。") || concept.includes("旧综合判断。")) {
    throw new Error(`Expected managed section replacement, got ${concept}`);
  }
  if (!concept.includes("用户手写分析必须保留。")) throw new Error("Managed section replacement lost user content.");
  const claim = await readFile(join(vaultRoot, "40 Claims", "旧结论.md"), "utf8");
  if (!claim.includes("status: stale") || !claim.includes("freshness_score: 0.4")) {
    throw new Error(`Expected frontmatter status/freshness update, got ${claim}`);
  }
  if (!claim.includes("用户备注。")) throw new Error("Frontmatter update lost user content.");
  const updated = repos.getWikiPageByPath({ workspaceId: workspace.id, vaultRoot, path: "40 Claims/旧结论.md" });
  if (!updated || updated.status !== "stale" || updated.freshnessScore !== 0.4) {
    throw new Error(`Expected stale registry state, got ${JSON.stringify(updated)}`);
  }
  if (!existsSync(join(vaultRoot, "health.md"))) throw new Error("Apply proposals should refresh health.md.");

  console.log(JSON.stringify({ ok: true, replaced: true, staleStatus: updated.status }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
