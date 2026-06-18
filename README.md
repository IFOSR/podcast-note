# Podcast Note

Podcast Note is a podcast intelligence platform. Users submit podcast links or define monitoring targets, and the system resolves public episodes, transcribes audio, extracts grounded summaries and insights, and renders verifiable reports with source audio timestamps.

The current implementation includes:

- RSS, Listen Notes, Apple Podcasts, Spotify, YouTube, Xiaoyuzhou, and manual URL connectors.
- Real local Web preview for two flows: process one podcast link, or monitor a target plus keywords.
- Agent execution status in the Web UI so long-running transcription/analysis does not look stuck.
- Episode reports with one-line summary, overview, listening recommendation, chapters, entities, insights, evidence excerpts, and timestamped audio playback.
- Shared worker pipeline used by both CLI and Web preview.
- Volcengine ASR transcription and Codex non-interactive summary/insight extraction.
- SQLite persistence for workspaces, watches, sources, episodes, transcripts, summaries, insights, feedback, and processing runs.

## Documents

- [PRD](./docs/podcast-intelligence-prd.md)
- [Technical design](./docs/technical-design-implementation.md)

## Local Web Preview

Start the product preview from the repository root:

```bash
scripts/podcast-note start
```

Then open:

```text
http://127.0.0.1:3000
```

The preview intentionally separates the two user-facing task types:

1. `/` processes one concrete podcast link directly as an immediate one-off task. It does not ask for keywords and does not create a monitoring task.
2. `/monitor` creates and manages monitoring tasks. It asks for a target site or platform name, channel or host name, optional comma-separated keywords, frequency, and backfill episode count.

After submission, the page runs the real processing path. It does not generate mock data. The immediate processing page shows an `Agent 执行过程` panel before results with these stages:

- 接收任务
- 解析来源
- 转写音频
- 提炼内容
- 生成报告

Submit buttons switch to a disabled busy state while processing is running. This matters because real ASR and analysis can take minutes for long episodes.

Results render as episode reports:

- 一句话总结
- 内容总结
- 是否值得听
- 推荐跳听
- 关键实体
- 章节与段落摘要
- 核心观点与证据
- 音频核验 player with timestamp buttons

Click any timestamp in recommendations, chapters, or insights to jump the audio player to that source segment and verify the summary against the original audio.

The monitoring page is task-management first: each monitoring task is collapsed by default, shows `监控中` or `已停止`, and provides `停止`/`开始` plus `删除`. Expanding a task shows that task's own produced episodes; each produced episode is also collapsed by default and expands into the same report elements as an immediate task. Immediate task results are not shown inside monitoring tasks.

Clicking `开始监控` does not depend on the browser tab staying open. The server immediately stores the Watch, starts a background backfill run, and the preview process keeps a built-in scheduler alive while `scripts/podcast-note` is running. The scheduler wakes every 5 minutes by default, checks enabled Watches, and only processes a Watch again when its configured frequency is due. URL-based source Watches, such as Xiaoyuzhou podcast pages, are treated as "monitor this source" and newly discovered episodes are queued for real transcription and insight generation.

Scheduler options can be changed with environment variables:

```bash
PODCAST_NOTE_SCHEDULER_ENABLED=true
PODCAST_NOTE_SCHEDULER_INTERVAL_MS=300000
PODCAST_NOTE_SCHEDULER_POLLING_LIMIT=20
PODCAST_NOTE_SCHEDULER_PROCESSING_LIMIT=3
```

Manage the local process with:

```bash
scripts/podcast-note status
scripts/podcast-note restart
scripts/podcast-note logs
scripts/podcast-note stop
```

Useful options:

```bash
scripts/podcast-note start --port 3001 --db storage/podcast-note.sqlite
```

`scripts/podcast-note start` and `scripts/podcast-note run-once` load `.env` automatically.

## Feishu Bot Commands

Podcast Note supports a personal Feishu/Lark bot conversation as a lightweight control surface. The Web app is still the configuration and full-report console; Feishu is for quick input, status checks, and receiving processed results.

After the administrator configures `LARK_APP_ID` and `LARK_APP_SECRET`, start the service and open the Feishu integration page in the Web preview. Scan the bot QR code with Feishu, open the Podcast Note bot private chat, then send `/bind` or any supported command. The backend records that private chat as a delivery target through the WebSocket message event `im.message.receive_v1`.

