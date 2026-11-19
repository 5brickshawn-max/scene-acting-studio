export type AssetKind = "base" | "design_ref" | "expression_ref" | "sheet" | "dialogue_ref" | "acting_ref" | "video";

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  base: "기본 그림",
  design_ref: "디자인 참고",
  expression_ref: "표정 참고 시트",
  sheet: "표정 시트(생성 결과)",
  dialogue_ref: "대사 참고",
  acting_ref: "액팅 참고",
  video: "영상 결과",
};

export type AssetView = {
  id: string;
  kind: AssetKind;
  name: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  projectId: string | null;
  createdAt: string;
  url: string;
  previewUrl: string;
};

export type JobView = {
  id: string;
  kind: string;
  step: number;
  status: "queued" | "running" | "done" | "failed";
  input: { message?: string; instruction?: string; characterId?: string; checkKey?: string };
  output: unknown;
  error: string | null;
  based_on_version: number;
  applied_version: number | null;
  created_at: string;
  finished_at: string | null;
  created_by: string | null;
};

export type VersionView = {
  version: number;
  kind: "create" | "save" | "approve" | "unapprove" | "ai_apply" | "restore";
  note: string | null;
  created_at: string;
  created_by: string | null;
};

export type CommentView = {
  id: string;
  step: number;
  target: string;
  body: string;
  resolved: boolean;
  author_email: string | null;
  created_at: string;
};
