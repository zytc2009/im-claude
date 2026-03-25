import axios from "axios";
import type { ClawraProfile } from "./types.js";
import { buildSelfiePrompt } from "./profile.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const FAL_API_URL = "https://fal.run/xai/grok-imagine-image/edit";
const TIMEOUT_MS = 15_000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface FalApiResponse {
  images: Array<{ url: string }>;
}

// ── Public Function ───────────────────────────────────────────────────────────

/**
 * Generate a selfie image via fal.ai API.
 * Returns the image URL on success, or null on any failure (never throws).
 */
export async function generateSelfie(
  profile: ClawraProfile,
  location: string,
  activity: string,
): Promise<string | null> {
  const falKey = process.env["FAL_KEY"];
  if (!falKey) {
    console.warn("[PhotoGenerator] FAL_KEY not set, skipping photo generation");
    return null;
  }

  const prompt = buildSelfiePrompt(profile, location, activity);

  const payload = {
    image_url: profile.referenceImageUrl,
    prompt,
    num_images: 1,
    output_format: "jpeg",
  };

  try {
    const response = await axios.post<FalApiResponse>(FAL_API_URL, payload, {
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      timeout: TIMEOUT_MS,
    });

    const imageUrl = response.data?.images?.[0]?.url;
    if (!imageUrl) {
      console.warn("[PhotoGenerator] No image URL in fal.ai response");
      return null;
    }

    return imageUrl;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[PhotoGenerator] Failed to generate selfie: ${message}`);
    return null;
  }
}
