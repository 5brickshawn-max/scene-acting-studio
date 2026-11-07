import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { castLabel, effectiveText, maxCastFor, FRAMING_CUT, FRAMING_LABEL, imageAspectFor, INTENSITY_LABEL, parseProjectData, POSITION_LABEL, showsHands, type ProjectData } from "@/lib/domain/project";
import {
  ActingOut,
  CharacterOut,
  DialogueOut,
  ExpressionsOut,
  SceneComposeOut,
  StoryboardOut,
  EnglishOut,
  PromptCheckOut,
  SheetCheckOut,
  consultSchemaFor,
  type EnglishOutT,
  type JobKind,
  type PromptCheckOutT,
} from "./schemas";
import { BASE_SYSTEM, STEP_CONTEXT, projectContext, sceneDesignNote, sceneDialogueNote } from "./prompts";
import { buildVideoHandoff } from "@/lib/domain/handoff";
import { preRenderCheck } from "@/lib/domain/check";
import { resolveFix } from "@/lib/domain/fixes";
import { buildEnglishSheet } from "@/lib/domain/english";
import { cacheThroughLastImage, consultConversation } from "./cache";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const client = new Anthropic();

type ImageBlock = Anthropic.Beta.BetaImageBlockParam;
type TextBlock = Anthropic.Beta.BetaTextBlockParam;
type Content = Array<ImageBlock | TextBlock>;

type JobRow = {
  id: string;
  project_id: string;
  kind: JobKind;
  step: number;
  input: { message?: string; instruction?: string; characterId?: string };
  based_on_version: number;
};

/** Load an asset image as a base64 block (uses the downscaled preview if present). */
async function imageBlock(assetId: string | null | undefined, label: string): Promise<Content> {
  if (!assetId) return [];
  const sb = supabaseAdmin();
  const { data: asset } = await sb.from("assets").select("storage_path, mime, meta").eq("id", assetId).maybeSingle();
  if (!asset) return [];
  const meta = (asset.meta ?? {}) as { previewPath?: string; previewMime?: string };
  const path = meta.previewPath ?? asset.storage_path;
  const mime = meta.previewPath ? meta.previewMime ?? "image/jpeg" : asset.mime;
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) return [];
  const { data: file, error } = await sb.storage.from("assets").download(path);
  if (error || !file) return [];
  const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  return [
    { type: "text", text: label },
    { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: b64 } },
  ];
}

/** Several images at once, kept in the given order. */
async function imageBlocks(items: { assetId: string | null | undefined; label: string }[]): Promise<Content> {
  return (await Promise.all(items.map((x) => imageBlock(x.assetId, x.label)))).flat();
}

/** The scene drawing (the whole cast together), labelled with who stands where. */
async function castImages(data: ProjectData): Promise<Content> {
  const multi = data.cast.length > 1;
  return imageBlock(
    data.baseAssetId,
    multi
      ? `[장면 기준 그림 — 출연진 ${data.cast.length}명이 함께 있음: ${data.cast.map((c, i) => `인물 ${i + 1} ${castLabel(data, c.id)}(화면 ${POSITION_LABEL[c.position]})`).join(", ")}]`
      : "[기본 그림 — 캐릭터의 기준]",
  );
}

/** Each expression's own image, labelled with its number (falls back to the legacy single sheet). */
async function expressionImages(data: ProjectData): Promise<Content> {
  const out = await imageBlocks(
    data.expressions.map((e, i) => ({
      assetId: e.imageAssetId,
      label: `[표정 ${i + 1} 그림 — ${data.cast.length > 1 ? `${castLabel(data, e.characterId)}: ` : ""}${e.emotion || "감정 미정"}]`,
    })),
  );
  if (!out.length && data.expressionSetup.sheetAssetId)
    return imageBlock(data.expressionSetup.sheetAssetId, "[표정 시트 — 칸은 왼쪽부터 표정 1, 2, …]");
  return out;
}

async function callClaude<S extends z.ZodType>(
  schema: S,
  system: string,
  messages: Anthropic.Beta.BetaMessageParam[],
  effort: "low" | "medium" | "high" = "high",
) {
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system,
    messages,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    // If a safety classifier declines, retry on Anthropic's recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (res.stop_reason === "refusal") {
    throw new Error("AI가 이 요청을 처리하지 않았습니다. 요청 내용을 바꿔 다시 시도해주세요.");
  }
  if (res.stop_reason === "max_tokens") {
    throw new Error("응답이 너무 길어 중간에 끊겼습니다. 요청 범위를 줄여 다시 시도해주세요.");
  }
  if (!res.parsed_output) throw new Error("AI 응답 형식을 읽지 못했습니다. 다시 시도해주세요.");
  // input_tokens is only the part not served from the cache; keep the whole prompt size as "input".
  const cacheRead = res.usage.cache_read_input_tokens ?? 0;
  const cacheWrite = res.usage.cache_creation_input_tokens ?? 0;
  return {
    output: res.parsed_output as z.infer<S>,
    usage: { input: res.usage.input_tokens + cacheRead + cacheWrite, output: res.usage.output_tokens, cacheRead, cacheWrite },
  };
}

