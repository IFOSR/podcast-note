# PodcastNote x LLM Wiki 融合方案

日期：2026-06-17

## 1. 结论

PodcastNote 已经具备“监控频道 -> 发现单集 -> 转写 -> 结构化摘要和 insight -> SQLite 持久化 -> Web/飞书推送”的核心闭环。下一步最值得做的不是再加一个通用 RAG 问答层，而是把 PodcastNote 变成一个面向 Obsidian 的“播客知识编译器”：

```text
监控源 / 播客单集
  -> PodcastNote 发现、转写、提炼证据型 insight
  -> raw/ 中沉淀不可变来源笔记
  -> wiki/ 中增量维护主题页、实体页、观点页、趋势页
  -> index.md / log.md / health.md 形成可持续维护的知识库操作层
  -> Obsidian 浏览、检索、图谱和人工修订
  -> 飞书云文档发布阶段性方案、日报/周报和共享版报告
```

这条路线和 LLM Wiki 的核心思想一致：知识不是每次提问时从原始材料里临时检索和重组，而是随着新材料进入，持续被编译成一个可读、可链接、可维护、可审计的 wiki。

## 2. 现状 review

### 2.1 当前项目已经具备的能力

从代码和文档看，PodcastNote 当前已经落地了以下能力：

- Monorepo 结构清晰：`apps/web` 是本地 Web preview，`apps/worker` 是发现、转写、分析、队列和检查脚本，`packages/core` 负责类型、分段、groundedness、格式化和去重，`packages/db` 负责 SQLite，`packages/connectors` 负责 RSS / Listen Notes / Apple / Spotify / YouTube / 小宇宙 / manual 解析，`packages/ai` 负责 ASR 与 insight provider，`packages/lark` 负责飞书 bot 和授权相关能力。
- Web preview 已经区分单次处理和监控任务：`/` 处理单个链接，`/monitor` 管理持续监控。
- Worker pipeline 已经复用到 CLI 和 Web：`apps/worker/src/process-sources.ts` 调用 connector、ASR、`processTranscript`、SQLite 保存、Markdown report 导出和飞书消息推送。
- 数据模型已经覆盖知识沉淀的关键原料：workspace、watch、source、episode、transcript、episode_segments、episode_summaries、insights、feedback、processing_runs、episode_processing_jobs、daily_briefs。
- 每条 insight 已经具备知识库所需的 provenance：`episodeId`、`watchId`、`claim`、`evidenceExcerpt`、`timestampStartSec`、`timestampEndSec`、`entities`、`relevanceScore`、`confidence`、`groundednessScore`。
- 现有 Markdown report 已经能作为第一版 Obsidian raw note 的基础，只是还没有按 vault 约定、frontmatter、wikilinks、索引和增量维护机制来组织。

### 2.2 当前缺口

- 缺少 Obsidian vault export：目前 `outputs/<episode-slug>/report.md` 是一次性报告，不是稳定的知识库目录结构。
- 缺少 LLM Wiki 的三层结构：不可变 raw source、可变 wiki synthesis、schema/操作规范还没有明确分层。
- 缺少增量编译器：新 insight 只被保存和推送，没有自动更新主题页、实体页、观点页、趋势页。
- 缺少知识演化日志：`processing_runs` 记录任务运行，但没有面向知识库的 `log.md`，不能表达“今天哪些 wiki 页面被新增/修订/废弃/发现矛盾”。
- 缺少健康检查：还不能自动发现孤立页面、缺证据观点、矛盾观点、过期结论、重复实体、缺少反向链接。
- 缺少人工审阅闸门：当前 insight 可保存/标错，但还没有“进入 wiki 前需要人工确认”的队列。
- 飞书集成偏消息流：当前更适合推送处理结果，不适合直接维护云文档知识库；云文档适合阶段性报告、方案和共享版 brief。

## 3. LLM Wiki 可借鉴的核心模式

### 3.1 关键思想

Karpathy 的 LLM Wiki 模式把知识库分成三层：

- Raw sources：用户精选的原始资料，LLM 只读不改，是事实来源。
- Wiki：LLM 生成和维护的 Markdown 页面，包括 summary、entity、concept、comparison、synthesis、overview。
- Schema：指导 LLM 如何组织页面、如何引用来源、如何执行 ingest/query/lint 的约定文件。

这个模式和传统 RAG 的差异是：RAG 多数时候在提问时临时检索和重组，LLM Wiki 则在资料进入时就把知识编译进 wiki。wiki 是会持续增长和修订的产物，不只是索引。

