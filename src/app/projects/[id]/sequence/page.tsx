import { notFound } from "next/navigation";
import { getCtx, canEdit } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAssets } from "@/lib/assets-server";
import { loadSequence } from "@/lib/sequence-server";
import { NoAccess } from "@/components/no-access";
import { TopBar } from "@/components/top-bar";
import { SequenceView } from "./sequence-view";

export const dynamic = "force-dynamic";

export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, email } = await getCtx();
  if (!ctx) return <NoAccess email={email} />;
  const sb = await supabaseServer();
  const seq = await loadSequence(sb, ctx.workspaceId, id);
  if (!seq) notFound();

  const ids = seq.scenes.flatMap((s) => [...s.data.video.resultAssetIds, s.data.video.startFrameAssetId].filter((x): x is string => Boolean(x)));
  const [assets, rootAssets] = await Promise.all([loadAssets({ ids }), loadAssets({ projectId: seq.rootId })]);
  const merges = rootAssets.filter((a) => a.mime.startsWith("video/") && a.name.startsWith("시퀀스 합본"));

  return (
    <>
      <TopBar ctx={ctx} />
      <main className="mx-auto max-w-[1100px] px-4 sm:px-6 py-8">
        <SequenceView
          projectId={id}
          canEdit={canEdit(ctx.role)}
          rootId={seq.rootId}
          scenes={seq.scenes.map((s) => ({ id: s.id, name: s.name, data: s.data }))}
          branches={seq.branches}
          assets={assets}
          merges={merges}
        />
      </main>
    </>
  );
}
