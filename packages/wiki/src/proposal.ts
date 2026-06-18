import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { EpisodeProcessingResult, Insight, Watch } from "../../core/src/types.ts";
import { stableId } from "../../core/src/format.ts";
import type { WikiProposalProvider, WikiUpdateProposal, WikiVaultConfig } from "./types.ts";
import { appendUniqueLine, formatTimestamp, frontmatter, isoDate, slugifyPathPart, wikiLink } from "./format.ts";
import { updateManagedFile, writeManagedMarkdown } from "./vault.ts";

export function buildWikiUpdateProposals(input: {
  result: EpisodeProcessingResult;
  watch: Watch;
  config: WikiVaultConfig;
}): WikiUpdateProposal[] {
  const minConfidence = input.config.minConfidence ?? 0.75;
  const minGroundedness = input.config.minGroundedness ?? 0.8;
  const proposals: WikiUpdateProposal[] = [];
  const published = input.result.insights.filter((insight) =>
    insight.status === "published"
    && insight.confidence >= minConfidence
    && (insight.groundednessScore ?? 0) >= minGroundedness
  );
  for (const insight of published) {
    const claimTitle = claimTitleForInsight(insight);
    proposals.push({
      id: stableId("wiki_prop", `${insight.id}:claim`),
      workspaceId: insight.workspaceId,
      episodeId: insight.episodeId,
      insightId: insight.id,
      targetPath: `40 Claims/${claimTitle}.md`,
      proposalType: "create_page",
      title: `形成观点页：${claimTitle}`,
      rationale: "高置信、可溯源 insight 可以沉淀为观点页或补充证据。",
      patch: {
        section: "支持证据",
        operation: "create",
        markdown: evidenceLine(input.result, insight),
        citations: citationFor(insight)
      },
      status: "pending"
    });
    for (const entity of insight.entities.slice(0, 5)) {
      proposals.push({
        id: stableId("wiki_prop", `${insight.id}:entity:${entity.name}`),
        workspaceId: insight.workspaceId,
        episodeId: insight.episodeId,
        insightId: insight.id,
        targetPath: entityPath(entity),
        proposalType: "append_evidence",
        title: `补充实体证据：${entity.name}`,
        rationale: "该实体出现在高置信 insight 中，适合追加来源证据和反向链接。",
        patch: {
          section: "相关证据",
          operation: "append",
          markdown: evidenceLine(input.result, insight),
          citations: citationFor(insight)
        },
        status: "pending"
      });
    }
    proposals.push({
      id: stableId("wiki_prop", `${insight.id}:concept:${input.watch.id}`),
      workspaceId: insight.workspaceId,
      episodeId: insight.episodeId,
      insightId: insight.id,
      targetPath: `20 Concepts/${slugifyPathPart(input.watch.query || input.watch.name)}.md`,
      proposalType: "append_evidence",
      title: `补充主题证据：${input.watch.name}`,
      rationale: "该 insight 与当前监控主题匹配，可增强主题页的证据池。",
      patch: {
        section: "支持证据",
        operation: "append",
        markdown: evidenceLine(input.result, insight),
        citations: citationFor(insight)
      },
      status: "pending"
    });
  }
  return dedupeProposals(proposals);
}

export function createDeterministicWikiProposalProvider(): WikiProposalProvider {
  return {
    name: "deterministic",
    model: "wiki-proposal-v1",
    async generateProposals(input) {
      return buildWikiUpdateProposals(input);
    }
  };
}

