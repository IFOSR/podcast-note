import { stableId } from "../../core/src/format.ts";
import type { EpisodeSummary, Insight } from "../../core/src/types.ts";
import type { EpisodeSummaryInput, InsightProvider, TranscriptProvider, TranscriptionInput, TranscriptionOutput, WatchInsightInput } from "./types.ts";
import { promptVersions } from "./types.ts";

export const mockTranscriptProvider: TranscriptProvider = {
  name: "mock",
  model: "fixture-transcript-v1",
  async transcribe(input: TranscriptionInput): Promise<TranscriptionOutput> {
    if (!input.episode.description) {
      throw new Error("Mock transcription requires episode.description or a transcript fixture.");
    }

    return {
      language: input.episode.language ?? "en",
      confidence: 0.9,
      durationSec: input.episode.durationSec,
      segments: [
        {
          startSec: 0,
          endSec: Math.max(30, input.episode.durationSec ?? 300),
          text: input.episode.description,
          confidence: 0.9
        }
      ]
    };
  }
};

export const mockInsightProvider: InsightProvider = {
  name: "mock",
  model: "deterministic-insight-v1",
  async summarizeEpisode(input: EpisodeSummaryInput): Promise<EpisodeSummary> {
    const firstSegment = input.segments[0];
    const overview = input.segments.map((segment) => segment.textExcerpt).join("\n\n");
    return {
      oneLiner: firstSentence(overview) || `Episode about ${input.episode.title}`,
      overview: overview.slice(0, 1200),
      chapters: input.segments.map((segment) => ({
        title: segment.title ?? `Segment ${segment.index + 1}`,
        startSec: segment.startSec,
        endSec: segment.endSec,
        summary: firstSentence(segment.text) || segment.textExcerpt
      })),
      worthListening: {
        recommendation: input.segments.length > 0 ? "listen_segments" : "skip",
        reason: firstSegment
          ? `Start with ${firstSegment.startSec}-${firstSegment.endSec}s for the densest discussion.`
          : "No transcript segments were available.",
        bestSegments: firstSegment ? [{ startSec: firstSegment.startSec, endSec: firstSegment.endSec, reason: "Highest available signal in the fixture." }] : []
      },
      entities: extractEntities(overview).map((name) => ({ name, type: "unknown", mentions: countMentions(overview, name) }))
    };
  },
  async extractWatchInsights(input: WatchInsightInput): Promise<Insight[]> {
    const terms = [...input.watch.includeTerms, ...input.watch.expandedTerms, input.watch.query]
      .map((term) => term.trim())
      .filter(Boolean);

    const candidateSegments = input.segments.filter((segment) =>
      terms.some((term) => segment.text.toLowerCase().includes(term.toLowerCase()))
    );

    const selectedSegments = (candidateSegments.length > 0 ? candidateSegments : input.segments).slice(0, 5);

    return selectedSegments.map((segment, index) => {
      const evidenceExcerpt = selectEvidence(segment.text, terms);
      const claim = buildClaim(input.watch.query, evidenceExcerpt);
      return {
        id: stableId("ins", `${input.watch.id}:${input.episode.id}:${segment.index}:${claim}`),
        workspaceId: input.workspaceId,
        watchId: input.watch.id,
        episodeId: input.episode.id,
        segmentIndex: segment.index,
        claim,
        evidenceExcerpt,
        reasoning: `This segment matched the watch query "${input.watch.query}".`,
        implication: "Review this segment before deciding whether to listen to the full episode.",
        timestampStartSec: segment.startSec,
        timestampEndSec: segment.endSec,
        entities: extractEntities(segment.text).map((name) => ({ name, type: "unknown" })),
        relevanceScore: candidateSegments.length > 0 ? Math.max(0.7, 0.9 - index * 0.05) : 0.55,
        confidence: 0.78,
        outputLanguage: input.outputLanguage,
        status: "draft",
        promptVersion: promptVersions.watchInsight,
        model: mockInsightProvider.model
      };
    });
  }
};

function firstSentence(input: string): string {
  return input.split(/(?<=[。！？.!?])\s+/)[0]?.trim() ?? "";
}

function selectEvidence(text: string, terms: string[]): string {
  const sentences = text.split(/(?<=[。！？.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const matched = sentences.find((sentence) =>
    terms.some((term) => term.length > 1 && sentence.toLowerCase().includes(term.toLowerCase()))
  );
  return (matched ?? sentences[0] ?? text).slice(0, 360);
}

function buildClaim(query: string, evidence: string): string {
  const compactEvidence = evidence.replace(/\s+/g, " ").trim();
  return `The episode contains a relevant point for "${query}": ${compactEvidence.slice(0, 180)}`;
}

function extractEntities(text: string): string[] {
  const matches = text.match(/\b[A-Z][A-Za-z0-9+.-]*(?:\s+[A-Z][A-Za-z0-9+.-]*){0,3}\b/g) ?? [];
  return [...new Set(matches.filter((match) => match.length > 2))].slice(0, 12);
}

function countMentions(text: string, entity: string): number {
  return text.split(entity).length - 1;
}

