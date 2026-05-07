# Podcast Note

Podcast Note is a podcast intelligence platform. Users create Watches for topics, podcasts, or entities; the system discovers matching episodes, transcribes them, extracts grounded insights, and delivers briefs.

The current implementation is the M0 scaffold:

- Core domain types and utility functions.
- RSS, Listen Notes, Apple Podcasts, Spotify, YouTube, Xiaoyuzhou, and manual URL connectors.
- AI provider interfaces with a deterministic mock provider for demos, a Codex non-interactive insight provider for real summary/insight extraction, and a Volcengine ASR provider for transcription.
- Worker CLI that can process a transcript fixture into grounded insights.
- Initial Postgres migration aligned with the PRD and technical design.

## Documents

- [PRD](./docs/podcast-intelligence-prd.md)
- [Technical design](./docs/technical-design-implementation.md)

## M0 Demo

```bash
bun apps/worker/src/cli.ts demo
```

Or process a transcript file:

```bash
bun apps/worker/src/cli.ts process-transcript evals/golden/ai-agent-sample-transcript.json
```

`demo` uses a mock AI provider so it can run without external APIs. `process-transcript` uses `codex exec` non-interactive mode for real text analysis.

## Real Local Flow

Create local inputs from the examples:

```bash
cp inputs/watch.example.json inputs/watch.json
cp inputs/sources.example.json inputs/sources.json
```

Then run:

```bash
bun apps/worker/src/cli.ts process-sources
```

The real flow reads user-friendly topic/source inputs, resolves public audio URLs, transcribes with Volcengine ASR, analyzes text with `codex exec`, and writes per-episode files under `outputs/<episode-slug>/`:

- `transcript.json`
- `report.md`
- `result.json`

It also persists Watches, Sources, Episodes, Transcripts, Segments, Summaries, and Insights to SQLite at `storage/podcast-note.sqlite` by default. When processing the same episode again, the worker reuses the latest stored transcript instead of calling ASR again, then continues analysis/export from that transcript. Override the path with:

```bash
bun apps/worker/src/cli.ts process-sources --db storage/custom.sqlite
```

Transcript JSON and audio cache objects use an object storage adapter. M0 ships a local adapter that writes to `storage/objects` by default and uses production-compatible keys:

```text
transcripts/<episode_id>/<provider>-<model>.json
audio-cache/<episode_id>/<sha256>.<ext>
```

Set `PODCAST_NOTE_OBJECT_STORAGE_DIR` to point the local adapter at another root directory.

Run the deterministic M0/M1 checks with:

```bash
bun run check:imports
bun run check:sqlite
bun run check:query-export
bun run check:skip-resume
bun run check:object-storage
bun run check:connectors
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

`check:workspace` covers the first M1 foundation slice: user upsert, idempotent personal workspace creation, and listing Watches scoped to that workspace.

`check:watch-crud` covers the next M1 slice: creating a Watch inside a workspace, reading/updating/deleting it through scoped repository methods, preserving the `enabled` flag, and rejecting cross-workspace access.

`check:watch-scheduler` covers the M1 Scheduler precursor slice: listing enabled Watches, recording poll history, deciding due Watches from `frequency` and `backfillDays`, and planning polling job inputs with workspace/watch metadata.

`check:rss-polling` covers the M1 RSS polling slice: taking a planned polling job, resolving its RSS source, discovering candidate episodes with the job `since` window, deduplicating candidates by stable episode ids, upserting new episodes, and recording poll counts.

`check:episode-processing-queue` covers the M1 processing queue slice: turning newly discovered episodes into idempotent queued jobs, claiming jobs for workers, attaching processing runs, and marking completed/failed states.

`check:metadata-relevance` covers the M1 metadata relevance slice: scoring title/description/source metadata against Watch query/include/exclude terms, storing score/reason on jobs, and filtering below-threshold episodes before processing.

`check:daily-brief` covers the M1 email brief slice: selecting published insights by workspace/day window, rendering a deterministic daily brief, using a mock email provider, recording sent/skipped/failed outcomes, and preventing duplicate sends for the same user/date.

`check:inbox-feedback-detail` covers the M1 product loop slice: querying inbox items with episode/watch metadata, saving feedback actions (`saved`/`irrelevant`/`wrong`/`archived`), filtering by feedback, and loading episode detail with transcript/summary/insights.

`check:auth-usage` covers the M1 auth/usage slice: creating lightweight user sessions, resolving valid tokens to user/workspace context, rejecting expired/revoked sessions, and recording usage events such as view/playback.

## Source Connectors

M0 source resolution now supports both feed/manual inputs and production-oriented podcast platform URLs:

- RSS feeds: `https://example.com/feed.xml`
- Listen Notes podcast/episode ids or URLs: `listennotes:<id>` or `https://www.listennotes.com/...`
- Apple Podcasts public pages: `https://podcasts.apple.com/...`
- Spotify public pages: `https://open.spotify.com/...`
- YouTube public pages: `https://youtube.com/...` and `https://youtu.be/...`
- Xiaoyuzhou public pages: `https://www.xiaoyuzhoufm.com/...`
- Manual public pages/direct audio URLs as the final fallback

`LISTEN_NOTES_API_KEY` enables full Listen Notes API metadata and episode listing. Without it, the Listen Notes connector runs in metadata-only mode so local routing checks and no-key development remain stable.

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
