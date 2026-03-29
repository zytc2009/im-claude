/**
 * 快速测试多虚拟人路由逻辑（不需要启动 bot）
 * 运行：node test-personas.mjs
 */

import { loadPersonasConfig, getPersona, getPersonaNames, getDefaultPersona, buildSystemPrompt } from "./dist/clawra/profile.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const personasPath = path.resolve(__dirname, "config/personas.json");

// ── 加载配置 ──────────────────────────────────────────────────────────────────
console.log("=== 加载 personas.json ===");
const config = loadPersonasConfig(personasPath);
console.log("默认虚拟人:", config.default);
console.log("所有虚拟人:", getPersonaNames());

// ── 测试按名字获取 ─────────────────────────────────────────────────────────────
console.log("\n=== 按名字获取 persona ===");
for (const name of getPersonaNames()) {
  const p = getPersona(name);
  console.log(`[${p.name}] 性别:${p.gender} 前缀:"${p.replyPrefix}" 自拍:${p.selfie.enabled}`);
}

// ── 测试大小写不敏感 ──────────────────────────────────────────────────────────
console.log("\n=== 大小写不敏感测试 ===");
const p1 = getPersona("KIRA");
const p2 = getPersona("kira");
console.log("KIRA === kira:", p1.name === p2.name ? "✅" : "❌");

// ── 测试不存在的名字回退到默认 ────────────────────────────────────────────────
console.log("\n=== 不存在名字回退默认 ===");
const fallback = getPersona("nobody");
const defaultP = getDefaultPersona();
console.log("回退到默认:", fallback.name === defaultP.name ? `✅ (${fallback.name})` : "❌");

// ── 测试 system prompt 生成 ───────────────────────────────────────────────────
console.log("\n=== System Prompt 预览（前3行）===");
for (const name of getPersonaNames()) {
  const p = getPersona(name);
  const prompt = buildSystemPrompt(p);
  const preview = prompt.split("\n").slice(0, 3).join(" | ");
  console.log(`[${p.name}] ${preview}`);
  if (p.selfie.enabled) {
    console.log(`  ↳ 自拍 prompt 已包含`);
  } else {
    console.log(`  ↳ 无自拍（disabled）`);
  }
}

// ── 测试消息前缀解析（复现 router 逻辑）────────────────────────────────────────
console.log("\n=== 消息前缀解析测试 ===");
const personaNames = getPersonaNames();
const defaultName = config.default.toLowerCase();

function parsePersona(raw) {
  const trimmed = raw.trim();
  const match = /^@?(\S+?)(?::| )\s*(.*)$/s.exec(trimmed);
  if (match) {
    const candidate = match[1].toLowerCase();
    if (personaNames.includes(candidate)) {
      return { personaName: candidate, text: match[2].trim() };
    }
  }
  return { personaName: defaultName, text: trimmed };
}

const cases = [
  ["阿瓜 你好", "阿瓜", "你好"],
  ["阿瓜: 你好", "阿瓜", "你好"],
  ["@阿瓜 你好", "阿瓜", "你好"],
  ["普通消息没有前缀", defaultName, "普通消息没有前缀"],
  ["Unknown 不认识的名字", defaultName, "Unknown 不认识的名字"],
];

let pass = 0, fail = 0;
for (const [input, expectedPersona, expectedText] of cases) {
  const result = parsePersona(input);
  const ok = result.personaName === expectedPersona && result.text === expectedText;
  console.log(`${ok ? "✅" : "❌"} "${input}"`);
  if (!ok) {
    console.log(`   期望: persona=${expectedPersona}, text="${expectedText}"`);
    console.log(`   实际: persona=${result.personaName}, text="${result.text}"`);
    fail++;
  } else {
    pass++;
  }
}
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
