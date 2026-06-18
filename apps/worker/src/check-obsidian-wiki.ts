import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { openPodcastNoteDb, createRepositories } from "../../../packages/db/src/index.ts";
import type { Episode, EpisodeProcessingResult, Watch } from "../../../packages/core/src/types.ts";
import { compileEpisodeToWiki, createDeepSeekTuiWikiProposalProvider } from "../../../packages/wiki/src/index.ts";

const dir = await mkdtemp(join(tmpdir(), "podcast-note-wiki-"));
const vaultRoot = join(dir, "vault");
const dbPath = join(dir, "podcast-note.sqlite");
const db = openPodcastNoteDb(dbPath);
const repos = createRepositories(db);
const user = repos.upsertUser({ id: "user_wiki_smoke", email: "wiki@example.com", name: "Wiki Smoke" });
const workspace = repos.ensurePersonalWorkspaceForUser(user.id);

const watch: Watch = {
  id: "watch_wiki_smoke",
  workspaceId: workspace.id,
  name: "AI Agent 商业化",
  type: "topic",
  query: "AI Agent 商业化",
  outputLanguage: "zh-CN",
  includeTerms: ["AI Agent"],
  excludeTerms: [],
  expandedTerms: ["AI Agent 商业化", "workflow"],
  minRelevanceScore: 0.65,
  frequency: "daily",
  backfillDays: 30,
  enabled: true
};

const episode: Episode = {
  id: "episode_wiki_smoke",
  title: "AI Agent Workflow Commercialization",
  publishedAt: "2026-06-17T00:00:00.000Z",
  durationSec: 1800,
  pageUrl: "https://example.invalid/wiki-smoke",
  audioUrl: "https://example.invalid/wiki-smoke.mp3",
  metadata: {
    podcastTitle: "Wiki Smoke Podcast"
  }
};

const result: EpisodeProcessingResult = {
  episode,
  summary: {
    oneLiner: "AI Agent 商业化正在转向企业工作流集成。",
    overview: "本集讨论了 AI Agent 从单点工具走向企业工作流、审计和半自动执行的路径。",
    chapters: [
      {
        title: "Workflow",
        startSec: 0,
        endSec: 600,
        summary: "讨论企业工作流集成。"
      }
    ],
    worthListening: {
      recommendation: "listen_segments",
      reason: "有明确商业化观点和证据。",
      bestSegments: [{ startSec: 120, endSec: 180, reason: "核心观点。" }]
    },
    entities: [
      { name: "OpenAI", type: "company", mentions: 2 },
      { name: "Claude Code", type: "product", mentions: 1 }
    ]
  },
  segments: [
    {
      index: 0,
      startSec: 120,
      endSec: 180,
      text: "AI Agent 产品竞争会转向企业工作流集成，因为客户需要审计和可控执行。",
      textExcerpt: "AI Agent 产品竞争会转向企业工作流集成。",
      title: "Workflow",
      summary: "企业工作流集成。"
    }
  ],
  insights: [
    {
      id: "insight_wiki_smoke",
      workspaceId: workspace.id,
      watchId: watch.id,
      episodeId: episode.id,
      segmentIndex: 0,
      claim: "AI Agent 产品竞争转向企业工作流集成",
      evidenceExcerpt: "AI Agent 产品竞争会转向企业工作流集成，因为客户需要审计和可控执行。",
      timestampStartSec: 120,
      timestampEndSec: 180,
      entities: [
        { name: "OpenAI", type: "company" },
        { name: "Claude Code", type: "product" }
      ],
      relevanceScore: 0.93,
      confidence: 0.91,
      groundednessScore: 0.9,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "smoke"
    },
    {
      id: "insight_wiki_low_confidence",
      workspaceId: workspace.id,
      watchId: watch.id,
      episodeId: episode.id,
      segmentIndex: 0,
      claim: "低置信 insight 不应进入 DeepSeek TUI wiki proposal",
      evidenceExcerpt: "这条证据故意设置为低置信。",
      timestampStartSec: 120,
      timestampEndSec: 180,
      entities: [],
      relevanceScore: 0.93,
      confidence: 0.3,
      groundednessScore: 0.9,
      outputLanguage: "zh-CN",
      status: "published",
      promptVersion: "watch-insight-v1",
      model: "smoke"
    }
  ]
};

repos.upsertWatch(watch);
repos.upsertEpisode(episode);
repos.saveTranscript({
  episodeId: episode.id,
  provider: "smoke",
  model: "smoke",
  transcript: {
    language: "zh-CN",
    durationSec: 180,
    segments: [{ startSec: 120, endSec: 180, text: result.segments[0].text }]
  }
});
repos.saveProcessingResult(result, watch, "smoke");