/** What the AI should do with arms and hands for the chosen shot size. */
/** The expressions are moments of ONE shot: consecutive ones must be reachable from each other. */
const CONTINUITY_NOTE =
  `표정들은 컷 없이 이어지는 하나의 쇼트 속 순간들입니다(표정 1 → 2 → 3 … 순서로 이어짐). 서 있는 위치·하체 자세·카메라 거리는 모든 표정에서 같게 두고, ` +
  `얼굴·몸 방향은 이웃한 표정끼리 한 단계씩만 바뀌도록(예: 정면 → 3/4, 3/4 → 옆) 설계하세요. 앞 표정의 손 위치에서 몇 박자 안에 옮겨 갈 수 있는 동작으로 이어 주고, ` +
  `완전히 다른 전신 포즈로 갑자기 바뀌지 않게 하세요.`;

function gestureNote(data: ProjectData) {
  const f = data.expressionSetup.framing;
  const multi = data.cast.length > 1;
  const head =
    `표정 그림 구도: ${FRAMING_LABEL[f]} — ${FRAMING_CUT[f]}, ${imageAspectFor(data)}. ${CONTINUITY_NOTE}` +
    (multi ? ` 여러 인물 장면이라 인물마다 화면 위치가 고정됩니다. 연기하는 인물의 방향과 시선은 상대 인물이 있는 쪽을 기준으로 정하세요. gesture는 연기하는 인물의 동작입니다.` : "");
  if (!showsHands(f))
    return `${head} 팔·손은 화면에 보이지 않으니 gesture는 빈 문자열로 두고, 얼굴 근육·시선·고개로 감정을 표현하세요.`;
  const where =
    f === "bust"
      ? `손은 가슴선 위 화면 안에 들어와야 보입니다. 얼굴·턱·입가·뺨·가슴·머리카락 근처의 동작이 좋습니다 (예: 손끝으로 입을 가림, 주먹을 턱 아래 쥠, 땋은 머리를 만지작거림, 손을 가슴에 얹음, 검지로 관객을 가리킴, 손바닥을 펴서 막는 시늉).`
      : `허리 위 상반신 전체로 읽히는 동작이 좋습니다 (예: 팔짱, 허리에 손, 어깨를 으쓱하며 두 손바닥을 펼침, 한 손으로 뒷머리를 긁음, 두 손을 앞에 모음, 자기 몸을 감싸 안음, 손가락으로 가리킴).`;
  return (
    `${head} gesture에는 이 표정의 감정이 몸으로도 읽히도록 팔·손·어깨 동작을 구체적으로 쓰세요 (어느 손이 어디에, 손 모양, 팔 위치, 어깨). ${where} ` +
    `표정마다 서로 다른 동작으로 하고, 팔을 그냥 내린 밋밋한 자세는 피하세요. 얼굴·몸 방향(facing, body)과 자연스럽게 맞추고 의상·장신구와 어울리게 하며, 손가락이 복잡하게 얽히는 동작은 피하세요.`
  );
}

function refGridNote(data: ProjectData) {
  const s = data.expressionSetup;
  return `표정 참고 시트는 가로 ${s.refColumns}칸 × 세로 ${s.refRows}줄 격자입니다. 칸 번호는 왼쪽→오른쪽, 위→아래 순서로 1부터 셉니다.`;
}

