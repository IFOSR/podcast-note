# 飞书 Agent 统一授权接入方案

> 状态说明：本文档是未来“用户级资源授权”的设计，例如需要代表用户读取个人云空间、日历、邮箱、会议纪要时使用。当前 Podcast Note 飞书机器人扫码接入不采用本文档的 OAuth redirect flow；首版主链路是机器人 AppLink 二维码 + 飞书长连接事件 `im.chat.member.bot.added_v1`，见 `docs/feishu-enterprise-integration-plan.md`。

## 目标

为 Agent 提供一套统一的飞书授权入口。用户在终端执行一次登录命令，终端生成二维码，用户用飞书扫码并确认授权后，Agent 获得访问飞书云文档、云空间、知识库、消息、群聊、通讯录、日历、任务、会议纪要、邮箱等能力所需的用户授权。

该方案解决三个问题：

1. 把 Agent 需要的飞书权限统一封装成一个授权包。
2. 用终端二维码完成用户绑定，避免用户手动复制 OAuth 链接。
3. 把 token 获取、刷新、加密存储、权限校验和后续 API 调用统一收口到后端。

## 结论

推荐实现一个 `device-like OAuth binding flow`：

```text
Terminal Agent -> Auth Backend -> Feishu OAuth -> Auth Backend Callback -> Terminal Agent Polling
```

终端只负责：

1. 请求创建绑定会话。
2. 展示二维码。
3. 轮询绑定结果。
4. 保存后端签发的 `connection_id` 或 Agent 侧访问凭证。

后端负责：

1. 生成飞书 OAuth 授权链接。
2. 校验 OAuth `state`。
3. 使用授权码换取 `user_access_token` 和 `refresh_token`。
4. 加密保存 token。
5. 自动刷新 token。
6. 为 Agent 提供统一的飞书 API 调用代理。

## 权限封装

### 全功能授权包

建议把全功能 Agent 权限封装为一个固定权限包：

```text
lark.agent.full_access
```

覆盖飞书开放平台中的这些能力域：

```text
docs
drive
wiki
sheets
slides
base
markdown
im
contact
calendar
task
minutes
vc
mail
```

如果使用 `lark-cli` 验证授权流程，可以直接使用：

```bash
lark-cli auth login \
  --domain docs,drive,wiki,sheets,slides,base,markdown,im,contact,calendar,task,minutes,vc,mail \
  --no-wait \
  --json
```

也可以在内部实现中把这些 domain 映射为飞书 OAuth scopes。推荐不要在业务代码里到处分散写 scope，而是维护一个集中配置：

```ts
export const LARK_AGENT_FULL_ACCESS_DOMAINS = [
  "docs",
  "drive",
  "wiki",
  "sheets",
  "slides",
  "base",
  "markdown",
  "im",
  "contact",
  "calendar",
  "task",
  "minutes",
  "vc",
  "mail",
] as const;
```

### 能力说明

| 权限域 | Agent 能力 |
| --- | --- |
| `docs` | 创建、读取、更新飞书文档，插入图片、附件、媒体块。 |
| `drive` | 搜索云空间文件，上传、下载、导出、移动文件，管理评论和权限申请。 |
| `wiki` | 读取和管理知识库空间、节点、文档层级。 |
| `sheets` | 创建、读取、写入、导出电子表格。 |
| `slides` | 创建、读取、编辑飞书幻灯片。 |
| `base` | 管理多维表格，包括表、字段、记录、视图、仪表盘和工作流。 |
| `markdown` | 创建、读取、覆盖飞书 Markdown 文件。 |
| `im` | 发送消息、回复消息、搜索消息、读取群聊、创建群聊、下载消息附件。 |
| `contact` | 按姓名、邮箱查询用户，解析 `open_id`、部门、邮箱等通讯录信息。 |
| `calendar` | 查询和创建日程，管理参会人，查询忙闲，查询或预定会议室。 |
| `task` | 创建和管理任务、任务清单、子任务、协作成员和任务附件。 |
| `minutes` | 查询妙记，读取会议总结、待办、章节和转写内容。 |
| `vc` | 查询历史视频会议、会议纪要产物和参会人快照。 |
| `mail` | 读取、搜索、发送、回复、转发邮件，管理草稿、附件、文件夹和标签。 |

### 最小默认授权包

如果未来需要降低授权敏感度，可以保留一个默认包：

```text
lark.agent.standard_access
```

