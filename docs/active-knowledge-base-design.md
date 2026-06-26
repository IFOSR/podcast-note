# Podcast Note 活知识库方案

日期：2026-06-26

## 1. 结论

Podcast Note 的知识库不应该只是“播客摘要归档”或“用户主动问答”。更合理的形态是一个会持续接收新音频材料、生成知识候选、更新综合判断、发现冲突、标记过期、归档旧结论的活知识库。

最终产品入口建议从当前三项：

```text
即时处理 / 监控任务 / 飞书集成
```

升级为四项：

```text
即时处理 / 监控任务 / 知识库 / 飞书集成
```

其中 `知识库` 是一级工作台，不是智能问答面板里的一个 tag。问答只是知识库的追问能力，核心价值应该来自后台主动生成的知识动态、待审更新、冲突提醒和衰退提醒。

## 2. 背景逻辑

LLM Wiki 的关键思想是：知识不是每次用户提问时才从原始材料里临时检索和拼装，而是在新材料进入时就被编译成持久、可链接、可审计的 wiki。

这和传统 RAG 的差异是：

- RAG 偏 query-time：用户问问题时检索 chunks，临时合成答案。
- LLM Wiki 偏 ingest-time 和 maintenance-time：新资料进入时，系统就更新 topic/entity/claim 页面，并维护引用、链接、健康状态和变更日志。

Podcast Note 的输入天然是持续流：监控任务会不断发现新播客、转写音频、抽取 insight。这个输入形态非常适合 LLM Wiki。否则系统只是在保存一堆单集摘要，用户仍然需要自己判断“本周观点有没有变化、哪些旧结论过期、哪里出现矛盾”。

## 3. 当前状态

当前已经具备的基础：

- 已有 `packages/wiki`，能把处理后的 episode 编译成 Obsidian source note。
- 已有 `wiki_update_proposals`，能把高置信 insight 转成 pending proposal。
- 已有 `00 Inbox` pending note、`index.md`、`log.md`、`health.md`。
- 已有 CLI 审批和应用 proposal：`wiki:proposal-status`、`wiki:apply-proposals`。
- 已有飞书 pending proposal 摘要推送。
- 已有本地命令行 LLM provider：DeepSeek TUI 优先，Kimi Code fallback。

当前缺口：

- Web 里的“问知识库”只是智能问答示例按钮，不是真正知识库页面。
- Web assistant 目前主要传 `activeWatches` 和 `recentEpisodes`，没有真正检索 wiki pages、insights、citations。
- 没有后台 synthesis job，无法定期更新主题/实体/观点页的综合判断。
- 没有 freshness / decay / archive 机制。
- 没有 conflict scanner，虽然 proposal type 支持 `flag_conflict`。
- 没有知识动态 Feed，用户无法主动看到知识库今天发生了什么变化。

## 4. 产品信息架构

新增一级页面：

```text
/wiki
  知识库
```

首页顶部入口：

```text
即时处理 | 监控任务 | 知识库 | 飞书集成
```

`/wiki` 页面建议分成六个模块。

### 4.1 知识库总览

显示当前活知识库健康度：

- 活跃知识页数
- 本周新增 claim 数
- 本周更新 concept/entity 数
- 待审 proposal 数
- 冲突提醒数
- stale/deprecated 页面数
- 最近一次 synthesis 时间

### 4.2 知识动态 Feed

这是活知识库的核心产品面。

Feed item 类型：

- `new_claim`：新观点形成。
- `concept_updated`：主题综合判断被更新。
- `entity_evidence_added`：实体新增证据。
- `conflict_detected`：新 insight 与旧 claim 冲突。
- `marked_stale`：旧结论进入衰退状态。
- `archived`：旧页面退出主知识面。
- `brief_generated`：生成日报/周报/主题简报。

每条 feed 必须带：

- 标题
- 变化摘要
- 影响页面
- 关联 episode
- 证据 timestamp
- proposal id 或 applied export id
- 操作：查看证据、批准、拒绝、追问

### 4.3 待审更新

显示 `wiki_update_proposals`。

用户可以：

- approve
- reject
- apply
- 查看证据
- 打开 Obsidian 路径
- 打开源播客 timestamp
- 让 LLM 解释为什么建议更新

### 4.4 冲突提醒

冲突提醒应该独立展示，不应该埋在普通 proposal 里。

冲突卡片内容：

- 旧 claim
- 新 insight
- 支持旧 claim 的证据
- 反驳或挑战旧 claim 的证据
- 影响范围：topic/entity/claim 页面
- 建议动作：标记 contested、修订综合判断、归档旧 claim、保留观察

### 4.5 衰退知识

显示 freshness 降低的知识页。

状态：

