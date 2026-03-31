import type { IMAdapter, IncomingMessage } from "../adapters/base.adapter.js";
import type { ClaudeRunner } from "../runner/claude.runner.js";
import type { PermissionManager } from "../permissions/permission.manager.js";
import { logMessage } from "../services/message.logger.js";

interface QueueItem {
  adapter: IMAdapter;
  chatId: string;
  userId: string;
  text: string;
  personaName: string;
}

export class MessageRouter {
  private readonly adapters: IMAdapter[] = [];
  /** 每个 userId:persona 的待处理队列 */
  private readonly queues = new Map<string, QueueItem[]>();
  /** 当前正在处理的 key */
  private readonly processing = new Set<string>();
  /** 内容去重：userId+text → 最近处理时间戳，防止同一消息在 120s 内被处理两次 */
  private readonly recentMessages = new Map<string, number>();

  constructor(
    private readonly runner: ClaudeRunner,
    private readonly permissions: PermissionManager,
    /** 所有可用 persona 名（小写），第一个为默认 */
    private readonly personaNames: string[],
    private defaultPersonaName: string,
  ) {}

  /** 运行时修改默认 persona（用于 /default <name> 指令）*/
  setDefaultPersona(name: string): boolean {
    if (!this.personaNames.includes(name.toLowerCase())) return false;
    this.defaultPersonaName = name.toLowerCase();
    return true;
  }

  registerAdapter(adapter: IMAdapter): void {
    this.adapters.push(adapter);
    adapter.onMessage((msg) => this.handle(adapter, msg));
    console.log(`[Router] Registered adapter: ${adapter.platform}`);
  }

  /**
   * 解析消息中的 persona 前缀。
   * 支持格式：
   *   "Kira 你好"       → { persona: "kira", text: "你好" }
   *   "Kira: 你好"      → { persona: "kira", text: "你好" }
   *   "@Kira 你好"      → { persona: "kira", text: "你好" }
   *   "你好"            → { persona: defaultPersona, text: "你好" }
   */
  private parsePersona(raw: string): { personaName: string; text: string } {
    const trimmed = raw.trim();
    // 匹配 @Name、Name:、Name<空格>、Name，、Name、 等前缀格式
    const match = /^@?(\S+?)(?::|[,，、]| )\s*(.*)$/s.exec(trimmed);
    if (match) {
      const candidate = match[1].toLowerCase();
      if (this.personaNames.includes(candidate)) {
        return { personaName: candidate, text: match[2].trim() };
      }
    }
    return { personaName: this.defaultPersonaName, text: trimmed };
  }

  private async handle(adapter: IMAdapter, msg: IncomingMessage): Promise<void> {
    const textPreview = msg.text.slice(0, 30);

    // 内容去重
    const contentKey = `${msg.userId}:${msg.text}`;
    const now = Date.now();
    const lastSeen = this.recentMessages.get(contentKey);
    if (lastSeen !== undefined && now - lastSeen < 120_000) {
      console.log(`[FLOW][Router] 重复跳过 user=${msg.userId} text="${textPreview}"`);
      return;
    }
    this.recentMessages.set(contentKey, now);
    // 清理超过 120s 的旧记录，防止内存泄漏
    if (this.recentMessages.size > 500) {
      const cutoff = now - 120_000;
      for (const [k, t] of this.recentMessages) {
        if (t < cutoff) this.recentMessages.delete(k);
      }
    }

    if (!this.permissions.isUserAllowed(msg.userId)) {
      await adapter.sendMessage({ chatId: msg.chatId, text: "❌ 无访问权限" });
      return;
    }

    // /default <name> 指令：修改默认 persona
    const defaultMatch = /^\/default\s+(\S+)$/i.exec(msg.text.trim());
    if (defaultMatch) {
      const name = defaultMatch[1];
      if (this.setDefaultPersona(name)) {
        await adapter.sendMessage({ chatId: msg.chatId, text: `✅ 默认虚拟人已切换为 ${name}` });
      } else {
        const available = this.personaNames.join("、");
        await adapter.sendMessage({ chatId: msg.chatId, text: `❌ 找不到 "${name}"，可用：${available}` });
      }
      return;
    }

    // /personas 指令：列出所有虚拟人
    if (msg.text.trim() === "/personas") {
      const list = this.personaNames
        .map((n) => (n === this.defaultPersonaName ? `${n}（默认）` : n))
        .join("\n");
      await adapter.sendMessage({ chatId: msg.chatId, text: `可用虚拟人：\n${list}` });
      return;
    }

    // /clear 指令：清除当前对话 session
    if (msg.text.trim() === "__CLEAR_SESSION__" || msg.text.trim() === "/clear") {
      const { personaName } = this.parsePersona(msg.text.trim().replace(/^\/clear\s*/, ""));
      this.runner.clearSession(msg.userId, personaName);
      return;
    }

    // /clearall 指令：清除所有虚拟人 session
    if (msg.text.trim() === "/clearall") {
      this.runner.clearAllSessions(msg.userId);
      await adapter.sendMessage({ chatId: msg.chatId, text: "✅ 所有虚拟人对话已重置" });
      return;
    }

    // /testimage 指令
    if (msg.text.trim() === "/testimage") {
      await adapter.sendMessage({
        chatId: msg.chatId,
        text: "测试图片",
        mediaUrl: "https://picsum.photos/400/300.jpg",
      });
      return;
    }

    const { personaName, text: messageText } = this.parsePersona(msg.text);
    if (!messageText) return;

    logMessage({
      timestamp: new Date().toISOString(),
      source: adapter.platform,
      userId: msg.userId,
      personaName,
      text: messageText,
    });

    const processingKey = `${msg.userId}:${personaName}`;
    const item: QueueItem = { adapter, chatId: msg.chatId, userId: msg.userId, text: messageText, personaName };

    if (this.processing.has(processingKey)) {
      // 正在处理中，检查队列中是否已有相同内容
      const queue = this.queues.get(processingKey) ?? [];
      const isDuplicateInQueue = queue.some(q =>
        q.text === messageText && q.adapter.platform === adapter.platform
      );
      if (isDuplicateInQueue) {
        console.log(`[Router][${personaName}] 队列中已存在相同消息，丢弃`);
        return;
      }
      queue.push(item);
      this.queues.set(processingKey, queue);
      console.log(`[Router][${personaName}] 消息已入队（队列长度: ${queue.length}）`);
      return;
    }

    void this.processItem(item, processingKey);
  }

