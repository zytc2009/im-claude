export interface SelfieConfig {
  readonly enabled: boolean;
  readonly referenceImageUrl?: string;
}

export interface PersonaProfile {
  readonly name: string;
  readonly gender: string;
  readonly personality: readonly string[];
  readonly hobbies: readonly string[];
  readonly speakingStyle: string;
  readonly language: string;
  /** 回复时带在开头的前缀，默认为 "<name>: " */
  readonly replyPrefix: string;
  /** 回复内容开头的称呼前缀，如 "亲爱的，" */
  readonly contentPrefix: string;
  readonly selfie: SelfieConfig;
}

export interface PersonasConfig {
  /** 默认使用的 persona 名称（无前缀时使用） */
  readonly default: string;
  readonly personas: readonly PersonaProfile[];
}

export type MessageType = "greeting" | "meal" | "activity" | "goodnight";

export interface ScheduleEntry {
  readonly time: string;
  readonly activity: string;
  readonly location: string;
  readonly sendPhoto: boolean;
  readonly messageType: MessageType;
  readonly promptHint: string;
}

export interface WeeklySchedule {
  readonly weekday: readonly ScheduleEntry[];
  readonly weekend: readonly ScheduleEntry[];
}

export interface GeneratedMessage {
  readonly text: string;
  readonly imageUrl?: string;
}

/** @deprecated Use PersonaProfile */
export type ClawraProfile = PersonaProfile & { referenceImageUrl: string };