建议包含：

```text
docs
drive
wiki
sheets
base
im
contact
calendar
task
```

高级功能再增量授权：

```text
slides
markdown
minutes
vc
mail
```

当前需求是“统一授权，全都开通”，因此首版按 `lark.agent.full_access` 实现。

## 飞书开发者后台配置

在飞书开放平台创建企业自建应用后，需要完成以下配置。

### 基础配置

1. 创建企业自建应用。
2. 获取 `App ID` 和 `App Secret`。
3. 配置 OAuth 回调地址：

```text
https://your-domain.com/api/lark/oauth/callback
```

4. 配置应用可用范围。
5. 发布应用版本，并确保目标企业已安装或启用该应用。

### API 权限

在开发者后台的“权限管理”中开通以下权限分类：

```text
云文档
云空间
知识库
电子表格
多维表格
幻灯片
即时消息
群组
消息历史
消息附件
通讯录
日历
会议室
任务
妙记
视频会议
邮箱
```

具体 scope 名称以飞书开放平台当前控制台展示为准。工程实现中应该从一个中心配置维护 scope，不要把 scope 分散在多个功能模块中。

### 事件订阅

如果 Agent 需要被动响应飞书消息，需要配置事件订阅。

建议首期开启：

```text
接收消息事件
群聊成员变更事件
机器人进群事件
机器人退群事件
消息撤回事件
消息已读事件
消息表情回应事件
```

事件回调地址：

```text
https://your-domain.com/api/lark/events
```

同时配置：

```text
Encrypt Key
Verification Token
```

后端必须实现 URL challenge 校验、事件解密、幂等处理和重放保护。

## 统一授权流程

### 流程图

```text
User Terminal
  |
  | agent lark login
  v
Agent CLI
  |
  | POST /api/lark/bind-sessions
  v
Auth Backend
  |
  | create bind_session + OAuth URL
  v
Agent CLI
  |
  | render QR code
  v
User scans with Feishu
  |
  | approve permissions
  v
Feishu OAuth
  |
  | GET /api/lark/oauth/callback?code=...&state=...
  v
Auth Backend
  |
  | exchange code for tokens
  | encrypt and store tokens
  | mark bind_session completed
  v
Agent CLI
  |
  | poll /api/lark/bind-sessions/{id}
  v
Login completed
```

### 创建绑定会话

终端请求：

```http
POST /api/lark/bind-sessions
Content-Type: application/json

{
  "agent_id": "agent_xxx",
  "permission_package": "lark.agent.full_access",
  "terminal_fingerprint": "optional-device-fingerprint"
}
```

后端返回：

```json
{
  "bind_session_id": "lbs_xxx",
  "verification_url": "https://accounts.feishu.cn/open-apis/authen/v1/authorize?...",
  "expires_at": "2026-06-05T12:00:00Z",
  "poll_interval_seconds": 2
}
```

终端生成二维码：

```bash
agent lark login
```

展示：

```text
请使用飞书扫描二维码完成授权

<terminal qr code>

如果二维码无法识别，请打开：
https://accounts.feishu.cn/open-apis/authen/v1/authorize?...

二维码 10 分钟内有效。
```

### OAuth 授权 URL

授权 URL 由后端生成：

```text
https://accounts.feishu.cn/open-apis/authen/v1/authorize
  ?client_id=<LARK_APP_ID>
  &redirect_uri=https%3A%2F%2Fyour-domain.com%2Fapi%2Flark%2Foauth%2Fcallback
  &scope=<encoded_scopes>
  &state=<signed_state>
```

如果使用 PKCE，则额外带上：

```text
code_challenge=<S256(code_verifier)>
code_challenge_method=S256
```

`state` 必须包含或关联：

```text
bind_session_id
nonce
agent_id
permission_package
expires_at
```

`state` 必须签名或随机不可预测。不要把敏感信息明文放进 `state`。

### OAuth 回调

飞书回调：

```http
GET /api/lark/oauth/callback?code=<authorization_code>&state=<signed_state>
```

后端处理：

1. 校验 `state` 签名。
2. 校验绑定会话存在且未过期。
3. 校验绑定会话状态为 `pending`。
4. 使用 `code` 换取 `user_access_token` 和 `refresh_token`。
5. 获取授权用户身份信息。
6. 加密保存 token。
7. 标记绑定会话为 `completed`。
8. 返回一个用户友好的 HTML 页面。