  private async processItem(item: QueueItem, processingKey: string): Promise<void> {
    const { adapter, chatId, userId, text, personaName } = item;
    console.log(`[FLOW][Router] 调用Runner user=${userId} text="${text.slice(0, 30)}"`);
    this.processing.add(processingKey);
    try {
      const response = await this.runner.run(userId, text, personaName);
      const replyPreview = response.slice(0, 40).replace(/\n/g, ' ');
      console.log(`[FLOW][Router] 收到回复 user=${userId} reply="${replyPreview}..."`);

      const prefix = this.runner.getReplyPrefix(personaName);
      const contentPrefix = this.runner.getContentPrefix(personaName);

      const imageUrlMatch =
        response.match(/https?:\/\/\S+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?/i) ??
        response.match(/https?:\/\/v3b\.fal\.media\/\S+/i);

      if (imageUrlMatch) {
        const rawUrl = imageUrlMatch[0];
        const imageUrl = rawUrl.includes("fal.media")
          ? `https://wsrv.nl/?url=${encodeURIComponent(rawUrl)}&n=-1`
          : rawUrl;
        const caption = response
          .replace(/!\[.*?\]\(.*?\)/g, "")
          .replace(/https?:\/\/\S+/g, "")
          .replace(/\n{3,}/g, "\n")
          .trim();
        const prefixedCaption = caption ? `${prefix}${caption}` : caption;
        const fallbackText = prefixedCaption ? `${prefixedCaption}\n${rawUrl}` : rawUrl;
        console.log(`[FLOW][Router] 发送图片回复 user=${userId}`);
        await adapter.sendMessage({ chatId, text: prefixedCaption, mediaUrl: imageUrl, fallbackText });
      } else {
        const outPreview = (prefix + contentPrefix + response).slice(0, 40).replace(/\n/g, ' ');
        console.log(`[FLOW][Router] 发送文字回复 user=${userId} out="${outPreview}..."`);
        await adapter.sendMessage({ chatId, text: `${prefix}${contentPrefix}${response}` });
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[FLOW][Router] 处理错误 user=${userId}: ${detail}`);
      await adapter.sendMessage({ chatId, text: `❌ 出错了：${detail}` });
    } finally {
      this.processing.delete(processingKey);

      // 处理队列中的下一条消息
      const queue = this.queues.get(processingKey);
      if (queue && queue.length > 0) {
        const next = queue.shift()!;
        if (queue.length === 0) this.queues.delete(processingKey);
        void this.processItem(next, processingKey);
      }
    }
  }

  async startAll(): Promise<void> {
    await Promise.all(this.adapters.map((a) => a.start()));
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.adapters.map((a) => a.stop()));
  }
}
