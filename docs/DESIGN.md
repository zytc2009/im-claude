# Clawra AI 陪伴系统 — 设计文档

## 1. 系统架构

### 整体链路

```
                          ┌──────────────────────────────────────┐
                          │           im-claude Bridge            │
                          │                                        │
  ┌──────────┐  消息      │  ┌──────────────┐  ┌──────────────┐  │
  │ Telegram │ ────────►  │  │ TelegramAdapter  │  │ DingTalkAdapter │
  └──────────┘            │  └──────┬───────┘  └──────┬───────┘  │
                          │         │                   │          │
  ┌──────────┐  消息      │         └──────────┬────────┘          │
  │ DingTalk │ ────────►  │                    │                   │
  └──────────┘            │            ┌───────▼────────┐          │
                          │            │  MessageRouter  │          │
                          │            └───────┬────────┘          │
                          │                    │ 被动响应链路        │
                          │            ┌───────▼────────┐          │
                          │            │  ClaudeRunner   │          │
                          │            │ (Agent SDK)     │          │
                          │            └────────────────┘          │
                          │                                        │
                          │  ┌─────────────────────────────────┐  │
                          │  │        ClawraScheduler           │  │
                          │  │  (主动推送链路)                   │  │
                          │  │                                   │  │
                          │  │  CronJob × N                     │  │
                          │  │    │                              │  │
                          │  │    ├─► MessageGenerator           │  │
                          │  │    │     (claude-haiku-4-5)       │  │
                          │  │    │                              │  │
                          │  │    └─► PhotoGenerator             │  │
                          │  │          (fal.ai API)             │  │
                          │  │              │                    │  │
                          │  │              ▼                    │  │
                          │  │    Adapter.sendMessage()         │  │
                          │  └─────────────────────────────────┘  │
                          └──────────────────────────────────────┘
```

### 两条链路对比

| 维度 | 被动响应链路 | 主动推送链路 |
|------|-------------|-------------|
| 触发方式 | 用户发消息 | Cron 定时触发 |
| LLM | Claude Agent SDK (claude-opus/sonnet) | @anthropic-ai/sdk (claude-haiku-4-5) |
| 照片生成 | ClaudeRunner 内部通过 bash 调用 fal.ai | PhotoGenerator 直接调用 fal.ai |
| 目标 chat | 来源消息的 chatId | 环境变量 CLAWRA_TARGET_CHAT_ID |
| 开关 | 始终开启 | CLAWRA_SCHEDULE_ENABLED=true |

---

## 2. 模块职责表

| 模块 | 文件 | 职责 |
|------|------|------|
| 类型定义 | `src/clawra/types.ts` | 所有共享接口和类型 |
| 人设加载 | `src/clawra/profile.ts` | 加载/校验/缓存 profile JSON；生成 system prompt 和 selfie prompt |
| 作息加载 | `src/clawra/schedule.ts` | 加载/校验/缓存 schedule JSON；日期判断；cron 表达式生成 |
| 消息生成 | `src/clawra/message-generator.ts` | 调用 Haiku 生成口语化短消息；含重试+fallback |
| 照片生成 | `src/clawra/photo-generator.ts` | 调用 fal.ai grok-imagine-image/edit；超时+静默失败 |
| 调度器 | `src/clawra/scheduler.ts` | 管理 CronJob 生命周期；串行执行消息+照片发送 |
| IM 路由 | `src/router/message.router.ts` | 注册适配器；转发消息；检测图片 URL |
| 适配器基类 | `src/adapters/base.adapter.ts` | IMAdapter 接口定义 |
| Telegram | `src/adapters/telegram.adapter.ts` | Telegram Bot API 接入；sendPhoto 支持 |
| Claude Runner | `src/runner/claude.runner.ts` | 包装 claude-agent-sdk query()；注入 Clawra 人设 |
| 入口 | `src/index.ts` | 组装所有组件；条件启动调度器；优雅退出 |

---

## 3. 配置文件 Schema 说明

### config/clawra-profile.json

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | Clawra 的名字，用于 prompt 中的自称 |
| `gender` | string | 性别描述，影响 prompt 中的人物设定 |
| `personality` | string[] | 性格标签列表，拼接进 system prompt |
| `hobbies` | string[] | 爱好列表，用于日常话题自然融入 |
| `speakingStyle` | string | 说话风格说明，直接嵌入 prompt 约束 LLM 输出 |
| `referenceImageUrl` | string (URL) | fal.ai 参考图片 URL，用于 image-to-image 生成 |
| `language` | string | 语言代码，如 `zh-CN` |

### config/clawra-schedule.json

顶层包含 `weekday` 和 `weekend` 两个数组，元素结构如下：

| 字段 | 类型 | 说明 |
|------|------|------|
| `time` | string (HH:MM) | 触发时间，24小时制 |
| `activity` | string | 正在做的事情，用于 prompt 上下文 |
| `location` | string | 所在地点，影响照片生成模式选择 |
| `sendPhoto` | boolean | 是否尝试生成自拍照 |
| `messageType` | `"greeting"\|"meal"\|"activity"\|"goodnight"` | 消息类型，用于 fallback 模板选择 |
| `promptHint` | string | 传给 LLM 的场景提示，让消息更自然 |

---

## 4. Cron 调度逻辑说明

```
parseCronExpression("07:15", true)  → "15 7 * * 1-5"   // 工作日
parseCronExpression("09:00", false) → "0 9 * * 0,6"     // 周末
```

- 工作日 (isWeekday=true)：天字段使用 `1-5`（周一到周五）
- 周末 (isWeekday=false)：天字段使用 `0,6`（周日, 周六）
- 时区通过 CronJob `timeZone` 选项设置，默认 `Asia/Shanghai`
- 调度器在 `start()` 时为 weekday 和 weekend 各创建一组 CronJob
- 每个 entry 生成一个独立的 CronJob 实例

