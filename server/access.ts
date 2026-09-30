// Which pages are access-controlled, the CID lists the admin page edits, and where those
// lists are kept (a JSON file in DATA_DIR). The live site opens for any signed-in CID.

import fs from "node:fs/promises";
import path from "node:path";

/** Pages whose access is a CID list the admins edit. */
export const ACCESS_PAGES = ["dev", "admin"] as const;
export type AccessPage = (typeof ACCESS_PAGES)[number];

export const PAGE_TITLES: Record<AccessPage, string> = {
  dev: "DEVELOPMENT SITE (/dev/)",
  admin: "ADMIN PAGE",
};

/** Built-in admins: full access to every page, never removable. SUPERADMIN_CIDS adds more. */
export const BUILT_IN_SUPERADMINS: readonly number[] = [1935951];

/** Most CIDs one page's list may hold. */
export const MAX_CIDS_PER_PAGE = 1000;

/** A VATSIM CID: a positive whole number of at most 8 digits. */
export function isCid(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 99_999_999;
}

/** What GET /api/me returns. */
export interface MeResponse {
  cid: number;
  name: string;
  /** Pages this CID may open. */
  pages: Record<AccessPage, boolean>;
  superadmin: boolean;
}

export interface StoredAccess {
  pages: Record<AccessPage, number[]>;
  /** Bumped on every save; a PUT with an older baseVersion is refused (409). */
  version: number;
  updatedAt: string | null;
  updatedBy: number | null;
}

/** What GET /api/access returns. */
export interface AccessResponse extends StoredAccess {
  superadmins: number[];
}

/** What PUT /api/access takes. */
export interface AccessUpdate {
  pages: Record<AccessPage, number[]>;
  baseVersion: number;
}

export function emptyAccess(): StoredAccess {
  return { pages: { dev: [], admin: [] }, version: 0, updatedAt: null, updatedBy: null };
}

/** Pages a CID may open. Admins (and superadmins) can open everything. */
export function pagesFor(
  cid: number,
  access: StoredAccess,
  supers: readonly number[],
): Record<AccessPage, boolean> {
  const admin = supers.includes(cid) || access.pages.admin.includes(cid);
  const out = {} as Record<AccessPage, boolean>;
  for (const p of ACCESS_PAGES) out[p] = admin || access.pages[p].includes(cid);
  return out;
}

/** Validates a PUT body into sorted, de-duplicated lists, or returns an error message. */
export function parseUpdate(body: unknown): AccessUpdate | string {
  if (!body || typeof body !== "object") return "body must be a JSON object";
  const b = body as Record<string, unknown>;
  if (typeof b.baseVersion !== "number") return "baseVersion missing";
  const pages = b.pages as Record<string, unknown> | undefined;
  if (!pages || typeof pages !== "object") return "pages missing";
  const out = {} as Record<AccessPage, number[]>;
  for (const p of ACCESS_PAGES) {
    const list = pages[p];
    if (!Array.isArray(list)) return `pages.${p} must be an array of CIDs`;
    const bad = list.find((x) => !isCid(x));
    if (bad !== undefined) return `pages.${p}: ${JSON.stringify(bad)} is not a CID`;
    if (list.length > MAX_CIDS_PER_PAGE) return `pages.${p}: more than ${MAX_CIDS_PER_PAGE} CIDs`;
    out[p] = [...new Set(list as number[])].sort((a, c) => a - c);
  }
  return { pages: out, baseVersion: b.baseVersion };
}

function normalize(raw: unknown): StoredAccess {
  const out = emptyAccess();
  if (!raw || typeof raw !== "object") return out;
  const parsed = raw as Partial<StoredAccess>;
  for (const p of ACCESS_PAGES) {
    const list = parsed.pages?.[p];
    out.pages[p] = Array.isArray(list) ? list.filter(isCid) : [];
  }
  out.version = typeof parsed.version === "number" ? parsed.version : 0;
  out.updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
  out.updatedBy = isCid(parsed.updatedBy) ? parsed.updatedBy : null;
  return out;
}

export type SaveResult = { ok: true; access: StoredAccess } | { ok: false; current: StoredAccess };

/**
 * The access lists, kept in memory and written through to `<dataDir>/access.json`. The
 * server is one process, so the version check on save is exact. Writes go to a temp file
 * that's then renamed over the old one, so a crash never leaves half a file.
 */
export class AccessStore {
  private readonly file: string;
  private current: StoredAccess = emptyAccess();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "access.json");
  }

  async load(): Promise<void> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    // A corrupt file is a startup error, not an empty list: the admins would lose their
    // lists on the next save.
    this.current = normalize(JSON.parse(text));
  }

  get(): StoredAccess {
    return this.current;
  }

  save(update: AccessUpdate, by: number): Promise<SaveResult> {
    const run = async (): Promise<SaveResult> => {
      if (update.baseVersion !== this.current.version) return { ok: false, current: this.current };
      const next: StoredAccess = {
        pages: update.pages,
        version: this.current.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: by,
      };
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
      await fs.rename(tmp, this.file);
      this.current = next;
      return { ok: true, access: next };
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
