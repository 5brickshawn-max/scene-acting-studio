import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { cacheThroughLastImage, consultConversation } from "@/lib/ai/cache";

type Block = Anthropic.Beta.BetaImageBlockParam | Anthropic.Beta.BetaTextBlockParam;
type Message = Anthropic.Beta.BetaMessageParam;

const label = (text: string): Block => ({ type: "text", text });
const image = (data: string): Block => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });

const blocks = (m: Message) => (typeof m.content === "string" ? [] : (m.content as Block[]));
const marked = (ms: Message[]) => ms.flatMap(blocks).filter((b) => b.cache_control);
/** The request as the cache sees it: breakpoints move between requests and are not part of the prefix. */
const strip = (ms: Message[]) => JSON.parse(JSON.stringify(ms, (k, v) => (k === "cache_control" ? undefined : v)));

const images = [label("[기본 그림]"), image("BASE"), label("[표정 1 그림 — 당황]"), image("E1")];

describe("prompt cache breakpoints", () => {
  it("ends the cached prefix at the last image and leaves the text after it out", () => {
    const content = cacheThroughLastImage([...images, label("현재 입력값 …")]);
    expect(content.map((b) => !!b.cache_control)).toEqual([false, false, false, true, false]);
    expect(images.some((b) => b.cache_control)).toBe(false); // input not mutated
    expect(cacheThroughLastImage([label("글만")])).toEqual([label("글만")]);
  });

  it("first question: the images, then the question, with the images cached", () => {
    const ms = consultConversation(images, [], "요청 1");
    expect(ms).toHaveLength(1);
    expect(blocks(ms[0]).at(-1)).toEqual(label("요청 1"));
    expect(marked(ms)).toEqual([{ ...image("E1"), cache_control: { type: "ephemeral" } }]);
  });

  it("follow-ups: images first, earlier exchanges next, this turn last — each request extends the previous one", () => {
    const t1 = consultConversation(images, [], "현재 입력값 + 요청 1");
    const t2 = consultConversation(images, [{ message: "요청 1", reply: "답 1" }], "현재 입력값 + 요청 2");
    const t3 = consultConversation(
      images,
      [
        { message: "요청 1", reply: "답 1" },
        { message: "요청 2", reply: "답 2" },
      ],
      "현재 입력값 + 요청 3",
    );

    // the images open the conversation and stay byte-identical across turns
    expect(strip(t2)[0].content.slice(0, images.length)).toEqual(strip(t1)[0].content.slice(0, images.length));
    expect(t2.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(t3.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    // turn 3 starts with everything turn 2 sent before its new message
    expect(strip(t3).slice(0, 2)).toEqual(strip(t2).slice(0, 2));
    // breakpoints: after the images and at the end of the earlier exchanges; the new message is not cached
    expect(marked(t3).map((b) => (b.type === "image" ? "image" : (b as Anthropic.Beta.BetaTextBlockParam).text))).toEqual(["image", "답 2"]);
    expect(blocks(t3.at(-1)!).some((b) => b.cache_control)).toBe(false);
    expect(marked(t3).length).toBeLessThanOrEqual(4);
  });

  it("no images: only the earlier exchanges are cached", () => {
    const ms = consultConversation([], [{ message: "요청 1", reply: "답 1" }], "요청 2");
    expect(marked(ms)).toEqual([{ type: "text", text: "답 1", cache_control: { type: "ephemeral" } }]);
  });
});