---

## 5. 消息生成策略

### LLM 调用流程

```
generateMessage(profile, entry)
    │
    ├─ 构建 system prompt（buildSystemPrompt）
    ├─ 构建 user prompt（时间 + 地点 + activity + promptHint）
    │
    ├─ 尝试 #1: callLLM → claude-haiku-4-5-20251001
    │   └─ 成功 → 返回
    │
    ├─ 失败 → sleep(500ms)
    ├─ 尝试 #2: callLLM
    │   └─ 成功 → 返回
    │
    ├─ 失败 → sleep(1000ms)
    ├─ 尝试 #3: callLLM
    │   └─ 成功 → 返回
    │
    └─ 失败 → pickFallback(entry.messageType) → 返回
```

### Fallback 模板

每种 `messageType` 对应 3 条备用消息，随机选取：

| 类型 | 示例 |
|------|------|
| greeting | "早安~ 今天也要加油哦！" |
| meal | "该吃饭啦，别忘了~" |
| activity | "刚换了个地方，跟你说一声~" |
| goodnight | "要睡觉了，晚安~" |

---

## 6. 照片生成流程

### 照片发送门控逻辑

```
ClawraScheduler.lastLocation  (初始值: "")
ClawraScheduler.lastPhotoDate (初始值: "")
    │
    today = new Date().toDateString()
    isNewDay       = today !== lastPhotoDate
    locationChanged = entry.location !== lastLocation
    shouldSendPhoto = entry.sendPhoto && (locationChanged || isNewDay)
    │
    ├─ shouldSendPhoto=true → generateSelfie()
    │       └─ 成功 → 更新 lastLocation、lastPhotoDate
    └─ shouldSendPhoto=false → 跳过照片生成
```

**设计意图：**
- 同一天内，若地点未变化则不重复发照片（避免连续相同自拍）
- 跨天时，即使地点相同也重置门控（保证每天早安自拍正常触发）
- 重启后 `lastPhotoDate=""` 触发"新天"逻辑，首次调度恢复正常

### Mirror vs Direct 模式选择

`buildSelfiePrompt` 根据 location 关键词判断：

| 关键词 | 模式 | Prompt 风格 |
|--------|------|-------------|
| gym / bedroom / mirror / bathroom / 健身 / 卧室 / 镜子 / 浴室 | mirror selfie | 手机镜像可见，室内光线 |
| 其他（cafe / library / park / mall 等） | direct selfie | 直接举起手机拍，自然光 |

### fal.ai API 调用

- Endpoint: `POST https://fal.run/xai/grok-imagine-image/edit`
- 参数: `{ image_url, prompt, num_images: 1, output_format: "jpeg" }`
- 超时: 15 秒
- 认证: `Authorization: Key {FAL_KEY}`

---

## 7. 错误处理策略

| 场景 | 策略 |
|------|------|
| profile JSON 校验失败 | Zod 抛异常，进程启动失败，明确报错字段 |
| schedule JSON 校验失败 | 同上 |
| LLM 调用失败 | 最多重试 2 次（500ms + 1000ms），最终用 fallback 模板 |
| fal.ai 调用失败/超时 | 静默返回 null，不发照片，仍发文字消息 |
| Adapter 发送失败 | 逐个 adapter 独立 try/catch，单个失败不影响其他 |
| 调度器 entry 处理异常 | catch 后打印日志，不影响其他 CronJob 运行 |
| 微信图片上传失败 | 自动降级为发送原始 URL 文字（fallbackText） |
| replyPrefix 未配置 | loadProfile 默认值为"亲爱的，" |

---

## 8. 微信图片上传协议

基于 `@tencent-weixin/openclaw-weixin` 官方实现，完整流程：

### 8.1 getuploadurl（扁平参数格式）

```json
POST ilink/bot/getuploadurl
{
  "filekey": "<16字节随机hex>",
  "media_type": 1,
  "to_user_id": "<目标用户wxid>",
  "rawsize": 12345,
  "rawfilemd5": "<明文MD5>",
  "filesize": 12352,
  "no_need_thumb": true,
  "aeskey": "<16字节随机hex编码>",
  "base_info": { "channel_version": "..." }
}
```

- `filesize` = AES-128-ECB 密文大小 = `Math.ceil((rawsize + 1) / 16) * 16`
- `aeskey` 用 **hex** 编码（不是 base64）
- 响应字段为 `upload_param`

### 8.2 CDN 上传

```
POST https://novac2c.cdn.weixin.qq.com/c2c/upload
  ?encrypted_query_param=<upload_param>
  &filekey=<filekey>

Body: AES-128-ECB 加密后的图片数据（无 Authorization header）
Response header: x-encrypted-param → 下载参数
```

### 8.3 sendmessage image_item

```json
{
  "type": 2,
  "image_item": {
    "media": {
      "encrypt_query_param": "<x-encrypted-param>",
      "aes_key": "<base64(hex字符串UTF-8字节)>",
      "encrypt_type": 1
    },
    "mid_size": 12352
  }
}
```

- `aes_key` = `Buffer.from(aeskeyHex).toString("base64")`
- `mid_size` = 密文大小（不是明文大小）

### 8.4 fal.ai 图片代理

fal.ai 域名在国内不可达，通过 wsrv.nl 代理后再上传微信 CDN：
```
https://wsrv.nl/?url=<encodeURIComponent(fal.media URL)>&n=-1
```
| 环境变量缺失 | `requireEnv()` 在启动时 fail-fast，明确提示缺失的 key |
