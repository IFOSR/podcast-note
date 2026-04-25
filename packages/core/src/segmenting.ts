import type { SemanticSegment, TranscriptSegment } from "./types.ts";

export type SegmentingOptions = {
  targetMinSec?: number;
  maxSec?: number;
  excerptChars?: number;
};

export function buildSemanticSegments(
  transcriptSegments: TranscriptSegment[],
  options: SegmentingOptions = {}
): SemanticSegment[] {
  const targetMinSec = options.targetMinSec ?? 180;
  const maxSec = options.maxSec ?? 480;
  const excerptChars = options.excerptChars ?? 420;
  const result: SemanticSegment[] = [];
  let bucket: TranscriptSegment[] = [];
  let bucketStart = transcriptSegments[0]?.startSec ?? 0;

  for (const segment of transcriptSegments) {
    if (bucket.length === 0) bucketStart = segment.startSec;
    bucket.push(segment);
    const duration = segment.endSec - bucketStart;
    const strongBreak = /[。！？.!?]\s*$/.test(segment.text.trim());

    if (duration >= maxSec || (duration >= targetMinSec && strongBreak)) {
      result.push(toSemanticSegment(result.length, bucket, excerptChars));
      bucket = [];
    }
  }

  if (bucket.length > 0) {
    result.push(toSemanticSegment(result.length, bucket, excerptChars));
  }

  return result;
}

function toSemanticSegment(index: number, segments: TranscriptSegment[], excerptChars: number): SemanticSegment {
  const text = segments.map((segment) => segment.text.trim()).join(" ").replace(/\s+/g, " ").trim();
  const first = segments[0];
  const last = segments[segments.length - 1];

  if (!first || !last) {
    throw new Error("Cannot build a semantic segment from an empty segment list.");
  }

  return {
    index,
    startSec: Math.floor(first.startSec),
    endSec: Math.ceil(last.endSec),
    text,
    textExcerpt: text.length > excerptChars ? `${text.slice(0, excerptChars).trim()}...` : text
  };
}

