/**
 * Higgsfield models offered in the app (ids/params verified against the
 * Higgsfield model catalog). Shared by the UI and the server; the server only
 * accepts combinations listed here.
 */

export type ImageModelKey = "nano_banana_2_1" | "gpt_image_2_5";

export const IMAGE_MODELS: Record<ImageModelKey, { label: string; params: Record<string, unknown> }> = {
  nano_banana_2_1: {
    label: "Nano Banana 2.1 · 1K",
    params: { model: "nano_banana_2_1", resolution: "1k", thinking_level: "high" },
  },
  gpt_image_2_5: {
    label: "GPT Image 2.5 · 1K",
    params: { model: "gpt_image_2_5", resolution: "1k", quality: "high" },
  },
};

export type VideoModelKey = "kling4_0" | "seedance_2_5" | "minimax_h3";

export type VideoResolution = { key: string; label: string; params: Record<string, unknown> };

export type VideoModel = {
  label: string;
  model: string;
  maxDuration: number;
  minDuration: number;
  resolutions: VideoResolution[];
  /** params when a start frame is attached / when only reference images are used */
  withStartFrame: Record<string, unknown>;
  withReferences: Record<string, unknown>;
  /** media role used for the start frame */
  startRole: "start_image" | "image_references";
  /** media role for the last frame (keyframes), or null when the app does not send one to this model */
  endRole: "end_image" | null;
  note: string;
};

export const VIDEO_MODELS: Record<VideoModelKey, VideoModel> = {
  kling4_0: {
    label: "Kling 4.0",
    model: "kling4_0",
    minDuration: 3,
    maxDuration: 30,
    resolutions: [
      { key: "720p", label: "720p", params: { resolution: "720p" } },
      { key: "1080p", label: "1080p", params: { resolution: "1080p" } },
    ],
    withStartFrame: { mode: "image-to-video" },
    withReferences: { mode: "reference-to-video" },
    startRole: "start_image",
    endRole: "end_image",
    note: "최대 30초 · 최종본 추천: 지금까지 캐릭터 유지·표정 연기·대사 발음이 가장 안정적",
  },
  seedance_2_5: {
    label: "Seedance 2.5",
    model: "seedance_2_5",
    minDuration: 4,
    maxDuration: 30,
    resolutions: [
      { key: "draft", label: "480p 드래프트", params: { resolution: "480p", draft: true } },
      { key: "720p", label: "720p", params: { resolution: "720p" } },
      { key: "1080p", label: "1080p", params: { resolution: "1080p" } },
    ],
    withStartFrame: { mode: "omni_reference" },
    withReferences: { mode: "omni_reference" },
    startRole: "image_references",
    endRole: null,
    note: "최대 30초 · 빠른 확인용(480p 드래프트, 7일 안에 1080p로 확정 가능) · 카메라 지시는 약하게 따르는 편",
  },
  minimax_h3: {
    label: "MiniMax H3",
    model: "minimax_h3",
    minDuration: 4,
    maxDuration: 15,
    resolutions: [{ key: "2K", label: "2K", params: { resolution: "2K" } }],
    withStartFrame: {},
    withReferences: {},
    startRole: "start_image",
    endRole: "end_image",
    note: "최대 15초 · 2K 고정 · 흰 배경 지시를 무시하고 배경을 그리는 경우가 있음",
  },
};

export const isImageModel = (k: string): k is ImageModelKey => k in IMAGE_MODELS;
export const isVideoModel = (k: string): k is VideoModelKey => k in VIDEO_MODELS;

/** Whole-second duration the model accepts for the acting timeline length. */
export function videoDuration(model: VideoModel, actingSeconds: number) {
  return Math.min(model.maxDuration, Math.max(model.minDuration, Math.ceil(actingSeconds)));
}