const m1m2 = await compileEpisodeToWiki({
  config: {
    vaultRoot,
    autoApply: false,
    now: "2026-06-17T12:00:00.000Z"
  },
  result,
  watch,
  transcriptProvider: "smoke",
  summaryModel: "smoke"
});

if (m1m2.sourceNoteStatus !== "written") throw new Error(`M1 expected source note written, got ${m1m2.sourceNoteStatus}.`);
if (m1m2.proposals.length < 3) throw new Error(`M2 expected at least 3 proposals, got ${m1m2.proposals.length}.`);
const sourceContent = await readFile(join(vaultRoot, m1m2.sourceNotePath), "utf8");
if (!sourceContent.includes("type: podcast_episode")) throw new Error("M1 source note missing frontmatter.");
if (!sourceContent.includes("InsightID:: insight_wiki_smoke")) throw new Error("M1 source note missing insight provenance.");
await writeFile(join(vaultRoot, m1m2.sourceNotePath), `${sourceContent}\nUser private note should not be overwritten.\n`, "utf8");
const conflictCheck = await compileEpisodeToWiki({
  config: {
    vaultRoot,
    autoApply: false,
    now: "2026-06-17T12:05:00.000Z"
  },
  result,
  watch,
  transcriptProvider: "smoke",
  summaryModel: "smoke"
});
if (conflictCheck.sourceNoteStatus !== "failed") throw new Error(`M1 expected edited source note to produce conflict, got ${conflictCheck.sourceNoteStatus}.`);
const editedSourceContent = await readFile(join(vaultRoot, m1m2.sourceNotePath), "utf8");
if (!editedSourceContent.includes("User private note should not be overwritten.")) throw new Error("M1 source note overwrite guard failed.");
const inbox = await readFile(join(vaultRoot, "00 Inbox/2026-06-17 pending-insights.md"), "utf8");
if (!inbox.includes("ProposalID::")) throw new Error("M2 inbox missing proposal details.");

const fakeDeepSeekCommand = join(dir, "fake-deepseek-tui");
await writeFile(fakeDeepSeekCommand, [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "if [[ \"$1\" != \"tui\" || \"$2\" != \"exec\" || \"$3\" != \"--auto\" ]]; then",
  "  echo \"unexpected args: $*\" >&2",
  "  exit 2",
  "fi",
  "if [[ \"$4\" != *\"Do not ask the user to confirm anything\"* ]]; then",
  "  echo \"missing autonomous judgment instruction\" >&2",
  "  exit 3",
  "fi",
  "if [[ \"$4\" == *\"低置信 insight 不应进入 DeepSeek TUI wiki proposal\"* ]]; then",
  "  echo \"low confidence insight leaked into prompt\" >&2",
  "  exit 4",
  "fi",
  "cat <<'JSON'",
  JSON.stringify({
    proposals: [
      {
        insightId: "insight_wiki_smoke",
        targetPath: "40 Claims/DeepSeek Agent Workflow.md",
        proposalType: "create_page",
        title: "形成观点页：DeepSeek Agent Workflow",
        rationale: "DeepSeek TUI non-interactive proposal smoke.",
        patch: {
          section: "支持证据",
          operation: "create",
          markdown: "- 2026-06-17: AI Agent 产品竞争转向企业工作流集成 [[2026-06-17 - AI Agent Workflow Commercialization]] 02:00-03:00 (insight_id: insight_wiki_smoke)",
          citations: [{
            episodeId: "episode_wiki_smoke",
            insightId: "insight_wiki_smoke",
            timestampStartSec: 120,
            timestampEndSec: 180
          }]
        }
      },
      {
        insightId: "insight_wiki_low_confidence",
        targetPath: "40 Claims/Low Confidence Should Be Filtered.md",
        proposalType: "create_page",
        title: "低置信 proposal 应被过滤",
        rationale: "Smoke test should filter this proposal.",
        patch: {
          section: "支持证据",
          operation: "create",
          markdown: "- should not persist",
          citations: [{
            episodeId: "episode_wiki_smoke",
            insightId: "insight_wiki_low_confidence",
            timestampStartSec: 120,
            timestampEndSec: 180
          }]
        }
      }
    ]
  }),
  "JSON"
].join("\n"));
await chmod(fakeDeepSeekCommand, 0o755);

const llmProposalCheck = await compileEpisodeToWiki({
  config: {
    vaultRoot: join(dir, "llm-vault"),
    autoApply: false,
    now: "2026-06-17T12:10:00.000Z",
    proposalProvider: createDeepSeekTuiWikiProposalProvider({
      command: `${fakeDeepSeekCommand} tui`,
      cwd: dir,
      timeoutMs: 5_000
    })
  },
  result,
  watch,
  transcriptProvider: "smoke",
  summaryModel: "smoke"
});
if (llmProposalCheck.proposals.length !== 1) throw new Error(`DeepSeek TUI provider expected one proposal, got ${llmProposalCheck.proposals.length}.`);
if (llmProposalCheck.proposals[0]?.targetPath !== "40 Claims/DeepSeek Agent Workflow.md") {
  throw new Error("DeepSeek TUI provider did not use model proposal target path.");
}

