import { isCid, type AccessPage } from "../../auth-worker/src/pages";
import { parseCid } from "../core/myPosition";

/**
 * The page a build of the main app needs access to: production builds from any branch
 * but main are the development site (/dev/). The live site and the local dev server
 * (`npm run dev`) are open.
 */
export function requiredPage(
  dev: boolean = import.meta.env.DEV,
  branch: string = __BUILD_BRANCH__,
): AccessPage | null {
  return !dev && branch !== "main" ? "dev" : null;
}

/** Parses CIDs typed or pasted into the admin page (separated by spaces, commas, newlines). */
export function parseCids(text: string): { cids: number[]; invalid: string[] } {
  const cids: number[] = [];
  const invalid: string[] = [];
  for (const tok of text.split(/[\s,;]+/).filter(Boolean)) {
    const p = parseCid(tok);
    if (p.kind === "ok" && isCid(p.cid)) cids.push(p.cid);
    else invalid.push(tok);
  }
  return { cids, invalid };
}

/** Where the live site is from this build (the development site lives in its dev/ folder). */
export function liveSiteUrl(base: string = import.meta.env.BASE_URL): string {
  return base.replace(/dev\/$/, "");
}