Supported private-chat messages:

- Send a Xiaoyuzhou episode URL to process that single episode immediately.
- Send a Xiaoyuzhou podcast URL to create or reuse a monitor for that podcast.
- Send natural language such as `小宇宙里面有一个商业访谈录，帮我监控起来` or `帮我关注 AI炼金术，每天检查`. The bot extracts the platform and podcast name, resolves a real podcast channel URL, then asks for `确认` before creating the monitor. If it cannot find a real channel URL, it will not create a monitor from the raw sentence.
- Send `状态` or `进度` to see monitor and queue counts.
- Send `重试失败` to requeue failed episode-processing jobs in the current workspace.
- Send `暂停 硅谷101` or `恢复 硅谷101` to pause or resume a matching monitor.
- Ask a knowledge question such as `AI Agent 商业化为什么会走向企业工作流？`. If the current workspace has processed podcast summaries or published insights that match, the bot replies with cited evidence, episode links, and timestamps. If nothing matches, it says the knowledge base has no relevant processed material instead of repeating the binding confirmation.

Team group delivery is intentionally not the primary path yet. The current production path is personal private-chat binding plus one-time delivery de-duplication, so every processed result is pushed once per active bound Feishu target.

## Required Configuration

Real Web processing requires Volcengine ASR credentials and Codex CLI access.

Natural-language Feishu commands can resolve Xiaoyuzhou podcast names through Xiaoyuzhou's authenticated search API when configured:

```bash
XIAOYUZHOU_ACCESS_TOKEN=...
XIAOYUZHOU_DEVICE_ID=...
```

`XIAOYUZHOU_DEVICE_ID` is optional. Without `XIAOYUZHOU_ACCESS_TOKEN`, Xiaoyuzhou natural-language commands still bind the chat and parse intent, but they will not create a monitor unless a matching source already exists locally or the user sends a real podcast URL.

Volcengine ASR can be configured with either:

```bash
VOLCENGINE_ASR_API_KEY=...
```

or, preferred when both are available:

```bash
VOLCENGINE_ASR_APP_ID=...
VOLCENGINE_ASR_ACCESS_TOKEN=...
```

When both `VOLCENGINE_ASR_API_KEY` and `VOLCENGINE_ASR_APP_ID + VOLCENGINE_ASR_ACCESS_TOKEN` are present, the provider prefers app-id/access-token headers. This avoids an invalid API key shadowing valid app credentials.

Optional ASR settings:

```bash
VOLCENGINE_ASR_MODE=standard
VOLCENGINE_ASR_RESOURCE_ID=...
VOLCENGINE_ASR_ENABLE_SPEAKER_INFO=true
VOLCENGINE_ASR_TIMEOUT_MS=3600000
```

`VOLCENGINE_ASR_TIMEOUT_MS` defaults to 60 minutes as the base wait limit. For longer episodes, the worker automatically waits for the episode duration plus one extra hour.

Codex insight extraction uses the non-interactive provider from `packages/ai/src/codex-provider.ts`. Make sure `codex exec` works in your local environment before running real processing. Long transcripts can take several minutes to summarize; `CODEX_INSIGHT_TIMEOUT_MS` defaults to 30 minutes.

Wiki proposal generation can use DeepSeek TUI instead of the deterministic proposal builder:

```bash
PODCAST_NOTE_WIKI_PROPOSAL_PROVIDER=deepseek-tui
DEEPSEEK_TUI_COMMAND="deepseek tui"
```

`DEEPSEEK_TUI_COMMAND=deepseek-tui` also works if your local executable is named that way. The provider calls `<command> exec --auto <prompt>`, does not prompt the user for confirmations, and still writes wiki synthesis updates as pending proposals unless auto-apply is enabled.

## Real CLI Flow

Create local inputs from the examples:

```bash
cp inputs/watch.example.json inputs/watch.json
cp inputs/sources.example.json inputs/sources.json
```

Then run:

```bash
bun apps/worker/src/cli.ts process-sources
```

