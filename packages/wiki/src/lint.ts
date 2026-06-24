import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export type WikiLintIssue = {
  severity: "error" | "warning";
  path: string;
  message: string;
};

export async function lintVault(vaultRoot: string): Promise<WikiLintIssue[]> {
  const files = (await listMarkdownFiles(vaultRoot)).filter((file) => !file.includes(".conflict-"));
  const issues: WikiLintIssue[] = [];
  const linked = new Set<string>();
  for (const file of files) {
    const content = await readFile(file, "utf8");
    const rel = relative(vaultRoot, file);
    if (!content.startsWith("---")) {
      issues.push({ severity: "warning", path: rel, message: "Missing YAML frontmatter." });
    }
    if (isSynthesisPath(rel) && !/insight_id:|insight_id:|InsightID::|insight_id/i.test(content)) {
      issues.push({ severity: "warning", path: rel, message: "Synthesis page has no explicit insight citation." });
    }
    for (const match of content.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) linked.add(match[1].trim());
  }
  for (const file of files) {
    const rel = relative(vaultRoot, file);
    if (rel === "index.md" || rel === "log.md" || rel === "health.md" || rel.startsWith("90 System/")) continue;
    const title = rel.split("/").pop()?.replace(/\.md$/i, "") ?? rel;
    if (!linked.has(title) && !rel.startsWith("10 Sources/")) {
      issues.push({ severity: "warning", path: rel, message: "Potential orphan synthesis page." });
    }
  }
  return issues;
}

export function renderHealthReport(issues: WikiLintIssue[]): string {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const issueLines = issues.length > 0
    ? issues.map((issue) => `- ${issue.severity.toUpperCase()} ${issue.path}: ${issue.message}`).join("\n")
    : "- No deterministic lint issues found.";
  return [
    `Score:: ${Math.max(0, 100 - errors.length * 25 - warnings.length * 5)}`,
    `Errors:: ${errors.length}`,
    `Warnings:: ${warnings.length}`,
    "",
    "## Issues",
    "",
    issueLines
  ].join("\n");
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  }));
  return nested.flat();
}

function isSynthesisPath(path: string): boolean {
  return path.startsWith("20 Concepts/") || path.startsWith("30 Entities/") || path.startsWith("40 Claims/");
}
