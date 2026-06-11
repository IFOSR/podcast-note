# Podcast Note 飞书企业集成技术方案

## 1. 目标

Podcast Note 保留现有外部 Web 端与后台 worker，同时新增飞书企业集成能力。

整体定位：

- 外部 Web 端：配置台、任务管理台、完整知识库、失败排查入口。
- 后台 worker：播客发现、转写、摘要、洞察抽取、音频切片、报告生成。
- 飞书端：企业用户的日常接收、阅读、收听入口。

飞书端不做复杂配置，不做“保存 / 不相关”等反馈交互。用户只需要在飞书聊天里收到摘要、打开完整报告、直接收听核心音频片段。

## 2. 产品形态

### 2.1 外部 Web 端

Web 端继续承担重操作：

- 创建和管理 Watch。
- 配置播客源、关键词、频率、推送目标群。
- 查看处理状态：解析、转写、分析、切片、同步飞书。
- 查看完整历史报告和跨播客搜索。
- 配置飞书企业授权、群聊绑定、推送规则。
- 处理失败任务和重试。

### 2.2 飞书端

飞书端采用标准聊天消息流，不设计独立复杂页面。

一轮推送由 4 类消息组成：

1. 处理完成提示。
2. 今日核心摘要文本消息。
3. 完整报告文件 / 文档卡。
4. 核心音频片段文件卡。

标准消息顺序：

```text
Podcast Note Bot:
「AI Agent 商业化雷达」已处理完成
发现 12 集新播客，深度处理 5 集，筛出 7 条核心观点，生成 9 个可直接收听的音频片段。

Podcast Note Bot:
今日最值得看的 3 条播客信号

1. Agent 产品竞争点正在转向企业工作流。
证据：02:14-03:08 · 建议听片段 01

2. Cursor 类产品护城河在团队上下文。
证据：18:42-20:10 · 建议听片段 02

3. 企业客户更关心可审计、可回滚的半自动执行。
证据：41:05-42:33 · 完整报告里有原文摘录

文件卡:
播客情报报告_AI_Agent_商业化雷达_2026-06-05.docx

音频文件卡:
片段01_Agent产品转向企业工作流_02m14s-03m08s.mp3

音频文件卡:
片段02_Cursor护城河在团队上下文_18m42s-20m10s.mp3
```

HTML 原型位置：

- `docs/lark-experience-prototype.html`

## 3. 系统架构

```text
Podcast Sources
  -> connectors
  -> worker queue
  -> transcript provider
  -> insight provider
  -> segment / clip generator
  -> storage
  -> report renderer
  -> Feishu integration service
  -> Feishu chat / docs / files

External Web
  -> Watch config
  -> Feishu binding
  -> processing status
  -> report library
  -> retry / admin tools
```

新增一个 `Feishu Integration Service`，它不参与播客理解，只负责把处理产物同步到飞书。

## 4. 后台处理链路

当前项目已有核心链路：

- `packages/connectors`：解析 RSS、Apple、Spotify、YouTube、小宇宙等来源。
- `apps/worker/src/process-sources.ts`：处理来源、转写、分析、导出。
- `apps/worker/src/pipeline.ts`：分段、摘要、洞察抽取、groundedness。
- `apps/worker/src/m1-run-once.ts`：Watch 轮询和队列处理。
- `packages/db`：SQLite 持久化 workspace、watch、episode、transcript、insight、processing run。

飞书接入后，后台链路扩展为：

```text
episode processed
  -> save transcript / summary / insights
  -> select top insights for Feishu
  -> cut audio clips by timestamp
  -> render report doc
  -> upload report and clips to Feishu
  -> send Feishu messages to bound chat
  -> store Feishu message/file/doc ids
```

## 5. 音频切片方案

### 5.1 切片输入

每条 insight 已有：

- `episodeId`
- `claim`
- `evidenceExcerpt`
- `timestampStartSec`
- `timestampEndSec`
- `relevanceScore`
- `confidence`

### 5.2 切片规则

默认切片窗口：

- 起点：`timestampStartSec - 8s`
- 终点：`timestampEndSec + 8s`
- 最短：30 秒
- 最长：180 秒
- 如果原始 evidence 太短，向前后扩展。
- 如果多个 insight 时间段重叠，合并成一个 clip，避免重复音频。

文件命名：

```text
片段01_<短标题>_<start>-<end>.mp3
片段02_<短标题>_<start>-<end>.mp3
```

示例：

```text
片段01_Agent产品转向企业工作流_02m14s-03m08s.mp3
```