The CLI and Web preview share the same worker implementation in `apps/worker/src/process-sources.ts`. The flow resolves public audio URLs, transcribes with Volcengine ASR, analyzes text with Codex, persists data to SQLite, and writes per-episode files under `outputs/<episode-slug>/`:

- `transcript.json`
- `report.md`
- `result.json`

Override the SQLite path with:

```bash
bun apps/worker/src/cli.ts process-sources --db storage/custom.sqlite
```

When processing the same episode again, the worker reuses the latest stored transcript instead of calling ASR again, then continues analysis/export from that transcript.

## Source Connectors

Source resolution supports:

- RSS feeds: `https://example.com/feed.xml`
- Listen Notes podcast/episode ids or URLs: `listennotes:<id>` or `https://www.listennotes.com/...`
- Apple Podcasts public pages: `https://podcasts.apple.com/...`
- Spotify public pages: `https://open.spotify.com/...`
- YouTube public pages: `https://youtube.com/...` and `https://youtu.be/...`
- Xiaoyuzhou public pages: `https://www.xiaoyuzhoufm.com/...`
- Manual public pages/direct audio URLs as the final fallback

`LISTEN_NOTES_API_KEY` enables full Listen Notes API metadata and episode listing. Without it, the Listen Notes connector runs in metadata-only mode so local routing checks and no-key development remain stable.

Xiaoyuzhou public pages are best-effort. The resolver extracts public audio metadata from the page and normalizes Ximalaya wrapped audio URLs to direct media URLs when possible so Volcengine can fetch them.

## SQLite Query / Export

After processing, inspect local data with:

```bash
bun apps/worker/src/cli.ts query episodes
bun apps/worker/src/cli.ts query runs --format json
bun apps/worker/src/cli.ts query insights --watch-id <watch_id> --limit 20
```

Export JSON for downstream review or backup:

```bash
bun apps/worker/src/cli.ts export insights --output exports/insights.json
bun apps/worker/src/cli.ts export episodes --db storage/custom.sqlite --output exports/episodes.json
```

## Verification

Run the focused checks used for the current Web/worker path:

```bash
bun run check:audio-formats
bun run check:connectors
bun run check:imports
bun run check:preview-ui
bun run check:start-script
bun run check:web-m15
bun run check:m1-run-once
bun run check:url-watch-queue
bun run check:xiaoyuzhou-podcast-processing
```

Other deterministic checks remain available:

```bash
bun run check:sqlite
bun run check:query-export
bun run check:skip-resume
bun run check:object-storage
bun run check:golden-eval
bun run check:workspace
bun run check:watch-crud
bun run check:watch-scheduler
bun run check:rss-polling
bun run check:episode-processing-queue
bun run check:metadata-relevance
bun run check:daily-brief
bun run check:inbox-feedback-detail
bun run check:auth-usage
```

Current key coverage:

- `check:audio-formats`: direct audio extension support and Volcengine auth header precedence.
- `check:connectors`: connector routing, Listen Notes no-key behavior, text query routing, and Ximalaya audio URL normalization.
- `check:preview-ui`: simplified Web entry points, no mock fallback, Agent execution panel, button busy state, episode report rendering, audio verification, timestamp seek buttons, and feedback.
- `check:start-script`: `start`, `status`, `restart`, `run-once`, and `stop` process-management behavior against an isolated preview server.
- `check:web-m15`: local web session, workspace-scoped service helpers, inbox/detail hydration, feedback, and playback usage events.
- `check:m1-run-once`: due Watch polling, RSS discovery, metadata relevance, queue processing, and insight publication in one deterministic worker call.
- `check:url-watch-queue`: URL source Watches queue and process newly discovered episodes instead of filtering them out as unrelated.
- `check:xiaoyuzhou-podcast-processing`: Xiaoyuzhou podcast pages resolve recent episodes with direct audio URLs.

## Demo / Fixture Commands

The repo still includes deterministic demo paths for development checks:

```bash
bun apps/worker/src/cli.ts demo
bun apps/worker/src/cli.ts process-transcript evals/golden/ai-agent-sample-transcript.json
```

`demo` uses the mock provider and is not used by the Web preview. The Web preview is intentionally configured to fail with a clear configuration error if real Volcengine/Codex processing is unavailable.
