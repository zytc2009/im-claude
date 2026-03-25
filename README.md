[toc]

# im-claude

### 主要功能：

**支持远程控制claude，支持发送语音消息，支持虚拟女友**，...



---

## 架构设计

```
用户 (Telegram / 钉钉)
        ↓ 消息
  [IMAdapter 适配器层]          ← 平台无关接口，每个平台独立实现
        ↓
  [MessageRouter 路由器]        ← 权限校验、防并发、图片URL检测
        ↓
  [ClaudeRunner]                ← 核心：调用 Agent SDK，注入 Clawra 人设
        ↓
  @anthropic-ai/claude-agent-sdk  ← 完整 Claude Code 工具链
        ↓
  Claude API (claude-sonnet-4-6)

  [ClawraScheduler]             ← 定时主动推送（独立链路）
        ├── MessageGenerator    ← claude-haiku 生成口语消息
        └── PhotoGenerator      ← fal.ai 生成自拍照
```

通过 Telegram 和钉钉与 Claude Code 对话的 IM 网关服务。

基于 `@anthropic-ai/claude-agent-sdk` 构建，完整复用 Claude Code 工具链（文件读写、Shell、Glob、Grep 等），无需修改 Claude Code 源码。

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `IMAdapter` | `src/adapters/base.adapter.ts` | 平台适配器抽象接口 |
| `TelegramAdapter` | `src/adapters/telegram.adapter.ts` | Telegram Bot（基于 grammy），含语音消息和图片发送 |
| `DingTalkAdapter` | `src/adapters/dingtalk.adapter.ts` | 钉钉企业内部应用机器人 |
| `ClaudeRunner` | `src/runner/claude.runner.ts` | Agent SDK 封装，注入 Clawra 人设，含会话续接 |
| `SessionManager` | `src/runner/session.manager.ts` | 基于 `session_id` 的会话管理 |
| `PermissionManager` | `src/permissions/permission.manager.ts` | 用户白名单 + 工具权限控制 |
| `MessageRouter` | `src/router/message.router.ts` | 消息路由、防并发、图片 URL 提取并以 sendPhoto 发送 |
| `TranscriptionService` | `src/services/transcription.service.ts` | 基于 Whisper 的语音转文字服务 |
| `ClawraScheduler` | `src/clawra/scheduler.ts` | Cron 调度器，管理定时消息和照片推送 |
| `MessageGenerator` | `src/clawra/message-generator.ts` | 调用 Haiku 生成口语化短消息，含重试和 fallback |
| `PhotoGenerator` | `src/clawra/photo-generator.ts` | 调用 fal.ai grok-imagine-image/edit 生成自拍照 |
| `profile.ts` | `src/clawra/profile.ts` | 加载/校验人设 JSON；生成 system prompt |
| `schedule.ts` | `src/clawra/schedule.ts` | 加载/校验作息 JSON；生成 cron 表达式 |

### 会话管理

使用 SDK 原生的 `session_id` 做会话续接，而非手动维护消息历史：

```
第 1 条消息 → query({ prompt })          → 返回 session_id，保存
第 2 条消息 → query({ prompt, resume: session_id })  → 续接上下文
/clear 命令 → 清除 session_id           → 下次重新开会话
```

---

## 项目结构

