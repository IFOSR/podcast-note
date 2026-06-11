# Podcast Note 外部 Web 页面升级方案

## 1. 定位

外部 Web 端不是替代飞书端，而是 Podcast Note 的配置台、处理观察台和完整知识库。

端侧分工：

- Web 端：配置、管理、搜索、排障、深度阅读。
- 飞书端：接收摘要、打开报告、收听核心音频片段。
- Worker：发现、转写、提炼、切片、同步。

当前 Web 端已有本地 preview server，但产品页面还偏验证路径。升级目标是把它变成企业用户可长期使用的工作台。

## 2. 信息架构

推荐主导航：

```text
Dashboard
Inbox
Watches
Reports
Sources
Feishu Integration
Processing Runs
Settings
```

### 2.1 Dashboard

首页展示今天或本周的整体情报状态。

核心模块：

- 今日发现：发现多少集、处理多少集、发布多少条 insight。
- 高价值观点：Top 3-5 insights。
- 待处理问题：转写失败、音频无法解析、飞书推送失败。
- 活跃 Watch：每个 Watch 的新增、处理、推送状态。
- 最近飞书推送：推送时间、目标群、是否成功。

Dashboard 不展示完整播客报告，只用于快速判断系统是否正常工作。

### 2.2 Inbox

Inbox 是用户阅读新情报的主入口。

展示逻辑：

- 默认按 insight 重要性排序，而不是按 episode 时间排序。
- 每条卡片显示：观点、来源播客、证据时间戳、相关 Watch、是否已推送飞书。
- 点击进入对应 Episode Report。

卡片字段：

```text
claim
watch name
episode title
source
timestamp
relevance score
confidence
feishu delivery status
```

### 2.3 Watches

Watch 管理页是 Web 端最重要的配置页。

能力：

- 创建 Watch。
- 配置主题、关键词、排除词、来源范围。
- 配置频率：实时、每日、每周。
- 配置 backfill 数量。
- 绑定飞书群。
- 查看每个 Watch 的最近发现和处理状态。
- 暂停、恢复、删除。

Watch 卡片建议字段：

```text
name
query
include terms
exclude terms
frequency
enabled
bound feishu chat
last polled at
last delivered at
processing health
```

### 2.4 Reports

Reports 是完整报告库。

展示逻辑：

- 以 episode 为主列表。
- 支持按 Watch、来源、日期、实体、关键词筛选。
- 支持搜索 transcript、summary、insight。
- 每个 report 显示是否已生成飞书报告和音频片段。

Report 详情页结构：

```text
Episode Header
  title
  podcast/source
  publish date
  original URL
  audio player

One-liner
Overview
Worth listening
Recommended clips
Chapters
Entities
Insights with evidence
Transcript segments
Delivery status
```

### 2.5 Sources

Sources 管理所有播客来源。

能力：

- 添加 RSS / Apple Podcasts / Spotify / YouTube / 小宇宙 / Listen Notes / manual URL。
- 查看解析结果。
- 查看最近发现 episode。
- 标记解析失败来源。
- 手动重新解析。

### 2.6 Feishu Integration

飞书集成配置页。

能力：

- 配置企业自建应用：App ID、App Secret。
- 测试 Bot 是否可用。
- 填写或选择目标 chat_id。
- 绑定 Watch 到飞书群。
- 配置推送频率。
- 预览飞书消息流。
- 查看最近推送记录。
- 手动重推。

这个页面只负责配置和诊断，飞书端最终呈现以 `docs/lark-experience-prototype.html` 为准。

### 2.7 Processing Runs

处理任务观察页。

能力：

- 查看每次 worker run。
- 展示阶段：resolved、transcribing、transcribed、analyzing、analyzed、exported、delivered。
- 查看错误栈和失败原因。
- 支持重试单集、重试飞书推送。

### 2.8 Settings

设置页。

能力：

- Workspace 设置。
- 默认输出语言。
- ASR / LLM provider 状态。
- 数据保留策略。
- 对象存储配置。
- 企业权限和审计。

## 3. 推荐页面布局

### 3.1 桌面端

采用典型企业工作台布局：

```text
Left Sidebar
  Dashboard
  Inbox
  Watches
  Reports
  Sources
  Feishu
  Runs
  Settings

Top Bar
  workspace switcher
  global search
  processing status

Main Content
  page-specific cards / tables / details
```

左侧导航固定，右侧内容根据页面切换。