回调页面示例：

```text
授权成功

你已经完成 Agent 与飞书账号的绑定，可以回到终端继续使用。
```

### 终端轮询

终端轮询：

```http
GET /api/lark/bind-sessions/lbs_xxx
```

未完成：

```json
{
  "status": "pending",
  "expires_at": "2026-06-05T12:00:00Z"
}
```

完成：

```json
{
  "status": "completed",
  "connection_id": "lark_conn_xxx",
  "user": {
    "open_id": "ou_xxx",
    "name": "Alice",
    "tenant_key": "xxx"
  }
}
```

过期：

```json
{
  "status": "expired",
  "message": "授权二维码已过期，请重新执行 agent lark login。"
}
```

终端拿到 `connection_id` 后，把它写入本地 Agent 配置：

```json
{
  "lark": {
    "connection_id": "lark_conn_xxx",
    "backend_base_url": "https://your-domain.com"
  }
}
```

不建议把飞书 `refresh_token` 直接保存到终端本地。

## Token 存储与刷新

### 存储模型

建议后端维护 `lark_connections` 表：

```sql
CREATE TABLE lark_connections (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  tenant_key TEXT NOT NULL,
  open_id TEXT NOT NULL,
  union_id TEXT,
  user_name TEXT,
  permission_package TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMP NOT NULL,
  refresh_token_expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP
);
```

绑定会话表：

```sql
CREATE TABLE lark_bind_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  permission_package TEXT NOT NULL,
  status TEXT NOT NULL,
  connection_id TEXT,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP
);
```

### 加密要求

必须做到：

1. `access_token` 和 `refresh_token` 入库前加密。
2. 加密密钥放在 KMS 或 Secret Manager，不放代码仓库。
3. 日志、错误上报、调试输出中禁止打印 token。
4. token 解密只发生在后端调用飞书 API 的短时间窗口。

### 自动刷新

每次调用飞书 API 前：

1. 检查 `access_token_expires_at`。
2. 如果即将过期，使用 `refresh_token` 刷新。
3. 刷新成功后更新加密 token 和过期时间。
4. 刷新失败则把连接标记为 `reauth_required`，提示用户重新扫码授权。

## 后端 API 设计

### 创建绑定会话

```http
POST /api/lark/bind-sessions
```

职责：

1. 校验 Agent 身份。
2. 解析权限包。
3. 创建绑定会话。
4. 生成飞书 OAuth URL。
5. 返回 URL 给终端生成二维码。

### 查询绑定状态

```http
GET /api/lark/bind-sessions/{bind_session_id}
```

职责：

1. 返回 `pending`、`completed`、`expired`、`failed`。
2. 完成时返回 `connection_id`。
3. 不返回飞书 token。

### OAuth 回调

```http
GET /api/lark/oauth/callback
```

职责：

1. 校验 `state`。
2. 使用授权码换 token。
3. 获取用户信息。
4. 保存连接。
5. 标记绑定完成。

### 飞书 API 代理

建议 Agent 不直接拿飞书 token，而是请求后端：

```http
POST /api/lark/proxy
```

示例：

```json
{
  "connection_id": "lark_conn_xxx",
  "capability": "im.messages.send",
  "payload": {
    "receive_id_type": "chat_id",
    "receive_id": "oc_xxx",
    "msg_type": "text",
    "content": "{\"text\":\"hello\"}"
  }
}
```

后端负责：

1. 校验 Agent 是否有权使用该 `connection_id`。
2. 校验 capability 是否在授权包内。
3. 刷新 token。
4. 调用飞书 API。
5. 记录审计日志。

## CLI 命令设计

### 登录

```bash
agent lark login
```

行为：

1. 调用后端创建绑定会话。
2. 把 `verification_url` 渲染成终端二维码。
3. 同时打印备用 URL。
4. 轮询绑定状态。
5. 成功后保存 `connection_id`。

### 查看状态

```bash
agent lark status
```

输出：

```text
飞书连接状态：已绑定
用户：Alice
企业：Example Inc.
权限包：lark.agent.full_access
绑定时间：2026-06-05 20:00:00
```

### 重新授权

```bash
agent lark relogin
```

用于 token 失效、权限新增或用户切换。

### 解绑

```bash
agent lark logout
```

行为：

1. 删除本地 `connection_id`。
2. 通知后端标记连接失效。
3. 可选调用飞书撤销授权接口。

## 安全策略