- `active`
- `stale`
- `contested`
- `deprecated`
- `archived`

用户可以看到：

- 上次被支持时间
- 最近反证数量
- source count
- freshness score
- 系统建议原因

### 4.6 Ask Wiki

保留主动问答，但必须升级为真正知识库问答。

回答要求：

- 必须引用 wiki page 或 insight。
- 必须带 episode title、timestamp、source URL。
- 如果知识库没有足够材料，明确说不足。
- 如果存在冲突，回答中必须说明“当前知识库中有冲突观点”。

## 5. 知识库目录结构

建议 Obsidian vault 结构：

```text
PodcastNote Vault/
  index.md
  log.md
  health.md
  00 Inbox/
    2026-06-26 pending-insights.md
    conflicts.md
  10 Sources/
    Podcasts/
      2026/
        2026-06-26 - episode-title.md
  20 Concepts/
    AI Agent 商业化.md
  30 Entities/
    People/
    Companies/
    Products/
    Podcasts/
  40 Claims/
    Agent 产品竞争转向企业工作流集成.md
  50 Briefs/
    Daily/
    Weekly/
    Topic/
  80 Archive/
    Claims/
    Concepts/
    Entities/
  90 System/
    schema.md
    aliases.md
    prompt-versions.md
    export-state.json
```

原则：

- `10 Sources` 是 provenance 层，不删除。
- `20/30/40` 是活 synthesis 层，会更新、衰退、归档。
- `80 Archive` 是退出主知识面的 synthesis，不是垃圾箱。
- `00 Inbox` 是审阅闸门。

## 6. 页面结构

### 6.1 Source Note

Source note 由系统确定性生成，重跑幂等。

```markdown
---
type: podcast_source
episode_id: episode_xxx
watch_id: watch_xxx
processed_at: 2026-06-26
---

# Episode Title

## Summary

...

## Insights

- Claim...
  - Evidence: ...
  - Timestamp: 12:30-13:10
  - insight_id: insight_xxx
```

### 6.2 Synthesis Page

Synthesis 页面只允许系统改 managed block，不覆盖用户手写区。

```markdown
---
type: concept
status: active
source_count: 12
confidence_score: 0.82
freshness_score: 0.76
contradiction_count: 1
last_supported_at: 2026-06-26
last_contradicted_at: 2026-06-24
last_reviewed_at: 2026-06-26
---

# AI Agent 商业化

<!-- podcast-note:synthesis:start -->
## 当前综合判断

...
<!-- podcast-note:synthesis:end -->

<!-- podcast-note:evidence:start -->
## 支持证据

...
<!-- podcast-note:evidence:end -->

<!-- podcast-note:conflicts:start -->
## 冲突与反证

...
<!-- podcast-note:conflicts:end -->

## 我的笔记

用户可以在这里自由写，系统不能覆盖。
```

## 7. 数据模型

### 7.1 `wiki_pages`

记录每个 wiki 页面在系统中的状态。

```sql
create table wiki_pages (
  id text primary key,
  workspace_id text not null,
  vault_root text not null,
  path text not null,
  page_type text not null check (page_type in ('concept', 'entity', 'claim', 'source', 'brief')),
  title text not null,
  status text not null check (status in ('active', 'stale', 'contested', 'deprecated', 'archived')),
  source_count integer not null default 0,
  confidence_score real not null default 0,
  freshness_score real not null default 1,
  contradiction_count integer not null default 0,
  last_supported_at text,
  last_contradicted_at text,
  last_reviewed_at text,
  content_hash text,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp,
  unique(workspace_id, vault_root, path)
);
```

### 7.2 `wiki_page_evidence`

记录页面与 insight 的证据关系。

```sql
create table wiki_page_evidence (
  id text primary key,
  workspace_id text not null,
  page_id text not null,
  insight_id text not null,
  episode_id text not null,
  watch_id text,
  support_type text not null check (support_type in ('supporting', 'contradicting', 'context')),
  claim text not null,
  evidence_excerpt text not null,
  timestamp_start_sec integer,
  timestamp_end_sec integer,
  confidence real not null default 0,
  groundedness_score real not null default 0,
  observed_at text not null,
  created_at text not null default current_timestamp,
  unique(page_id, insight_id, support_type)
);
```

### 7.3 扩展 `wiki_update_proposals`

新增 proposal 类型：

```text
refresh_synthesis
mark_stale
mark_deprecated
archive_page
```

最终 proposal type：

```text
create_page
append_evidence
revise_summary
refresh_synthesis
flag_conflict
add_crosslink
mark_stale
mark_deprecated
archive_page
```

Patch operation：

```text
create
append
replace_managed_section
set_frontmatter
move
```

## 8. 后台任务

