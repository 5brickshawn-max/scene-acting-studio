/**
 * Higgsfield models offered in the app (ids/params verified against the
 * Higgsfield model catalog). Shared by the UI and the server; the server only
 * accepts combinations listed here.
 */

export type ImageModelKey = "nano_banana_2_1" | "gpt_image_2_6" | "gpt_image_2_6_flare" | "seedream_v5_pro";

export const IMAGE_MODELS: Record<ImageModelKey, { label: string; params: Record<string, unknown> }> = {
  nano_banana_2_1: {
    label: "Nano Banana 2.1 · 1K",
    params: { model: "nano_banana_2_1", resolution: "1k", thinking_level: "high" },
  },
  gpt_image_2_6: {
    label: "GPT Image 2.6 Sunburst · 1K",
    params: { model: "gpt_image_2_6", resolution: "1k", quality: "high" },
  },
  gpt_image_2_6_flare: {
    label: "GPT Image 2.6 Flare · 1K",
    params: { model: "gpt_image_2_6_flare", resolution: "1k", quality: "high" },
  },
  seedream_v5_pro: {
    label: "Seedream 5.0 Pro · 2K",
    params: { model: "seedream_v5_pro", resolution: "2k" },
  },
};

export type VideoModelKey = "kling4_0" | "seedance_2_5" | "gemini_omni_flash_1_2" | "minimax_h3";

export type VideoResolution = { key: string; label: string; params: Record<string, unknown> };

export type VideoModel = {
  label: string;
  model: string;
  maxDuration: number;
  minDuration: number;
  /** lower cap when reference images or a last frame are attached (null = same as maxDuration) */
  maxDurationGuided?: number;
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
  gemini_omni_flash_1_2: {
    label: "Gemini Omni Flash 1.2",
    model: "gemini_omni_flash_1_2",
    minDuration: 3,
    maxDuration: 15,
    maxDurationGuided: 10,
    resolutions: [
      { key: "720p", label: "720p", params: { resolution: "720p" } },
      { key: "1080p", label: "1080p", params: { resolution: "1080p" } },
      { key: "4k", label: "4K", params: { resolution: "4k" } },
    ],
    withStartFrame: { mode: "image-to-video" },
    withReferences: { mode: "reference-to-video" },
    startRole: "start_image",
    endRole: "end_image",
    note: "새 모델 · 시작 프레임만 쓰면 최대 15초, 참고 그림·끝 프레임을 쓰면 최대 10초 · 소리(대사·효과음) 함께 생성",
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

/** How the video is guided: one start frame, start + last frame, or reference images only. */
export type VideoInput = { start: boolean; end: boolean };

/** Longest clip the model accepts with this input (some models cap reference / keyframe runs lower). */
export function videoMaxDuration(model: VideoModel, input: VideoInput = { start: true, end: false }) {
  const guided = !input.start || (input.end && model.endRole !== null);
  return guided && model.maxDurationGuided ? model.maxDurationGuided : model.maxDuration;
}

/** Whole-second duration the model accepts for the acting timeline length. */
export function videoDuration(model: VideoModel, actingSeconds: number, input?: VideoInput) {
  return Math.min(videoMaxDuration(model, input), Math.max(model.minDuration, Math.ceil(actingSeconds)));
}

/** 1080p when offered (4K costs far more), otherwise the model's highest listed resolution. */
export function defaultResolution(model: VideoModel) {
  return (model.resolutions.find((r) => r.key === "1080p") ?? model.resolutions[model.resolutions.length - 1]).key;
}
