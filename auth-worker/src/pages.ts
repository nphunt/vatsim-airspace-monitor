// Shared by the auth Worker and the site: which pages are access-controlled, and the CIDs
// that always have access to everything.

/** Pages whose access is a CID list the admins edit. The live site is open to everyone. */
export const ACCESS_PAGES = ["dev", "admin"] as const;
export type AccessPage = (typeof ACCESS_PAGES)[number];

export const PAGE_TITLES: Record<AccessPage, string> = {
  dev: "DEVELOPMENT SITE (/dev/)",
  admin: "ADMIN PAGE",
};

/**
 * Built-in admins: full access to every page whatever the stored lists say, and never
 * removable from the admin page. The Worker's SUPERADMIN_CIDS setting overrides it.
 */
export const DEFAULT_SUPERADMIN_CIDS: readonly number[] = [1935951];

/** Most CIDs one page's list may hold. */
export const MAX_CIDS_PER_PAGE = 1000;

/** A VATSIM CID: a positive whole number of at most 8 digits. */
export function isCid(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 99_999_999;
}

/** What GET /me returns. */
export interface MeResponse {
  cid: number;
  name: string;
  /** Pages this CID may open. */
  pages: Record<AccessPage, boolean>;
  superadmin: boolean;
}

/** What GET /access returns, and PUT /access takes back (pages + baseVersion). */
export interface AccessResponse {
  pages: Record<AccessPage, number[]>;
  superadmins: number[];
  /** Bumped on every save; a PUT with an older baseVersion is refused (409). */
  version: number;
  updatedAt: string | null;
  updatedBy: number | null;
}

export interface AccessUpdate {
  pages: Record<AccessPage, number[]>;
  baseVersion: number;
}
