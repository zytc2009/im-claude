import axios, { type AxiosInstance } from "axios";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { IMAdapter, IncomingMessage, OutgoingMessage, MessageHandler } from "./base.adapter.js";

const BASE_URL = "https://ilinkai.weixin.qq.com";
const TOKEN_FILE = path.resolve(process.cwd(), ".wechat-token");
const CHANNEL_VERSION = "1.0.2";

// ── API 类型 ──────────────────────────────────────────────────────────────────

interface MessageItem {
  type: number;           // 1=文字, 2=图片, 3=语音, 4=文件, 5=视频
  text_item?: { text: string };
  image_item?: { media_id: string };
}

interface WeChatMessage {
  from_user_id: string;   // xxx@im.wechat
  to_user_id: string;     // xxx@im.bot
  message_type: number;   // 1=用户消息, 2=bot消息
  message_state: number;
  context_token: string;
  item_list: MessageItem[];
}

interface GetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeChatMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

interface SendMessageResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class WeChatAdapter implements IMAdapter {
  readonly platform = "wechat" as const;

  private baseUrl = BASE_URL;
  private botToken: string | null = null;
  private handler?: MessageHandler;
  private polling = false;
  private updatesBuf = "";   // 游标，空串=从最新消息开始
  private stopResolve?: () => void;

  /** userId → 最新 context_token，用于回复消息 */
  private contextTokens = new Map<string, string>();