LLM Wiki 的公开实现 `lucasastorian/llmwiki` 也强化了几个工程点：

- 以普通 Markdown wiki 为核心，支持原始文件、wiki 页面和索引/缓存分层。
- 通过 MCP 让 Claude/Codex 等 agent 读取、搜索、创建、编辑、追加、删除和 lint wiki。
- 支持 web app、Chrome clipper、local/hosted 两种模式。
- 强调 cross-link、source citation、graph viewer、nightly routine、lint health check。

### 3.2 对 PodcastNote 的启发

PodcastNote 的优势是它能持续捕获“音频世界的新资料”，而 LLM Wiki 的优势是它能把持续进入的资料变成“不断更新的结构化知识”。两者结合后，PodcastNote 不只是播客摘要器，而是一个可持续更新的音频知识操作系统。

重点不应是“用户问一个问题，系统从 transcript 里 RAG 回答”，而应是：

- 每个新播客单集先变成可审计 raw note。
- 每条 high-confidence insight 触发 wiki candidate。
- 每个 candidate 被合并到主题、实体、观点、趋势页。
- 每次合并都记录引用、来源、时间戳和修改日志。
- 用户在 Obsidian 里看到的是已经整理好的知识网络，而不是一堆摘要文件。

## 4. 产品形态

### 4.1 用户体验

用户配置监控任务后，PodcastNote 每天/每周自动完成：

1. 发现新单集。
2. 转写音频。
3. 抽取带证据的 insight。
4. 生成单集 raw note。
5. 生成 wiki update proposal。
6. 自动或半自动更新 Obsidian vault。
7. 生成 `log.md` 记录本次知识库变化。
8. 在飞书推送“今天新增了哪些知识、哪些页面被更新、有哪些矛盾或待确认问题”。

用户主要在 Obsidian 里消费：

- `00 Inbox/`：待确认 insight、待合并候选、低置信或冲突内容。
- `10 Sources/`：每集播客的 raw note。
- `20 Concepts/`：主题概念页，例如 `AI Agent 商业化`、`MCP`、`企业工作流自动化`。
- `30 Entities/`：人物、公司、产品、播客、论文、书籍页。
- `40 Claims/`：稳定观点页，记录观点、支持证据、反例、变化历史。
- `50 Briefs/`：日报、周报、主题简报。
- `90 System/`：schema、index、log、health、prompt 版本、导出记录。

### 4.2 一句话定位

PodcastNote 是持续监听播客世界的采集器；Obsidian wiki 是持续沉淀和演化的知识库；LLM 是把新材料编译进知识库的维护者。

## 5. 推荐 vault 结构

```text
PodcastNote Vault/
  AGENTS.md
  index.md
  log.md
  health.md
  00 Inbox/
    2026-06-17 pending-insights.md
    conflicts.md
  10 Sources/
    Podcasts/
      2026/
        2026-06-17 - 硅谷101 - xxx.md
  20 Concepts/
    AI Agent 商业化.md
    企业工作流.md
    MCP.md
  30 Entities/
    People/
    Companies/
    Products/
    Podcasts/
  40 Claims/
    Agent 产品竞争转向工作流集成.md
  50 Briefs/
    Daily/
    Weekly/
    Topic/
  90 System/
    schema.md
    prompt-versions.md
    export-state.json
    aliases.md
  assets/
    audio-clips/
    images/
```

### 5.1 Raw source note 模板

```markdown
---
type: podcast_episode
episode_id: ep_xxx
source_id: src_xxx
watch_ids:
  - watch_xxx
title: "..."
podcast: "[[硅谷101]]"
published_at: 2026-06-17
processed_at: 2026-06-17T10:30:00+08:00
duration_sec: 3600
page_url: "https://..."
audio_url: "https://..."
transcript_provider: volcengine
summary_model: gpt-5.5
tags:
  - podcast/source
---

# ...

## 一句话

...

## 总结

...

## 值得听吗

...

## 章节

- [00:00](...) ...

## Insights

### Agent 产品竞争转向企业工作流

Claim:: ...
Evidence:: ...
Timestamp:: 12:34-13:20
Entities:: [[Cursor]], [[Claude Code]], [[企业工作流]]
Relevance:: 0.87
Confidence:: 0.82
Groundedness:: 0.91
Promote:: pending

## Transcript Excerpts

...
```

