import type { IMAdapter, IncomingMessage } from "../adapters/base.adapter.js";
import type { ClaudeRunner } from "../runner/claude.runner.js";
import type { PermissionManager } from "../permissions/permission.manager.js";

/** 正在处理中的用户集合，防止重复提交 */
const PROCESSING = new Set<string>();

export class MessageRouter {
  private readonly adapters: IMAdapter[] = [];

  constructor(
    private readonly runner: ClaudeRunner,
    private readonly permissions: PermissionManager,
  ) {}

  registerAdapter(adapter: IMAdapter): void {
    this.adapters.push(adapter);
    adapter.onMessage((msg) => this.handle(adapter, msg));
    console.log(`[Router] Registered adapter: ${adapter.platform}`);
  }

  private async handle(adapter: IMAdapter, msg: IncomingMessage): Promise<void> {
    // 权限校验
    if (!this.permissions.isUserAllowed(msg.userId)) {
      await adapter.sendMessage({ chatId: msg.chatId, text: "❌ 无访问权限" });
      return;
    }

    // /clear 指令
    if (msg.text === "__CLEAR_SESSION__") {
      this.runner.clearSession(msg.userId);
      return;
    }

    // /testimage 指令：用随机图测试图片发送
    if (msg.text.trim() === "/testimage") {
      await adapter.sendMessage({
        chatId: msg.chatId,
        text: "测试图片",
        mediaUrl: "https://picsum.photos/400/300.jpg",
      });
      return;
    }

    // 防并发：同一用户上一条还未处理完时，拒绝新请求
    if (PROCESSING.has(msg.userId)) {
      await adapter.sendMessage({
        chatId: msg.chatId,
        text: "⏳ 上一条消息仍在处理中，请稍候...",
      });
      return;
    }

    PROCESSING.add(msg.userId);
    // 每 25 秒发一次心跳，防止 WeChat context_token 过期
    const heartbeat = setInterval(() => {
      adapter.sendMessage({ chatId: msg.chatId, text: "⏳ 生成中，请稍候..." }).catch(() => {});
    }, 25_000);
    try {
      await adapter.sendMessage({ chatId: msg.chatId, text: "⏳ 思考中..." });
      const response = await this.runner.run(msg.userId, msg.text);
      console.log(`[Router] Claude 响应: ${JSON.stringify(response)}`);

      const prefix = this.runner.getReplyPrefix();

      // 检测回复中是否包含图片 URL（fal.media 或其他图片链接）
      const imageUrlMatch = response.match(
        /https?:\/\/\S+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?/i
      ) ?? response.match(/https?:\/\/v3b\.fal\.media\/\S+/i);

      if (imageUrlMatch) {
        const rawUrl = imageUrlMatch[0];
        // fal.ai 域名在国内不可达，通过 wsrv.nl 代理（WeChat 服务器可访问）
        const imageUrl = rawUrl.includes("fal.media")
          ? `https://wsrv.nl/?url=${encodeURIComponent(rawUrl)}&n=-1`
          : rawUrl;
        // 清理 caption：移除所有 URL 和 markdown 图片语法，保留纯文字
        const caption = response
          .replace(/!\[.*?\]\(.*?\)/g, "")           // 移除 ![alt](url)
          .replace(/https?:\/\/\S+/g, "")            // 移除所有 URL
          .replace(/\n{3,}/g, "\n")                  // 合并多余空行
          .trim();
        const prefixedCaption = caption ? `${prefix}${caption}` : caption;
        const fallbackText = prefixedCaption ? `${prefixedCaption}\n${rawUrl}` : rawUrl;
        await adapter.sendMessage({ chatId: msg.chatId, text: prefixedCaption, mediaUrl: imageUrl, fallbackText });
      } else {
        await adapter.sendMessage({ chatId: msg.chatId, text: `${prefix}${response}` });
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[Router] Error for user ${msg.userId}:`, detail);
      await adapter.sendMessage({
        chatId: msg.chatId,
        text: `❌ 出错了：${detail}`,
      });
    } finally {
      clearInterval(heartbeat);
      PROCESSING.delete(msg.userId);
    }
  }

  async startAll(): Promise<void> {
    await Promise.all(this.adapters.map((a) => a.start()));
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.adapters.map((a) => a.stop()));
  }
}
