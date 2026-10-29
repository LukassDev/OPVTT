import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import yauzl from "yauzl";

const YT_DLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const YT_DLP_CHECKSUM_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS";
const FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const FFMPEG_CHECKSUM_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256";
const DENO_URL = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip";
const DENO_CHECKSUM_URL = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip.sha256sum";
const MAX_DOWNLOAD_BYTES = 400 * 1024 * 1024;
const MAX_EXECUTABLE_BYTES = 200 * 1024 * 1024;
const MAX_MEDIA_BYTES = 400 * 1024 * 1024;
const ONLINE_MEDIA_TTL_MS = 6 * 60 * 60 * 1000;
const TOOLS_DIRECTORY = path.join(
  process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local"),
  "OPVTT",
  "media-tools",
);
const MEDIA_CACHE_DIRECTORY = path.join(TOOLS_DIRECTORY, "media-cache");

interface MediaTools {
  ytDlp: string;
  ffmpegDirectory: string;
  deno: string;
}

export interface ResolvedMedia {
  url: string;
  title: string;
}

let toolsPromise: Promise<MediaTools> | null = null;
let mediaServer: Server | null = null;
let mediaServerAddress = "";
const onlineMediaSources = new Map<string, {
  url?: string;
  filename?: string;
  contentType?: string;
  expiresAt: number;
}>();

export async function startOnlineMediaServer(): Promise<void> {
  if (mediaServerAddress) return;

  const server = createServer((request, response) => {
    void serveLocalMediaRequest(request, response);
  });
  server.on("clientError", (cause, socket) => {
    console.error("Invalid request to the online media server:", cause);
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (cause: Error) => reject(cause);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("The local media server did not receive a TCP address."));
        return;
      }
      mediaServer = server;
      mediaServerAddress = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

export async function resolveOnlineMedia(link: string, audioOnly: boolean): Promise<ResolvedMedia> {
  const mediaUrl = validateMediaUrl(link);
  if (process.platform !== "win32") {
    throw new Error("Online media resolution is currently supported on Windows only.");
  }
  const tools = await getMediaTools();
  const titleResult = await runExecutable(tools.ytDlp, [
    "--quiet", "--no-warnings", "--no-progress",
    "--js-runtimes", `deno:${tools.deno}`,
    "--no-playlist", "--print", "%(title)s",
    "--skip-download", mediaUrl,
  ], 90_000);

  if (titleResult.exitCode !== 0) {
    const reason = titleResult.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
    throw new Error((reason || "yt-dlp could not resolve this link.").slice(0, 500));
  }
  const title = titleResult.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0]
    || new URL(mediaUrl).hostname;
  const preparedMedia = await downloadCompatibleMedia(tools, mediaUrl, audioOnly);
  return {
    url: registerOnlineMediaFile(preparedMedia.filename, preparedMedia.contentType),
    title,
  };
}

export function registerOnlineMediaSource(url: string): string {
  return registerMedia({ url: validateMediaUrl(url) });
}

function registerOnlineMediaFile(filename: string, contentType: string): string {
  return registerMedia({ filename, contentType });
}

function registerMedia(source: { url?: string; filename?: string; contentType?: string }): string {
  if (!mediaServerAddress) throw new Error("The local online media server is not running. Restart OPVTT and try again.");
  const now = Date.now();
  for (const [id, source] of onlineMediaSources) {
    if (source.expiresAt <= now) {
      onlineMediaSources.delete(id);
      if (source.filename) {
        void rm(source.filename, { force: true }).catch((cause: unknown) => {
          console.error("Unable to remove expired online media:", cause);
        });
      }
    }
  }
  const id = randomUUID();
  onlineMediaSources.set(id, { ...source, expiresAt: now + ONLINE_MEDIA_TTL_MS });
  return `${mediaServerAddress}/stream/${id}`;
}

