/**
 * Time marks in the director's camera text ("0–3s", "3-6 sec", "0~3초", "Continuous 8-second
 * single take", "8초짜리 롱테이크"). The check uses them to see when a camera plan was written for
 * another length than the video; the fix stretches every mark to the video's length.
 * Plain words like "120도", "24fps", "a 2-second hold" or a lone "1-2 seconds pause" are not
 * marks of the whole take.
 */

const NUM = String.raw`(\d+(?:\.\d+)?)`;
/** a span of the timeline: "0–3s", "3 - 6 sec", "6~8초", "0 to 3 seconds" */
const RANGE = String.raw`${NUM}(\s*(?:–|—|-|~|〜|to)\s*)${NUM}(\s*(?:seconds?|secs?|s|초))(?![a-zA-Z가-힣])`;
/** the length of the whole take: "8-second single take", "10 sec shot", "8초짜리 롱테이크", "8초 원테이크" */
const TOTAL_EN = String.raw`${NUM}([-\s](?:seconds?|secs?)\s+(?:[A-Za-z-]+\s+){0,2}?(?:take|shot|oner|clip|video|sequence)s?\b)`;
const TOTAL_KO = String.raw`${NUM}(\s*초\s*(?:짜리\s*)?(?:롱\s*테이크|원\s*테이크|테이크|쇼트|숏|영상))`;

type Mark = { index: number; text: string; end: number; render: (f: number, from: number, to: number) => string };

const half = (v: number) => Math.round(v * 2) / 2;
const fmt = (v: number) => String(Math.round(v * 100) / 100);

function marks(text: string): Mark[] {
  const out: Mark[] = [];
  for (const m of text.matchAll(new RegExp(RANGE, "gi"))) {
    const [, a, sep, b, unit] = m;
    const A = Number(a);
    const B = Number(b);
    if (!(B > A)) continue;
    out.push({
      index: m.index ?? 0,
      text: m[0],
      end: B,
      render: (f, from, to) => {
        const at = (v: number) => (v === from ? to : half(v * f));
        let a2 = at(A);
        let b2 = at(B);
        // very short spans: keep them apart at a finer step
        if (b2 <= a2) [a2, b2] = [Math.round(A * f * 10) / 10, Math.round(B * f * 10) / 10];
        return `${fmt(a2)}${sep}${fmt(b2)}${unit}`;
      },
    });
  }
  // spans are a timeline only when one starts at 0 ("a 1-2 seconds pause" on its own is not)
  if (!out.some((r) => /^0(?:\.0+)?\D/.test(r.text))) out.length = 0;
  const inRange = (i: number) => out.some((r) => i >= r.index && i < r.index + r.text.length);
  for (const src of [TOTAL_EN, TOTAL_KO]) {
    for (const m of text.matchAll(new RegExp(src, "gi"))) {
      const i = m.index ?? 0;
      if (inRange(i)) continue;
      const [, n, rest] = m;
      const N = Number(n);
      out.push({ index: i, text: m[0], end: N, render: (f, from, to) => `${fmt(N === from ? to : half(N * f))}${rest}` });
    }
  }
  return out.sort((x, y) => x.index - y.index);
}

/** The length (seconds) the text was written for: the latest time it names, or null when it names none. */
export function plannedSeconds(text: string): number | null {
  const ms = marks(text);
  return ms.length ? Math.max(...ms.map((m) => m.end)) : null;
}

/** Does the text plan the camera for another length than `seconds`? */
export function timingMismatch(text: string, seconds: number): number | null {
  const planned = plannedSeconds(text);
  return planned !== null && Math.abs(planned - seconds) >= 0.25 ? planned : null;
}

/**
 * Stretch (or shrink) every time mark so the plan ends at `to` seconds:
 * "Continuous 8-second single take … 6–8s" becomes "Continuous 10-second single take … 7.5–10s".
 * Returns the new text and the changed marks ("0–3s → 0–4s") for the team to see.
 */
export function retime(text: string, to: number): { text: string; changes: string[] } {
  const ms = marks(text);
  const from = ms.length ? Math.max(...ms.map((m) => m.end)) : null;
  if (from === null || Math.abs(from - to) < 0.05) return { text, changes: [] };
  const f = to / from;
  const changes: string[] = [];
  let out = "";
  let at = 0;
  for (const m of ms) {
    if (m.index < at) continue;
    const next = m.render(f, from, to);
    if (next !== m.text) changes.push(`${m.text.trim()} → ${next.trim()}`);
    out += text.slice(at, m.index) + next;
    at = m.index + m.text.length;
  }
  return { text: out + text.slice(at), changes };
}
