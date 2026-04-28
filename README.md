# Podcast Note

Podcast Note is a podcast intelligence platform. Users create Watches for topics, podcasts, or entities; the system discovers matching episodes, transcribes them, extracts grounded insights, and delivers briefs.

The current implementation is the M0 scaffold:

- Core domain types and utility functions.
- RSS and manual URL connector skeletons.
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
