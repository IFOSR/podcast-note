# M0 Implementation Notes

Created: 2026-04-25

M0 has started with the smallest end-to-end path:

```text
Transcript fixture -> semantic segments -> episode summary -> watch-specific insights -> groundedness check -> Markdown report
```

## What Exists

- Root monorepo scaffold with Bun scripts.
- `packages/core`: domain types, dedupe, metadata scoring, segmenting, groundedness, formatting.
- `packages/connectors`: RSS and manual URL connector skeletons.
- `packages/ai`: provider interfaces and deterministic mock provider.
- `packages/db`: initial Postgres migration.
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
- Generates a mock episode summary.
- Extracts Watch-specific insights.
- Filters insights through deterministic groundedness checks.
- Prints a Markdown report.

## Next M0 Tasks

1. Replace fixture-only input with RSS/manual URL processing.
2. Add persistent repositories for Postgres.
3. Add object storage adapter for transcript JSON and audio cache.
4. Add a real transcription provider adapter behind the existing interface.
5. Add golden eval script for precision, groundedness, and timestamp accuracy.