```
im-claude/
├── src/
│   ├── adapters/
│   │   ├── base.adapter.ts          # IMAdapter 接口
│   │   ├── telegram.adapter.ts      # Telegram 适配器（含语音和图片发送）
│   │   └── dingtalk.adapter.ts      # 钉钉适配器
│   ├── runner/
│   │   ├── claude.runner.ts         # Claude Agent SDK 封装（注入 Clawra 人设）
│   │   └── session.manager.ts       # 会话状态管理
│   ├── permissions/
│   │   └── permission.manager.ts    # 访问控制
│   ├── router/
│   │   └── message.router.ts        # 消息路由器（含图片 URL 提取）
│   ├── services/
│   │   └── transcription.service.ts # Whisper 语音转文字
│   ├── clawra/
│   │   ├── types.ts                 # 共享类型定义
│   │   ├── profile.ts               # 人设加载与 system prompt 生成
│   │   ├── schedule.ts              # 作息加载与 cron 表达式生成
│   │   ├── message-generator.ts     # Haiku 短消息生成（含 fallback）
│   │   ├── photo-generator.ts       # fal.ai 自拍照生成
│   │   └── scheduler.ts             # Cron 调度器
│   └── index.ts                     # 入口文件
├── config/
│   ├── clawra-profile.json          # Clawra 人设配置
│   └── clawra-schedule.json         # 作息时间表配置
├── tests/
│   └── clawra/                      # Clawra 模块单元测试
├── docs/
│   ├── DESIGN.md                    # 系统设计文档
│   └── USAGE.md                     # 使用说明
├── .env.example                     # 环境变量模板
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

---

## 快速开始

### 前置要求

- Node.js 18+
- Anthropic API Key（需有 Claude API 访问权限）
- Telegram Bot Token（可选）
- 钉钉企业内部应用（可选）
- [Whisper](https://github.com/openai/whisper)（可选，Telegram 语音消息识别需要）
  ```bash
  pip install openai-whisper
  ```

### 安装

```bash
git clone <this-repo>
cd im-claude
npm install
```

### 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# 必填
ANTHROPIC_API_KEY=sk-ant-xxx

# Telegram（二选一或都填）
TELEGRAM_BOT_TOKEN=

# 钉钉
DINGTALK_APP_KEY=
DINGTALK_APP_SECRET=
DINGTALK_AGENT_ID=
DINGTALK_WEBHOOK_SECRET=
DINGTALK_WEBHOOK_PORT=3000

# 访问控制：逗号分隔的用户 ID 白名单，留空则允许所有人
ALLOWED_USER_IDS=

# Claude Code 允许使用的工具（生产环境建议不开 Bash）
ALLOWED_TOOLS=Read,Glob,Grep,Write

# Claude Code 工作目录
WORKING_DIR=/workspace

# Whisper 语音识别模型（tiny/base/small/medium/large，越大越准但越慢）
# 需要先安装：pip install openai-whisper
WHISPER_MODEL=base

# Clawra 自拍功能（可选）
# 需要 fal.ai 账号：https://fal.ai/ 注册后充值（最低 $10），在控制台获取 API Key
# 未配置时自拍功能不可用，启动时会打印警告
FAL_KEY=
```

### 开发模式运行

```bash
npm run dev
```

### 生产构建

```bash
npm run build
npm start
```

### Docker 部署

```bash
docker-compose up -d
```

---

## Telegram 配置

### 1. 创建 Bot

1. 在 Telegram 中找到 `@BotFather`
2. 发送 `/newbot`，按提示填写名称
3. 复制获得的 Token，填入 `.env` 的 `TELEGRAM_BOT_TOKEN`

### 2. 获取用户 ID（白名单用）

向 `@userinfobot` 发消息，获取自己的数字 ID，填入 `ALLOWED_USER_IDS`。

### 3. 支持的命令与功能

| 命令/操作 | 说明 |
|-----------|------|
| 直接发文字 | 与 Claude 对话 |
| 发送**语音**消息 | 自动转文字后发给 Claude（需安装 Whisper） |
| `/clear` | 清空对话历史，开始新会话 |
| `/start` | 欢迎消息 |
| `/help` | 使用说明 |

### 4. 语音消息（Telegram）

Telegram 支持直接发送语音消息，Bot 会自动调用 Whisper 进行语音识别，将识别结果发送给 Claude：

```
用户发语音 → Whisper 转文字 → 显示识别结果（🎤 文字） → Claude 回复
```

**前置条件**：需在运行环境中安装 Whisper：
```bash
pip install openai-whisper
```

可通过 `WHISPER_MODEL` 环境变量调整模型大小（越大越准但首次下载慢）：

| 模型 | 大小 | 适用场景 |
|------|------|---------|
| `tiny` | ~75MB | 速度优先 |
| `base` | ~145MB | 默认，均衡 |
| `small` | ~466MB | 较高精度 |
| `medium` | ~1.5GB | 高精度 |
| `large` | ~3GB | 最高精度 |

---

## 钉钉配置

### 1. 创建企业内部应用机器人

