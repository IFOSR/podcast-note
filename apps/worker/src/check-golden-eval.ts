import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { publishableInsight } from "../../../packages/core/src/groundedness.ts";
import type { Insight, SemanticSegment, Watch } from "../../../packages/core/src/types.ts";
import { demoWatch, episodeFromFixture, processTranscriptFixture, type TranscriptFixture } from "./pipeline.ts";

const fixturePath = resolve(process.argv[2] ?? "evals/golden/ai-agent-sample-transcript.json");
const fixture = await loadFixture(fixturePath);
const watch = demoWatch();
const result = await processTranscriptFixture({
  workspaceId: watch.workspaceId,
  watch,
  episode: episodeFromFixture(fixture),
  transcriptSegments: fixture.transcript
});

const published = result.insights.filter((insight) => insight.status === "published");
const relevantPublished = published.filter((insight) => isRelevant(insight, watch));
const grounded = result.insights.filter((insight) => insight.groundednessScore !== undefined && insight.groundednessScore >= 0.75);
const timestampAccurate = result.insights.filter((insight) => timestampMatchesSegment(insight, result.segments));
const duplicateRate = duplicateInsightRate(result.insights);

const metrics = {
  fixture: fixturePath,
  insights: result.insights.length,
  published: published.length,
  precision: ratio(relevantPublished.length, published.length),
  groundedness: ratio(grounded.length, result.insights.length),
  timestampAccuracy: ratio(timestampAccurate.length, result.insights.length),
  duplicateRate
};

assertAtLeast(metrics.insights, 3, "insights");
assertAtLeast(metrics.published, 3, "published insights");
assertAtLeast(metrics.precision, 0.9, "insight precision");
assertAtLeast(metrics.groundedness, 0.9, "groundedness");
assertAtLeast(metrics.timestampAccuracy, 0.9, "timestamp accuracy");
assertAtMost(metrics.duplicateRate, 0.1, "duplicate rate");

for (const insight of result.insights) {
  const republished = publishableInsight(insight, result.segments, watch.minRelevanceScore);
  if (republished.status !== insight.status) {
    throw new Error(`Groundedness classification is not stable for insight: ${insight.claim}`);
  }
}

console.log(
  [
    "Golden eval check passed.",
    `- insights=${metrics.insights}`,
    `- published=${metrics.published}`,
    `- precision=${metrics.precision.toFixed(2)}`,
    `- groundedness=${metrics.groundedness.toFixed(2)}`,
    `- timestampAccuracy=${metrics.timestampAccuracy.toFixed(2)}`,
    `- duplicateRate=${metrics.duplicateRate.toFixed(2)}`
  ].join("\n")
);

async function loadFixture(path: string): Promise<TranscriptFixture> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as TranscriptFixture;
  if (!parsed.episode?.title || !parsed.episode?.pageUrl || !Array.isArray(parsed.transcript)) {
    throw new Error(`Invalid golden fixture: ${path}`);
  }
  return parsed;
}

function isRelevant(insight: Insight, watch: Watch): boolean {
  const haystack = [insight.claim, insight.evidenceExcerpt, insight.reasoning, insight.implication]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return [watch.query, ...watch.includeTerms, ...watch.expandedTerms]
    .map((term) => term.toLowerCase())
    .some((term) => haystack.includes(term));
}

function timestampMatchesSegment(insight: Insight, segments: SemanticSegment[]): boolean {
  if (insight.timestampEndSec <= insight.timestampStartSec) return false;
  return segments.some((segment) =>
    insight.timestampStartSec >= segment.startSec &&
    insight.timestampEndSec <= segment.endSec &&
    segment.text.includes(insight.evidenceExcerpt)
  );
}

function duplicateInsightRate(insights: Insight[]): number {
  if (insights.length === 0) return 0;
  const normalized = insights.map((insight) => normalize(insight.claim));
  const unique = new Set(normalized);
  return (normalized.length - unique.size) / normalized.length;
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ").trim();
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function assertAtLeast(actual: number, expected: number, label: string): void {
  if (actual < expected) throw new Error(`${label} expected >= ${expected}, got ${actual}.`);
}

function assertAtMost(actual: number, expected: number, label: string): void {
  if (actual > expected) throw new Error(`${label} expected <= ${expected}, got ${actual}.`);
}
