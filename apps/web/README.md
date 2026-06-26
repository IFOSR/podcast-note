# Web App

The Web app currently ships a local Bun preview server in `src/server/preview.ts`. It is intentionally server-first and uses the shared SQLite repositories and worker pipeline, while leaving the `src/app/` scaffold available for a future Next.js App Router UI.

## Current Preview Behavior

The preview separates the two user-facing flows into different pages:

- `/` processes one concrete podcast link as an immediate one-off task.
- `/monitor` creates and manages monitoring tasks for a target site or platform, channel or host, optional comma-separated keywords, frequency, and backfill episode count.

Both flows call the real worker pipeline via `processSourceInputs`. The Web preview does not use mock data or one-click demo generation. If Volcengine ASR or the local command-line LLM provider is not configured, the page returns a clear configuration error instead of pretending success.

Monitoring is service-backed, not browser-backed. Clicking `开始监控` stores the Watch, starts an immediate background backfill run, and then the preview server's scheduler keeps checking enabled Watches while `scripts/podcast-note` is running. The scheduler wakes every 5 minutes by default and respects each Watch frequency, so a daily Watch is not processed every 5 minutes.

The page includes:

- Agent execution status before the immediate-task result section.
- Busy/disabled submit buttons while processing is running.
- Episode reports with summary, overview, listening recommendation, chapters, entities, and evidence-backed insights.
- Inline audio verification player.
- Timestamp buttons that seek to source audio segments for recommendations, chapters, and insights.
- Save/irrelevant feedback actions.
- Collapsed monitoring task cards with `监控中`/`已停止` status, `停止`/`开始` and `删除` actions, and task-scoped produced episodes that expand into the same report elements as immediate results.

## Local Preview

From the repository root:

```bash
scripts/podcast-note start
```

Open:

```text
http://127.0.0.1:3000
```

Use the right page for the task type:

1. On `/`, paste a podcast URL and click `立即处理`.
2. On `/monitor`, enter the target, channel/host, optional keywords, frequency, and backfill episode count, then click `开始监控`.

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

Scheduler settings:

```bash
PODCAST_NOTE_SCHEDULER_ENABLED=true
PODCAST_NOTE_SCHEDULER_INTERVAL_MS=300000
PODCAST_NOTE_SCHEDULER_POLLING_LIMIT=20
PODCAST_NOTE_SCHEDULER_PROCESSING_LIMIT=3
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
bun run check:url-watch-queue
```

`check:web-m15` seeds an isolated SQLite database, creates a local session, hydrates inbox and episode detail, records feedback and playback usage, then asserts workspace-scoped results.

`check:preview-ui` starts the Bun preview server against an isolated SQLite database and verifies:

- The homepage exposes only the two current entry points.
- Mock/demo data is not generated.
- Missing real provider config returns an explicit error.
- The Agent execution panel and busy submit states exist.
- Episode reports include audio verification and timestamp seek buttons.
- Save feedback still works.
- URL-based monitor Watches queue discovered episodes for processing.