  private get http(): AxiosInstance {
    return axios.create({
      baseURL: this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.botToken}`,
        "AuthorizationType": "ilink_bot_token",
        "X-WECHAT-UIN": randomWechatUin(),
      },
      timeout: 40_000,
    });
  }

  // ── 公共接口 ───────────────────────────────────────────────────────────────

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    console.log("[WeChat] 正在启动微信适配器...");

    this.botToken = this.loadToken();
    if (!this.botToken) {
      try {
        await this.login();
      } catch (err) {
        console.error("[WeChat] 登录失败，微信功能暂不可用:", err instanceof Error ? err.message : err);
        return;
      }
    } else {
      console.log("[WeChat] 已加载保存的 Token");
    }

    console.log("[WeChat] Bot 就绪，开始长轮询...");
    this.polling = true;
    await sleep(1500);  // 等服务端 session 初始化
    void this.pollLoop();

    await new Promise<void>((resolve) => { this.stopResolve = resolve; });
  }

  async stop(): Promise<void> {
    this.polling = false;
    this.stopResolve?.();
    console.log("[WeChat] Bot 已停止");
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const contextToken = this.contextTokens.get(msg.chatId);
    if (!contextToken) {
      console.warn(`[WeChat] 找不到 ${msg.chatId} 的 context_token，无法发送消息`);
      return;
    }
    console.log(`[WeChat] 发送消息到 ${msg.chatId}, 有图片=${!!msg.mediaUrl}`);
    // 图片暂时降级为文字（upload_media 接口需单独实现）
    const text = msg.text || "";
    await this.sendText(contextToken, msg.chatId, text);
  }

  // ── 登录流程 ───────────────────────────────────────────────────────────────

  private async login(): Promise<void> {
    console.log("[WeChat] 获取登录二维码...");

    const res = await axios.get<{ qrcode: string; qrcode_img_content: string; ret: number }>(
      `${BASE_URL}/ilink/bot/get_bot_qrcode`,
      { params: { bot_type: 3 }, timeout: 15_000 },
    );

    const { qrcode, qrcode_img_content: qrcodeUrl } = res.data;

    console.log("\n[WeChat] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("[WeChat] 请用微信扫描以下二维码登录：");
    console.log(`[WeChat] ${qrcodeUrl}`);
    console.log("[WeChat] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    try {
      const qrTerm = await import("qrcode-terminal" as string) as { generate: (url: string, opts: object) => void };
      qrTerm.generate(qrcodeUrl, { small: true });
    } catch { /* 未安装，忽略 */ }

    console.log("[WeChat] 等待扫码...");
    const deadline = Date.now() + 5 * 60 * 1000;

    while (Date.now() < deadline) {
      await sleep(2000);
      try {
        const statusRes = await axios.get(
          `${BASE_URL}/ilink/bot/get_qrcode_status`,
          { params: { qrcode }, timeout: 60_000 },
        );
        const { status, bot_token, baseurl } = statusRes.data as {
          status: string; bot_token?: string; baseurl?: string;
        };

        if (status === "scanned") {
          console.log("[WeChat] 已扫码，等待手机端确认...");
        } else if (status === "confirmed" && bot_token) {
          this.botToken = bot_token;
          if (baseurl) this.baseUrl = baseurl;
          this.saveToken(bot_token);
          console.log("[WeChat] 登录成功！");
          return;
        }
      } catch (err) {
        console.warn("[WeChat] 状态查询失败，重试中:", err instanceof Error ? err.message : err);
        await sleep(3000);
      }
    }
    throw new Error("扫码等待超时（5分钟）");
  }

  // ── 长轮询消息 ─────────────────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const body: Record<string, unknown> = {
          base_info: { channel_version: CHANNEL_VERSION },
        };
        if (this.updatesBuf) body["get_updates_buf"] = this.updatesBuf;

        const res = await this.http.post<GetUpdatesResponse>(
          "ilink/bot/getupdates",
          body,
        );

        const { ret, errcode, msgs, get_updates_buf } = res.data;
        const code = errcode ?? ret ?? 0;

        if (code !== 0) {
          console.error(`[WeChat] getupdates 错误 code=${code} ${res.data.errmsg ?? ""}`);
          if (code === -14) {
            console.warn("[WeChat] Session 已过期，重新登录...");
            this.botToken = null;
            this.updatesBuf = "";
            this.deleteToken();
            await this.login();
          } else {
            await sleep(3000);
          }
          continue;
        }

        // 更新游标
        if (get_updates_buf) this.updatesBuf = get_updates_buf;

        for (const msg of msgs ?? []) {
          void this.handleMessage(msg);
        }
      } catch (err) {
        if (!this.polling) break;
        console.error("[WeChat] 轮询异常:", err instanceof Error ? err.message : err);
        await sleep(5000);
      }
    }
  }

  private async handleMessage(msg: WeChatMessage): Promise<void> {
    console.log(`[WeChat] 收到消息: type=${msg.message_type} from=${msg.from_user_id} items=${JSON.stringify(msg.item_list)}`);
    if (!this.handler) return;
    // 只处理用户发来的消息（message_type=1）
    if (msg.message_type !== 1) return;

    // 保存 context_token
    this.contextTokens.set(msg.from_user_id!, msg.context_token!);

    // 只处理文字
    const textItem = msg.item_list?.find((i) => i.type === 1);
    if (!textItem?.text_item?.text) {
      console.log(`[WeChat] 忽略非文字消息 from=${msg.from_user_id}`);
      return;
    }

    console.log(`[WeChat] 处理消息: "${textItem.text_item.text}" from=${msg.from_user_id}`);
    await this.handler({
      userId: msg.from_user_id!,
      chatId: msg.from_user_id!,
      text: textItem.text_item.text,
      platform: "wechat",
      timestamp: new Date(),
    });
  }

  // ── 发送消息 ───────────────────────────────────────────────────────────────

  private async sendText(contextToken: string, toUserId: string, text: string): Promise<void> {
    if (!text.trim()) return;
    const plain = stripMarkdown(text);
    const chunks = splitText(plain, 2000);
    for (const chunk of chunks) {
      const clientId = `im-claude-${crypto.randomBytes(8).toString("hex")}`;
      console.log(`[WeChat] sendmessage to=${toUserId} len=${chunk.length} clientId=${clientId}`);
      const res = await this.http.post<SendMessageResponse>("ilink/bot/sendmessage", {
        msg: {
          from_user_id: "",
          to_user_id: toUserId,
          client_id: clientId,
          message_type: 2,
          message_state: 2,
          context_token: contextToken,
          item_list: [{ type: 1, text_item: { text: chunk } }],
        },
        base_info: { channel_version: CHANNEL_VERSION },
      });
      const code = res.data.errcode ?? res.data.ret ?? 0;
      if (code !== 0) {
        console.error(`[WeChat] sendmessage 失败 code=${code}: ${res.data.errmsg}`);
        throw new Error(`[WeChat] sendmessage 失败: ${res.data.errmsg}`);
      }
      console.log(`[WeChat] sendmessage 成功`);
    }
  }

  private async sendImage(contextToken: string, toUserId: string, imageUrl: string, caption: string): Promise<void> {
    try {
      const imgRes = await axios.get<ArrayBuffer>(imageUrl, { responseType: "arraybuffer", timeout: 20_000 });
      const buffer = Buffer.from(imgRes.data);

      const FormData = (await import("form-data")).default;
      const form = new FormData();
      form.append("file", buffer, { filename: "photo.jpg", contentType: "image/jpeg" });

      const uploadRes = await this.http.post<{ ret: number; media_id?: string; errmsg?: string }>(
        "/ilink/bot/upload_media",
        form,
        { headers: { ...form.getHeaders() } },
      );

      if (uploadRes.data.ret === 0 && uploadRes.data.media_id) {
        await this.http.post<SendMessageResponse>("/ilink/bot/sendmessage", {
          msg: {
            to_user_id: toUserId,
            message_type: 2,
            message_state: 2,
            context_token: contextToken,
            item_list: [{ type: 2, image_item: { media_id: uploadRes.data.media_id } }],
          },
        });
      } else {
        throw new Error(uploadRes.data.errmsg ?? "upload_media failed");
      }

      if (caption) await this.sendText(contextToken, toUserId, caption);
    } catch (err) {
      console.warn("[WeChat] 图片发送失败，降级为文字:", err instanceof Error ? err.message : err);
      if (caption) await this.sendText(contextToken, toUserId, caption);
    }
  }

  // ── Token 持久化 ───────────────────────────────────────────────────────────

  private loadToken(): string | null {
    try {
      const raw = fs.readFileSync(TOKEN_FILE, "utf-8").trim();
      if (!raw) return null;
      const data = JSON.parse(raw) as { token: string; baseurl?: string };
      if (data.baseurl) this.baseUrl = data.baseurl;
      return data.token;
    } catch { return null; }
  }

  private saveToken(token: string): void {
    try {
      fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token, baseurl: this.baseUrl }), "utf-8");
    } catch (err) { console.warn("[WeChat] 无法保存 Token:", err); }
  }

  private deleteToken(): void {
    try { fs.unlinkSync(TOKEN_FILE); } catch { /* 忽略 */ }
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) chunks.push(text.slice(i, i + maxLen));
  return chunks;
}

/** 生成随机 X-WECHAT-UIN header（同官方实现） */
function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

/** 去掉 Markdown 格式，微信不渲染 markdown */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, (_: string, code: string) => code.trim())
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\|[\s:|-]+\|$/gm, "")
    .replace(/^\|(.+)\|$/gm, (_: string, inner: string) =>
      inner.split("|").map((c: string) => c.trim()).join("  "))
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*]\s+/gm, "• ");
}
