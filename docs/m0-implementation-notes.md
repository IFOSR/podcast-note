# M0 Implementation Notes

Created: 2026-04-25

M0 has started with the smallest end-to-end path:

```text
Transcript fixture -> semantic segments -> episode summary -> watch-specific insights -> groundedness check -> Markdown report
```

## What Exists

- Root monorepo scaffold with Bun scripts.
- `packages/core`: domain types, dedupe, metadata scoring, segmenting, groundedness, formatting.
- `packages/connectors`: RSS, Listen Notes, Apple Podcasts, Spotify, YouTube, Xiaoyuzhou, and manual URL connectors.
- `packages/ai`: provider interfaces, deterministic mock provider for demos, Codex non-interactive insight provider for real summary/insight extraction, and Volcengine ASR provider for transcription.
- `packages/db`: initial SQLite schema, migration runner, and repositories.
- `apps/worker`: CLI and M0 transcript processing pipeline.
- `apps/web`: placeholder for M1 Web App.
- `evals/golden`: first sample transcript fixture.

## Run

```bash
bun apps/worker/src/cli.ts demo
```

Expected behavior:

- Reads `evals/golden/ai-agent-sample-transcript.json`.
- Builds semantic segments.
- Generates a mock episode summary for the demo command.
- Extracts Watch-specific insights.
- Filters insights through deterministic groundedness checks.
- Prints a Markdown report.

## Next M0 Tasks

1. ✅ Add SQLite-backed query/export commands for processed episodes, runs, and insights.
2. ✅ Add skip/resume behavior so completed transcripts can be reused instead of retranscribed.
3. ✅ Add object storage adapter for transcript JSON and audio cache.
4. ✅ Add production-grade source connectors beyond RSS/manual public pages.
5. ✅ Add golden eval script for precision, groundedness, and timestamp accuracy.