for (const proposal of m1m2.proposals) {
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
repos.recordWikiExport({
  workspaceId: workspace.id,
  vaultRoot,
  episodeId: episode.id,
  watchId: watch.id,
  exportType: "source_note",
  filePath: m1m2.sourceNotePath,
  contentHash: m1m2.sourceNoteHash,
  status: m1m2.sourceNoteStatus
});
if (repos.listWikiUpdateProposals({ workspaceId: workspace.id }).length !== m1m2.proposals.length) {
  throw new Error("M2 repository proposal persistence failed.");
}
const firstProposalId = m1m2.proposals[0]?.id;
if (!firstProposalId) throw new Error("M2 expected first proposal id.");
await $`bun apps/worker/src/cli.ts wiki:proposal-status ${firstProposalId} approved --db ${dbPath}`;
const approved = repos.listWikiUpdateProposals({ workspaceId: workspace.id, status: "approved" });
if (approved.length !== 1 || approved[0]?.id !== firstProposalId) throw new Error("M2 proposal approval CLI failed.");

await $`bun apps/worker/src/cli.ts wiki:apply-proposals --vault ${vaultRoot} --db ${dbPath} --workspace-id ${workspace.id} --status approved --now 2026-06-17T12:30:00.000Z`;
const appliedFromCli = repos.listWikiUpdateProposals({ workspaceId: workspace.id, status: "applied" });
if (appliedFromCli.length !== 1 || appliedFromCli[0]?.id !== firstProposalId) throw new Error("M3 approved proposal apply CLI failed.");

for (const proposal of repos.listWikiUpdateProposals({ workspaceId: workspace.id, status: "pending" })) {
  repos.updateWikiUpdateProposalStatus(proposal.id, "approved");
}
await $`bun apps/worker/src/cli.ts wiki:apply-proposals --vault ${vaultRoot} --db ${dbPath} --workspace-id ${workspace.id} --status approved --now 2026-06-17T12:40:00.000Z`;
const remainingApproved = repos.listWikiUpdateProposals({ workspaceId: workspace.id, status: "approved" });
if (remainingApproved.length !== 0) throw new Error("M3 expected all approved proposals applied.");
const claim = await readFile(join(vaultRoot, "40 Claims/AI Agent 产品竞争转向企业工作流集成.md"), "utf8");
if (!claim.includes("insight_id: insight_wiki_smoke")) throw new Error("M3 claim page missing citation.");
const health = await readFile(join(vaultRoot, "health.md"), "utf8");
if (!health.includes("Score::")) throw new Error("M3 health report missing score.");
const log = await readFile(join(vaultRoot, "log.md"), "utf8");
if (!log.includes("Applied proposals:")) throw new Error("M3 log missing applied count.");

const publishedPath = join(dir, "published.md");
await $`bun apps/worker/src/cli.ts wiki:brief --vault ${vaultRoot} --topic "AI Agent 商业化" --period weekly --date 2026-06-17 --db ${dbPath} --workspace-id ${workspace.id}`;
const briefPath = join(vaultRoot, "50 Briefs/Weekly/2026-06-17 - AI Agent 商业化.md");
const brief = await readFile(briefPath, "utf8");
if (!brief.includes("BriefType:: weekly")) throw new Error("M4 weekly brief generation failed.");
await $`bun apps/worker/src/cli.ts lark:publish-markdown ${briefPath} --target ${`file://${publishedPath}`} --db ${dbPath} --workspace-id ${workspace.id}`;
const published = await readFile(publishedPath, "utf8");
if (!published.includes("AI Agent 商业化")) throw new Error("M4 file publisher smoke failed.");
if (repos.listWikiExports({ workspaceId: workspace.id, exportType: "lark_doc" }).length !== 1) {
  throw new Error("M4 lark_doc export record failed.");
}

const cliVaultRoot = join(dir, "cli-vault");
await $`bun apps/worker/src/cli.ts export obsidian --vault ${cliVaultRoot} --db ${dbPath} --workspace-id ${workspace.id} --auto-apply`;
const cliHealth = await readFile(join(cliVaultRoot, "health.md"), "utf8");
if (!cliHealth.includes("Score::")) throw new Error("CLI export obsidian smoke failed.");

console.log("Obsidian wiki M1-M4 E2E checks passed.");