async function downloadCompatibleMedia(
  tools: MediaTools,
  mediaUrl: string,
  audioOnly: boolean,
): Promise<{ filename: string; contentType: string }> {
  await mkdir(MEDIA_CACHE_DIRECTORY, { recursive: true });
  const id = randomUUID();
  const output = path.join(MEDIA_CACHE_DIRECTORY, `${id}.%(ext)s`);
  const filename = path.join(MEDIA_CACHE_DIRECTORY, `${id}.webm`);
  const format = audioOnly
    ? "bestaudio[ext=webm][acodec=opus]/bestaudio[ext=m4a][acodec^=mp4a]"
    : "bestvideo[height<=1080][ext=webm][vcodec^=vp9]+bestaudio[ext=webm][acodec=opus]"
      + "/bestvideo[height<=1080][ext=webm][vcodec^=vp8]+bestaudio[ext=webm][acodec=opus]";

  try {
    const result = await runExecutable(tools.ytDlp, [
      "--quiet", "--no-warnings", "--no-progress",
      "--ffmpeg-location", tools.ffmpegDirectory,
      "--js-runtimes", `deno:${tools.deno}`,
      "--no-playlist", "--format", format,
      ...(audioOnly ? [] : ["--merge-output-format", "webm"]),
      "--max-filesize", `${MAX_MEDIA_BYTES}`,
      "--output", output,
      mediaUrl,
    ], 10 * 60_000);

    if (result.exitCode !== 0) {
      const reason = result.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
      throw new Error((reason || "Could not prepare a browser-compatible WebM stream.").slice(0, 500));
    }
    const extension = audioOnly ? null : "webm";
    const outputFilename = extension
      ? filename
      : (await readdir(MEDIA_CACHE_DIRECTORY))
        .filter((entry) => entry.startsWith(`${id}.`))
        .map((entry) => path.join(MEDIA_CACHE_DIRECTORY, entry))[0];
    if (!outputFilename) throw new Error("The media resolver did not produce an audio file.");
    const info = await stat(outputFilename);
    if (!info.isFile() || info.size === 0) throw new Error("The media resolver produced an empty WebM file.");
    if (info.size > MAX_MEDIA_BYTES) throw new Error("The prepared media file exceeds the 400 MB limit.");
    const contentType = path.extname(outputFilename).toLowerCase() === ".m4a" ? "audio/mp4" : "audio/webm";
    return { filename: outputFilename, contentType: audioOnly ? contentType : "video/webm" };
  } catch (cause) {
    const files = await readdir(MEDIA_CACHE_DIRECTORY).catch((readError: unknown) => {
      console.error("Unable to inspect incomplete media downloads:", readError);
      return [];
    });
    await Promise.all(files
      .filter((entry) => entry.startsWith(`${id}.`))
      .map((entry) => rm(path.join(MEDIA_CACHE_DIRECTORY, entry), { force: true })));
    throw cause;
  }
}