### 5.2 Concept page 模板

```markdown
---
type: concept
status: active
aliases:
  - AI Agent commercialization
source_count: 12
last_updated: 2026-06-17
confidence: medium
tags:
  - concept/ai
---

# AI Agent 商业化

## 当前综合判断

...

## 关键观点

- [[Agent 产品竞争转向企业工作流集成]]
- [[企业客户更关心可审计半自动执行]]

## 最新变化

- 2026-06-17: 来自 [[2026-06-17 - ...]] 的观点强化了“企业工作流”方向。

## 支持证据

...

## 反例与矛盾

...

## 相关实体

[[OpenAI]]、[[Anthropic]]、[[Cursor]]

## 相关来源

...
```

### 5.3 Claim page 模板

```markdown
---
type: claim
status: active
claim_id: claim_xxx
created_at: 2026-06-17
last_updated: 2026-06-17
confidence: medium
support_count: 3
counter_count: 1
tags:
  - claim
---

# Agent 产品竞争转向企业工作流集成

## 观点

...

## 为什么重要

...

## 支持证据

- [[2026-06-17 - ...#Agent 产品竞争转向企业工作流]] 12:34-13:20

## 反方/限制

...

## 演化历史

- 2026-06-17: 初次形成。
```

## 6. 系统设计

### 6.1 新增模块

建议新增一个独立 package：

```text
packages/wiki/
  src/
    types.ts
    vault.ts
    render-episode-note.ts
    render-index.ts
    render-log.ts
    proposal.ts
    lint.ts
```

职责：

- 将 `EpisodeProcessingResult` 渲染为 Obsidian raw note。
- 将 insight 转成 `WikiUpdateProposal`。
- 管理 vault 文件路径、frontmatter、wikilinks、slug、冲突文件命名。
- 维护 `index.md`、`log.md`、`health.md`。
- 提供 deterministic lint，避免所有维护都依赖 LLM。

### 6.2 新增数据表

SQLite 中新增最小表：

```sql
create table wiki_exports (
  id text primary key,
  workspace_id text not null,
  vault_root text not null,
  episode_id text references episodes(id) on delete cascade,
  watch_id text references watches(id) on delete set null,
  export_type text not null check (export_type in ('source_note', 'brief', 'proposal', 'wiki_page')),
  file_path text not null,
  content_hash text not null,
  status text not null check (status in ('written', 'skipped', 'failed')),
  error text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  unique (workspace_id, export_type, file_path)
);

create table wiki_update_proposals (
  id text primary key,
  workspace_id text not null,
  episode_id text not null references episodes(id) on delete cascade,
  insight_id text references insights(id) on delete cascade,
  target_path text not null,
  proposal_type text not null check (proposal_type in ('create_page', 'append_evidence', 'revise_summary', 'flag_conflict', 'add_crosslink')),
  title text not null,
  rationale text not null,
  patch_json text not null,
  status text not null check (status in ('pending', 'approved', 'applied', 'rejected', 'failed')),
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);
```

### 6.3 Pipeline 扩展点

当前 `processSourceInputs` 的处理顺序是：

```text
resolve -> transcribe -> analyze -> saveProcessingResult -> maybeDeliverToLark -> export report.md
```

建议改为：

```text
resolve
  -> transcribe
  -> analyze
  -> saveProcessingResult
  -> export source note to Obsidian
  -> create wiki update proposals
  -> optionally auto-apply safe proposals
  -> update index/log/health
  -> deliver Feishu summary
```

这里的关键是：`source note` 必须 deterministic，默认自动写；`wiki synthesis` 可以先 proposal 化，避免 LLM 背景任务误改用户知识库。

### 6.4 Wiki compiler prompt

新增一个专用 prompt version：

```ts
promptVersions.wikiProposal = "wiki-proposal-v1";
promptVersions.wikiApply = "wiki-apply-v1";
promptVersions.wikiLint = "wiki-lint-v1";
```

`wiki-proposal-v1` 输入：

- 当前 episode summary。
- published insights。
- entities。
- 相关已有 wiki 页面摘要。
- `AGENTS.md` / `schema.md` 规则。
- index.md 中相关条目。

输出：

