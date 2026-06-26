import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { createRepositories, openPodcastNoteDb } from "../../../packages/db/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "podcast-note-wiki-ask-"));
const dbPath = join(dir, "check.sqlite");
const vaultRoot = join(dir, "vault");

try {
  const repos = createRepositories(openPodcastNoteDb(dbPath));
  const user = repos.upsertUser({ id: "user_wiki_ask", email: "wiki-ask@example.invalid", name: "Wiki Ask" });
  const workspace = repos.ensurePersonalWorkspaceForUser(user.id);
  const watch = {
    id: "watch_wiki_ask",
    workspaceId: workspace.id,
    name: "AI Agent 商业化",
    type: "topic" as const,
    query: "AI Agent 商业化",
    outputLanguage: "zh-CN",
    includeTerms: ["AI Agent"],
    excludeTerms: [],
    expandedTerms: [],
    minRelevanceScore: 0.65,
    frequency: "daily" as const,
    backfillDays: 30,
    enabled: true
  };
  repos.upsertWatch(watch);
  repos.upsertEpisode({
    id: "episode_wiki_ask",
    title: "Agent Workflow Evidence",
    pageUrl: "https://example.invalid/wiki-ask",
    audioUrl: "https://example.invalid/wiki-ask.mp3"
  });
  repos.saveProcessingResult({
    episode: {
      id: "episode_wiki_ask",
      title: "Agent Workflow Evidence",
      pageUrl: "https://example.invalid/wiki-ask",
      audioUrl: "https://example.invalid/wiki-ask.mp3"
    },
    summary: { oneLiner: "Agent.", overview: "Agent.", chapters: [], worthListening: { recommendation: "listen_segments", reason: "Agent.", bestSegments: [] }, entities: [] },
    segments: [{ index: 0, startSec: 120, endSec: 180, text: "AI Agent 商业化转向企业工作流集成。", textExcerpt: "AI Agent 商业化转向企业工作流集成。", title: "Agent", summary: "Agent." }],
    insights: [{
      id: "insight_wiki_ask",
      workspaceId: workspace.id,
      watchId: watch.id,
      episodeId: "episode_wiki_ask",
      segmentIndex: 0,
      claim: "AI Agent 商业化转向企业工作流集成",
      evidenceExcerpt: "嘉宾认为 AI Agent 商业化转向企业工作流集成。",
      reasoning: "多家公司从通用助手转向企业流程。",
      implication: "产品需要更重视集成和权限。",
      timestampStartSec: 120,
      timestampEndSec: 180,
      entities: [],
      relevanceScore: 0.9,
      confidence: 0.9,
      groundednessScore: 0.88,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "check"
    }]
  }, watch, "check");

  const page = repos.upsertWikiPage({
    workspaceId: workspace.id,
    vaultRoot,
    path: "20 Concepts/AI Agent 商业化.md",
    pageType: "concept",
    title: "AI Agent 商业化",
    status: "active",
    sourceCount: 1,
    confidenceScore: 0.9,
    freshnessScore: 1,
    contradictionCount: 1,
    lastSupportedAt: "2026-06-26T00:00:00.000Z"
  });
  repos.upsertWikiPageEvidence({
    workspaceId: workspace.id,
    pageId: page.id,
    insightId: "insight_wiki_ask",
    episodeId: "episode_wiki_ask",
    watchId: watch.id,
    supportType: "supporting",
    claim: "AI Agent 商业化转向企业工作流集成",
    evidenceExcerpt: "嘉宾认为 AI Agent 商业化转向企业工作流集成。",
    timestampStartSec: 120,
    timestampEndSec: 180,
    confidence: 0.9,
    groundednessScore: 0.88,
    observedAt: "2026-06-26T00:00:00.000Z"
  });
  repos.upsertWikiUpdateProposal({
    id: "wiki_prop_ask_conflict",
    workspaceId: workspace.id,
    episodeId: "episode_wiki_ask",
    insightId: "insight_wiki_ask",
    targetPath: "20 Concepts/AI Agent 商业化.md",
    proposalType: "flag_conflict",
    title: "发现冲突：AI Agent 商业化",
    rationale: "存在反证。",
    patch: {
      section: "冲突与反证",
      operation: "append",
      markdown: "- 反证",
      citations: [{ episodeId: "episode_wiki_ask", insightId: "insight_wiki_ask" }]
    },
    status: "pending"
  });

  const output = await $`bun apps/worker/src/cli.ts wiki:ask --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --question "AI Agent 商业化有什么结论？"`.text();
  const parsed = JSON.parse(output) as {
    ok: boolean;
    insufficient: boolean;
    hasConflict: boolean;
    answer: string;
    citations: Array<{ wikiPath: string; episodeTitle: string; episodeUrl?: string; insightId: string; timestamp?: string }>;
  };
  if (!parsed.ok || parsed.insufficient) throw new Error(`Expected sufficient wiki answer, got ${output}`);
  if (!parsed.hasConflict || !parsed.answer.includes("冲突观点")) throw new Error(`Ask Wiki must disclose conflicts, got ${parsed.answer}`);
  if (parsed.citations.length < 1) throw new Error(`Expected citations, got ${output}`);
  const citation = parsed.citations[0];
  if (citation?.wikiPath !== "20 Concepts/AI Agent 商业化.md") throw new Error(`Expected wiki path citation, got ${JSON.stringify(citation)}`);
  if (citation?.episodeTitle !== "Agent Workflow Evidence" || citation.episodeUrl !== "https://example.invalid/wiki-ask") {
    throw new Error(`Expected episode source citation, got ${JSON.stringify(citation)}`);
  }
  if (citation?.timestamp !== "2:00-3:00" || citation.insightId !== "insight_wiki_ask") {
    throw new Error(`Expected timestamp and insight citation, got ${JSON.stringify(citation)}`);
  }

  const emptyOutput = await $`bun apps/worker/src/cli.ts wiki:ask --db ${dbPath} --workspace-id ${workspace.id} --vault ${vaultRoot} --question "量子烹饪有什么结论？"`.text();
  const empty = JSON.parse(emptyOutput) as { insufficient: boolean; answer: string; citations: unknown[] };
  if (!empty.insufficient || empty.citations.length !== 0 || !empty.answer.includes("知识库证据不足")) {
    throw new Error(`Expected explicit insufficient answer, got ${emptyOutput}`);
  }

  console.log(JSON.stringify({
    ok: true,
    citationCount: parsed.citations.length,
    hasConflict: parsed.hasConflict,
    insufficientFallback: empty.insufficient
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
