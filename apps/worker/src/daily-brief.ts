import type { createRepositories } from "../../../packages/db/src/repositories.ts";

type Repositories = ReturnType<typeof createRepositories>;
type DailyBriefInsight = ReturnType<Repositories["listInsightsForDailyBrief"]>[number];

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type EmailAdapter = {
  send(message: EmailMessage): Promise<{ providerMessageId?: string }>;
};

export type DailyBriefResult = {
  status: "sent" | "failed" | "skipped";
  insightCount: number;
  subject?: string;
  providerMessageId?: string;
  reason?: "already_sent" | "no_insights" | "missing_email";
  error?: string;
};

export type GenerateDailyBriefInput = {
  repositories: Repositories;
  workspaceId: string;
  userId: string;
  date: string;
  timezone: string;
  emailAdapter: EmailAdapter;
  now?: string;
};

export async function generateAndSendDailyBrief(input: GenerateDailyBriefInput): Promise<DailyBriefResult> {
  const existing = input.repositories.getDailyBrief(input.workspaceId, input.userId, input.date);
  if (existing?.status === "sent") {
    return {
      status: "skipped",
      insightCount: existing.insightCount,
      subject: existing.subject,
      providerMessageId: existing.providerMessageId,
      reason: "already_sent"
    };
  }

  const user = input.repositories.getUser(input.userId);
  if (!user?.email) {
    input.repositories.recordDailyBrief({
      workspaceId: input.workspaceId,
      userId: input.userId,
      briefDate: input.date,
      timezone: input.timezone,
      status: "skipped",
      insightCount: 0,
      error: "missing_email"
    });
    return { status: "skipped", insightCount: 0, reason: "missing_email" };
  }

  const window = dayWindowUtc(input.date, input.timezone);
  const insights = input.repositories.listInsightsForDailyBrief({
    workspaceId: input.workspaceId,
    since: window.since,
    until: window.until,
    limit: 20
  });

  if (insights.length === 0) {
    input.repositories.recordDailyBrief({
      workspaceId: input.workspaceId,
      userId: input.userId,
      briefDate: input.date,
      timezone: input.timezone,
      status: "skipped",
      insightCount: 0,
      error: "no_insights"
    });
    return { status: "skipped", insightCount: 0, reason: "no_insights" };
  }

  const subject = `Podcast Note Daily Brief · ${input.date} · ${insights.length} insights`;
  const message = renderDailyBriefEmail({
    to: user.email,
    subject,
    date: input.date,
    timezone: input.timezone,
    insights
  });

  try {
    const sent = await input.emailAdapter.send(message);
    const brief = input.repositories.recordDailyBrief({
      workspaceId: input.workspaceId,
      userId: input.userId,
      briefDate: input.date,
      timezone: input.timezone,
      status: "sent",
      insightCount: insights.length,
      subject,
      providerMessageId: sent.providerMessageId,
      sentAt: input.now ?? new Date().toISOString()
    });
    return {
      status: "sent",
      insightCount: brief.insightCount,
      subject: brief.subject,
      providerMessageId: brief.providerMessageId
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.repositories.recordDailyBrief({
      workspaceId: input.workspaceId,
      userId: input.userId,
      briefDate: input.date,
      timezone: input.timezone,
      status: "failed",
      insightCount: insights.length,
      subject,
      error: message
    });
    return { status: "failed", insightCount: insights.length, subject, error: message };
  }
}

function renderDailyBriefEmail(input: {
  to: string;
  subject: string;
  date: string;
  timezone: string;
  insights: DailyBriefInsight[];
}): EmailMessage {
  const lines = [
    `Podcast Note Daily Brief · ${input.date}`,
    `Timezone: ${input.timezone}`,
    "",
    ...input.insights.flatMap((insight, index) => [
      `${index + 1}. ${insight.claim}`,
      `   Watch: ${insight.watchName}`,
      `   Episode: ${insight.episodeTitle}`,
      `   Link: ${insight.episodePageUrl}`,
      `   Evidence: ${insight.evidenceExcerpt}`,
      ""
    ])
  ];
  const items = input.insights.map((insight) => `
    <li>
      <p><strong>${escapeHtml(insight.claim)}</strong></p>
      <p>Watch: ${escapeHtml(insight.watchName)} · Episode: <a href="${escapeHtml(insight.episodePageUrl)}">${escapeHtml(insight.episodeTitle)}</a></p>
      <blockquote>${escapeHtml(insight.evidenceExcerpt)}</blockquote>
    </li>
  `).join("\n");
  return {
    to: input.to,
    subject: input.subject,
    text: lines.join("\n"),
    html: `<!doctype html><html><body><h1>Podcast Note Daily Brief · ${escapeHtml(input.date)}</h1><ol>${items}</ol></body></html>`
  };
}

function dayWindowUtc(date: string, timezone: string): { since: string; until: string } {
  // M1 uses deterministic date windows for checks and stores timestamps in UTC text. Asia/Shanghai is UTC+8.
  const offsetHours = timezone === "Asia/Shanghai" ? 8 : 0;
  const sinceMs = Date.parse(`${date}T00:00:00.000Z`) - offsetHours * 60 * 60 * 1000;
  const untilMs = sinceMs + 24 * 60 * 60 * 1000;
  return { since: new Date(sinceMs).toISOString(), until: new Date(untilMs).toISOString() };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