### 5.3 技术实现

新增模块：

```text
apps/worker/src/audio-clips.ts
```

职责：

- 下载或读取 episode audio。
- 使用 ffmpeg 按时间戳切片。
- 统一转码为 mp3。
- 输出 clip metadata。

建议数据结构：

```ts
type AudioClip = {
  id: string;
  episodeId: string;
  insightIds: string[];
  title: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  localPath: string;
  mimeType: "audio/mpeg";
};
```

## 6. 报告生成方案

### 6.1 飞书完整报告

推荐两阶段：

MVP：

- 先生成 `.docx` 或 `.md` 文件，作为飞书文件发送。
- 形态最接近用户截图里的文件卡。
- 实现简单，稳定性高。

增强版：

- 创建飞书在线 Docx 文档。
- 把报告内容写入飞书云文档。
- 消息里发送文档链接或文件卡。

### 6.2 报告结构

```text
标题：播客情报报告｜<Watch 名称>｜<日期>

1. 今日总览
发现多少集、处理多少集、发布多少条 insight、生成多少个片段。

2. 最值得看的观点
每条包含 claim、证据时间戳、播客来源、建议收听片段。

3. 单集报告
每集的一句话总结、章节、是否值得听、核心观点。

4. 证据原文
每条核心观点对应 transcript excerpt。

5. 原始来源
播客页面 URL、音频 URL、发布时间。
```

## 7. 飞书 API 接入

### 7.1 应用类型

使用企业自建应用：

- 安装到企业。
- 开启机器人能力。
- Bot 支持私聊和群聊；首版使用个人私聊作为推送目标。
- 后台使用 tenant access token 调用飞书 API。

### 7.1.1 首版接入入口：机器人 AppLink + 长连接

首版产品入口不使用 OAuth redirect，也不要求公网回调地址。用户只需要在 Web 端打开“飞书集成”，用飞书扫描机器人入口二维码，进入 Podcast Note 机器人私聊并发送一条消息，即可把个人私聊绑定为推送目标。

团队群聊接收先暂缓。代码保留机器人入群事件能力，但产品主路径先只引导个人私聊接收。

Web 端新增：

```text
/integrations/feishu
```

用户路径：

```text
打开飞书集成页
  -> 页面展示机器人 AppLink 二维码
  -> 用户用飞书扫码打开 Podcast Note 机器人
  -> 用户进入机器人私聊并发送 /bind 或任意消息
  -> 后台长连接收到 im.message.receive_v1
  -> 后端保存个人私聊 chat_id
  -> 页面显示已连接
```

接入二维码内容：

```text
https://applink.feishu.cn/client/bot/open?appId=<LARK_APP_ID>
```

后端 API：

```text
GET /api/integrations/feishu
GET /api/lark/bot-open-url
POST /api/lark/bot-installations
POST /api/lark/send-test-message
```

本地预览实现：

- 使用 `LARK_APP_ID` 或 `FEISHU_APP_ID` 生成机器人 AppLink。
- 页面使用真实 QR SVG 编码 AppLink，用户侧不需要填写 App ID。
- 后台使用 `lark-cli event consume im.message.receive_v1 --as bot` 走长连接事件。
- 收到个人私聊消息后写入 `lark_bot_installations`，会话名记为“个人播客助手”。
- `im.chat.member.bot.added_v1` 保留给后续团队群聊模式。
- 本地没有真实事件时，可以在页面“本地验证入口”手动填入 `chat_id` 验证发送消息。

产品约束：

- 普通用户只看到机器人二维码、扫码流程和接入状态。
- `LARK_APP_ID` / `LARK_APP_SECRET` 是系统管理员部署配置，不暴露给普通用户填写。
- 若服务端未配置 App ID，页面提示“管理员未完成应用配置”，而不是要求业务用户理解飞书开放平台参数。
- `docs/lark-agent-unified-auth-design.md` 只作为未来用户级资源授权保留，例如代表用户读取个人云空间、日历、邮箱时再启用；它不是本次机器人扫码接入主链路。

相关实现：

```text
packages/lark/src/index.ts
packages/db/src/repositories.ts
apps/web/src/server/preview.ts
apps/worker/src/lark-bot-events.ts
apps/worker/src/check-lark-bot-integration.ts
apps/worker/src/check-lark-bot-events.ts
```

### 7.2 需要的核心能力

飞书官方开放平台支持：

- 发送消息 API。
- 上传文件 API，支持上传音频、视频、文档等文件类型。
- 消息内容支持文本、文件、音频、卡片等类型。
- 创建新版文档 Docx API。