```json
{
  "proposals": [
    {
      "type": "append_evidence",
      "targetPath": "20 Concepts/AI Agent 商业化.md",
      "title": "补充企业工作流证据",
      "rationale": "新单集提供了支持现有观点的直接证据",
      "citations": [
        {
          "episodeId": "ep_xxx",
          "insightId": "ins_xxx",
          "timestampStartSec": 754,
          "timestampEndSec": 800
        }
      ],
      "patch": {
        "section": "支持证据",
        "operation": "append",
        "markdown": "- 2026-06-17: ..."
      }
    }
  ]
}
```

## 7. Obsidian 集成策略

### 7.1 MVP 只写本地 Markdown

优先不接 Obsidian 插件 API，直接写文件。原因：

- Obsidian vault 本质是文件夹，最稳定。
- 用户可以自己用 Obsidian 打开、搜索、图谱、Dataview。
- 方便 git 版本管理和 diff。
- Worker 可以在无 UI 环境运行。

配置新增：

```bash
PODCAST_NOTE_OBSIDIAN_VAULT=/home/ylfego/Documents/PodcastNoteVault
PODCAST_NOTE_WIKI_AUTO_APPLY=false
PODCAST_NOTE_WIKI_MIN_CONFIDENCE=0.75
PODCAST_NOTE_WIKI_MIN_GROUNDEDNESS=0.8
PODCAST_NOTE_WIKI_PROPOSAL_PROVIDER=deepseek-tui
DEEPSEEK_TUI_COMMAND=deepseek-tui
```

### 7.2 写入安全

- 不覆盖用户手动编辑：写入前比较 `content_hash`，如果目标文件已被外部修改，创建 `.conflict.md` 或生成 pending proposal。
- raw note 幂等：同一个 `episode_id` 只更新系统管理区块，例如 `<!-- podcast-note:start -->` 到 `<!-- podcast-note:end -->`。
- wiki synthesis 默认 proposal：只有置信度高、目标页面明确、patch 可局部应用时才自动合并。
- 每次写入都追加 `log.md`。

### 7.3 Dataview 支持

所有页面写 YAML frontmatter，方便 Obsidian Dataview 查询：

```dataview
TABLE source_count, confidence, last_updated
FROM "20 Concepts"
WHERE type = "concept"
SORT last_updated DESC
```

```dataview
TABLE podcast, published_at, confidence
FROM "10 Sources"
WHERE type = "podcast_episode"
SORT published_at DESC
```

## 8. 飞书云文档策略

飞书不建议作为第一版知识库写入层，原因是：

- Obsidian 的 wikilink、frontmatter、graph、git diff 更适合 LLM Wiki。
- 飞书 API 写复杂文档块和增量编辑成本高于写 Markdown 文件。
- 当前项目的飞书能力主要是 bot 消息推送和绑定，不是云文档知识库维护。

飞书适合做三类输出：

- 方案文档：例如本文，作为共享和评审入口。
- Daily/Weekly brief：把今日新增知识、重要观点、冲突提醒发到飞书。
- Topic report：按主题导出阶段性报告，供团队协作评论。

后续如果需要飞书知识库空间，可做单向发布：

```text
Obsidian / Markdown source of truth
  -> render selected pages
  -> lark-cli docs +create / +update
  -> 保存飞书 doc token 到 wiki_exports
```

## 9. 知识生成机制

### 9.1 从 insight 到知识页

每条 published insight 分三步处理：

1. Classification：判断它是新观点、已有观点的证据、反例、实体事实、趋势信号还是低价值摘要。
2. Retrieval：从 `index.md` 和已有页面中找最相关的 3-8 个页面。
3. Proposal：生成页面创建/追加/修订/冲突标记建议。

### 9.2 新知识的类型

- Concept synthesis：多个播客都在谈同一主题时，更新主题综合判断。
- Entity profile：人物、公司、产品被反复提及时，形成实体页。
- Claim evolution：同一观点被多次支持或挑战时，形成观点页。
- Trend brief：某个 watch 在一周内出现多个相关 insight，形成趋势页或周报。
- Question backlog：模型发现证据不足或矛盾时，生成待研究问题。

### 9.3 让知识不断生成新知识

建议引入三类定时任务：

- Nightly ingest：处理当天新增单集，把 safe proposal 写入 vault。
- Weekly synthesis：按 watch 聚合本周 insight，更新主题页和周报。
- Monthly lint：扫描 orphan pages、矛盾、过期结论、缺证据观点、重复实体，生成 health report。

这对应 LLM Wiki 的 ingest / query / lint 三个操作，但 PodcastNote 的 ingest 来源是持续监控的播客流。

## 10. 分阶段实施计划

