# 大航海时代：用 AI 打造你的虚拟船员

> 每个海贼王的身边，都有一群独一无二的伙伴。
> 今天，我们也有了自己的船员。

---

## 背景

[im-claude](https://github.com/zytc2009/im-claude) 是一个将 Claude AI 接入微信、Telegram 等 IM 平台的本地 Bot 框架。

最初，它只有一个虚拟人——Clawra，一个 AI 女友人设。

但一艘船，只有一个船员是不够的。

**大航海时代需要的是一支船队。**

---

## 这次我们做了什么

我们为 im-claude 加入了**多虚拟人（Multi-Persona）**能力：

- 每个虚拟人有自己的**名字、性格、爱好、说话风格**
- 每个虚拟人维护**独立的对话记忆**，互不干扰
- 发消息时带上名字前缀，就能找到对应的人
- 无前缀时，自动找默认虚拟人
- 虚拟人数量**无上限**，改一个 JSON 文件即可扩展

---

## 怎么和虚拟船员聊天

### 找特定的人

```
阿瓜 你今天在干嘛
阿瓜，你今天在干嘛
@阿瓜 你今天在干嘛
阿瓜: 你今天在干嘛
```

以上四种格式都能识别，语音消息也支持（微信自动语音转文字）。

### 无前缀，找默认船员

```
你好啊
```

直接发消息，默认找第一个虚拟人回复。

### 管理指令

| 指令 | 作用 |
|------|------|
| `/personas` | 列出所有虚拟人 |
| `/default 阿瓜` | 切换默认虚拟人 |
| `/clear 阿瓜` | 重置与阿瓜的对话记忆 |
| `/clearall` | 重置所有虚拟人对话记忆 |

---

## 怎么创建你自己的船员

编辑 `config/personas.json`，按下面的模板加入新成员：

```json
{
  "default": "阿瓜",
  "personas": [
    {
      "name": "阿瓜",
      "gender": "女",
      "personality": ["温柔体贴", "活泼开朗", "略带撒娇", "细心", "爱笑"],
      "hobbies": ["瑜伽", "烘焙", "咖啡", "摄影", "追剧", "逛街"],
      "speakingStyle": "口语化自然简短，经常用波浪号~表达语气，喜欢用颜文字，说话不超过两句",
      "language": "中文",
      "replyPrefix": "阿瓜: ",
      "selfie": {
        "enabled": false
      }
    },
    {
      "name": "海贼王",
      "gender": "男",
      "personality": ["豪爽直接", "幽默风趣", "热情开朗", "对新鲜事物充满好奇心"],
      "hobbies": ["篮球", "跑步", "健身", "骑行", "探索新地方", "尝试新科技"],
      "speakingStyle": "说话豪爽接地气，爱开玩笑，偶尔用网络梗，语气充满活力，不超过两三句",
      "language": "中文",
      "replyPrefix": "海贼王: ",
      "selfie": {
        "enabled": false
      }
    }
  ]
}
```

**改完重启 Bot 即生效，不需要改代码。**

---

## 自拍功能（可选）

如果你想让虚拟人发自拍，需要：

1. 申请 [fal.ai](https://fal.ai) API Key，填入 `.env` 的 `FAL_KEY`
2. 准备一张参考图片（用于生成 AI 形象）
3. 开启 selfie：

```json
"selfie": {
  "enabled": true,
  "referenceImageUrl": "https://你的参考图片地址.jpg"
}
```

开启后，当你问虚拟人「发张照片」「你在哪」，她会自动生成一张场景自拍发给你。

---

## 快速上手

```bash
# 1. 克隆项目
git clone https://github.com/zytc2009/im-claude.git
cd im-claude

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 TELEGRAM_BOT_TOKEN 或开启 WECHAT_ENABLED=true

# 4. 配置你的船员
# 编辑 config/personas.json，按模板填入虚拟人信息

# 5. 启动
npm run dev
```

---

## 技术实现简述

多虚拟人的核心设计：

**消息路由**：收到消息后，用正则从首词提取 persona 名，匹配不到则用默认值。
**独立 Session**：每个虚拟人的 Session Key 为 `userId:personaName`，对话历史完全隔离。
**动态 System Prompt**：每个虚拟人启动独立的 Claude Agent，注入各自的人设 Prompt。

```
用户: "海贼王，今天天气怎样？"
        ↓
Router 解析出 persona="海贼王"，message="今天天气怎样？"
        ↓
Session Key = "userId:海贼王"（独立上下文）
        ↓
加载海贼王的人设 → 注入 Claude Agent
        ↓
回复: "海贼王: 天气？管它呢！出海就完了！哈哈哈"
```

---

## 大航海时代的宝藏在哪里？

路飞说，大宝藏在航行的终点。

但我们知道，**宝藏从来不在终点，而在每一次出发的勇气里。**

每一个加入的虚拟伙伴，都是一次新的出发。
每一段对话，都是一段属于你的航行。
每一个创造者，都是这片海上的船长。

**船员已就位，启航吧。**

---

## 加入我们

- GitHub：[zytc2009/im-claude](https://github.com/zytc2009/im-claude)
- 欢迎提 Issue、PR，一起壮大船队

> *"我要成为海贼王！"*
> —— 不止是路飞的梦想，也是每一个敢于创造的人的宣言。