### 7.3 推荐消息实现

MVP 不使用复杂交互卡片，优先使用稳定消息类型：

- 摘要：`text` 或 `post` 消息。
- 报告：`file` 消息。
- 音频片段：优先 `file` 消息，文件类型为音频；如果测试确认飞书客户端对 `audio` 消息体验更好，再切换为 `audio`。

原因：

- 文件卡最贴近用户截图。
- 音频 mp3 作为文件卡也容易理解。
- 不引入按钮和交互回调，集成复杂度低。

### 7.4 权限与配置

建议最小权限集合：

- 机器人能力。
- 机器人进群事件 `im.chat.member.bot.added_v1`，对应 `im:chat.members:bot_access`。
- 接收消息事件 `im.message.receive_v1`，用于用户私聊机器人时返回接入指引。
- 发送单聊、群组消息。
- 以应用身份发消息。
- 获取与上传图片或文件资源。
- 创建 / 编辑云文档，若使用在线 Docx。
- 获取群聊信息，若需要 Web 端列出可绑定群。

环境变量：

```bash
LARK_APP_ID=...
LARK_APP_SECRET=...
LARK_WEBSOCKET_ENABLED=true
FEISHU_BOT_NAME=Podcast Note
FEISHU_DEFAULT_CHAT_ID=...
FEISHU_DOC_FOLDER_TOKEN=...
```

启动 Web：

```bash
scripts/podcast-note start
```

启动长连接事件消费者：

```bash
scripts/podcast-note events --workspace-id <workspace_id>
```

该消费者默认同时监听：

- `im.message.receive_v1`：用户私聊机器人时，写入个人私聊 `chat_id` 并回复“个人接收已连接”。
- `im.chat.member.bot.added_v1`：保留给后续团队群聊模式；当前产品页面不主推。

如果扫码后看到机器人会话是空白，这通常不是扫码失败，而是以下任一项未完成：

- 事件消费者未启动。
- 飞书开放平台未开启 `im.message.receive_v1` 事件。
- 未开通发送消息权限，导致机器人无法主动回复。
- 用户只打开了机器人但没有发送消息；需要在机器人私聊里发送 `/bind` 或任意消息。

验证：

```bash
bun run check:lark-bot-integration
bun run check:lark-bot-events
```

兼容变量：

```bash
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_OAUTH_REDIRECT_URI=...
```

## 8. 数据模型扩展

新增表建议：

### 8.1 feishu_integrations

企业授权配置。

```text
id
workspace_id
tenant_key
app_id
encrypted_app_secret
bot_open_id
status
created_at
updated_at
```

### 8.2 feishu_delivery_targets

Watch 到飞书群的绑定。

```text
id
workspace_id
watch_id
chat_id
chat_name
delivery_frequency
enabled
created_at
updated_at
```

### 8.3 audio_clips

切好的音频片段。

```text
id
episode_id
title
start_sec
end_sec
duration_sec
local_path
storage_url
created_at
```

### 8.4 feishu_deliveries

每次飞书推送记录。

```text
id
workspace_id
watch_id
chat_id
report_id
status
error
sent_at
created_at
```

### 8.5 feishu_delivery_items

飞书侧每个消息、文件、文档的映射。

```text
id
delivery_id
item_type -- summary_message | report_file | audio_clip_file | doc
local_entity_id
feishu_message_id
feishu_file_key
feishu_doc_token
created_at
```

## 9. 新增代码模块

建议新增 package：

```text
packages/feishu
```

职责：

- token 获取与刷新。
- 文件上传。
- 发送文本 / post / file / audio 消息。
- 创建飞书文档。
- 错误码封装。
- 重试与幂等。

建议新增 worker 模块：

```text
apps/worker/src/feishu-delivery.ts
apps/worker/src/audio-clips.ts
apps/worker/src/report-renderer.ts
```

职责：

- 从处理结果选择要推送的 insights。
- 生成报告文件。
- 生成音频切片。
- 调用 `packages/feishu` 推送。
- 保存推送记录。

## 10. 外部 Web 配置页

新增 Web 页面或 server route：

```text
/integrations/feishu
/watches/:id/delivery
```

页面能力：

- 配置飞书 App ID / Secret。
- 测试 Bot 是否可发送消息。
- 绑定 Watch 到某个 chat_id。
- 配置推送频率：实时、每日、每周。
- 预览飞书推送内容。
- 查看最近推送状态和失败原因。
- 手动重推某次报告。

