/** Rough speaking time. Korean ≈ 4.5 syllables/s; Latin text ≈ 2.7 words/s. */
export function estimateSpeechSeconds(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const hangul = (t.match(/[가-힣]/g) ?? []).length;
  const latinWords = (t.replace(/[가-힣]/g, " ").match(/[A-Za-z0-9']+/g) ?? []).length;
  return Math.round((hangul / 4.5 + latinWords / 2.7) * 10) / 10;
}
