/**
 * The site's server. Everything needs VATSIM Connect sign-in: a signed-out page load goes
 * straight to VATSIM and back. Any signed-in CID gets the live build at /; the development
 * build at /dev/ and the admin page only open for CIDs on their lists.
 *
 *   GET  /auth/login?return=<path> -> VATSIM Connect; comes back to <path> signed in
 *                                     (&switch=1: VATSIM asks for a CID and password
 *                                     again, to sign in as someone else)
 *   GET  /auth/callback            -> VATSIM Connect redirect target
 *   POST /auth/logout?return=<path>
 *   GET  /api/me                   -> { cid, name, pages: { dev, admin }, superadmin }
 *   GET  /api/access               -> the per-page CID lists (admins only)
 *   PUT  /api/access               -> replace them (admins only; { pages, baseVersion })
 *   GET  /admin/                   -> the page that edits the lists (admins only)
 *
 * Sessions are HMAC-signed HttpOnly cookies. Access is looked up on every request, so
 * removing a CID takes effect on their next request.
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  pagesFor,
  parseUpdate,
  isCid,
  type AccessPage,
  type AccessResponse,
  type AccessStore,
  type MeResponse,
  type StoredAccess,
} from "./access.ts";
import type { Config } from "./config.ts";
import { deniedPage, errorPage, noBuildPage } from "./pages.ts";
import {
  SESSION_COOKIE,
  SIGNED_OUT_COOKIE,
  STATE_COOKIE,
  clearCookie,
  readCookie,
  setCookie,
  signToken,
  verifyToken,
  type Session,
} from "./session.ts";
import { authorizeUrl, fetchUser, type VatsimClient } from "./vatsim.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.resolve(HERE, "../node_modules/@fontsource/ibm-plex-mono/files");
const STATE_TTL_S = 600;

/** A return target is a path on this site only (no open redirect). */
export function safeReturn(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f]/.test(raw)) return "/";
  return raw;
}

function wantsHtml(req: Request): boolean {
  return req.method === "GET" && (req.headers.accept ?? "").includes("text/html");
}

