/**
 * 시퀀스: scenes made with "다음 장면 만들기" form a chain through `previous`. The chain is read from the first
 * scene down; when a scene has several next scenes (the team made a second try), the most recently changed one
 * continues the chain and the others are listed as other branches.
 */
import { sceneEndState, type ProjectData } from "./project";

export type SeqNode = { id: string; name: string; previousId: string | null; updatedAt: string };

export function sequenceChain(nodes: SeqNode[], rootId: string): { chain: string[]; branches: { afterId: string; ids: string[] }[] } {
  const children = new Map<string, SeqNode[]>();
  for (const n of nodes) if (n.previousId) children.set(n.previousId, [...(children.get(n.previousId) ?? []), n]);
  const chain = [rootId];
  const branches: { afterId: string; ids: string[] }[] = [];
  const seen = new Set(chain);
  for (let cur = rootId; ; ) {
    const kids = (children.get(cur) ?? []).filter((k) => !seen.has(k.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!kids.length) break;
    if (kids.length > 1) branches.push({ afterId: cur, ids: kids.slice(1).map((k) => k.id) });
    cur = kids[0].id;
    seen.add(cur);
    chain.push(cur);
  }
  return { chain, branches };
}

export type Junction = {
  /** the end state the next scene was made from no longer matches where the scene before now ends */
  endChanged: boolean;
  /** where the scene before ends now */
  endNow: string;
};

/** How the scene `next` joins the scene `prev` before it. */
export function junction(prev: ProjectData, next: ProjectData): Junction {
  const endNow = sceneEndState(prev);
  const stored = next.previous?.endState ?? "";
  return { endChanged: Boolean(endNow) && endNow.replace(/\s+/g, " ").trim() !== stored.replace(/\s+/g, " ").trim(), endNow };
}

/** The result video a scene adds to the sequence by default: its newest one. */
export const defaultResult = (d: ProjectData): string | null => d.video.resultAssetIds[d.video.resultAssetIds.length - 1] ?? null;
