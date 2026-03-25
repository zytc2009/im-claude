# Clawra AI 陪伴系统 — 使用说明

## 快速开始（3步）

**第一步：配置环境变量**

复制并编辑 `.env` 文件，填入必要的 API Key：

```bash
cp .env.example .env  # 如有示例文件
# 或直接编辑 .env
```

**第二步：安装依赖并构建**

```bash
npm install
npm run build
```

**第三步：启动**

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm start
```

---

## 环境变量完整配置表

| 字段 | 说明 | 是否必填 | 默认值 |
|------|------|----------|--------|
| `ANTHROPIC_API_KEY` | Anthropic API Key，用于 Claude LLM 调用 | 必填 | — |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token，来自 @BotFather | 条件必填（二选一）| — |
| `DINGTALK_APP_KEY` | 钉钉应用 AppKey | 条件必填（二选一）| — |
| `DINGTALK_APP_SECRET` | 钉钉应用 AppSecret | 若配置 DingTalk 则必填 | — |
| `DINGTALK_AGENT_ID` | 钉钉应用 AgentId | 若配置 DingTalk 则必填 | — |
| `DINGTALK_WEBHOOK_SECRET` | 钉钉 Webhook 签名密钥 | 若配置 DingTalk 则必填 | — |
| `DINGTALK_WEBHOOK_PORT` | 钉钉 Webhook 监听端口 | 否 | `3000` |
| `FAL_KEY` | fal.ai API Key，用于自拍照生成 | 否（无则跳过照片生成）| — |
| `ALLOWED_USER_IDS` | 允许使用的用户 ID 列表，逗号分隔 | 否 | 空（拒绝所有） |
| `ALLOWED_TOOLS` | Claude Agent 允许使用的工具列表 | 否 | `Read,Glob,Grep` |
| `WORKING_DIR` | Claude Agent 工作目录 | 否 | 当前目录 |
| `WHISPER_MODEL` | 本地 Whisper 语音识别模型大小 | 否 | `base` |
| `CLAWRA_TARGET_CHAT_ID` | 主动消息推送目标的 Telegram Chat ID | 否 | `8251974296` |
| `CLAWRA_TIMEZONE` | 调度器时区 | 否 | `Asia/Shanghai` |
| `CLAWRA_SCHEDULE_ENABLED` | 是否开启主动消息调度 | 否 | `false` |

---

## 人设配置说明

人设配置文件位于 `config/clawra-profile.json`。

```json
{
  "name": "Clawra",
  "gender": "female",
  "personality": ["温柔体贴", "活泼开朗", "略带撒娇", "细心", "爱笑"],
  "hobbies": ["瑜伽", "烘焙", "咖啡", "摄影", "追剧", "逛街"],
  "speakingStyle": "口语化自然简短，经常用波浪号~表达语气",
  "referenceImageUrl": "https://cdn.jsdelivr.net/gh/SumeLabs/clawra@main/assets/clawra.png",
  "language": "zh-CN"
}
```

**修改建议：**
- `personality` 和 `hobbies` 直接影响 LLM 生成的消息风格
- `speakingStyle` 是最关键的控制字段，直接嵌入 system prompt
- `referenceImageUrl` 需要是公开可访问的 HTTPS 图片 URL
- 修改后重启生效（profile 有内存缓存）

---

## 作息表配置说明

作息表配置文件位于 `config/clawra-schedule.json`。

```json
{
  "weekday": [...],
  "weekend": [...]
}
```

每个条目格式：

```json
{
  "time": "07:15",
  "activity": "起床",
  "location": "bedroom",
  "sendPhoto": true,
  "messageType": "greeting",
  "promptHint": "刚起床，头发乱乱的，向对方说早安"
}
```

**time 格式：** `HH:MM`，24小时制。

**messageType 可选值：**
- `greeting` — 早安/问候类
- `meal` — 吃饭提醒类
- `activity` — 活动/位置切换类
- `goodnight` — 晚安类

**location 与照片模式：**
- 含 `gym`/`bedroom`/`mirror`/`bathroom`：生成镜前自拍风格
- 其他（`cafe`/`library`/`park`/`mall`）：生成直拍风格

**sendPhoto 说明：**
- `true` 代表"有意愿发照片"，实际触发需满足：`sendPhoto=true` 且（location 变化 **或** 跨天）
- 同一天内连续触发同一 location 时，跳过照片生成（避免重复）
- 每天首次触发会重置门控，保证早安自拍等每天都能正常发送
- 若 `FAL_KEY` 未配置，照片生成自动跳过

---

## 启动命令

```bash
# 开发环境（TypeScript 直接运行）
npm run dev

# 生产构建
npm run build

# 生产启动
npm start

# 运行测试
npm test

# 测试监听模式
npm run test:watch
```

---

## 开启主动消息调度

1. 确认 `FAL_KEY` 已在 `.env` 中配置（用于照片生成）
2. 确认目标 Chat ID 正确：
   ```
   CLAWRA_TARGET_CHAT_ID=你的TelegramChatID
   ```
3. 在 `.env` 中将调度开关设为 `true`：
   ```
   CLAWRA_SCHEDULE_ENABLED=true
   ```
4. 确认时区正确（默认上海时区）：
   ```
   CLAWRA_TIMEZONE=Asia/Shanghai
   ```
5. 重启服务即可生效

**获取你的 Telegram Chat ID：**
向 @userinfobot 发任意消息，它会回复你的 Chat ID。

---

## 常见问题排查

**Q: 启动失败，提示"缺少必要环境变量"**

检查 `.env` 文件是否存在，并且对应 key 有值（不是空字符串）。

**Q: Telegram Bot 无响应**

1. 检查 `TELEGRAM_BOT_TOKEN` 是否正确
2. 检查 `ALLOWED_USER_IDS` 是否包含你的 Telegram User ID
3. 查看控制台日志是否有 `[Telegram] Bot ready`

**Q: 发不出照片，只收到文字**

1. 检查 `FAL_KEY` 是否已设置（在 `.env` 或 `~/.claude/skills/clawra-selfie/.env`）
2. 查看日志是否有 `[PhotoGenerator]` 相关警告
3. fal.ai API 超时为 15 秒，网络慢时可能失败
4. 调度照片：确认 `sendPhoto=true` 且满足门控条件（location 变化或跨天）
5. 会话照片：Clawra 会通过 Bash 调用 fal.ai API 生成并在回复中附上原始 URL

**Q: 调度消息不发送**

1. 确认 `CLAWRA_SCHEDULE_ENABLED=true`
2. 确认时区设置正确，检查当前服务器时间
3. 查看启动日志是否有 `Clawra 主动消息调度已启动`
4. 查看 `[ClawraScheduler] Started N cron jobs` 日志

**Q: 照片生成了但场景不对**

修改 `config/clawra-schedule.json` 中对应条目的 `location` 和 `promptHint`。
location 关键词影响 mirror/direct 模式选择，参见 DESIGN.md 第6章。

**Q: 消息风格不对，太像机器人**

修改 `config/clawra-profile.json` 中的 `speakingStyle` 字段，它直接控制 LLM 的说话风格。
示例：`"说话简短自然，像发微信一样，不超过两句，经常用~结尾"`
