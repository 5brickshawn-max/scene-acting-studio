import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { safeName, text, zipFiles } from "@/lib/export";

describe("Higgsfield ZIP packs", () => {
  it("zips Korean folder and file names, with Windows line endings for text", async () => {
    const blob = await zipFiles([
      text("01_당황_기준그림/프롬프트.txt", "한 쇼트\n컷 없음"),
      { path: "01_당황_기준그림/참고1_캐릭터 기본 그림.png", data: new Uint8Array([1, 2, 3]) },
      text("작업안내.txt", "안내"),
    ]);
    const out = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(out).sort()).toEqual(["01_당황_기준그림/참고1_캐릭터 기본 그림.png", "01_당황_기준그림/프롬프트.txt", "작업안내.txt"]);
    expect(strFromU8(out["01_당황_기준그림/프롬프트.txt"])).toBe("한 쇼트\r\n컷 없음");
    expect(Array.from(out["01_당황_기준그림/참고1_캐릭터 기본 그림.png"])).toEqual([1, 2, 3]);
  });
  it("makes safe file names", () => {
    expect(safeName('당황/놀람: "아"?')).toBe("당황 놀람 아");
    expect(safeName("")).toBe("이름없음");
  });
});