async function buildRequest(job: JobRow, data: ProjectData) {
  const ctx = projectContext(data, job.step);
  const extra = job.input.instruction?.trim() ? `\n\n추가 요청: ${job.input.instruction.trim()}` : "";
  // loaded only by the jobs that send it, in parallel with their other images
  const baseImage = () => castImages(data);
  const multi = data.cast.length > 1;

  switch (job.kind) {
    case "compose_scene": {
      // the scenario is the source; the scene picture, extra references and each character's material help when there
      const scenario = data.expressionSetup.scene.trim();
      if (!scenario && !data.baseAssetId) throw new Error("먼저 씬 시놉시스·시나리오를 쓰거나 장면 기준 그림을 올리세요.");
      const [base, refs, people] = await Promise.all([
        data.baseAssetId ? castImages(data) : Promise.resolve([] as Content),
        imageBlocks(data.designRefAssetIds.map((id) => ({ assetId: id, label: "[추가 참고 그림]" }))),
        imageBlocks(data.cast.map((c, i) => ({ assetId: c.refAssetId, label: `[인물 ${i + 1} ${castLabel(data, c.id)}의 참고 자료]` }))),
      ]);
      const max = maxCastFor(data.mode);
      const notes = data.cast
        .map((c, i) =>
          [c.name, c.locks, c.appearance, c.outfit].some((x) => x.trim())
            ? `인물 ${i + 1} ${castLabel(data, c.id)} — 특징: ${c.locks || "(없음)"} / 외형: ${c.appearance || "(없음)"} / 의상: ${c.outfit || "(없음)"}`
            : "",
        )
        .filter(Boolean)
        .join("\n");
      return {
        schema: SceneComposeOut,
        content: [
          ...base,
          ...refs,
          ...people,
          {
            type: "text",
            text:
              `아래 씬 시놉시스·시나리오로 이 장면을 구성하세요. 결과는 그림·영상 생성의 기준이 됩니다.\n` +
              `- characters: 대사를 하거나 이름으로 불리는 주요 인물만, 최대 ${max}명(${data.mode === "storyboard" ? "스토리보드 방식" : "인물별 연기 방식"}). 그 밖의 사람들은 extras에 무리로 적으세요.\n` +
              `- 인물마다 그림 모델이 같은 인물을 계속 그릴 수 있게 locks(구별되는 식별 요소부터), appearance, outfit을 구체적으로. 위에 참고 자료나 팀이 적은 메모가 있으면 그것을 따르고, 없는 부분은 시나리오의 시대·장소·분위기에 맞게 정하되 지어낸 핵심 결정은 questions에 '…로 정했습니다, 맞나요?'처럼 남기세요.\n` +
              `- style: ${data.baseAssetId || refs.length ? "참고 그림의 그림체를 따라" : "시나리오의 장르·분위기에 맞는 2D 애니메이션 그림체로"} 선·채색·명암·색감을 구체적으로.\n` +
              (data.mode === "storyboard"
                ? `- shots: 시나리오를 쇼트(컷 분할)로 나누세요. 쇼트 사이는 컷으로 끊깁니다. 시나리오가 '세 컷이 1초씩', '완전 부감', '클로즈업으로' 처럼 화면을 바꾸면 새 쇼트, 한 쇼트 안에서 카메라가 움직여 구도가 바뀌면 그 쇼트의 패널을 늘리세요(머무는 쇼트는 패널 1개). 패널 합계는 2~12개. seconds는 쇼트 길이, 합이 duration과 같게.\n`
                : `- shots: 인물별 연기 방식은 컷 없는 한 쇼트입니다. 쇼트 1개에 표정 비트(감정이 바뀌는 순간)를 패널로 2~12개 적으세요.\n`) +
              `- duration: 장면 길이(초). 시나리오에 타임코드(예: 02:02~02:18)가 있으면 그 길이로, 60초를 넘기지 마세요.\n` +
              `- extras: 이름 없는 사람들(군중·행인·병사 등)만. 사람이 없으면 빈 문자열로 두고, 배경·풍경은 opening에 쓰세요.\n` +
              `- opening: 이 장면의 첫 순간을 한 장의 그림으로 그릴 묘사. 모든 주요 인물이 얼굴이 보이게 화면에 들어가야 합니다(이 그림이 이후 모든 컷의 인물 기준이 됨). 장소·시간·빛·군중·소품 포함.\n\n` +
              `씬 시놉시스·시나리오:\n${scenario || "(없음 — 그림만 보고 구성)"}\n` +
              (notes ? `\n팀이 적어 둔 인물 메모:\n${notes}\n` : "") +
              (data.extras.trim() ? `\n팀이 적어 둔 군중: ${data.extras}\n` : "") +
              (data.style.trim() ? `\n팀이 적어 둔 그림체: ${data.style}\n` : "") +
              extra,
          },
        ] as Content,
      };
    }
    case "analyze_character": {
      // one analysis of the scene drawing describes every cast member and the shared style
      const [base, refs] = await Promise.all([
        castImages(data),
        imageBlocks(data.designRefAssetIds.map((id) => ({ assetId: id, label: "[추가 참고 그림]" }))),
      ]);
      return {
        schema: CharacterOut,
        content: [
          ...base,
          ...refs,
          {
            type: "text",
            text:
              (multi
                ? `장면 기준 그림에 출연진 ${data.cast.length}명이 함께 있습니다. 위 그림 설명의 이름과 화면 위치로 각 인물을 찾아, characters에 인물 번호(1~${data.cast.length})마다 하나씩 설명을 작성하세요. ` +
                  `인물마다 다른 인물과 구별해 주는 요소를 locks 앞쪽에 두고, 인물끼리의 키·체격 차이도 appearance에 적으세요. 위치나 이름으로 누가 누구인지 확신할 수 없으면 questions에 남기세요.\n`
                : `기본 그림만 보고 캐릭터 설명을 작성하세요. characters에는 인물 1 하나만 씁니다.\n`) +
              `- locks: 표정이 바뀌어도 절대 변하면 안 되는 식별 요소를 번호 목록으로\n` +
              `- appearance: 얼굴 비율, 눈·코·입, 피부, 머리\n- outfit: 화면에 보이는 의상·장신구만\n- style: 장면 전체의 선, 채색, 명암, 색감\n` +
              `보이지 않거나 확신할 수 없는 것은 지어내지 말고 questions에 확인 질문으로 남기세요.\n\n현재 입력값:\n${ctx}${extra}`,
          },
        ] as Content,
      };
    }
    case "design_expressions": {
      if (data.mode === "storyboard") {
        // storyboard: the scene as successive panels, each described as a whole (sketches the team drew are followed)
        const [base, sketches] = await Promise.all([
          baseImage(),
          imageBlocks(data.expressions.map((e, i) => ({ assetId: e.sketchAssetId, label: `[${i + 1}번 컷 러프 스케치 — 구도·자세·카메라]` }))),
        ]);
        const n = data.expressionSetup.count;
        return {
          schema: StoryboardOut,
          content: [
            ...base,
            ...sketches,
            {
              type: "text",
              text:
                `이 장면을 콘티처럼 컷 ${n}개로 나눠 설계하세요. panels 배열 길이는 정확히 ${n}개이고, 컷 1이 장면의 처음, 컷 ${n}이 끝입니다. 컷(콘티 칸)끼리는 카메라가 이어서 움직이거나(continuous), 컷 분할로 새 쇼트가 시작됩니다(cut) — link로 정하세요.\n` +
                `- 반드시 시나리오 전체(처음부터 끝까지, 모든 기초 대사 포함)를 이 컷 ${n}개·${data.acting.duration}초 안에 담으세요. 컷 수가 시나리오의 장면 전환보다 적으면 비슷한 순간을 합치고, 시나리오 뒷부분을 빼지 마세요.\n` +
                (job.input.instruction?.includes("[처음부터 다시]")
                  ? `- 지금 있는 컷 제목·장면 묘사·연결은 무시하고 처음부터 다시 나누세요.\n`
                  : `- 현재 입력값의 컷 제목과 연결([컷 분할]/[이어짐])이 시나리오 전체를 담는 구성이면 따르고 내용만 채우세요. 시나리오 일부만 담고 있으면(예: 컷 수를 줄인 뒤 뒤쪽 컷이 잘림) 무시하고 다시 나누세요.\n`) +
                `- 장면 묘사·카메라에 '약 3초'처럼 초 단위 시간을 쓰지 마세요. 시간은 4단계 타임라인이 정합니다.\n` +
                `- action: 그 순간 화면 전체에서 일어나는 일을 2~4문장으로. 주요 인물은 이름으로, 군중·배경 인물은 무리로(예: "뒤쪽 군중이 놀라 물러선다"). 표정과 자세는 핵심만.\n` +
                `- camera: 샷 크기·앵글·다음 컷까지의 움직임을 한 문장으로. 이웃한 컷끼리 카메라가 자연스럽게 이어지게.\n` +
                `- speaker: 이 컷에서 대사를 말하는 주요 인물 번호(1~${data.cast.length}), 대사가 없으면 0.\n` +
                `- link: 앞 컷과의 연결. 시나리오가 화면을 끊어 새 쇼트로 넘어가면(예: '특대 클로즈업 세 컷이 1초씩', '완전 부감으로', 장소·시점이 크게 바뀜) cut, 같은 쇼트에서 카메라가 이어서 움직여 다음 구도가 되면 continuous. 첫 컷은 continuous. cut이면 camera에는 그 쇼트의 구도만 쓰고, 앞 컷에서 이어지는 움직임은 쓰지 마세요.\n` +
                (sketches.length ? `팀이 올린 러프 스케치가 있는 컷은 그 구도·자세·카메라를 따르고 action에 그대로 풀어 쓰세요.\n` : "") +
                (data.expressionSetup.scene.trim()
                  ? `'상황 설정·기초 대사'의 흐름을 따르고, 기초 대사마다 그 대사를 말하는 컷을 배정하세요.\n\n상황 설정·기초 대사:\n${data.expressionSetup.scene.trim()}\n`
                  : "") +
                `\n현재 입력값:\n${ctx}${extra}`,
            },
          ] as Content,
        };
      }
      const [base, ref] = await Promise.all([
        baseImage(),
        imageBlock(data.expressionSetup.refAssetId, "[표정 참고 시트 — 연기(표정·방향)만 참고, 그림체는 참고하지 않음]"),
      ]);
      return {
        schema: ExpressionsOut,
        content: [
          ...base,
          ...ref,
          {
            type: "text",
            text:
              (multi
                ? `이 장면(출연진 ${data.cast.length}명)의 표정(비트) ${data.expressionSetup.count}개를 장면 순서대로 설계하세요. expressions 배열 길이는 정확히 ${data.expressionSetup.count}개여야 합니다. ` +
                  `표정마다 character에 중심 인물(대사가 있으면 말하는 인물) 번호(1~${data.cast.length})를 적고, 중심 인물의 연기는 표정 필드에, 같은 순간 나머지 인물 각각의 연기는 reactions에 인물마다 하나씩 적으세요(감정·강도·눈썹·눈·입·팔손·방향). ` +
                  `말하지 않는 인물은 입을 다물고 시선·눈썹·숨·고개·손으로 반응합니다. 인물들의 시선과 몸 방향은 화면 위치를 기준으로 서로를 향하게 정하세요.\n`
                : `이 캐릭터의 표정 ${data.expressionSetup.count}개를 설계하세요. expressions 배열 길이는 정확히 ${data.expressionSetup.count}개여야 합니다. character는 1, reactions는 빈 배열로 두세요.\n`) +
              (ref.length
                ? `${refGridNote(data)}\n참고 시트의 각 칸을 하나씩 따로 관찰해 감정, 얼굴 근육, 머리 방향, 시선, 몸 방향을 기록하세요. ` +
                  `칸마다 방향이 반대로 바뀔 수 있으니 이전 칸의 값을 복사하지 마세요. directionEvidence에 판단 근거를 쓰세요.\n` +
                  `참고 시트의 그림체가 기본 그림과 크게 다르면 styleWarning에 적으세요.\n`
                : data.expressionSetup.scene.trim()
                  ? `참고 시트가 없으니 panel은 null로 두세요.\n`
                  : `참고 시트가 없으니 캐릭터 성격에 맞게 서로 구분되는 표정을 제안하고, panel은 null로 두세요.\n`) +
              `${gestureNote(data)}\n` +
              // the team's scene (상황 설정·기초 대사) decides the emotional arc and the order
              (data.expressionSetup.scene.trim() ? `\n${sceneDesignNote(data, ref.length > 0)}\n` : "") +
              `\n현재 입력값:\n${ctx}${extra}`,
          },
        ] as Content,
      };
    }
    case "check_sheet": {
      const [base, sheet] = await Promise.all([baseImage(), expressionImages(data)]);
      if (!sheet.length) throw new Error("검사할 표정 그림이 없습니다. 먼저 표정 그림을 생성하거나 올려주세요.");
      if (data.mode === "storyboard")
        return {
          schema: SheetCheckOut,
          content: [
            ...base,
            ...sheet,
            {
              type: "text",
              text:
                `컷 그림들(컷마다 한 장)을 장면 기준 그림과 컷 설계(장면 묘사·카메라)에 비교해 검사하세요. panel은 컷 번호입니다. 그림이 없는 컷은 검사하지 말고 panelCountMatches는 true로 두세요. ` +
                `각 그림이 장면 묘사대로인지, 주요 인물의 정체성(얼굴·머리·의상)이 기준 그림과 같고 서로 섞이지 않았는지, 그림체·조명·세계가 컷끼리 이어지는지, 비율이 ${imageAspectFor(data)}인지 확인하세요. ` +
                `컷 순서대로 카메라와 인물 위치가 한 쇼트처럼 자연스럽게 이어질 수 있는지, 글자·말풍선·칸 테두리가 들어가지 않았는지, 손과 얼굴이 무너지지 않았는지도 확인하세요. 문제가 없으면 issues를 비워두세요.\n\n${ctx}`,
            },
          ] as Content,
        };
      const perImage = data.expressions.some((e) => e.imageAssetId);
      return {
        schema: SheetCheckOut,
        content: [
          ...base,
          ...sheet,
          {
            type: "text",
            text:
              (perImage
                ? `표정 그림들(표정마다 한 장)을 기본 그림과 표정 설계에 비교해 검사하세요. panel은 표정 번호입니다. 그림이 없는 표정은 검사하지 말고 panelCountMatches는 true로 두세요. `
                : `생성된 표정 시트를 기본 그림과 표정 설계에 비교해 검사하세요. 칸 수가 ${data.expressions.length}개인지 확인하세요. `) +
              `각 그림의 감정·얼굴 방향·시선이 설계와 같은지, 고정 특징(locks)이 유지되었는지, 그림체가 바뀌지 않았는지 확인하세요. ` +
              `구도가 ${FRAMING_LABEL[data.expressionSetup.framing]}(${FRAMING_CUT[data.expressionSetup.framing]})이고 비율이 ${imageAspectFor(data)}인지, 머리나 머리 장식이 위쪽에서 잘리지 않았는지 확인하세요. ` +
              `그림들이 컷 없는 한 쇼트의 순간들처럼 이어지는지(카메라 거리·인물 크기·위치·조명이 같은지), 이웃한 표정끼리 자세가 자연스럽게 이어질 수 있는지 확인하세요. ` +
              (showsHands(data.expressionSetup.framing)
                ? `팔·손 동작이 설계(gesture)와 감정에 맞는지, 표정마다 동작이 단조롭게 반복되지 않는지, 손이 자연스럽게 그려졌는지(손가락 5개, 붙거나 늘어난 손가락 없음) 확인하세요. `
                : "") +
              (multi
                ? `모든 그림에 출연진 ${data.cast.length}명이 정해진 화면 위치에 모두 나오는지, 인물이 빠지거나 더 있거나 서로 특징이 섞이지 않았는지, 연기하는 인물이 설계대로 연기하고 나머지는 반응(입 다묾)하는지 확인하세요. 그림이 여러 칸으로 나뉘면 문제로 적으세요. `
                : `한 그림에 캐릭터가 여러 명이거나 여러 칸으로 나뉘면 문제로 적으세요. `) +
              `문제가 없으면 issues를 비워두세요.\n\n${ctx}`,
          },
        ] as Content,
      };
    }
    case "write_dialogue":
      return {
        schema: DialogueOut,
        content: [
          ...(await baseImage()),
          {
            type: "text",
            text:
              `각 표정(panel 번호 = 표정 순서, 1부터)에 맞는 짧은 대사와 의미, 말투를 작성하고 대사가 있는 인물마다 목소리 설정(voices, character = 인물 번호)을 정하세요. ` +
              (multi
                ? `대사는 그 표정을 연기하는 인물이 말합니다(위 '표정 N: 인물 · …'). 인물마다 목소리가 서로 분명히 구별되게(나이·음높이·음색·속도) 쓰세요. 이미 적힌 목소리가 있으면 살리세요. `
                : "") +
              `대사 언어: ${data.dialogue.language}. 영상 전체 길이는 ${data.acting.duration}초로 고정입니다. ` +
              `각 대사는 그 표정에 배정된 시간(위 '구간') 안에 여유 있게 말할 수 있어야 합니다. 한국어는 1초에 약 4음절, 영어는 1초에 약 2.5단어를 넘기지 말고, ` +
              `표정만 보여주는 순간이 필요하면 대사를 비워도 됩니다(line은 빈 문자열).\n` +
              (data.mode === "storyboard"
                ? `컷들은 시나리오 전체를 담습니다. 말투(delivery)에는 '약 8.2초에' 같은 절대 시각을 쓰지 말고 '컷이 시작되자마자', '낙하음 뒤 짧은 정적 다음'처럼 컷 안의 상대적인 순간으로 쓰세요(타임라인이 바뀌어도 맞도록).\n`
                : "") +
              (data.expressionSetup.scene.trim() ? `${sceneDialogueNote(data)}\n` : "") +
              `\n${ctx}${extra}`,
          },
        ] as Content,
      };
    case "plan_acting":
      return {
        schema: ActingOut,
        content: [
          {
            type: "text",
            text:
              `영상 전체 길이는 ${data.acting.duration}초로 고정입니다(2단계에서 정함). 이 시간 안에서 표정 순서와 시간 분배만 설계하세요. ` +
              `duration은 반드시 ${data.acting.duration}으로 두고, 구간은 0초에서 시작해 빈틈없이 이어져 ${data.acting.duration}초에서 끝나야 합니다. 모든 표정을 한 번씩 쓰세요. ` +
              `대사를 말할 시간이 충분하도록 하고(한국어 기준 1초에 약 4~5음절), transition에는 다음 표정으로 넘어가는 연기를 짧게 적으세요.` +
              (data.mode === "storyboard"
                ? ` 스토리보드 방식이라 transition은 다음 컷으로 넘어가는 방식입니다: 다음 컷이 [컷 분할]이면 무엇에서 끊기는지(예: 숨이 끝나는 순간 컷), [이어짐]이면 카메라·몸이 어떻게 이어지는지. 초 단위 시각은 쓰지 마세요.`
                : "") +
              (data.expressionSetup.scene.trim() ? ` '상황 설정·기초 대사'의 흐름(순서와 템포, 숨을 고르는 순간)을 따르세요.` : "") +
              `\n\n${ctx}${extra}`,
          },
        ] as Content,
      };
    case "check_prompt": {
      // the exact prompt generation will send (same source as gen.ts)
      const h = buildVideoHandoff(data, data.video.startFrameAssetId ? "start_frame" : "references");
      const handled = [
        ...h.overrides.map((o) => `- 추가 연출 우선: ${o}`),
        ...h.adjustments.map((a) => `- ${a.where}: ${a.rule}`),
        ...data.video.promptFixes.map((f) => `- 이미 고친 문구(영상 프롬프트에만): ${f.note || f.target}`),
      ].join("\n");
      const warns = preRenderCheck(data, h)
        .filter((i) => i.level === "warn")
        .map((i) => `- ${i.area}: ${i.text}`)
        .join("\n");
      return {
        schema: PromptCheckOut,
        content: [
          {
            type: "text",
            text:
              `아래는 영상 모델(Kling·Seedance·MiniMax)에 보낼 최종 영상 프롬프트입니다. 렌더 전에, 서로 부딪히는 지시를 찾고 고칠 글까지 써 주세요.\n` +
              `우선순위: ① DIRECTOR'S DIRECTION(감독의 추가 연출) ② 맨 끝의 스튜디오 제약사항 ③ 앱이 만든 일반 문장·구간 설명.\n` +
              `찾을 것:\n` +
              `- 프롬프트 안의 문장끼리 부딪히는 곳 (카메라·장비·각도·구도·배경·조명·속도·소리·컷 여부 등)\n` +
              `- 구간 설명(표정·팔손 동작·전환·대사 말투)이 감독 지시나 제약사항과 맞지 않는 곳\n` +
              `- 추가 연출의 카메라 시간(예: 0–3s)이 영상 길이나 구간과 맞지 않는 곳, 시간 안에 할 수 없는 동작·대사, 한 쇼트에서 동시에 할 수 없는 지시, 영상 모델이 헷갈릴 만한 모호한 표현\n` +
              `- 아래 '자동 점검의 확인할 점' 중 글을 고쳐 풀 수 있는 것 (예: 프롬프트가 길면 추가 연출에서 앱 문장이나 제약사항과 겹치는 문장을 덜어 낸 안)\n` +
              `앱이 이미 자동으로 조율한 아래 항목은 다시 지적하지 마세요:\n${handled || "- 없음"}\n` +
              `자동 점검의 확인할 점:\n${warns || "- 없음"}\n\n` +
              `고칠 글(fix) 쓰는 법:\n` +
              `- 글 한 칸을 바꿔 풀리는 문제에만 fix를 채우세요. 그림·시간 배분·영상 길이처럼 글로 못 고치는 문제는 fix를 null로 두고 step에 고칠 단계를 적으세요.\n` +
              `- direction(추가 연출)은 감독이 직접 쓴 글입니다. 고칠 곳만 바꾸고 나머지는 줄바꿈·제목·언어까지 그대로 둔 전체 글을 text에 쓰세요. 감독이 정한 장비·경로·속도·구도는 바꾸지 마세요.\n` +
              `- transition·gesture·notes·delivery는 설계 문서의 '표정 N' 번호로 고칠 표정을 정하고, voice는 expression에 인물 번호(1부터)를 적고 그 인물의 목소리 설명 전체를 고칩니다. 이 수정은 영상 프롬프트에만 쓰이고, 승인된 단계의 글은 그대로 남습니다.\n` +
              (multi ? `- 여러 인물 장면에서는 대사마다 말하는 인물이 분명한지, 두 인물의 목소리가 구별되는지, 듣는 인물이 입을 움직이라는 지시가 없는지도 확인하세요.\n` : "") +
              `- 같은 칸은 한 번만 고치세요. 같은 칸을 고쳐야 하는 문제가 여럿이면 첫 문제의 fix에 모두 반영하고, 나머지는 fix를 null로 두고 suggestion에 '위 수정에 포함'이라고 적으세요.\n` +
              `문제가 없으면 conflicts를 비우세요. suggestion에는 사람이 어느 칸을 어떻게 고치면 되는지 짧게 적으세요.\n\n` +
              `최종 영상 프롬프트 (${h.prompt.length}자):\n"""\n${h.prompt}\n"""\n\n설계 문서:\n${ctx}`,
          },
        ] as Content,
      };
    }
    case "write_english": {
      const fx = (t: "notes" | "gesture" | "transition" | "delivery" | "voice", id: string | null, s: string) => effectiveText(data, t, id, s);
      const framing = data.expressionSetup.framing;
      const storyboard = data.mode === "storyboard";
      const beats = data.expressions
        .map((e, i) => {
          const seg = data.acting.segments.find((s) => s.expressionId === e.id);
          const line = data.dialogue.lines.find((l) => l.expressionId === e.id);
          if (storyboard)
            return [
              `컷 ${i + 1}: ${e.emotion || "(제목 없음)"}`,
              `  장면 묘사: ${e.action}`,
              `  카메라: ${e.camera}`,
              `  다음 컷으로: ${seg ? fx("transition", e.id, seg.transition) : ""}`,
              line?.line
                ? `  대사(${castLabel(data, e.characterId)}): "${line.line}" (뜻: ${line.meaning}) · 말투: ${fx("delivery", e.id, line.delivery)}`
                : "  대사: 없음",
            ].join("\n");
          return [
            `표정 ${i + 1}: ${multi ? `${castLabel(data, e.characterId)} · ` : ""}${e.emotion || "(감정 미정)"} · 강도 ${INTENSITY_LABEL[e.intensity]}`,
            `  눈썹: ${e.brows}`,
            `  눈: ${e.eyes}`,
            `  입: ${e.mouth}`,
            `  메모: ${fx("notes", e.id, e.notes)}`,
            showsHands(framing) ? `  팔·손: ${fx("gesture", e.id, e.gesture)}` : "  팔·손: (손이 화면에 안 보이는 구도)",
            ...(multi
              ? e.reactions.map(
                  (r) =>
                    `  같은 순간 인물 ${data.cast.findIndex((c) => c.id === r.characterId) + 1} ${castLabel(data, r.characterId)}: ${r.emotion || "(감정 미정)"} · 강도 ${INTENSITY_LABEL[r.intensity]} · 눈썹 ${r.brows} · 눈 ${r.eyes} · 입 ${r.mouth}${showsHands(framing) ? ` · 팔·손 ${r.gesture}` : ""}`,
                )
              : []),
            `  다음 표정으로: ${seg ? fx("transition", e.id, seg.transition) : ""}`,
            line?.line ? `  대사: "${line.line}" (뜻: ${line.meaning}) · 말투: ${fx("delivery", e.id, line.delivery)}` : "  대사: 없음",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n");
      const cast = data.cast
        .map((c, i) =>
          [
            `인물 ${i + 1} (${castLabel(data, c.id)}, 화면 ${POSITION_LABEL[c.position]})`,
            `유지할 특징:\n${c.locks}`,
            `외형: ${c.appearance}`,
            `의상: ${c.outfit}`,
            `목소리: ${fx("voice", c.id, c.voice)}`,
          ].join("\n"),
        )
        .join("\n\n");
      return {
        schema: EnglishOut,
        content: [
          {
            type: "text",
            text:
              `아래 설계를 그림·영상 생성 모델에 넣을 짧은 영어로 정리하세요. 번역문을 늘어놓지 말고, 생성 모델이 바로 따를 수 있게 보이는 것과 움직임만 압축하세요. 설계에 없는 내용은 더하지 마세요.\n` +
              `- language: 대사 언어의 영어 이름\n` +
              `- style: 장면 그림체를 영어 한 문장\n` +
              `- cast: 인물마다 하나씩(character = 인물 번호). look은 '유지할 특징'과 '외형'에서 그림에 보이는 식별 요소를 색·모양·위치까지 구체적인 영어 명사구로, 중요한 순서로 최대 8개${
                multi ? " (다른 인물과 구별되는 요소를 앞에)" : ""
              }. outfit, voice는 각각 영어 한 문장\n` +
              (storyboard
                ? `- beats: 컷마다 하나씩(panel = 컷 번호). 이 장면은 스토리보드 방식이라 필드를 이렇게 씁니다: emotion = 컷 제목(영어 2~6단어), face = 장면 묘사(누가 무엇을 하는지, 군중 포함, 영어 1~2문장), body = 카메라(영어 한 문장), delivery = 대사 말투, others = 빈 배열\n`
                : `- beats: 표정마다 하나씩(panel = 표정 번호). face는 중심 인물의 얼굴 연기, body는 팔·손·몸 연기, delivery는 대사 말투${
                    multi ? ". others에는 '같은 순간' 나머지 인물마다 하나씩(character = 인물 번호) emotion·face·body" : ""
                  }\n`) +
              `- transition은 얼굴이 녹듯 바뀌는 모핑을 막는 핵심입니다. 다음 표정으로 넘어가는 변화를 실어 나르는 몸의 동작 하나로 쓰세요(눈을 깜빡이는 사이, 숨을 들이쉬며, 고개를 돌리며, 손이 얼굴 앞을 지나가며 등). 설계의 '다음 표정으로'가 있으면 그 동작을 살리세요. 마지막 표정은 빈 문자열\n` +
              `- 초 단위 시간, 발음 설명, 얼굴·몸·시선 방향(정면·3/4·화면 왼쪽 등)은 쓰지 마세요. 방향은 앱이 확인된 값으로 따로 넣습니다. 대사 원문은 옮기지 마세요.\n\n` +
              `출연진\n${cast}\n\n${storyboard && data.extras.trim() ? `군중·배경 인물: ${data.extras}\n\n` : ""}그림체(장면 공통): ${data.style}\n\n` +
              `대사 언어: ${data.dialogue.language}\n표정 그림 구도: ${FRAMING_LABEL[framing]} (${FRAMING_CUT[framing]})\n\n${beats}`,
          },
        ] as Content,
      };
    }
    case "consult":
      return null;
  }
}

/** What "AI와 상의" looks at: the base drawing, and on step 2 also the reference sheet and the expression images. */
async function consultImages(job: JobRow, data: ProjectData): Promise<Content> {
  if (job.step !== 1) return castImages(data);
  const [cast, ref, expressions] = await Promise.all([
    castImages(data),
    imageBlock(data.expressionSetup.refAssetId, "[표정 참고 시트 — 연기만 참고]"),
    expressionImages(data),
  ]);
  return [...cast, ...ref, ...expressions];
}

async function consultMessages(job: JobRow, data: ProjectData): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const sb = supabaseAdmin();
  const [{ data: prior }, images] = await Promise.all([
    sb
      .from("ai_jobs")
      .select("input, output")
      .eq("project_id", job.project_id)
      .eq("kind", "consult")
      .eq("step", job.step)
      .eq("status", "done")
      .lt("created_at", new Date().toISOString())
      .neq("id", job.id)
      // the latest 10 exchanges (put back in order below)
      .order("created_at", { ascending: false })
      .limit(10),
    consultImages(job, data),
  ]);
  const earlier = (prior ?? [])
    .reverse()
    .map((p) => ({
      message: (p.input as { message?: string })?.message ?? "",
      reply: (p.output as { reply?: string })?.reply ?? "",
    }))
    .filter((t) => t.message && t.reply);
  const current =
    `지금 단계: ${STEP_CONTEXT[job.step] ?? ""}\n현재 입력값:\n${projectContext(data, job.step)}\n\n` +
    `요청: ${job.input.message ?? ""}\n\n` +
    (earlier.length && images.length ? `(그림은 대화 맨 앞에 있으며, 지금 상태의 그림입니다.)\n` : "") +
    `질문에 답만 하면 proposal은 null. 내용을 바꾸자는 요청이면 이 단계 전체를 수정한 결과를 proposal에 넣고, reply에 무엇을 바꿨는지 짧게 설명하세요.`;
  return consultConversation(images, earlier, current);
}

/** Execute one queued job. Never throws — failures are written to the row. */
export async function runJob(jobId: string) {
  const sb = supabaseAdmin();
  const { data: job } = await sb.from("ai_jobs").select("*").eq("id", jobId).maybeSingle<JobRow>();
  if (!job) return;
  await sb.from("ai_jobs").update({ status: "running" }).eq("id", jobId);
  try {
    const { data: ver } = await sb
      .from("project_versions")
      .select("data")
      .eq("project_id", job.project_id)
      .eq("version", job.based_on_version)
      .maybeSingle();
    const data = parseProjectData(ver?.data);

    let result: Awaited<ReturnType<typeof callClaude>>;
    if (job.kind === "consult") {
      const messages = await consultMessages(job, data);
      result = await callClaude(consultSchemaFor(job.step, data.mode === "storyboard"), BASE_SYSTEM, messages, "medium");
    } else {
      const req = await buildRequest(job, data);
      if (!req) throw new Error("알 수 없는 작업입니다.");
      // Text-only planning jobs do not need the deepest reasoning; image analysis keeps "high".
      // (Effort stays fixed per kind: changing it would also miss the prompt cache.)
      const effort =
        job.kind === "write_dialogue" || job.kind === "plan_acting" || job.kind === "check_prompt" || job.kind === "write_english" ? "medium" : "high";
      result = await callClaude(req.schema, BASE_SYSTEM, [{ role: "user", content: cacheThroughLastImage(req.content) }], effort);
    }
    const u = result.usage;
    console.info(`[ai] ${job.kind}: input ${u.input} (cache read ${u.cacheRead}, cache write ${u.cacheWrite}), output ${u.output}`);
    // the English, tied to the Korean of this version (the client applies it as it arrives)
    if (job.kind === "write_english") result.output = { sheet: buildEnglishSheet(data, result.output as EnglishOutT) };
    // tie each text fix to the exact text it replaces, so the team applies it only while that text is unchanged
    if (job.kind === "check_prompt") {
      const out = result.output as PromptCheckOutT;
      result.output = {
        ...out,
        conflicts: out.conflicts.map((c) => ({ ...c, fix: c.fix ? resolveFix(data, c.fix) : null })),
      };
    }

    await sb
      .from("ai_jobs")
      .update({
        status: "done",
        output: result.output as object,
        input_tokens: result.usage.input,
        output_tokens: result.usage.output,
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  } catch (e) {
    let message = e instanceof Error ? e.message : "알 수 없는 오류";
    if (e instanceof Anthropic.RateLimitError) message = "AI 요청이 몰려 있습니다. 잠시 후 다시 시도해주세요.";
    else if (e instanceof Anthropic.AuthenticationError) message = "AI 키 설정을 확인해주세요 (관리자).";
    else if (e instanceof Anthropic.APIError) message = `AI 서버 오류 (${e.status}). 잠시 후 다시 시도해주세요.`;
    await sb
      .from("ai_jobs")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("id", jobId);
  }
}
