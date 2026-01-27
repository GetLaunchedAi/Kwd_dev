import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import axios from "axios";

type ClickUpAttachment = {
  id?: string;
  title?: string;
  extension?: string;     // e.g. "png"
  type?: string;          // e.g. "image/png"
  url?: string;           // downloadable URL
  url_w_query?: string;   // sometimes present
};

type ClickUpTaskResponse = {
  id: string;
  attachments?: ClickUpAttachment[];
};

export type FetchAttachmentsOptions = {
  taskId: string;
  clientFolder: string;         // e.g. D:\...\client-websites\jacks-roofing-llc
  clickupToken: string;         // OAuth access token or CLICKUP_API_TOKEN
  // Optional knobs
  subdirName?: string;          // default: ".cursor/attachments/<taskId>"
  maxFiles?: number;            // default: 10
  maxBytesPerFile?: number;     // default: 5 * 1024 * 1024 (5MB)
  onlyImages?: boolean;         // default: true
};

export type FetchAttachmentsResult = {
  outDir: string;
  downloaded: string[]; // absolute paths
  skipped: { reason: string; title?: string; url?: string }[];
};

function sanitizeFileBase(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-") // Windows-illegal chars
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned.length ? cleaned : "attachment";
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function isImageAttachment(a: ClickUpAttachment): boolean {
  if (a.type && a.type.toLowerCase().startsWith("image/")) return true;
  const ext = (a.extension || "").toLowerCase();
  return ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
}

export async function fetchAttachments(opts: FetchAttachmentsOptions): Promise<FetchAttachmentsResult> {
  const {
    taskId,
    clientFolder,
    clickupToken,
    subdirName,
    maxFiles = 10,
    maxBytesPerFile = 5 * 1024 * 1024,
    onlyImages = true,
  } = opts;

  const outDir = subdirName
    ? path.resolve(clientFolder, subdirName)
    : path.resolve(clientFolder, ".cursor", "attachments", taskId);

  await fs.ensureDir(outDir);

  const manifestPath = path.join(outDir, "manifest.json");
  const manifest = (await fs.pathExists(manifestPath))
    ? await fs.readJson(manifestPath).catch(() => ({}))
    : {};

  const alreadyByUrl = new Set<string>(
    Array.isArray(manifest?.items) ? manifest.items.map((it: any) => it?.url).filter(Boolean) : []
  );

  // 1) Fetch task (includes attachments)
  const taskUrl = `https://api.clickup.com/api/v2/task/${encodeURIComponent(taskId)}`;
  const taskResp = await axios.get<ClickUpTaskResponse>(taskUrl, {
    headers: { Authorization: clickupToken },
    timeout: 20_000,
  });

  const attachments = Array.isArray(taskResp.data.attachments) ? taskResp.data.attachments : [];
  const filtered = onlyImages ? attachments.filter(isImageAttachment) : attachments;

  const toProcess = filtered.slice(0, Math.max(0, maxFiles));

  const downloaded: string[] = [];
  const skipped: { reason: string; title?: string; url?: string }[] = [];
  const newItems: any[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const a = toProcess[i];
    const url = a.url_w_query || a.url;

    if (!url) {
      skipped.push({ reason: "missing_url", title: a.title });
      continue;
    }

    if (alreadyByUrl.has(url)) {
      skipped.push({ reason: "already_downloaded", title: a.title, url });
      continue;
    }

    // 2) Download bytes
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: 30_000,
      // Some attachment URLs are signed/public; header won’t hurt if ignored.
      headers: { Authorization: clickupToken },
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const buf = Buffer.from(res.data);

    if (buf.byteLength > maxBytesPerFile) {
      skipped.push({ reason: `too_large>${maxBytesPerFile}`, title: a.title, url });
      continue;
    }

    const ext =
      (a.extension && a.extension.toLowerCase()) ||
      (a.type?.toLowerCase().includes("png") ? "png" :
        a.type?.toLowerCase().includes("jpeg") ? "jpg" :
        a.type?.toLowerCase().includes("jpg") ? "jpg" :
        a.type?.toLowerCase().includes("webp") ? "webp" :
        a.type?.toLowerCase().includes("gif") ? "gif" :
        a.type?.toLowerCase().includes("svg") ? "svg" :
        "bin");

    const base = sanitizeFileBase(a.title || a.id || `attachment-${i + 1}`);
    const prefix = String(i + 1).padStart(2, "0");
    const filename = `${prefix}-${base}.${ext}`;
    const filePath = path.join(outDir, filename);

    await fs.writeFile(filePath, buf);

    const hash = sha256(buf);
    downloaded.push(filePath);
    newItems.push({
      id: a.id,
      title: a.title,
      type: a.type,
      extension: a.extension,
      url,
      file: filename,
      sha256: hash,
      bytes: buf.byteLength,
      downloadedAt: new Date().toISOString(),
    });

    alreadyByUrl.add(url);
  }

  // 3) Persist manifest for idempotency
  const nextManifest = {
    taskId,
    outDir,
    fetchedAt: new Date().toISOString(),
    items: [
      ...(Array.isArray(manifest?.items) ? manifest.items : []),
      ...newItems,
    ],
  };

  await fs.writeJson(manifestPath, nextManifest, { spaces: 2 });

  return { outDir, downloaded, skipped };
}
