import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../logs/messages.jsonl");

mkdirSync(dirname(LOG_PATH), { recursive: true });

export interface MessageLog {
  timestamp: string;
  source: string;
  userId: string;
  personaName: string;
  text: string;
}

export function logMessage(entry: MessageLog): void {
  try {
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // 日志写入失败不影响主流程
  }
}
