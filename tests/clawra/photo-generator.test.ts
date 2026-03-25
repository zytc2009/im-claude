import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ClawraProfile } from "../../src/clawra/types.js";

// Mock axios before importing module under test
vi.mock("axios");

// Mock profile module
vi.mock("../../src/clawra/profile.js", () => ({
  buildSelfiePrompt: vi
    .fn()
    .mockReturnValue("make a photo of this person, direct selfie"),
}));

import axios from "axios";
import { generateSelfie } from "../../src/clawra/photo-generator.js";

const mockProfile: ClawraProfile = {
  name: "Clawra",
  gender: "female",
  personality: ["温柔"],
  hobbies: ["咖啡"],
  speakingStyle: "简短",
  referenceImageUrl: "https://example.com/clawra.png",
  language: "zh-CN",
};

describe("generateSelfie", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, FAL_KEY: "test-fal-key-123" };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return image URL on successful API call", async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        images: [{ url: "https://cdn.fal.media/result/test-image.jpg" }],
      },
    });

    const result = await generateSelfie(mockProfile, "cafe", "drinking coffee");
    expect(result).toBe("https://cdn.fal.media/result/test-image.jpg");
  });

  it("should return null when FAL_KEY is not set", async () => {
    delete process.env["FAL_KEY"];

    const result = await generateSelfie(mockProfile, "cafe", "drinking coffee");
    expect(result).toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("should return null on API error (not throw)", async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(new Error("Network error"));

    const result = await generateSelfie(mockProfile, "gym", "working out");
    expect(result).toBeNull();
  });

  it("should return null when API response has no images", async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { images: [] },
    });

    const result = await generateSelfie(mockProfile, "library", "studying");
    expect(result).toBeNull();
  });

  it("should return null when API response images array is undefined", async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {},
    });

    const result = await generateSelfie(mockProfile, "park", "walking");
    expect(result).toBeNull();
  });

  it("should call API with correct Authorization header", async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        images: [{ url: "https://cdn.fal.media/test.jpg" }],
      },
    });

    await generateSelfie(mockProfile, "bedroom", "resting");

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("fal.run"),
      expect.objectContaining({
        image_url: mockProfile.referenceImageUrl,
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Key test-fal-key-123",
        }),
        timeout: 15000,
      }),
    );
  });

  it("should return null on timeout error", async () => {
    const timeoutError = new Error("timeout of 15000ms exceeded");
    timeoutError.name = "ECONNABORTED";
    vi.mocked(axios.post).mockRejectedValueOnce(timeoutError);

    const result = await generateSelfie(mockProfile, "mall", "shopping");
    expect(result).toBeNull();
  });
});
