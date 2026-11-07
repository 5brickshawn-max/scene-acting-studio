import type { ProjectData } from "@/lib/domain/project";

/** Test helper: fill the first (lead) cast member, as tests of the single-character app filled `character`. */
export function setCharacter(
  d: ProjectData,
  patch: { name?: string; baseAssetId?: string | null; locks?: string; appearance?: string; outfit?: string; style?: string; voice?: string },
): void {
  const { style, ...rest } = patch;
  if (style !== undefined) d.style = style;
  d.cast[0] = { ...d.cast[0], name: d.cast[0].name || d.title, ...rest };
}