## 11. 推送策略

### 11.1 单集完成推送

适合高优先级 Watch。

```text
一集处理完成
  -> 如果 insight 数量 >= 阈值
  -> 立即推送一组消息
```

### 11.2 Daily Brief

推荐默认策略。

```text
每天固定时间
  -> 聚合过去 24 小时所有 processed episodes
  -> 选 Top 3-5 insights
  -> 生成一份报告
  -> 发送摘要 + 报告 + 音频片段
```

### 11.3 Weekly Brief

适合低频团队。

```text
每周固定时间
  -> 按主题合并
  -> 输出趋势、重复观点、变化信号
```

MVP 建议先做 Daily Brief。

## 12. 错误处理

必须处理：

- Bot 不在群里。
- chat_id 无效。
- 飞书 token 失效。
- 文件上传失败。
- 文件过大。
- 音频切片失败。
- 文档创建失败。
- 消息发送部分成功。

策略：

- 每个 delivery item 独立记录状态。
- 已成功上传的文件不重复上传。
- 发送消息使用幂等 key。
- 失败后可在 Web 端手动重试。
- 飞书推送失败不影响核心播客处理结果。

## 13. 安全与企业化

企业面需要重点做：

- tenant 级隔离。
- workspace 级隔离。
- 飞书 app secret 加密存储。
- 原始音频、转录、报告权限隔离。
- 支持私有化部署或客户自有对象存储。
- 所有飞书推送有审计日志。
- 删除 Watch 时可选择是否删除飞书侧历史文件。

企业客户更关心：

- 数据是否离开企业环境。
- 谁能看到报告。
- 音频片段是否可外链访问。
- Bot 是否只在指定群可用。
- 是否能追踪谁配置了推送。

## 14. MVP 落地顺序

### Phase 1：飞书最小闭环

- 新增飞书统一授权入口。
- 支持创建 bind session、展示授权链接、OAuth callback、轮询连接状态。
- 支持 Web 端查看飞书连接状态。
- 支持 Bot 向指定 chat_id 发送文本消息。

验收：

- Web 端进入 `/integrations/feishu` 可以生成授权会话。
- 授权完成后，`/api/integrations/feishu` 返回 connected。
- Web 端配置 chat_id 后能发送测试消息。

### Phase 2：报告文件卡

- 生成 Markdown / docx 报告。
- 上传到飞书。
- 发送报告文件消息。

验收：

- 飞书聊天流里出现类似截图的报告文件卡。
- 用户点开可读完整报告。

### Phase 3：音频片段文件卡

- 接入 ffmpeg。
- 按 insight timestamp 切片。
- 上传 mp3。
- 发送音频片段文件消息。

验收：

- 飞书聊天流里出现片段 mp3 文件卡。
- 用户可在飞书内点开播放。

### Phase 4：Daily Brief

- 每日聚合多个 episode。
- 选 Top insights。
- 生成日报。
- 定时推送。

验收：

- 每天固定时间向绑定群推送一组标准消息。

### Phase 5：企业增强

- 多 tenant。
- 群聊选择器。
- 权限审计。
- 推送失败重试面板。
- 在线飞书 Docx 创建。

## 15. 可行性判断

技术上可行，且与当前项目架构匹配。

原因：

- 当前项目已经有 episode、transcript、summary、insight、processing run 的核心数据。
- insight 已经带时间戳，天然支持音频切片。
- 飞书开放平台支持消息发送、文件上传、音频/文件消息和云文档。
- 飞书手机端天然适合以聊天流接收“摘要 + 文件卡 + 音频卡”。
- 不需要自研客户端，外部 Web 端只保留配置和管理职责。

最大风险：

- 飞书客户端对 API 发送的 `audio` 消息和 `file` 音频文件卡展示效果需要实测。
- 文件大小和上传频率需要压测。
- 部分企业对外部音频和转录数据有合规要求，需要支持私有化或客户自有存储。

建议 MVP 先用 `file` 方式发送 mp3，稳定后再评估是否切换为飞书原生 `audio` 消息。

## 16. 官方参考

- 飞书发送消息 API：https://open.feishu.cn/document/server-docs/im-v1/message/create
- 飞书上传文件 API：https://open.feishu.cn/document/server-docs/im-v1/file/create
- 飞书消息内容结构：https://open.feishu.cn/document/server-docs/im-v1/message-content-description/message_content
- 飞书新版文档 Docx API 概览：https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/docx-overview
- 飞书创建文档 API：https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/create