### M1：Obsidian source note 导出

目标：所有已处理单集自动进入 Obsidian。

范围：

- 新增 `packages/wiki` 基础渲染器。
- 新增 vault 配置。
- 将 `EpisodeProcessingResult` 导出到 `10 Sources/Podcasts/...md`。
- 为每个 note 加 frontmatter、wikilinks、timestamp、证据片段、source URL。
- 新增 `wiki_exports` 表记录写入状态。
- CLI 增加 `export obsidian` 命令。

验收：

- 对同一个 episode 重跑不会重复生成文件。
- 用户手动编辑后不会被静默覆盖。
- Obsidian 打开后能看到来源、实体、insight 和反向链接。

### M2：Wiki proposal 队列

目标：把 insight 转为可审阅的知识库更新建议。

范围：

- 新增 `wiki_update_proposals`。
- 新增 `wiki-proposal-v1` provider。
- 生成 `00 Inbox/YYYY-MM-DD pending-insights.md`。
- Web 或 CLI 提供 approve/reject/apply。
- 飞书推送今日 pending proposal 摘要。

验收：

- 每条 proposal 都能追溯到 insight 和 timestamp。
- 不确定内容不会直接改 wiki synthesis。
- 用户可以批量批准高置信 proposal。

### M3：自动维护 wiki synthesis

目标：让知识页自动生长。

范围：

- 自动创建/更新 `20 Concepts`、`30 Entities`、`40 Claims`。
- 更新 `index.md`、`log.md`、`health.md`。
- 支持 conflict page。
- 加 deterministic lint：frontmatter、wikilink、citation、orphan、stale。

验收：

- 新增一集高质量播客后，相关 concept/entity/claim 页面自动更新。
- `log.md` 清楚记录变更。
- `health.md` 能列出下一步应该处理的问题。

### M4：飞书云文档发布

目标：把阶段性知识成果发布到飞书。

范围：

- 使用 `lark-cli docs +create/+update` 或项目内 `packages/lark` 封装云文档创建。
- 支持把 Weekly brief 或 Topic report 发布为飞书云文档。
- 保存 doc token、URL、版本、发布时间。

验收：

- 可从 CLI 一键发布本周 `AI Agent 商业化` 简报到飞书。
- 飞书文档包含来源链接和关键时间戳。
- Obsidian 仍是 source of truth。

## 11. 工程风险与控制

- LLM 误改知识库：默认 proposal，不默认改 synthesis；自动写只允许 raw source note 和 index/log 的系统区块。
- 幻觉和错引：所有 claim 必须绑定 `insight_id`、`episode_id`、timestamp、evidence excerpt；缺证据不能进入 claim page。
- 文件并发冲突：写入前检查 hash，冲突则生成 proposal 或 conflict 文件。
- 页面爆炸：实体页创建需要阈值，例如出现 2 次以上或被 high-confidence insight 引用。
- Obsidian 链接别名混乱：维护 `90 System/aliases.md`，统一实体 canonical name。
- 飞书和 Obsidian 双写不一致：只做从 Obsidian/Markdown 到飞书的单向发布。
- 成本失控：wiki proposal 使用摘要、insight 和相关页摘要，不直接塞全文 transcript。

## 12. 推荐下一步

优先做 M1 和 M2，不要直接做全自动 wiki agent。

第一周建议完成：

1. 定义 vault 结构和 `AGENTS.md`。
2. 新增 `packages/wiki`，实现 source note renderer。
3. 新增 `PODCAST_NOTE_OBSIDIAN_VAULT` 配置。
4. 在 `processSourceInputs` 保存处理结果后导出 Obsidian note。
5. 增加 `bun run check:obsidian-export`。
6. 手动处理 5-10 集你正在监控的播客，观察 Obsidian 里的信息结构是否舒服。

第二周再做：

1. `wiki_update_proposals` 表。
2. `wiki-proposal-v1` prompt。
3. `00 Inbox` pending proposal 页面。
4. 飞书推送今日知识库变化摘要。

## 13. 参考资料

- Karpathy, LLM Wiki gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- LLM Wiki app: https://llmwiki.app/
- lucasastorian/llmwiki: https://github.com/lucasastorian/llmwiki
- PodcastNote README: `README.md`
- PodcastNote 技术设计：`docs/technical-design-implementation.md`
- PodcastNote 飞书企业集成方案：`docs/feishu-enterprise-integration-plan.md`
