import type { WikiUpdateProposal } from "./types.ts";

export function renderIndex(input: {
  sourceNotes: string[];
  proposals: WikiUpdateProposal[];
  appliedPaths: string[];
}): string {
  const sourceLines = input.sourceNotes.length > 0
    ? input.sourceNotes.map((path) => `- [[${basenameNoExt(path)}]]`).join("\n")
    : "- No source notes exported yet.";
  const appliedLines = input.appliedPaths.length > 0
    ? [...new Set(input.appliedPaths)].sort().map((path) => `- [[${basenameNoExt(path)}]]`).join("\n")
    : "- No synthesis pages updated yet.";
  const pending = input.proposals.filter((proposal) => proposal.status === "pending");
  const pendingLines = pending.length > 0
    ? pending.map((proposal) => `- ${proposal.title} -> ${proposal.targetPath}`).join("\n")
    : "- No pending proposals.";
  return [
    "## Sources",
    "",
    sourceLines,
    "",
    "## Updated Wiki Pages",
    "",
    appliedLines,
    "",
    "## Pending Proposals",
    "",
    pendingLines
  ].join("\n");
}

export function renderLogEntry(input: {
  now: string;
  sourceNotePath?: string;
  proposals: WikiUpdateProposal[];
  appliedPaths: string[];
}): string {
  return [
    `## ${input.now}`,
    "",
    input.sourceNotePath ? `- Source note: ${input.sourceNotePath}` : "- Source note: none",
    `- Proposals: ${input.proposals.length}`,
    `- Applied: ${input.appliedPaths.length}`,
    ...input.appliedPaths.map((path) => `- Updated: ${path}`)
  ].join("\n");
}

function basenameNoExt(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
}