export function createApp(config: Config, store: AccessStore) {
  const app = express();
  app.disable("x-powered-by");

  const secure = config.publicUrl.protocol === "https:";
  const vatsim: VatsimClient = {
    authBase: config.vatsimAuthBase,
    clientId: config.vatsimClientId,
    clientSecret: config.vatsimClientSecret,
    redirectUri: new URL("/auth/callback", config.publicUrl).toString(),
  };

  const session = (req: Request): Session | null => {
    const raw = readCookie(req.headers.cookie, SESSION_COOKIE);
    const s = raw ? verifyToken<Session>(raw, config.sessionSecret) : null;
    return s && isCid(s.cid) ? s : null;
  };

  const me = (s: Session): MeResponse => ({
    cid: s.cid,
    name: s.name,
    pages: pagesFor(s.cid, store.get(), config.superadmins),
    superadmin: config.superadmins.includes(s.cid),
  });

  const accessBody = (a: StoredAccess): AccessResponse => ({
    ...a,
    superadmins: config.superadmins,
  });

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  // ---- Sign-in ----

  app.get("/auth/login", (req, res) => {
    const ret = safeReturn(req.query.return);
    // The state cookie and the session must land on the origin VATSIM sends people back
    // to, so a sign-in started on another host name moves over to PUBLIC_URL first.
    if (req.headers.host !== config.publicUrl.host) {
      return res.redirect(302, new URL(req.originalUrl, config.publicUrl).toString());
    }
    const nonce = randomBytes(16).toString("base64url");
    const state = signToken(
      { n: nonce, r: ret, exp: Math.floor(Date.now() / 1000) + STATE_TTL_S },
      config.sessionSecret,
    );
    // VATSIM Connect remembers who signed in there, so without prompt=login it would hand
    // back the same CID. Ask again on SWITCH, and on the first sign-in after SIGN OUT.
    const forceLogin =
      req.query.switch === "1" || readCookie(req.headers.cookie, SIGNED_OUT_COOKIE) === "1";
    res.setHeader("Cache-Control", "no-store");
    // The nonce cookie ties the callback to the browser that started the sign-in.
    res.setHeader(
      "Set-Cookie",
      setCookie(STATE_COOKIE, nonce, { path: "/auth/callback", maxAgeS: STATE_TTL_S, secure }),
    );
    if (forceLogin) res.append("Set-Cookie", clearCookie(SIGNED_OUT_COOKIE, "/auth", secure));
    res.redirect(302, authorizeUrl(vatsim, state, forceLogin));
  });

  app.get("/auth/callback", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Set-Cookie", clearCookie(STATE_COOKIE, "/auth/callback", secure));
    const state = verifyToken<{ n: string; r: string; exp: number }>(
      String(req.query.state ?? ""),
      config.sessionSecret,
    );
    if (!state || readCookie(req.headers.cookie, STATE_COOKIE) !== state.n) {
      return res
        .status(400)
        .send(
          errorPage("SIGN-IN EXPIRED OR WAS STARTED IN ANOTHER BROWSER. TRY AGAIN.", "/auth/login"),
        );
    }
    const ret = safeReturn(state.r);
    const retry = `/auth/login?return=${encodeURIComponent(ret)}`;
    const code = req.query.code;
    if (typeof code !== "string" || !code) {
      return res.status(400).send(errorPage("SIGN-IN WAS CANCELLED.", retry));
    }
    try {
      const user = await fetchUser(vatsim, code);
      const token = signToken(
        { cid: user.cid, name: user.name, exp: Math.floor(Date.now() / 1000) + config.sessionTtlS },
        config.sessionSecret,
      );
      res.append(
        "Set-Cookie",
        setCookie(SESSION_COOKIE, token, { path: "/", maxAgeS: config.sessionTtlS, secure }),
      );
      console.log(`sign-in: CID ${user.cid}`);
      res.redirect(302, ret);
    } catch (e) {
      console.error("VATSIM Connect sign-in failed:", e);
      res.status(502).send(errorPage("VATSIM SIGN-IN FAILED. TRY AGAIN.", retry));
    }
  });

  app.post("/auth/logout", (req, res) => {
    res.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE, "/", secure));
    res.append(
      "Set-Cookie",
      setCookie(SIGNED_OUT_COOKIE, "1", { path: "/auth", maxAgeS: 30 * 24 * 3600, secure }),
    );
    res.redirect(303, safeReturn(req.query.return));
  });

  // ---- API ----

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  api.get("/me", (req, res) => {
    const s = session(req);
    if (!s) return res.status(401).json({ error: "not signed in" });
    res.json(me(s));
  });

  // A write must come from this site: SameSite=Lax already keeps the cookie off cross-site
  // POST/PUT, and the Origin check backs that up.
  const sameOrigin = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && origin !== config.publicUrl.origin) {
      return res.status(403).json({ error: "cross-origin request refused" });
    }
    next();
  };

  const adminOnly = (req: Request, res: Response, next: NextFunction) => {
    const s = session(req);
    if (!s) return res.status(401).json({ error: "not signed in" });
    if (!me(s).pages.admin) return res.status(403).json({ error: "admins only" });
    res.locals.session = s;
    next();
  };

  api.get("/access", adminOnly, (_req, res) => {
    res.json(accessBody(store.get()));
  });

  api.put("/access", sameOrigin, adminOnly, express.json({ limit: "64kb" }), async (req, res) => {
    const update = parseUpdate(req.body);
    if (typeof update === "string") return res.status(400).json({ error: update });
    const s = res.locals.session as Session;
    const result = await store.save(update, s.cid);
    if (!result.ok) {
      return res.status(409).json({
        error: "the lists changed since you loaded them",
        current: accessBody(result.current),
      });
    }
    console.log(`access lists saved by CID ${s.cid} (version ${result.access.version})`);
    res.json(accessBody(result.access));
  });

  app.use("/api", api);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // ---- Pages ----

  /**
   * Lets the request through only for a signed-in CID with access to `page` ("live": any
   * signed-in CID). Signed out, a page load goes straight to VATSIM Connect and comes back
   * here; other requests (scripts, data) just get 401.
   */
  const gate = (page: AccessPage | "live") => (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "private, no-cache");
    const s = session(req);
    const html = wantsHtml(req);
    if (!s) {
      if (!html) return res.status(401).type("text/plain").send("sign in first");
      return res.redirect(
        302,
        `/auth/login?return=${encodeURIComponent(safeReturn(req.originalUrl))}`,
      );
    }
    if (page !== "live" && !me(s).pages[page]) {
      if (!html) return res.status(403).type("text/plain").send("access denied");
      return res.status(403).send(deniedPage(page, s.cid, safeReturn(req.originalUrl)));
    }
    next();
  };

  const serve = (dir: string, isPrivate: boolean) =>
    express.static(dir, {
      cacheControl: false,
      setHeaders(res, file) {
        const scope = isPrivate ? "private" : "public";
        // Vite fingerprints everything under assets/; the rest (index.html, data/) isn't.
        const hashed = file.split(path.sep).includes("assets");
        res.setHeader(
          "Cache-Control",
          hashed ? `${scope}, max-age=31536000, immutable` : `${scope}, no-cache`,
        );
      },
    });

  const missing = (which: string) => (req: Request, res: Response, next: NextFunction) => {
    if (wantsHtml(req) && !fs.existsSync(path.join(config.siteDir, which, "index.html"))) {
      return res.status(503).send(noBuildPage(which === "live" ? "LIVE" : "DEVELOPMENT"));
    }
    next();
  };

  app.use("/_vam/fonts", serve(FONTS, false));
  app.use("/_vam", serve(path.join(HERE, "static"), false));
  app.use("/admin", gate("admin"), serve(path.join(HERE, "admin"), true));
  app.use("/dev", gate("dev"), missing("dev"), serve(path.join(config.siteDir, "dev"), true));
  app.use(gate("live"), missing("live"), serve(path.join(config.siteDir, "live"), true));

  app.use((_req, res) => {
    res.status(404).type("text/plain").send("not found");
  });

  return app;
}
