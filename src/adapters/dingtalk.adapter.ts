/**
 * 钉钉企业内部应用机器人适配器
 *
 * 接收消息：通过 HTTP Webhook 服务器接收钉钉推送
 * 发送消息：调用钉钉 API（需要 AppKey/AppSecret 换取 access_token）
 *
 * 前置配置（钉钉开放平台）：
 *  1. 创建"企业内部应用" → 添加"机器人"能力
 *  2. 配置消息接收地址：http://your-server:3000/dingtalk/webhook
 *  3. 开启"签名"并记录签名密钥 → DINGTALK_WEBHOOK_SECRET
 *  4. 记录 AppKey / AppSecret / AgentId
 */

import { createServer, type IncomingMessage as NodeRequest, type ServerResponse } from "node:http";
import { createHmac } from "node:crypto";
import axios from "axios";
import type { IMAdapter, IncomingMessage, OutgoingMessage, MessageHandler } from "./base.adapter.js";

interface DingTalkConfig {
  appKey: string;
  appSecret: string;
  agentId: string;
  webhookSecret: string;
  port: number;
}

interface DingTalkToken {
  accessToken: string;
  expiresAt: number;
}

export class DingTalkAdapter implements IMAdapter {
  readonly platform = "dingtalk" as const;
  private handler?: MessageHandler;
  private tokenCache?: DingTalkToken;
  private server?: ReturnType<typeof createServer>;

  constructor(private readonly config: DingTalkConfig) {}

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  // ─── 发消息 ────────────────────────────────────────────────────────────────

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const token = await this.getAccessToken();
    // chatId 格式：dingtalk_{conversationId}_{userId}（用于区分群 / 单聊）
    const [, conversationId, userId] = msg.chatId.split("_");

    await axios.post(
      "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
      {
        robotCode: this.config.appKey,
        userIds: [userId],
        msgKey: "sampleMarkdown",
        msgParam: JSON.stringify({
          title: "Claude",
          text: msg.text,
        }),
      },
      {
        headers: {
          "x-acs-dingtalk-access-token": token,
          "Content-Type": "application/json",
        },
      },
    );

    void conversationId; // 暂未使用，预留群消息扩展
  }

  // ─── access_token 管理（自动刷新）──────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.accessToken;
    }

    const res = await axios.post<{ accessToken: string; expireIn: number }>(
      "https://api.dingtalk.com/v1.0/oauth2/accessToken",
      { appKey: this.config.appKey, appSecret: this.config.appSecret },
      { headers: { "Content-Type": "application/json" } },
    );

    this.tokenCache = {
      accessToken: res.data.accessToken,
      expiresAt: now + res.data.expireIn * 1000,
    };

    return this.tokenCache.accessToken;
  }

  // ─── 签名验证 ──────────────────────────────────────────────────────────────

  private verifySignature(timestamp: string, sign: string): boolean {
    const expected = createHmac("sha256", this.config.webhookSecret)
      .update(`${timestamp}\n${this.config.webhookSecret}`)
      .digest("base64");
    return expected === sign;
  }

  // ─── Webhook HTTP 服务器 ───────────────────────────────────────────────────

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(this.config.port, () => {
        console.log(`[DingTalk] Webhook server listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server?.close((err) => (err ? reject(err) : resolve()));
    });
    console.log("[DingTalk] Webhook server stopped");
  }

  private async handleRequest(req: NodeRequest, res: ServerResponse): Promise<void> {
    if (req.url !== "/dingtalk/webhook" || req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }

    // 读取请求体
    const body = await this.readBody(req);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body) as Record<string, unknown>;
    } catch {
      res.writeHead(400).end("Invalid JSON");
      return;
    }

    // 签名验证
    const timestamp = String(payload["timestamp"] ?? "");
    const sign = String(payload["sign"] ?? "");
    if (!this.verifySignature(timestamp, sign)) {
      console.warn("[DingTalk] Signature verification failed");
      res.writeHead(401).end("Unauthorized");
      return;
    }

    // 解析消息
    const text = this.extractText(payload);
    const userId = String((payload["senderStaffId"] as string | undefined) ?? "unknown");
    const conversationId = String(
      (payload["conversationId"] as string | undefined) ?? "unknown",
    );

    if (text && this.handler) {
      await this.handler({
        userId,
        chatId: `dingtalk_${conversationId}_${userId}`,
        text,
        platform: "dingtalk",
        timestamp: new Date(),
      });
    }

    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({ msgtype: "empty" }),
    );
  }

  private extractText(payload: Record<string, unknown>): string {
    // 文本消息
    const text = payload["text"] as { content?: string } | undefined;
    if (text?.content) return text.content.trim();
    // 兜底
    return String(payload["content"] ?? "");
  }

  private readBody(req: NodeRequest): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }
}
