/**
 * Server-side video work for sequences (시퀀스): join scene videos into one MP4, and take a video's last frame
 * (to start the next scene exactly where this one ends). Uses the ffmpeg binary shipped in npm
 * (@ffmpeg-installer), since the hosting has no ffmpeg of its own.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const run = promisify(execFile);
const FFMPEG = ffmpegInstaller.path;

export type Probe = { duration: number; width: number; height: number; audio: boolean };

/** Duration, frame size and whether there is sound, read from ffmpeg's own report (no ffprobe needed). */
export async function probe(file: string): Promise<Probe> {
  // `ffmpeg -i` with no output exits with an error but prints the stream report on stderr
  const report = await run(FFMPEG, ["-hide_banner", "-i", file], { maxBuffer: 4 * 1024 * 1024 }).then(
    (r) => r.stderr,
    (e: { stderr?: string }) => e.stderr ?? "",
  );
  const d = report.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const v = report.match(/Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
  return {
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
    width: v ? Number(v[1]) : 0,
    height: v ? Number(v[2]) : 0,
    audio: /Stream #[^\n]*Audio:/.test(report),
  };
}

/** The frame size a sequence is joined at, from the video aspect ratio of its scenes. */
export function sequenceSize(aspect: string): { w: number; h: number } {
  return aspect === "9:16" ? { w: 720, h: 1280 } : { w: 1280, h: 720 };
}

/**
 * Join videos end to end into one MP4 (H.264 + AAC). Every input is fitted into the same frame (letterboxed,
 * never stretched) at 24 fps; an input without sound gets silence, so the sound stays in step with the picture.
 */
export async function joinVideos(files: string[], out: string, size: { w: number; h: number }): Promise<Probe> {
  if (!files.length) throw new Error("합칠 영상이 없습니다.");
  const probes = await Promise.all(files.map(probe));
  const parts: string[] = [];
  const chain: string[] = [];
  probes.forEach((p, i) => {
    const dur = Math.max(0.1, p.duration);
    parts.push(
      `[${i}:v]scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p,trim=duration=${dur},setpts=PTS-STARTPTS[v${i}]`,
    );
    parts.push(
      p.audio
        ? `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${dur},asetpts=PTS-STARTPTS[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${dur},aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`,
    );
    chain.push(`[v${i}][a${i}]`);
  });
  parts.push(`${chain.join("")}concat=n=${files.length}:v=1:a=1[v][a]`);
  const args = [
    "-hide_banner",
    "-y",
    ...files.flatMap((f) => ["-i", f]),
    "-filter_complex",
    parts.join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    out,
  ];
  await run(FFMPEG, args, { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 });
  return probe(out);
}

/** The very last frame of a video as a PNG (the next scene's start frame for a seamless join). */
export async function lastFrame(file: string, out: string): Promise<void> {
  // seek close to the end and keep overwriting one image: what remains is the final decoded frame
  await run(FFMPEG, ["-hide_banner", "-y", "-sseof", "-0.5", "-i", file, "-update", "1", "-q:v", "2", out], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
  });
}
