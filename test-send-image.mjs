/**
 * 微信图片发送测试脚本（官方正确格式）
 * 用法: node test-send-image.mjs <wxid> <context_token> [imageUrl]
 *
 * context_token 从 bot 日志里找：
 *   [WeChat] 收到消息: ... context_token=xxx
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";

const toUserId     = process.argv[2];
const contextToken = process.argv[3];
const imageUrl     = process.argv[4] ?? "https://picsum.photos/400/300.jpg";

if (!toUserId || !contextToken) {
  console.error("用法: node test-send-image.mjs <wxid> <context_token> [imageUrl]");
  console.error("  wxid         : 如 o9cq8046fnuS_9E-VTDVw_DkjzOk@im.wechat");
  console.error("  context_token: 从 bot 控制台日志 [WeChat] 收到消息 中复制");
  console.error("  imageUrl     : 可选，默认使用 picsum.photos 测试图");
  process.exit(1);
}

const CDN_BASE_URL    = "https://novac2c.cdn.weixin.qq.com/c2c";
const CHANNEL_VERSION = "1.0.2";
const TOKEN_FILE      = path.resolve(process.cwd(), ".wechat-token");

const raw     = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
const token   = raw.token;
const baseUrl = (raw.baseurl ?? "https://ilinkai.weixin.qq.com").replace(/\/$/, "");

function randomWechatUin() {
  return Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0))).toString("base64");
}

function makeHttp() {
  return axios.create({
    baseURL: `${baseUrl}/`,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "AuthorizationType": "ilink_bot_token",
      "X-WECHAT-UIN": randomWechatUin(),
    },
    timeout: 40_000,
  });
}

/** AES-128-ECB 密文大小（PKCS7 padding 到 16 字节边界） */
function aesEcbPaddedSize(plaintextSize) {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

// ── Step 1: 下载图片 ──────────────────────────────────────────────────────────
console.log(`\n📥 下载图片: ${imageUrl}`);
const imgRes = await axios.get(imageUrl, {
  responseType: "arraybuffer",
  timeout: 30_000,
  maxRedirects: 5,
});
const imgBuffer   = Buffer.from(imgRes.data);
const rawsize     = imgBuffer.length;
const rawfilemd5  = crypto.createHash("md5").update(imgBuffer).digest("hex");
const filesize    = aesEcbPaddedSize(rawsize);  // 密文大小
console.log(`   明文大小: ${rawsize} bytes | 密文大小: ${filesize} bytes | md5: ${rawfilemd5}`);

// ── Step 2: 生成 aeskey 和 filekey ───────────────────────────────────────────
const aesKeyBuf = crypto.randomBytes(16);
const aeskeyHex = aesKeyBuf.toString("hex");   // 官方传 hex 给 getuploadurl
const filekey   = crypto.randomBytes(16).toString("hex"); // 官方用 hex 作为 filekey

console.log(`\n🔑 aeskey(hex): ${aeskeyHex}`);
console.log(`   filekey: ${filekey}`);

// ── Step 3: 调用 getuploadurl（官方扁平格式）─────────────────────────────────
console.log(`\n📡 调用 getuploadurl...`);
const uploadUrlBody = {
  filekey,
  media_type: 1,          // 1=IMAGE
  to_user_id: toUserId,
  rawsize,
  rawfilemd5,
  filesize,               // 密文大小
  no_need_thumb: true,
  aeskey: aeskeyHex,      // hex 编码
  base_info: { channel_version: CHANNEL_VERSION },
};
console.log(`   请求体: ${JSON.stringify(uploadUrlBody)}`);

const uploadUrlRes = await makeHttp().post("ilink/bot/getuploadurl", uploadUrlBody);
console.log(`   响应: ${JSON.stringify(uploadUrlRes.data)}`);

const uploadParam = uploadUrlRes.data.upload_param;  // 官方字段名是 upload_param
if (!uploadParam) {
  console.error("❌ 未获得 upload_param");
  process.exit(1);
}
console.log(`✅ getuploadurl 成功，upload_param: ${uploadParam}`);

// ── Step 4: AES-128-ECB 加密 ──────────────────────────────────────────────────
console.log(`\n🔐 加密图片...`);
const cipher    = crypto.createCipheriv("aes-128-ecb", aesKeyBuf, null);
const encrypted = Buffer.concat([cipher.update(imgBuffer), cipher.final()]);
console.log(`   密文大小: ${encrypted.length} bytes（预期: ${filesize} bytes）`);

// ── Step 5: 上传到 CDN（官方不带 Authorization header）───────────────────────
const cdnUrl = `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
console.log(`\n☁️  上传到 CDN...`);
console.log(`   URL: ${cdnUrl}`);

const cdnRes = await axios.post(cdnUrl, encrypted, {
  headers: {
    "Content-Type": "application/octet-stream",
    // 官方实现不带 Authorization / X-WECHAT-UIN
  },
  timeout: 60_000,
  validateStatus: () => true,
});

console.log(`   CDN 响应状态: ${cdnRes.status}`);
console.log(`   CDN headers: ${JSON.stringify(cdnRes.headers)}`);

const downloadEncryptedQueryParam = cdnRes.headers["x-encrypted-param"];
if (!downloadEncryptedQueryParam) {
  console.error("❌ CDN 未返回 x-encrypted-param，上传失败");
  process.exit(1);
}
console.log(`✅ CDN 上传成功，x-encrypted-param: ${downloadEncryptedQueryParam}`);

// ── Step 6: 发送图片消息 ──────────────────────────────────────────────────────
// aes_key in sendmessage = base64(hex_string) 官方用法: Buffer.from(aeskeyHex).toString("base64")
const aesKeyBase64 = Buffer.from(aeskeyHex).toString("base64");

const clientId = `im-claude-${crypto.randomBytes(8).toString("hex")}`;
console.log(`\n📤 发送图片消息 clientId=${clientId}...`);
console.log(`   mid_size(密文): ${filesize} | aes_key: ${aesKeyBase64}`);

const sendRes = await makeHttp().post("ilink/bot/sendmessage", {
  msg: {
    from_user_id: "",
    to_user_id: toUserId,
    client_id: clientId,
    message_type: 2,
    message_state: 2,
    context_token: contextToken,
    item_list: [{
      type: 2,
      image_item: {
        media: {
          encrypt_query_param: downloadEncryptedQueryParam,
          aes_key: aesKeyBase64,
          encrypt_type: 1,
        },
        mid_size: filesize,  // 密文大小
      },
    }],
  },
  base_info: { channel_version: CHANNEL_VERSION },
});

console.log(`sendmessage 响应: ${JSON.stringify(sendRes.data)}`);
const code = sendRes.data.errcode ?? sendRes.data.ret ?? 0;
if (code === 0) {
  console.log("✅ 图片发送成功！");
} else {
  console.error(`❌ 失败 code=${code}: ${sendRes.data.errmsg}`);
}
