export interface ClawraProfile {
  readonly name: string;
  readonly gender: string;
  readonly personality: readonly string[];
  readonly hobbies: readonly string[];
  readonly speakingStyle: string;
  readonly referenceImageUrl: string;
  readonly language: string;
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
