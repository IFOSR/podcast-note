# Web App

The Web app currently ships a local Bun preview server in `src/server/preview.ts`. It is intentionally server-first and uses the shared SQLite repositories and worker pipeline, while leaving the `src/app/` scaffold available for a future Next.js App Router UI.

## Current Preview Behavior

The preview page exposes two user-facing flows:

- Process one concrete podcast link.
- Monitor a target site/platform/podcast plus keywords.

Both flows call the real worker pipeline via `processSourceInputs`. The Web preview does not use mock data or one-click demo generation. If Volcengine ASR or Codex insight extraction is not configured, the page returns a clear configuration error instead of pretending success.

The page includes:

- Agent execution status before the result section.
- Busy/disabled submit buttons while processing is running.
- Episode reports with summary, overview, listening recommendation, chapters, entities, and evidence-backed insights.
- Inline audio verification player.
- Timestamp buttons that seek to source audio segments for recommendations, chapters, and insights.
- Save/irrelevant feedback actions.

## Local Preview

From the repository root:

```bash
scripts/podcast-note start
```

Open:

```text
http://127.0.0.1:3000
```

Use either entry:

1. Paste a podcast URL and click `立即处理`.
2. Enter a target plus keywords and click `开始监控`.

During processing, the `Agent 执行过程` panel shows the current stage:

- 接收任务
- 解析来源
- 转写音频
- 提炼内容
- 生成报告

After completion, the result section displays the episode report. Click any timestamp to jump the audio player to the evidence segment.

Manage the process with:

```bash
scripts/podcast-note status
scripts/podcast-note restart
scripts/podcast-note logs
scripts/podcast-note stop
```

## Service Layer

`src/server/m1-app.ts` provides reusable server helpers for:

- Local session/context creation.
- Workspace-scoped Watch create/update/list helpers.
- Inbox hydration for published insights with episode/watch metadata.
- Episode detail hydration with player metadata, transcript, summary, insights, and feedback state.
- Feedback and usage-event recording for save/irrelevant/wrong/archive, inbox/detail views, and playback.

`src/server/preview.ts` is the product trial surface on top of those helpers plus the shared worker pipeline.

## Verification

From the repository root:

```bash
bun run check:web-m15
bun run check:preview-ui
```

`check:web-m15` seeds an isolated SQLite database, creates a local session, hydrates inbox and episode detail, records feedback and playback usage, then asserts workspace-scoped results.

`check:preview-ui` starts the Bun preview server against an isolated SQLite database and verifies:

- The homepage exposes only the two current entry points.
- Mock/demo data is not generated.
- Missing real provider config returns an explicit error.
- The Agent execution panel and busy submit states exist.
- Episode reports include audio verification and timestamp seek buttons.
- Save feedback still works.