export async function handleOnlineMediaRequest(request: Request): Promise<Response> {
  const address = new URL(request.url);
  if (address.hostname !== "stream") {
    return new Response("Unknown media stream.", { status: 404 });
  }

  const headers = corsHeaders();
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Range, If-Range");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("Allow", "GET, HEAD, OPTIONS");
    return new Response("Method not allowed.", { status: 405, headers });
  }

  const id = address.pathname.startsWith("/stream/")
    ? address.pathname.slice("/stream/".length)
    : "";
  const source = onlineMediaSources.get(id);
  if (!source || source.expiresAt <= Date.now()) {
    onlineMediaSources.delete(id);
    if (source?.filename) {
      await rm(source.filename, { force: true }).catch((cause: unknown) => {
        console.error("Unable to remove expired online media:", cause);
      });
    }
    return new Response("Online media link expired. Resolve the link again.", { status: 404, headers });
  }

  const upstreamHeaders = new Headers();
  for (const name of ["range", "if-range"]) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }
  const userAgent = request.headers.get("user-agent");
  if (userAgent) upstreamHeaders.set("user-agent", userAgent);
  if (source.filename) {
    return serveCachedMedia(request, source.filename, source.contentType || "application/octet-stream", headers);
  }
  if (!source.url) return new Response("Online media source is unavailable.", { status: 404, headers });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let upstream: Response;
  try {
    upstream = await fetch(source.url, {
      method: request.method,
      headers: upstreamHeaders,
      signal: controller.signal,
    });
  } catch (cause) {
    console.error("Unable to retrieve online media:", cause);
    return new Response("Unable to retrieve online media.", { status: 502, headers });
  } finally {
    clearTimeout(timer);
  }

  for (const name of ["accept-ranges", "content-length", "content-range", "content-type", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!upstream.ok && upstream.status !== 416) {
    console.error("Online media server returned status:", upstream.status);
  }
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function serveCachedMedia(
  request: Request,
  filename: string,
  contentType: string,
  headers: Headers,
): Promise<Response> {
  let info;
  try {
    info = await stat(filename);
  } catch (cause) {
    console.error("Unable to read prepared online media:", cause);
    return new Response("Prepared media is unavailable.", { status: 404, headers });
  }
  if (!info.isFile()) return new Response("Prepared media is unavailable.", { status: 404, headers });

  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Type", contentType);
  const range = request.headers.get("range");
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      headers.set("Content-Range", `bytes */${info.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        headers.set("Content-Range", `bytes */${info.size}`);
        return new Response(null, { status: 416, headers });
      }
      start = Math.max(0, info.size - suffixLength);
    } else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), info.size - 1);
    }
    if (start >= info.size || end < start) {
      headers.set("Content-Range", `bytes */${info.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
    status = 206;
  }
  headers.set("Content-Length", String(end - start + 1));
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const iterator = createReadStream(filename, { start, end })[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (cause) {
        controller.error(cause);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
  return new Response(body, { status, headers });
}

async function serveLocalMediaRequest(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): Promise<void> {
  try {
    const method = request.method || "GET";
    const headers = new Headers();
    for (const name of ["range", "if-range", "user-agent", "origin"]) {
      const value = request.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    const mediaRequest = new Request(`http://stream${request.url || "/"}`, { method, headers });
    const mediaResponse = await handleOnlineMediaRequest(mediaRequest);
    response.writeHead(mediaResponse.status, Object.fromEntries(mediaResponse.headers.entries()));
    if (!mediaResponse.body) {
      response.end();
      return;
    }

    const reader = mediaResponse.body.getReader();
    let completed = false;
    response.once("close", () => {
      if (!completed) void reader.cancel().catch((cause: unknown) => {
        console.error("Unable to stop a cancelled media response:", cause);
      });
    });
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!response.write(next.value)) await once(response, "drain");
    }
    completed = true;
    response.end();
  } catch (cause) {
    console.error("Unable to serve local online media:", cause);
    if (!response.headersSent) response.writeHead(502, { "Access-Control-Allow-Origin": "*" });
    response.end("Unable to serve online media.");
  }
}

function corsHeaders(): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
}

export function validateMediaUrl(link: string): string {
  if (!link?.trim()) throw new Error("Enter a media link.");
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch (cause) {
    throw new Error("Enter a valid HTTPS media link.", { cause });
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error("Use a valid HTTPS link to a supported media site.");
  }
  return url.toString();
}

function getMediaTools(): Promise<MediaTools> {
  if (!toolsPromise) {
    toolsPromise = installMediaTools().catch((cause: unknown) => {
      toolsPromise = null;
      throw cause;
    });
  }
  return toolsPromise;
}

async function installMediaTools(): Promise<MediaTools> {
  await mkdir(TOOLS_DIRECTORY, { recursive: true });
  const ytDlp = path.join(TOOLS_DIRECTORY, "yt-dlp.exe");
  const ffmpegDirectory = path.join(TOOLS_DIRECTORY, "ffmpeg");
  const ffmpeg = path.join(ffmpegDirectory, "ffmpeg.exe");
  const deno = path.join(TOOLS_DIRECTORY, "deno.exe");
  if (!(await isFile(ytDlp))) await installYtDlp(ytDlp);
  if (!(await isFile(ffmpeg))) await installFfmpeg(ffmpegDirectory);
  if (!(await isFile(deno))) await installDeno(deno);
  return { ytDlp, ffmpegDirectory, deno };
}

async function installYtDlp(destination: string): Promise<void> {
  const workspace = await mkdtemp(path.join(TOOLS_DIRECTORY, "yt-dlp-install-"));
  const download = path.join(workspace, "yt-dlp.exe");
  try {
    const checksums = await getText(YT_DLP_CHECKSUM_URL);
    const line = checksums.split(/\r?\n/).find((entry) => entry.trim().endsWith("yt-dlp.exe"));
    if (!line) throw new Error("yt-dlp checksum is missing.");
    await downloadFile(YT_DLP_URL, download);
    await verifySha256(download, checksumFromText(line, "yt-dlp"), "yt-dlp");
    await rename(download, destination);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function installFfmpeg(destination: string): Promise<void> {
  const workspace = await mkdtemp(path.join(TOOLS_DIRECTORY, "ffmpeg-install-"));
  const archive = path.join(workspace, "ffmpeg.zip");
  const staging = path.join(workspace, "unpacked");
  try {
    await mkdir(staging);
    const expected = checksumFromText(await getText(FFMPEG_CHECKSUM_URL), "FFmpeg");
    await downloadFile(FFMPEG_URL, archive);
    await verifySha256(archive, expected, "FFmpeg");
    await extractExecutable(archive, staging, "ffmpeg.exe", true);
    const executable = path.join(staging, "ffmpeg.exe");
    if (!(await isFile(executable))) throw new Error("The FFmpeg archive did not contain ffmpeg.exe.");
    await runChecked(executable, ["-version"], 10_000, "FFmpeg");
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function installDeno(destination: string): Promise<void> {
  const workspace = await mkdtemp(path.join(TOOLS_DIRECTORY, "deno-install-"));
  const archive = path.join(workspace, "deno.zip");
  const executable = path.join(workspace, "deno.exe");
  try {
    const expected = checksumFromText(await getText(DENO_CHECKSUM_URL), "Deno");
    await downloadFile(DENO_URL, archive);
    await verifySha256(archive, expected, "Deno");
    await extractExecutable(archive, workspace, "deno.exe", false);
    if (!(await isFile(executable))) throw new Error("The Deno archive did not contain deno.exe.");
    await runChecked(executable, ["--version"], 10_000, "Deno");
    await rename(executable, destination);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function extractExecutable(
  archive: string,
  destination: string,
  executable: string,
  inBinDirectory: boolean,
): Promise<void> {
  const zip = await yauzl.openPromise(archive, { lazyEntries: true, validateEntrySizes: true });
  let found = false;
  try {
    for await (const entry of zip.eachEntry()) {
      const parts = entry.fileName.replace(/\\/g, "/").split("/");
      const isTarget = parts.at(-1)?.toLowerCase() === executable
        && (inBinDirectory ? parts.at(-2)?.toLowerCase() === "bin" : parts.length === 1);
      if (!isTarget) continue;
      if (entry.uncompressedSize > MAX_EXECUTABLE_BYTES) {
        throw new Error(`${executable} exceeds the extraction limit.`);
      }
      const input = await zip.openReadStreamPromise(entry);
      let extracted = 0;
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          extracted += chunk.length;
          if (extracted > MAX_EXECUTABLE_BYTES) {
            callback(new Error(`${executable} exceeds the extraction limit.`));
            return;
          }
          callback(null, chunk);
        },
      });
      await pipeline(input, limit, createWriteStream(path.join(destination, executable), { flags: "wx" }));
      found = true;
      break;
    }
  } finally {
    zip.close();
  }
  if (!found) throw new Error(`The media-tool archive did not contain ${executable}.`);
}

async function getText(address: string): Promise<string> {
  const response = await fetch(address, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not retrieve media-tool checksum (${response.status}).`);
  return response.text();
}

async function downloadFile(address: string, destination: string): Promise<void> {
  const response = await fetch(address, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!response.ok || !response.body) {
    throw new Error(`Could not download media tool (${response.status}).`);
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_DOWNLOAD_BYTES) throw new Error("Media-tool download exceeds the size limit.");

  let total = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > MAX_DOWNLOAD_BYTES) {
        callback(new Error("Media-tool download exceeds the size limit."));
        return;
      }
      callback(null, chunk);
    },
  });
  const reader = response.body.getReader();
  const input = Readable.from((async function* () {
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) return;
        yield Buffer.from(next.value);
      }
    } finally {
      reader.releaseLock();
    }
  })());
  await pipeline(input, limit, createWriteStream(destination, { flags: "wx" }));
}

function checksumFromText(text: string, tool: string): string {
  const checksum = text.match(/\b[0-9a-f]{64}\b/i)?.[0];
  if (!checksum) throw new Error(`${tool} checksum is missing or invalid.`);
  return checksum;
}

async function verifySha256(filename: string, expected: string, tool: string): Promise<void> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filename)) {
    digest.update(chunk);
  }
  if (digest.digest("hex").toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${tool}.`);
  }
}

async function isFile(filename: string): Promise<boolean> {
  try {
    return (await stat(filename)).isFile();
  } catch {
    return false;
  }
}

async function runChecked(
  executable: string,
  args: string[],
  timeoutMs: number,
  tool: string,
): Promise<void> {
  const result = await runExecutable(executable, args, timeoutMs);
  if (result.exitCode !== 0) throw new Error(`The installed ${tool} executable failed its version check.`);
}

function runExecutable(
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const process = spawn(executable, args, { windowsHide: true, shell: false });
    let output = "";
    let outputExceeded = false;
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 1_000_000) {
        output = output.slice(-1_000_000);
        outputExceeded = true;
        process.kill();
      }
    };
    process.stdout.on("data", append);
    process.stderr.on("data", append);
    const timer = setTimeout(() => process.kill(), timeoutMs);
    process.once("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    process.once("close", (code) => {
      clearTimeout(timer);
      if (outputExceeded) {
        reject(new Error("The media resolver produced excessive output."));
      } else if (code === null) {
        reject(new Error("The media resolver did not complete before the timeout."));
      } else {
        resolve({ exitCode: code, output });
      }
    });
  });
}