### 8.1 `wiki:synthesize`

目的：让知识页生长。

输入：

- 最近 N 天 published insights
- 已有 wiki pages
- 已有 page evidence
- 当前 active watches

输出：

- `create_page`
- `append_evidence`
- `refresh_synthesis`
- `flag_conflict`
- `add_crosslink`

命令：

```bash
bun apps/worker/src/cli.ts wiki:synthesize \
  --vault /path/to/vault \
  --workspace-id <workspace_id> \
  --since-days 7
```

### 8.2 `wiki:decay`

目的：发现旧知识衰退。

输入：

- wiki pages
- page evidence
- 最近支持/反证时间
- orphan lint 结果

输出：

- `mark_stale`
- `mark_deprecated`
- `archive_page`

命令：

```bash
bun apps/worker/src/cli.ts wiki:decay \
  --vault /path/to/vault \
  --workspace-id <workspace_id> \
  --stale-days 90
```

### 8.3 `wiki:ask`

目的：真正的知识库问答。

输入：

- 用户问题
- matching wiki pages
- matching insights
- source note snippets

输出：

- answer
- citations
- related pages
- unresolved questions
- conflict warnings

命令：

```bash
bun apps/worker/src/cli.ts wiki:ask \
  --workspace-id <workspace_id> \
  --question "最近播客里关于 AI Agent 商业化有什么结论？"
```

### 8.4 `wiki:feed`

目的：生成 Web `/wiki` 的知识动态。

输入：

- wiki proposals
- wiki exports
- wiki pages
- conflicts
- decay status changes

输出：

- feed items
- counts
- highlights

命令：

```bash
bun apps/worker/src/cli.ts wiki:feed \
  --workspace-id <workspace_id> \
  --since-days 7
```

## 9. 衰退评分

初版用 deterministic score，不直接依赖 LLM。

```text
freshness_score =
  time_decay(last_supported_at)
  + support_boost(recent_supporting_evidence)
  - contradiction_penalty(recent_contradictions)
  - orphan_penalty(orphan_page)
```

建议规则：

- `last_supported_at <= 30 days`：`1.0`
- `31-90 days`：`0.7`
- `91-180 days`：`0.4`
- `>180 days`：`0.2`
- 最近 supporting evidence：每条 `+0.05`，最多 `+0.2`
- 最近 contradicting evidence：每条 `-0.2`
- orphan page：`-0.1`

状态转换：

```text
active -> stale: freshness_score < 0.5
active/stale -> contested: contradiction_count >= 2
stale -> deprecated: freshness_score < 0.3 且 90 天无支持
deprecated -> archived: deprecated 超过 60 天，且无人恢复
```

所有状态转换默认生成 proposal，不直接改页面。

## 10. 冲突检测

冲突检测不应该简单用关键词判断。最低要求是 LLM 输出 evidence pair：

```json
{
  "proposalType": "flag_conflict",
  "targetPath": "40 Claims/example.md",
  "oldClaim": "...",
  "newClaim": "...",
  "supportingEvidence": {
    "insightId": "insight_old",
    "episodeId": "episode_old",
    "timestampStartSec": 120
  },
  "contradictingEvidence": {
    "insightId": "insight_new",
    "episodeId": "episode_new",
    "timestampStartSec": 300
  },
  "rationale": "..."
}
```

没有成对证据，不允许进入 conflict proposal。

## 11. 主动推送

活知识库必须主动推送，否则用户感知不到知识在生长。

推送渠道：

- Web `/wiki` Feed
- 飞书私聊或群
- Weekly brief

推送内容：

- 今日新增知识
- 本周重要综合判断变化
- 待审 proposal
- 冲突提醒
- stale/deprecated 候选
- 可点击查看证据和 timestamp

默认频率：

- 每日：pending proposal 和重要冲突
- 每周：知识变化 summary
- 每月：衰退和归档建议

## 12. 自动化边界

允许自动 apply：

- `append_evidence`
- `add_crosslink`
- 安全 frontmatter 更新，例如 `source_count`、`last_supported_at`

默认 pending：

- `refresh_synthesis`
- `revise_summary`
- `flag_conflict`
- `mark_stale`
- `mark_deprecated`
- `archive_page`

永远不做：

- 删除 source note
- 覆盖用户手写 Markdown
- 无 citation 的 claim
- 无证据 pair 的 conflict
- 直接归档 active 高置信页面

## 13. LLM 使用方式

沿用本地命令行 LLM provider：

- DeepSeek TUI first
- Kimi Code fallback
- 非交互命令行调用

建议分工：

- insight extraction：现有 command-line provider
- proposal generation：DeepSeek TUI provider 或 command-line provider
- decay scoring：deterministic first
- conflict explanation：LLM 参与，但必须结构化输出 evidence pair
- Ask Wiki：LLM 生成答案，但检索和 citation 由系统提供

