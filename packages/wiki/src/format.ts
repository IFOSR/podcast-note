import { createHash } from "node:crypto";

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function slugifyPathPart(input: string, fallback = "untitled"): string {
  const slug = input
    .trim()
    .replace(/[\\/:*?"<>|#^[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return slug || fallback;
}

export function wikiLink(input: string): string {
  return `[[${input.replaceAll("[", "").replaceAll("]", "").trim()}]]`;
}

export function frontmatter(values: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
      continue;
    }
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

export function formatTimestamp(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "00:00";
  const whole = Math.max(0, Math.floor(seconds));
  const hour = Math.floor(whole / 3600);
  const minute = Math.floor((whole % 3600) / 60);
  const second = whole % 60;
  if (hour > 0) return `${hour}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  return `${minute}:${String(second).padStart(2, "0")}`;
}

export function isoDate(input: string | undefined, fallbackIso: string): string {
  const date = input ? new Date(input) : new Date(fallbackIso);
  if (Number.isNaN(date.getTime())) return fallbackIso.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function appendUniqueLine(content: string, heading: string, line: string): string {
  if (content.includes(line)) return content;
  const marker = `\n## ${heading}\n`;
  if (!content.includes(marker)) return `${content.trimEnd()}\n\n## ${heading}\n\n${line}\n`;
  const index = content.indexOf(marker) + marker.length;
  return `${content.slice(0, index)}\n${line}${content.slice(index)}`;
}

export function ensureSection(content: string, heading: string, body = ""): string {
  if (content.includes(`\n## ${heading}\n`)) return content;
  return `${content.trimEnd()}\n\n## ${heading}\n\n${body}\n`;
}

function yamlScalar(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (/^[a-zA-Z0-9_./:-]+$/.test(text)) return text;
  return JSON.stringify(text);
}
