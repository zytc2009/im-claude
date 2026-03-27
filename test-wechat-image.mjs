/**
 * 快速测试 WeChat 图片发送
 * 用法: node test-wechat-image.mjs <wxid> [imageUrl]
 */
import "dotenv/config";
import path from "path";
import fs from "fs";

const TOKEN_FILE = path.resolve(process.cwd(), ".wechat-token");
const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const BASE_URL = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "1.0.2";

const toUserId = process.argv[2];
if (!toUserId) {
  console.error("用法: node test-wechat-image.mjs <wxid> [imageUrl]");
  process.exit(1);
}

// 默认用一张公开测试图
const imageUrl = process.argv[3] ?? "https://picsum.photos/200/300.jpg";

const { default: axios } = await import("axios");
const crypto = await import("crypto");

const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
const token = raw.token;
const baseUrl = raw.baseurl ?? BASE_URL;

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

const http = axios.create({
  baseURL: baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "AuthorizationType": "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
  },
  timeout: 40_000,
});

// 先拿 context_token（需要先用 getupdates 获取，这里暂时跳过）
// 实际中 context_token 由收到消息时保存，这里需要手动提供
// 所以先发一条文字消息验证连通，图片需要有 context_token

console.log("⚠️  图片发送需要 context_token（只有收到用户消息后才有）");
console.log("📋 测试方案：先在微信给 bot 发一条消息，然后 bot 会尝试回复图片");
console.log("");
console.log("✅ 如果 bot 已在运行，在微信发「发一张图」即可触发图片发送流程");
console.log("   bot 会调用 FAL_KEY 生成 AI 图片并通过 CDN 上传发送");