## 14. Web UI 方案

### 14.1 顶部导航

```text
Podcast Note

[即时处理] [监控任务] [知识库] [飞书集成]
```

### 14.2 `/wiki` 页面布局

```text
知识库总览
------------------------------------------------
活跃页面 | 本周新增 | 待审更新 | 冲突 | 衰退 | 健康分

左侧：知识动态 Feed              右侧：待审更新
------------------------------------------------
- AI Agent 商业化判断更新        - approve/reject
- 新增 OpenAI entity evidence     - 查看证据
- 发现旧 claim 冲突              - 打开 timestamp
- 某 claim 标记 stale             - 追问原因

下方：Ask Wiki
------------------------------------------------
输入问题 -> 带 citations 的回答
```

### 14.3 从当前 assistant panel 的迁移

当前“问知识库”示例按钮保留，但行为改成跳转或调用 `/wiki`：

- 在首页：按钮文案仍可叫 `问知识库`。
- 点击后进入 `/wiki?question=...`。
- `/wiki` 负责真正的知识库检索、引用和追问。

## 15. 测试计划

新增检查脚本：

```bash
bun run check:wiki-synthesis
bun run check:wiki-decay
bun run check:wiki-conflict
bun run check:wiki-archive
bun run check:wiki-feed
bun run check:wiki-ask
bun run check:wiki-active-knowledge-e2e
```

覆盖场景：

- 两集播客支持同一 topic，生成 `refresh_synthesis` proposal。
- 新 insight 支持已有 claim，追加 evidence。
- 新 insight 反驳旧 claim，生成 `flag_conflict`。
- 页面 180 天无支持，生成 `mark_stale`。
- stale 页面长期无支持，生成 `mark_deprecated`。
- approved archive proposal 把页面移动到 `80 Archive`。
- source note 永不删除。
- 用户手写区不被覆盖。
- Ask Wiki 回答必须带 citation。
- 无 citation 的回答失败。

## 16. 分阶段落地

### M1：Wiki Registry

目标：让系统知道 vault 里有哪些知识页，以及每页对应哪些 evidence。

范围：

- 新增 `wiki_pages`
- 新增 `wiki_page_evidence`
- compile/apply proposal 时写入 registry
- Web `/wiki` 先展示总览和 pending proposals

### M2：知识动态 Feed

目标：让用户看到知识库变化。

范围：

- 新增 `wiki:feed`
- Web `/wiki` 展示 feed
- 飞书推送每日 pending proposal summary 升级为 knowledge change summary

### M3：Synthesis

目标：让知识页真正生长。

范围：

- 新增 `wiki:synthesize`
- 新增 `refresh_synthesis` proposal
- 支持 managed section replace
- Ask Wiki 可引用 synthesis pages

### M4：Decay

目标：让旧知识衰退。

范围：

- freshness score
- `wiki:decay`
- `mark_stale`
- `mark_deprecated`
- Web 展示衰退知识

### M5：Conflict

目标：发现观点冲突。

范围：

- conflict scanner
- evidence pair schema
- `flag_conflict` proposal
- Web 冲突提醒

### M6：Archive

目标：让无效知识退出主知识面。

范围：

- `archive_page` proposal
- move to `80 Archive`
- 保留 source note 和 evidence
- Web 展示归档历史

## 17. 验收标准

第一版活知识库完成时，应该满足：

- 用户可以从首页进入独立 `知识库` 页面。
- 用户不用提问，也能看到本周知识库发生了什么变化。
- 每条新知识都有 source、episode、timestamp、insight id。
- 系统能提出 synthesis 更新建议。
- 系统能提出 stale/deprecated 建议。
- 系统能发现至少一类 evidence-based conflict。
- 用户可以 approve/reject/apply proposal。
- Ask Wiki 回答带 citation。
- source note 不会被删除。
- 用户手写内容不会被覆盖。

## 18. 决策

建议做活知识库。

理由：

- Podcast Note 的监控源是持续流入的，活知识库正好解决“结论随时间演化”的问题。
- 用户真正关心的是“最近有什么新判断、哪些结论变了、哪里有冲突”，不是单集摘要本身。
- 只做被动问答会把价值藏起来，主动知识动态 Feed 才能让用户感知系统在工作。
- proposal-first 可以控制 LLM 写知识库的风险。

不建议做完全自动知识库 agent。

正确边界是：

- 自动发现。
- 自动生成候选。
- 自动计算衰退。
- 自动推送变化。
- 安全追加可以自动应用。
- 核心判断改写、冲突处理、归档必须先进入 proposal。

