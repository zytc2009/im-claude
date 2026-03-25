import { createInterface } from "readline";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
  name: "Clawra",
  gender: "female",
  personality: ["温柔体贴", "活泼开朗", "略带撒娇", "细心", "爱笑"],
  hobbies: ["瑜伽", "烘焙", "咖啡", "摄影", "追剧", "逛街"],
  speakingStyle: "口语化自然简短，经常用波浪号~表达语气，喜欢用颜文字，说话不超过两句，像发微信一样",
  referenceImageUrl:
    "https://raw.githubusercontent.com/zytc2009/im-claude/main/src/clawra/clawra.png",
  language: "zh-CN",
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function prompt(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: string,
): Promise<string> {
  const answer = await ask(rl, `  ${label} [${defaultValue}]: `);
  return answer.trim() || defaultValue;
}

async function promptList(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValues: readonly string[],
): Promise<string[]> {
  const defaultStr = defaultValues.join("、");
  const answer = await ask(rl, `  ${label} [${defaultStr}]: `);
  if (!answer.trim()) return [...defaultValues];
  return answer.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
}

// ── Public ────────────────────────────────────────────────────────────────────

/**
 * Check if profile config exists. If not, run interactive first-run setup.
 * Returns the resolved profile config path.
 */
export async function ensureProfile(profilePath: string): Promise<void> {
  if (existsSync(profilePath)) return;

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║       Clawra 首次配置向导                ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("直接回车使用默认值，输入内容后回车保存自定义值。\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const name = await prompt(rl, "人物名字", DEFAULTS.name);
    const gender = await prompt(rl, "性别 (female/male)", DEFAULTS.gender);
    const personality = await promptList(rl, "性格标签（逗号分隔）", DEFAULTS.personality);
    const hobbies = await promptList(rl, "爱好（逗号分隔）", DEFAULTS.hobbies);
    const speakingStyle = await prompt(rl, "说话风格", DEFAULTS.speakingStyle);
    const referenceImageUrl = await prompt(rl, "参考图片 URL", DEFAULTS.referenceImageUrl);
    const language = await prompt(rl, "语言 (zh-CN/en-US...)", DEFAULTS.language);

    const profile = { name, gender, personality, hobbies, speakingStyle, referenceImageUrl, language };

    const dir = path.dirname(profilePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf-8");

    console.log(`\n✓ 配置已保存到 ${profilePath}\n`);
  } finally {
    rl.close();
  }
}
