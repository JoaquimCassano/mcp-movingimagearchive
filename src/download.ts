import { execFile } from "node:child_process";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { clipDownloadUrl, getSource, request, sourceDownloadUrl, toSlug } from "./archive.ts";

export interface DownloadRequest {
  clipId?: string;
  sourceSlug?: string;
  fromShot?: number;
  toShot?: number;
  startSeconds?: number;
  endSeconds?: number;
  outputPath?: string;
}

// ponytail: not configurable; pass outputPath for anywhere else.
export const DEFAULT_DIR = path.join(os.homedir(), "Downloads");

const run = promisify(execFile);

// Shift-click on the site: shots a..b (1-based, either order) → first start to last end.
export function shotRange(shots: { shotNumber: number; startSeconds: number; endSeconds: number }[], from: number, to: number) {
  const pick = (n: number) => {
    const s = shots.find((s) => s.shotNumber === n);
    if (!s) throw new Error(`Shots must be between 1 and ${shots.length}`);
    return s;
  };
  const a = pick(Math.min(from, to)), b = pick(Math.max(from, to));
  return { start: a.startSeconds, end: b.endSeconds };
}

// `outputPath` is a file if it has an extension, otherwise a directory. `~` is the home dir. Never overwrites.
async function outFile(outputPath = DEFAULT_DIR, name: string) {
  const p = path.resolve(outputPath.replace(/^~(?=$|[\\/])/, os.homedir()));
  const isDir = !path.extname(p) || (await stat(p).catch(() => null))?.isDirectory();
  const file = isDir ? path.join(p, name) : p;
  if (await stat(file).catch(() => null)) throw new Error(`${file} already exists; choose another outputPath`);
  await mkdir(path.dirname(file), { recursive: true });
  return file;
}

// Never leaves a half-written file at `file`: write to `.part`, rename on success.
async function writeAtomically(file: string, write: (tmp: string) => Promise<unknown>) {
  const tmp = `${file}.part`;
  try {
    await write(tmp);
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

// ffmpeg seeks with HTTP range requests (following the site's redirect), so only the needed
// part of the film is fetched; re-encoding makes the cuts frame-accurate.
async function trim(url: string, start: number | undefined, end: number | undefined, file: string, signal?: AbortSignal) {
  const args = ["-nostdin", "-v", "error", "-y", "-protocol_whitelist", "https,tls,tcp,crypto",
    ...(start !== undefined ? ["-ss", String(start)] : []), ...(end !== undefined ? ["-to", String(end)] : []),
    "-i", url, "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", "-f", "mp4", file];
  try {
    await run("ffmpeg", args, { signal });
  } catch (e: any) {
    if (e.code === "ENOENT") throw new Error(`ffmpeg not found on PATH. Install it, or run: ffmpeg ${args.map((a) => JSON.stringify(a)).join(" ")}`);
    throw new Error(`ffmpeg failed: ${String(e.stderr || e.message).slice(-800)}`);
  }
}

// `signal` is the MCP request's cancellation; it aborts the transfer or kills ffmpeg (the `.part` file is removed).
export async function download({ clipId, sourceSlug, fromShot, toShot, startSeconds, endSeconds, outputPath }: DownloadRequest, signal?: AbortSignal) {
  if (!clipId === !sourceSlug) throw new Error("Pass exactly one of clipId or sourceSlug");
  // clipId ends up in a URL path and a file name.
  if (clipId && !/^[0-9a-f-]{36}$/i.test(clipId)) throw new Error(`Invalid clipId: ${JSON.stringify(clipId)}`);
  const shots = fromShot !== undefined || toShot !== undefined;
  if (shots && (clipId || startSeconds !== undefined || endSeconds !== undefined))
    throw new Error("fromShot/toShot need sourceSlug and can't be combined with startSeconds/endSeconds");

  const name = clipId ?? toSlug(sourceSlug!, "sources");
  const url = clipId ? clipDownloadUrl(clipId) : sourceDownloadUrl(name);
  let start = startSeconds, end = endSeconds;
  if (shots) ({ start, end } = shotRange((await getSource(name, { offset: 0, limit: Infinity })).shots, fromShot ?? toShot!, toShot ?? fromShot!));

  if (start === undefined && end === undefined) {
    const file = await outFile(outputPath, `${name}.mp4`);
    await writeAtomically(file, async (tmp) => writeFile(tmp, (await request(url, { signal })).body!, { signal }));
    return { file, url };
  }
  if (start !== undefined && end !== undefined && end <= start) throw new Error("endSeconds must be greater than startSeconds");
  const file = await outFile(outputPath, `${name}-${(start ?? 0).toFixed(1)}-${end?.toFixed(1) ?? "end"}.mp4`);
  await writeAtomically(file, (tmp) => trim(url, start, end, tmp, signal));
  return { file, url, startSeconds: start, endSeconds: end };
}
