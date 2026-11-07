import { setCharacter } from "./helpers";
import { describe, expect, it } from "vitest";
import { createProjectData, type ProjectData } from "@/lib/domain/project";
import { buildFrameHandoff, buildVideoHandoff } from "@/lib/domain/handoff";
import { preRenderCheck } from "@/lib/domain/check";
import { VIDEO_MODELS } from "@/lib/higgsfield/models";

function project(): ProjectData {
  const d = createProjectData("x");
  setCharacter(d, { baseAssetId: "base-1", locks: "1. 머리띠: 금테 파란 밴드\n2. 초커", style: "가는 갈색 외곽선." });
  d.expressions = d.expressions.map((e, i) => ({ ...e, emotion: `감정${i + 1}`, imageAssetId: `img-${i}`, imageFraming: "bust", imageAspect: "3:4" }));
  return d;
}

describe("시작·끝 프레임 (keyframes)", () => {
  it("asks the shot to end on the end frame when one is attached", () => {
    const d = project();
    d.video.startFrameAssetId = "start-1";
    expect(buildVideoHandoff(d, "start_frame").prompt).not.toContain("end frame");
    d.video.endFrameAssetId = "end-1";
    expect(buildVideoHandoff(d, "start_frame").prompt).toContain("The shot ends exactly on the end frame");
    // a model that takes no end frame gets no such sentence
    expect(buildVideoHandoff(d, "start_frame", { endFrame: false }).prompt).not.toContain("end frame");
    expect(VIDEO_MODELS.kling4_0.endRole).toBe("end_image");
    expect(VIDEO_MODELS.minimax_h3.endRole).toBe("end_image");
    expect(VIDEO_MODELS.seedance_2_5.endRole).toBeNull();
    const items = preRenderCheck(d, buildVideoHandoff(d, "start_frame"));
    expect(items.find((i) => i.area === "끝 프레임")?.level).toBe("ok");
    d.video.startFrameAssetId = null;
    expect(preRenderCheck(d, buildVideoHandoff(d)).find((i) => i.area === "끝 프레임")?.level).toBe("warn");
  });

  it("draws a frame at the video's aspect ratio from one expression's moment", () => {
    const d = project();
    d.video.aspectRatio = "16:9";
    const f = buildFrameHandoff(d, d.expressions[2].id, "close_up");
    expect(f.aspectRatio).toBe("16:9");
    expect(f.references.map((r) => r.assetId)).toEqual(["base-1", "img-2"]);
    expect(f.prompt).toContain("One frame of a 16:9 horizontal video: ONE character, close-up");
    expect(f.prompt).toContain("Image reference 2 is the exact moment to draw");
    expect(f.prompt).toContain("Plain white background.");
    expect(f.prompt).toContain("Must keep: 머리띠, 초커.");
    d.video.extraDirection = "배경은 사막 (낮, 모래 언덕)";
    expect(buildFrameHandoff(d, d.expressions[0].id, "bust").prompt).toContain("Background as in this direction: 배경은 사막");
  });
});
