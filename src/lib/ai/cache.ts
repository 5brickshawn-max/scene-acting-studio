/**
 * Prompt caching for the Claude requests (5-minute entries, refreshed on every hit).
 *
 * The images are the heavy part of most requests and they repeat: when a job is re-run, and on
 * every follow-up question in "AI와 상의". So each request puts its images first and the cached
 * prefix ends at the last image; the text after it (current inputs, the request) changes every
 * time and is sent after the cached part. A hit costs a fraction of the normal input price and
 * the model starts answering sooner.
 */
import type Anthropic from "@anthropic-ai/sdk";

type Block = Anthropic.Beta.BetaImageBlockParam | Anthropic.Beta.BetaTextBlockParam;
type Message = Anthropic.Beta.BetaMessageParam;

const CACHE = { type: "ephemeral" } as const;

/** Cache breakpoint on the last image (no change when there is no image). */
export function cacheThroughLastImage(content: Block[]): Block[] {
  const last = content.findLastIndex((b) => b.type === "image");
  return last < 0 ? content : content.map((b, i) => (i === last ? { ...b, cache_control: CACHE } : b));
}

export type ConsultTurn = { message: string; reply: string };

/**
 * One "AI와 상의" request: the images, then the earlier exchanges, then this turn (current inputs
 * and the question). Images and earlier exchanges are the same on the next follow-up, so they are
 * cached: one breakpoint after the images, one at the end of the earlier exchanges.
 */
export function consultConversation(images: Block[], earlier: ConsultTurn[], current: string): Message[] {
  const lead = cacheThroughLastImage(images);
  if (!earlier.length) return [{ role: "user", content: [...lead, { type: "text", text: current }] }];
  const messages = earlier.flatMap((t, i): Message[] => [
    { role: "user", content: [...(i === 0 ? lead : []), { type: "text", text: t.message }] },
    {
      role: "assistant",
      content: [{ type: "text", text: t.reply, ...(i === earlier.length - 1 ? { cache_control: CACHE } : {}) }],
    },
  ]);
  messages.push({ role: "user", content: [{ type: "text", text: current }] });
  return messages;
}