1. 登录[钉钉开放平台](https://open.dingtalk.com)
2. 进入「应用开发」→「企业内部应用」→「创建应用」
3. 在应用中添加「机器人」能力
4. 记录 **AppKey**、**AppSecret**、**AgentId**

### 2. 配置消息接收

1. 机器人设置页 → 「消息接收模式」选择「HTTP 模式」
2. 消息接收地址填入：

   ```
   http://你的公网IP或域名:3000/dingtalk/webhook
   ```

   > 本地开发可用 [ngrok](https://ngrok.com) 或 [frp](https://github.com/fatedier/frp) 暴露端口

3. 开启「签名」，复制签名密钥填入 `DINGTALK_WEBHOOK_SECRET`

### 3. 配置权限

在应用「权限管理」中申请：
- 消息发送（单聊）：`qyapi_chat`
- 机器人发消息：`robot`

### 4. 获取用户 StaffId（白名单用）

通过钉钉 API 或管理后台获取成员的 `staffId`，填入 `ALLOWED_USER_IDS`。

---

## 虚拟女友

她是 Claude AI + 精心设计的人设 Prompt + fal.ai 图像生成的组合体。

支持日常陪聊天和按你的要求发自拍。

配置作息表后，Clawra 会在固定时间**主动给你发消息**，偶尔附上自拍。

第一次运行时，会弹出配置向导，让你给 Clawra 起名字、设定性格和爱好。

<img src="docs\images\IMG_2552.jpg" style="zoom:50%;float:left" />

## 访问控制

### 用户白名单

```env
# Telegram 用数字 userId，钉钉用 staffId，混用逗号分隔
ALLOWED_USER_IDS=123456789,user_dingtalk_001
```

留空表示允许所有人，**仅适合本地开发**。

### 工具权限

控制 Claude 可以使用哪些 Claude Code 工具：

```env
# 只读模式（安全）
ALLOWED_TOOLS=Read,Glob,Grep

# 读写模式
ALLOWED_TOOLS=Read,Glob,Grep,Write,Edit

# 完整模式（谨慎开放 Bash）
ALLOWED_TOOLS=Read,Glob,Grep,Write,Edit,Bash
```



## 验证

### 1. Telegram 基本对话

1. 在 Telegram 搜索你的 Bot 用户名
2. 发送 `/start`
3. 发任意消息测试对话

### 2. Clawra 自拍

向 Bot 发：「发张咖啡馆自拍给我」，Bot 会调用 fal.ai 生成图片并通过 `sendPhoto` 发送。

### 3. 运行单元测试

```bash
npm test
```

---

## 扩展：添加新 IM 平台

实现 `IMAdapter` 接口即可：

```typescript
import type { IMAdapter, IncomingMessage, OutgoingMessage, MessageHandler } from "./base.adapter.js";

export class MyIMAdapter implements IMAdapter {
  readonly platform = "myim" as const;

  onMessage(handler: MessageHandler): void { /* 注册消息处理器 */ }
  async sendMessage(msg: OutgoingMessage): Promise<void> { /* 发送消息 */ }
  async start(): Promise<void> { /* 启动监听 */ }
  async stop(): Promise<void> { /* 停止 */ }
}
```

在 `src/index.ts` 中注册：

```typescript
const myim = new MyIMAdapter(/* config */);
router.registerAdapter(myim);
```

---

## 技术栈

| 依赖 | 用途 |
|------|------|
| `@anthropic-ai/claude-agent-sdk` | Claude Code Agent SDK，核心 AI 能力 |
| `@anthropic-ai/sdk` | Anthropic SDK，用于 Clawra 消息生成（Haiku） |
| `grammy` | Telegram Bot 框架 |
| `axios` | HTTP 调用（钉钉 API、fal.ai、Telegram 文件下载） |
| `cron` | Clawra 定时调度 |
| `zod` | 配置文件 JSON 校验 |
| `dotenv` | 环境变量管理 |
| `typescript` + `tsx` | TypeScript 运行时 |
| `openai-whisper`（系统依赖） | 语音消息转文字（Python，需单独安装） |

---

## 常见问题

**Q: 钉钉本地开发如何接收 webhook？**

使用 ngrok 暴露本地端口：
```bash
ngrok http 3000
# 将 https://xxx.ngrok.io/dingtalk/webhook 填入钉钉消息接收地址
```

**Q: 如何限制 Claude 只能访问特定目录？**

设置 `WORKING_DIR` 为目标目录，Claude Code 默认只操作该目录下的文件。

**Q: Telegram 消息超长怎么办？**

适配器会自动按 4000 字符分割为多条消息发送。

**Q: 能同时运行 Telegram 和钉钉吗？**

可以，在 `.env` 中同时配置两者的参数即可，服务启动时会自动注册两个适配器。