export async function writePendingInbox(input: {
  vaultRoot: string;
  proposals: WikiUpdateProposal[];
  now?: string;
}): Promise<string> {
  const date = (input.now ?? new Date().toISOString()).slice(0, 10);
  const relativePath = `00 Inbox/${date} pending-insights.md`;
  const grouped = input.proposals.filter((proposal) => proposal.status === "pending");
  const body = grouped.length > 0
    ? grouped.map((proposal) => [
      `## ${proposal.title}`,
      "",
      `- ProposalID:: ${proposal.id}`,
      `- Type:: ${proposal.proposalType}`,
      `- Target:: ${proposal.targetPath}`,
      `- EpisodeID:: ${proposal.episodeId}`,
      proposal.insightId ? `- InsightID:: ${proposal.insightId}` : undefined,
      `- Rationale:: ${proposal.rationale}`,
      "",
      proposal.patch.markdown
    ].filter(Boolean).join("\n")).join("\n\n")
    : "No pending proposals.";
  await updateManagedFile({
    vaultRoot: input.vaultRoot,
    relativePath,
    title: `${date} Pending Insights`,
    marker: "pending",
    body
  });
  return relativePath;
}

export async function applySafeProposals(input: {
  vaultRoot: string;
  result: EpisodeProcessingResult;
  watch: Watch;
  proposals: WikiUpdateProposal[];
  now?: string;
}): Promise<Array<{ path: string; contentHash: string }>> {
  const applied: string[] = [];
  const results: Array<{ path: string; contentHash: string }> = [];
  for (const proposal of input.proposals) {
    const target = join(input.vaultRoot, proposal.targetPath);
    const content = await readOptional(target);
    const next = content
      ? appendUniqueLine(content, proposal.patch.section, proposal.patch.markdown)
      : createSynthesisPage({
        proposal,
        result: input.result,
        watch: input.watch,
        now: input.now
      });
    const write = await writeManagedMarkdown({
      vaultRoot: input.vaultRoot,
      absolutePath: target,
      content: next
    });
    if (write.status === "written" || write.status === "skipped") {
      proposal.status = "applied";
      applied.push(proposal.targetPath);
      results.push({ path: proposal.targetPath, contentHash: write.contentHash });
    } else {
      proposal.status = "failed";
    }
  }
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.path)) return false;
    seen.add(result.path);
    return true;
  });
}

export async function applyWikiUpdateProposals(input: {
  vaultRoot: string;
  proposals: WikiUpdateProposal[];
  now?: string;
}): Promise<Array<{ path: string; contentHash?: string; proposal: WikiUpdateProposal }>> {
  const results: Array<{ path: string; contentHash?: string; proposal: WikiUpdateProposal }> = [];
  for (const proposal of input.proposals) {
    if (proposal.status !== "approved" && proposal.status !== "pending") continue;
    const target = join(input.vaultRoot, proposal.targetPath);
    const content = await readOptional(target);
    const next = content
      ? appendUniqueLine(content, proposal.patch.section, proposal.patch.markdown)
      : createSynthesisPageFromProposal({
        proposal,
        now: input.now
      });
    const write = await writeManagedMarkdown({
      vaultRoot: input.vaultRoot,
      absolutePath: target,
      content: next
    });
    if (write.status === "written" || write.status === "skipped") {
      proposal.status = "applied";
      results.push({ path: proposal.targetPath, contentHash: write.contentHash, proposal });
    } else {
      proposal.status = "failed";
      results.push({ path: proposal.targetPath, proposal });
    }
  }
  return results;
}

export function renderProposalRows(proposals: WikiUpdateProposal[]): string {
  return JSON.stringify(proposals.map((proposal) => ({
    id: proposal.id,
    targetPath: proposal.targetPath,
    proposalType: proposal.proposalType,
    title: proposal.title,
    rationale: proposal.rationale,
    patch: proposal.patch,
    status: proposal.status
  })), null, 2);
}

