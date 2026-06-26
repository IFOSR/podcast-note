import { stableId } from "../../../packages/core/src/format.ts";
import type { createRepositories } from "../../../packages/db/src/index.ts";
import type { WikiPageRecord } from "../../../packages/db/src/repositories.ts";
import type { WikiUpdateProposal } from "../../../packages/wiki/src/index.ts";

type Repositories = ReturnType<typeof createRepositories>;

export function buildWikiDecayProposals(input: {
  repositories: Repositories;
  workspaceId: string;
  vaultRoot: string;
  now?: string;
  staleDays?: number;
  limit?: number;
}): WikiUpdateProposal[] {
  const now = new Date(input.now ?? new Date().toISOString());
  const pages = input.repositories.listWikiPages({
    workspaceId: input.workspaceId,
    vaultRoot: input.vaultRoot,
    limit: input.limit ?? 200
  }).filter((page) => page.pageType === "claim" || page.pageType === "concept" || page.pageType === "entity");
  return pages.flatMap((page) => decayProposalForPage({
    repositories: input.repositories,
    page,
    now,
    staleDays: input.staleDays ?? 90
  }));
}

function decayProposalForPage(input: {
  repositories: Repositories;
  page: WikiPageRecord;
  now: Date;
  staleDays: number;
}): WikiUpdateProposal[] {
  const page = input.page;
  if (page.status === "archived") return [];
  const days = daysSince(page.lastSupportedAt, input.now);
  const freshnessScore = freshnessForDays(days);
  const evidence = input.repositories.listWikiPageEvidence({ pageId: page.id, limit: 1 })[0];
  if (!evidence) return [];
  if (page.status === "deprecated" && days >= input.staleDays + 60) {
    return [proposalFor(page, evidence.episodeId, "archive_page", "move", `80 Archive/${archiveFolder(page)}/${titleFromPath(page.path)}`, freshnessScore)];
  }
  if (page.status === "stale" && freshnessScore < 0.3) {
    return [proposalFor(page, evidence.episodeId, "mark_deprecated", "set_frontmatter", undefined, freshnessScore)];
  }
  if (page.status === "active" && days >= input.staleDays && freshnessScore < 0.5) {
    return [proposalFor(page, evidence.episodeId, "mark_stale", "set_frontmatter", undefined, freshnessScore)];
  }
  return [];
}

function proposalFor(
  page: WikiPageRecord,
  episodeId: string,
  type: "mark_stale" | "mark_deprecated" | "archive_page",
  operation: "set_frontmatter" | "move",
  targetPath: string | undefined,
  freshnessScore: number
): WikiUpdateProposal {
  const status = type === "mark_stale" ? "stale" : type === "mark_deprecated" ? "deprecated" : "archived";
  return {
    id: stableId("wiki_prop", `${page.id}:${type}:${status}`),
    workspaceId: page.workspaceId,
    episodeId,
    targetPath: page.path,
    proposalType: type,
    title: `${typeLabel(type)}：${page.title}`,
    rationale: `该页面最近支持证据不足，freshness_score=${freshnessScore.toFixed(2)}，建议标记为 ${status}。`,
    patch: {
      section: "frontmatter",
      operation,
      targetPath,
      frontmatter: {
        status,
        freshness_score: freshnessScore
      },
      citations: []
    },
    status: "pending"
  };
}

function daysSince(value: string | undefined, now: Date): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function freshnessForDays(days: number): number {
  if (days <= 30) return 1;
  if (days <= 90) return 0.7;
  if (days <= 180) return 0.4;
  return 0.2;
}

function typeLabel(type: "mark_stale" | "mark_deprecated" | "archive_page"): string {
  if (type === "mark_stale") return "标记衰退";
  if (type === "mark_deprecated") return "标记废弃";
  return "建议归档";
}

function archiveFolder(page: WikiPageRecord): string {
  if (page.pageType === "concept") return "Concepts";
  if (page.pageType === "entity") return "Entities";
  return "Claims";
}

function titleFromPath(path: string): string {
  return path.split("/").pop() ?? path;
}
