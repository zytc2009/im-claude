import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

vi.mock("fs");

import {
  loadSchedule,
  getScheduleForDay,
  parseCronExpression,
} from "../../src/clawra/schedule.js";

const validScheduleJson = JSON.stringify({
  weekday: [
    {
      time: "07:15",
      activity: "起床",
      location: "bedroom",
      sendPhoto: true,
      messageType: "greeting",
      promptHint: "刚起床",
    },
    {
      time: "23:00",
      activity: "睡觉",
      location: "bedroom",
      sendPhoto: false,
      messageType: "goodnight",
      promptHint: "准备睡觉",
    },
  ],
  weekend: [
    {
      time: "09:00",
      activity: "起床",
      location: "bedroom",
      sendPhoto: true,
      messageType: "greeting",
      promptHint: "周末睡懒觉",
    },
  ],
});

describe("loadSchedule", () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReturnValue(validScheduleJson);
  });

  it("should load and parse valid schedule", () => {
    const schedule = loadSchedule("/fake/schedule.json");
    expect(schedule.weekday).toHaveLength(2);
    expect(schedule.weekend).toHaveLength(1);
  });

  it("should return frozen entries", () => {
    const schedule = loadSchedule("/fake/schedule-freeze.json");
    const entry = schedule.weekday[0]!;
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it("should cache results", () => {
    loadSchedule("/fake/schedule-cache.json");
    loadSchedule("/fake/schedule-cache.json");
    expect(vi.mocked(readFileSync)).toHaveBeenCalled();
  });

  it("should throw on invalid time format", () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        weekday: [
          {
            time: "7:5",
            activity: "test",
            location: "home",
            sendPhoto: false,
            messageType: "greeting",
            promptHint: "test",
          },
        ],
        weekend: [
          {
            time: "09:00",
            activity: "test",
            location: "home",
            sendPhoto: false,
            messageType: "greeting",
            promptHint: "test",
          },
        ],
      }),
    );
    expect(() => loadSchedule("/fake/bad-time.json")).toThrow();
  });

  it("should throw on invalid messageType", () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        weekday: [
          {
            time: "07:00",
            activity: "test",
            location: "home",
            sendPhoto: false,
            messageType: "unknown",
            promptHint: "test",
          },
        ],
        weekend: [
          {
            time: "09:00",
            activity: "test",
            location: "home",
            sendPhoto: false,
            messageType: "greeting",
            promptHint: "test",
          },
        ],
      }),
    );
    expect(() => loadSchedule("/fake/bad-type.json")).toThrow();
  });
});

describe("getScheduleForDay", () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReturnValue(validScheduleJson);
  });

  it("should return weekday schedule on Monday", () => {
    const schedule = loadSchedule("/fake/day-mon.json");
    // Monday = 1
    const monday = new Date("2025-01-06");
    const result = getScheduleForDay(schedule, monday);
    expect(result).toHaveLength(2);
    expect(result[0]?.promptHint).toBe("刚起床");
  });

  it("should return weekday schedule on Friday", () => {
    const schedule = loadSchedule("/fake/day-fri.json");
    // Friday = 5
    const friday = new Date("2025-01-10");
    const result = getScheduleForDay(schedule, friday);
    expect(result).toHaveLength(2);
  });

  it("should return weekend schedule on Saturday", () => {
    const schedule = loadSchedule("/fake/day-sat.json");
    // Saturday = 6
    const saturday = new Date("2025-01-11");
    const result = getScheduleForDay(schedule, saturday);
    expect(result).toHaveLength(1);
    expect(result[0]?.promptHint).toBe("周末睡懒觉");
  });

  it("should return weekend schedule on Sunday", () => {
    const schedule = loadSchedule("/fake/day-sun.json");
    // Sunday = 0
    const sunday = new Date("2025-01-12");
    const result = getScheduleForDay(schedule, sunday);
    expect(result).toHaveLength(1);
  });
});

describe("parseCronExpression", () => {
  it("should convert 07:15 weekday to correct cron", () => {
    expect(parseCronExpression("07:15", true)).toBe("15 7 * * 1-5");
  });

  it("should convert 23:00 weekday to correct cron", () => {
    expect(parseCronExpression("23:00", true)).toBe("0 23 * * 1-5");
  });

  it("should convert 09:30 weekend to correct cron", () => {
    expect(parseCronExpression("09:30", false)).toBe("30 9 * * 0,6");
  });

  it("should convert 00:00 weekend to correct cron", () => {
    expect(parseCronExpression("00:00", false)).toBe("0 0 * * 0,6");
  });

  it("should throw on invalid time format", () => {
    expect(() => parseCronExpression("invalid", true)).toThrow();
  });

  it("should handle single digit hour", () => {
    expect(parseCronExpression("08:05", true)).toBe("5 8 * * 1-5");
  });
});