function createSynthesisPage(input: {
  proposal: WikiUpdateProposal;
  result: EpisodeProcessingResult;
  watch: Watch;
  now?: string;
}): string {
  const title = input.proposal.targetPath.split("/").pop()?.replace(/\.md$/i, "") ?? input.proposal.title;
  const type = input.proposal.targetPath.startsWith("20 Concepts/")
    ? "concept"
    : input.proposal.targetPath.startsWith("30 Entities/")
      ? "entity"
      : "claim";
  const date = isoDate(undefined, input.now ?? new Date().toISOString());
  const intro = type === "claim"
    ? "## 观点\n\n待人工审阅后补充综合判断。"
    : "## 当前综合判断\n\n待更多来源积累后生成稳定综合判断。";
  return [
    frontmatter({
      type,
      status: "active",
      source_count: 1,
      last_updated: date,
      confidence: "medium",
      tags: [type]
    }),
    "",
    `# ${title}`,
    "",
    "<!-- podcast-note:start -->",
    "",
    intro,
    "",
    `## ${input.proposal.patch.section}`,
    "",
    input.proposal.patch.markdown,
    "",
    "## 相关来源",
    "",
    `- ${sourceNoteLink(input.result)} (${input.watch.name})`,
    "",
    "<!-- podcast-note:end -->",
    ""
  ].join("\n");
}

function createSynthesisPageFromProposal(input: {
  proposal: WikiUpdateProposal;
  now?: string;
}): string {
  const title = input.proposal.targetPath.split("/").pop()?.replace(/\.md$/i, "") ?? input.proposal.title;
  const type = input.proposal.targetPath.startsWith("20 Concepts/")
    ? "concept"
    : input.proposal.targetPath.startsWith("30 Entities/")
      ? "entity"
      : "claim";
  const date = isoDate(undefined, input.now ?? new Date().toISOString());
  const intro = type === "claim"
    ? "## 观点\n\n待人工审阅后补充综合判断。"
    : "## 当前综合判断\n\n待更多来源积累后生成稳定综合判断。";
  return [
    frontmatter({
      type,
      status: "active",
      source_count: 1,
      last_updated: date,
      confidence: "medium",
      tags: [type]
    }),
    "",
    `# ${title}`,
    "",
    "<!-- podcast-note:start -->",
    "",
    intro,
    "",
    `## ${input.proposal.patch.section}`,
    "",
    input.proposal.patch.markdown,
    "",
    "<!-- podcast-note:end -->",
    ""
  ].join("\n");
}

function claimTitleForInsight(insight: Insight): string {
  return slugifyPathPart(insight.claim.replace(/[。.!?！？]$/g, ""), insight.id);
}

function entityPath(entity: { name: string; type: string }): string {
  const folder = /person|people|人物/i.test(entity.type)
    ? "People"
    : /company|org|organization|公司|机构/i.test(entity.type)
      ? "Companies"
      : /product|tool|产品|工具/i.test(entity.type)
        ? "Products"
        : "Podcasts";
  return `30 Entities/${folder}/${slugifyPathPart(entity.name)}.md`;
}

function evidenceLine(result: EpisodeProcessingResult, insight: Insight): string {
  return `- ${isoDate(result.episode.publishedAt, new Date().toISOString())}: ${insight.claim} ${sourceNoteLink(result)} ${formatTimestamp(insight.timestampStartSec)}-${formatTimestamp(insight.timestampEndSec)} (insight_id: ${insight.id})`;
}

function sourceNoteLink(result: EpisodeProcessingResult): string {
  const date = isoDate(result.episode.publishedAt, new Date().toISOString());
  return wikiLink(`${date} - ${slugifyPathPart(result.episode.title)}`);
}

function citationFor(insight: Insight): WikiUpdateProposal["patch"]["citations"] {
  return [{
    episodeId: insight.episodeId,
    insightId: insight.id,
    timestampStartSec: insight.timestampStartSec,
    timestampEndSec: insight.timestampEndSec
  }];
}

function dedupeProposals(proposals: WikiUpdateProposal[]): WikiUpdateProposal[] {
  const seen = new Set<string>();
  return proposals.filter((proposal) => {
    const key = `${proposal.id}:${proposal.targetPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
