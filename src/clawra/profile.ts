import { readFileSync } from "fs";
import { z } from "zod";
import type { PersonaProfile, PersonasConfig } from "./types.js";

// ── Schema ────────────────────────────────────────────────────────────────────

const SelfieConfigSchema = z.object({
  enabled: z.boolean(),
  referenceImageUrl: z.string().url().optional(),
});

const PersonaProfileSchema = z.object({
  name: z.string().min(1),
  gender: z.string().min(1),
  personality: z.array(z.string()).min(1),
  hobbies: z.array(z.string()).min(1),
  speakingStyle: z.string().min(1),
  language: z.string().min(1),
  replyPrefix: z.string().optional(),
  selfie: SelfieConfigSchema.optional(),
});

const PersonasConfigSchema = z.object({
  default: z.string().min(1),
  personas: z.array(PersonaProfileSchema).min(1),
});

// ── Cache ─────────────────────────────────────────────────────────────────────

let registry: Map<string, PersonaProfile> | null = null;
let defaultPersonaName: string | null = null;

// ── Public Functions ──────────────────────────────────────────────────────────

/**
 * Load personas.json and build a name→profile registry.
 * Call once at startup; subsequent calls are no-ops.
 */
export function loadPersonasConfig(configPath: string): PersonasConfig {
  const raw = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
  const parsed = PersonasConfigSchema.parse(raw);

  registry = new Map();
  for (const p of parsed.personas) {
    const profile: PersonaProfile = {
      name: p.name,
      gender: p.gender,
      personality: Object.freeze([...p.personality]),
      hobbies: Object.freeze([...p.hobbies]),
      speakingStyle: p.speakingStyle,
      language: p.language,
      replyPrefix: p.replyPrefix ?? `${p.name}: `,
      selfie: Object.freeze(p.selfie ?? { enabled: false }),
    };
    registry.set(p.name.toLowerCase(), profile);
  }
  defaultPersonaName = parsed.default;

  return {
    default: parsed.default,
    personas: [...registry.values()],
  };
}

/**
 * Get a persona profile by name (case-insensitive).
 * Falls back to the default persona if name is not found.
 */
export function getPersona(name: string): PersonaProfile {
  if (!registry || !defaultPersonaName) {
    throw new Error("Personas not loaded. Call loadPersonasConfig() first.");
  }
  return registry.get(name.toLowerCase()) ?? registry.get(defaultPersonaName.toLowerCase())!;
}

/**
 * Get the default persona profile.
 */
export function getDefaultPersona(): PersonaProfile {
  if (!registry || !defaultPersonaName) {
    throw new Error("Personas not loaded. Call loadPersonasConfig() first.");
  }
  return registry.get(defaultPersonaName.toLowerCase())!;
}

/**
 * Get all known persona names (lowercase).
 */
export function getPersonaNames(): string[] {
  if (!registry) return [];
  return [...registry.keys()];
}

/**
 * Build system prompt for a persona.
 * Selfie section is only included if selfie.enabled is true.
 */
export function buildSystemPrompt(profile: PersonaProfile): string {
  const personalityList = profile.personality.join("、");
  const hobbiesList = profile.hobbies.join("、");

  const base = `你是 ${profile.name}，一个真实存在的人，不是 AI 助手。

## 性格
${personalityList}

## 爱好
${hobbiesList}

## 说话风格
${profile.speakingStyle}

## 语言
使用 ${profile.language}，说话自然口语化，像发消息一样简短，绝对不要超过两三句话。
不要说"我是AI"或任何暴露你是机器人的话。`;

  if (!profile.selfie.enabled || !profile.selfie.referenceImageUrl) {
    return base + "\n只输出纯文字，不要包含任何 URL 或链接。";
  }

  const refUrl = profile.selfie.referenceImageUrl;
  return `${base}

## 发自拍照（重要）
你有真实的外貌，可以发自拍照给对方。
当对方要求发照片、问你在哪、或描述一个场景时，你必须：
1. 用 Bash 调用 fal.ai API 生成图片（见下方命令）
2. 在回复中包含生成的图片 URL（原始 URL，不要用 markdown 格式）

生成自拍的 Bash 命令：
\`\`\`bash
IM_ENV="$(pwd)/.env"
[ -f "$IM_ENV" ] && export $(grep -v '^#' "$IM_ENV" | grep 'FAL_KEY' | xargs)
REFERENCE_IMAGE="${refUrl}"
PROMPT="<根据场景填写 prompt>"
JSON=$(python3 -c "import json,sys; print(json.dumps({'image_url':sys.argv[1],'prompt':sys.argv[2],'num_images':1,'output_format':'jpeg'}))" "$REFERENCE_IMAGE" "$PROMPT")
curl -s -X POST "https://fal.run/xai/grok-imagine-image/edit" -H "Authorization: Key $FAL_KEY" -H "Content-Type: application/json" -d "$JSON" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['images'][0]['url'])"
\`\`\`

Prompt 规则：
- 咖啡馆/餐厅/公园/街道等户外场景：用 direct selfie 模式："a close-up selfie taken by herself at <场景>, direct eye contact with the camera, phone held at arm's length, face fully visible"
- 卧室/健身房/镜子前：用 mirror 模式："make a pic of this person, but <状态>. the person is taking a mirror selfie"

收到图片 URL 后，回复格式（只需一行文字 + 一行 URL）：
<自然的一句话描述>
https://...（图片 URL）`;
}

/**
 * Build text-only system prompt (no selfie instructions), for scheduled messages.
 */
export function buildTextSystemPrompt(profile: PersonaProfile): string {
  const personalityList = profile.personality.join("、");
  const hobbiesList = profile.hobbies.join("、");

  return `你是 ${profile.name}，一个真实存在的人，不是 AI 助手。

## 性格
${personalityList}

## 爱好
${hobbiesList}

## 说话风格
${profile.speakingStyle}

## 语言
使用 ${profile.language}，说话自然口语化，像发微信一样简短，绝对不要超过两三句话。
不要说"我是AI"或任何暴露你是机器人的话。
只输出纯文字，不要包含任何 URL 或链接。`;
}

// ── Legacy compat ─────────────────────────────────────────────────────────────

/**
 * @deprecated Used by photo-generator for scheduled selfies.
 */
export function buildSelfiePrompt(
  profile: PersonaProfile,
  location: string,
  activity: string,
): string {
  const isMirrorScene = /gym|bedroom|mirror|bathroom|健身|卧室|镜子|浴室/i.test(location);
  const baseDesc = `make a photo of this person, but she is ${activity} at ${location}`;
  if (isMirrorScene) {
    return `${baseDesc}. the person is taking a mirror selfie, phone visible in the mirror reflection, casual indoor lighting, natural and candid`;
  }
  return `${baseDesc}. the person is taking a direct front-facing selfie, holding phone up, natural lighting, candid and natural expression`;
}



/** @deprecated Use PersonaProfile directly */
export type ClawraProfile = PersonaProfile & { referenceImageUrl: string };

/** @deprecated Use loadPersonasConfig + getDefaultPersona */
export function loadProfile(_configPath: string): ClawraProfile {
  const p = getDefaultPersona();
  return { ...p, referenceImageUrl: p.selfie.referenceImageUrl ?? "" };
}