### 授权会话

1. 二维码有效期建议 5 到 10 分钟。
2. `bind_session_id` 必须随机不可预测。
3. `state` 必须绑定 `bind_session_id` 和 `agent_id`。
4. 同一个 `state` 只能使用一次。
5. OAuth 回调必须校验来源参数，不接受过期会话。

### 权限最小化

虽然首版使用全功能权限包，但代码结构上仍应支持权限包拆分：

```text
lark.agent.standard_access
lark.agent.full_access
lark.agent.mail_access
lark.agent.meeting_access
```

这样后续可以根据企业安全要求降级授权范围。

### 审计

所有高风险操作必须写审计日志：

```text
发送消息
创建群聊
读取消息历史
下载云空间文件
导出文档
修改文档
删除或移动文件
发送邮件
创建日程并邀请他人
```

审计字段：

```text
agent_id
connection_id
open_id
tenant_key
capability
resource_type
resource_id
request_id
timestamp
result
```

### 敏感操作确认

建议以下操作要求 Agent 二次确认或用户策略允许：

```text
删除云空间文件
移动大量文件
批量发送消息
批量发送邮件
邀请外部用户
修改知识库权限
导出大量文档
读取大范围消息历史
```

## 错误处理

| 场景 | 处理方式 |
| --- | --- |
| 用户未扫码 | 终端持续轮询直到过期，提示重新登录。 |
| 用户拒绝授权 | 标记会话 `failed`，终端展示拒绝原因。 |
| scope 未在后台开通 | 后端返回 `permission_not_enabled`，提示去飞书开发者后台开启对应权限。 |
| token 刷新失败 | 标记连接 `reauth_required`，要求重新扫码授权。 |
| 飞书 API 限流 | 后端按飞书返回的限流信息退避重试。 |
| 事件重复投递 | 使用 event id 做幂等去重。 |
| 企业未安装应用 | 提示管理员安装或发布应用版本。 |

## 落地步骤

### 第 1 阶段：开发者后台准备

1. 创建飞书企业自建应用。
2. 配置 OAuth 回调地址。
3. 开通全功能权限域。
4. 配置事件订阅。
5. 发布应用版本并在目标企业启用。

### 第 2 阶段：后端授权服务

1. 实现 `POST /api/lark/bind-sessions`。
2. 实现 `GET /api/lark/bind-sessions/{id}`。
3. 实现 `GET /api/lark/oauth/callback`。
4. 实现 token 加密存储。
5. 实现 token 自动刷新。
6. 实现权限包和 capability 映射。

### 第 3 阶段：终端 Agent

1. 实现 `agent lark login`。
2. 实现终端二维码渲染。
3. 实现绑定状态轮询。
4. 实现本地连接配置保存。
5. 实现 `status`、`relogin`、`logout`。

### 第 4 阶段：飞书能力代理

1. 实现后端飞书 API proxy。
2. 按 capability 封装文档、消息、云空间、日历、任务等操作。
3. 增加审计日志。
4. 增加限流、重试和错误映射。

### 第 5 阶段：验收

1. 扫码绑定成功。
2. 能读取和更新飞书文档。
3. 能搜索和下载云空间文件。
4. 能发送和回复消息。
5. 能查询通讯录并解析用户。
6. 能查询和创建日程。
7. 能创建和更新任务。
8. 能读取妙记和会议纪要。
9. token 过期后能自动刷新。
10. 权限不足时能给出明确后台配置提示。

## 推荐的首版实现边界

首版建议只做“统一授权”和“核心能力代理”，不要一次性把所有飞书 API 都封装成工具。

优先实现：

```text
扫码绑定
token 存储和刷新
文档读取/更新
云空间搜索/下载/上传
消息发送/回复/搜索
通讯录用户解析
日历查询/创建
任务创建/查询
事件订阅接收消息
```

后续再扩展：

```text
邮箱
妙记
视频会议
幻灯片
多维表格高级操作
知识库权限管理
批量文件同步
```

## 关键工程原则

1. 终端不保存飞书 refresh token。
2. 所有权限集中声明，不在业务代码里散落 scope。
3. 所有 token 加密存储。
4. 所有高风险操作写审计日志。
5. OAuth `state` 一次性、短有效期、防重放。
6. 支持权限包拆分，方便未来从全量授权降级到最小授权。
7. 后端统一代理飞书 API，便于鉴权、审计、限流和错误处理。