### 3.2 移动端

Web 移动端不是主消费入口，飞书承担移动消费。

移动 Web 只需要保证：

- 可查看 Dashboard。
- 可暂停 / 恢复 Watch。
- 可查看失败原因。
- 可打开报告。

不优先做复杂移动端配置。

## 4. 关键用户流程

### 4.1 创建一个播客监控任务

```text
Watches
  -> New Watch
  -> 填主题 / 来源 / 关键词
  -> 选择推送频率
  -> 绑定飞书群
  -> 保存
  -> 后台开始 backfill
  -> Dashboard 显示处理状态
```

### 4.2 阅读新情报

```text
Inbox
  -> 看到 Top insights
  -> 点击某条 insight
  -> 进入 Report Detail
  -> 点击 timestamp 播放原音频
  -> 查看是否已推送飞书
```

### 4.3 配置飞书推送

```text
Feishu Integration
  -> 填 App ID / Secret
  -> 测试 Bot
  -> 填 chat_id 或选择群
  -> 绑定 Watch
  -> 发送测试消息
  -> 开启 Daily Brief
```

### 4.4 处理失败任务

```text
Processing Runs
  -> 看到 failed run
  -> 查看失败阶段
  -> 如果是转写失败，重试 transcript
  -> 如果是飞书失败，重试 delivery
```

## 5. 数据与 API 需求

Web 端需要的主要服务能力：

```text
GET /api/dashboard
GET /api/inbox
GET /api/watches
POST /api/watches
PATCH /api/watches/:id
DELETE /api/watches/:id
GET /api/reports
GET /api/reports/:episodeId
GET /api/sources
POST /api/sources/resolve
GET /api/runs
POST /api/runs/:id/retry
GET /api/integrations/feishu
POST /api/integrations/feishu
POST /api/integrations/feishu/test
POST /api/integrations/feishu/deliveries/:id/retry
```

## 6. 与现有代码的关系

当前相关入口：

- `apps/web/src/server/preview.ts`：本地预览服务，已有处理链接、监控目标、Watch 操作和状态查询。
- `apps/web/src/server/m1-app.ts`：session、watch、inbox、feedback 等服务函数。
- `apps/worker/src/process-sources.ts`：真实处理来源。
- `apps/worker/src/m1-run-once.ts`：Watch 轮询和队列处理。
- `packages/db/src/repositories.ts`：大部分数据查询基础。

升级建议：

- 保留 preview server 作为本地产品服务。
- 增强 `m1-app.ts` 的应用服务层。
- 新增 Feishu integration service。
- 前端页面从占位页升级为真实工作台。

## 7. UI 优先级

### Phase 1：可用工作台

- Dashboard。
- Watch 管理。
- Processing Runs。
- Feishu 配置页。

目标：用户能完成配置、启动处理、看到状态。

### Phase 2：阅读体验

- Inbox。
- Report 列表。
- Report 详情。
- 音频 timestamp 跳转。

目标：用户能在 Web 中完整阅读和核验证据。

### Phase 3：企业运维

- 飞书推送记录。
- 失败重试。
- 多 Workspace。
- 权限与审计。

目标：支持企业长期使用。

### Phase 4：知识库增强

- 跨播客全文搜索。
- 实体视图。
- 主题趋势。
- Weekly Brief。

目标：从播客摘要升级为播客情报系统。

## 8. 与飞书方案的衔接

飞书方案文档：

- `docs/feishu-enterprise-integration-plan.md`

飞书手机端标准原型：

- `docs/lark-experience-prototype.html`

Web 端负责“配置和管理飞书”，飞书端负责“接收和消费结果”。

两端之间的数据闭环：

```text
Watch config in Web
  -> Worker processes episodes
  -> Web shows status and full report
  -> Feishu delivery sends summary/report/audio
  -> Web stores delivery status
```

## 9. 近期落地建议

建议下一步按这个顺序做：

1. 把现有 `/` 和 `/monitor` preview 统一升级为 Dashboard + Watches。
2. 增加 Processing Runs 页面，让处理过程可观察。
3. 增加 Feishu Integration 页面，但先只做 chat_id + test message。
4. 增加 Report Detail 页面，把现有报告元素结构化展示。
5. 接入飞书报告文件和音频片段后，在 Report Detail 显示 delivery status。

这个顺序能先解决“产品能配置、能运行、能看状态”的问题，再优化阅读和企业集成。
