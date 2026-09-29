// Server-rendered pages: access denied, sign-in failed and a missing build. (Signed-out
// page loads go straight to VATSIM Connect, so there is no sign-in page.)

import { PAGE_TITLES, type AccessPage } from "./access.ts";
import type { SignInFailure } from "./vatsim.ts";

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function layout(title: string, body: string, liveLink = true): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <meta name="robots" content="noindex" />
    <title>${esc(title)} · VATSIM Airspace Monitor</title>
    <link rel="stylesheet" href="/_vam/style.css" />
  </head>
  <body>
    <main class="gate">
      <div class="gate-box">
        <h1>VATSIM AIRSPACE MONITOR</h1>
${body}
${liveLink ? `        <p><a href="/">GO TO THE LIVE SITE</a></p>\n` : ""}      </div>
    </main>
  </body>
</html>
`;
}

function signOutForm(returnTo: string): string {
  return `<form method="post" action="/auth/logout?return=${encodeURIComponent(returnTo)}">
          <button type="submit">SIGN OUT</button>
        </form>`;
}

export function deniedPage(page: AccessPage, cid: number, returnTo: string): string {
  return layout(
    "Access denied",
    `        <h2>${esc(PAGE_TITLES[page])}</h2>
        <p class="alert" role="alert">ACCESS DENIED: CID ${cid} DOES NOT HAVE ACCESS TO THE ${esc(PAGE_TITLES[page])}. ASK AN ADMIN FOR ACCESS.</p>
        <p class="dim">GIVE THE ADMIN YOUR CID: ${cid}</p>
        <p><a class="button" href="/auth/login?switch=1&amp;return=${encodeURIComponent(returnTo)}">SIGN IN AS A DIFFERENT CID</a></p>
        ${signOutForm(returnTo)}`,
  );
}

interface FailureText {
  title: string;
  /** `{cid}` is replaced with the CID when known. */
  message: string;
  status: number;
  /** Offer TRY AGAIN (a suspended account would only be refused again). */
  retry: boolean;
}

const FAILURES: Record<SignInFailure, FailureText> = {
  cancelled: {
    title: "SIGN-IN CANCELLED",
    message: "THE SIGN-IN WAS CANCELLED ON VATSIM'S PAGE. THIS SITE NEEDS A VATSIM SIGN-IN.",
    status: 400,
    retry: true,
  },
  expired: {
    title: "SIGN-IN EXPIRED",
    message: "THE SIGN-IN TOOK TOO LONG, OR WAS STARTED IN ANOTHER BROWSER OR TAB. START IT AGAIN.",
    status: 400,
    retry: true,
  },
  "code-rejected": {
    title: "SIGN-IN REJECTED",
    message: "VATSIM DID NOT ACCEPT THE SIGN-IN. IT MAY HAVE EXPIRED OR ALREADY BEEN USED.",
    status: 400,
    retry: true,
  },
  "client-rejected": {
    title: "SIGN-IN UNAVAILABLE",
    message:
      "VATSIM REJECTED THIS SITE'S SIGN-IN SETTINGS. THIS IS A PROBLEM WITH THE SITE, NOT YOUR ACCOUNT. TELL AN ADMIN.",
    status: 502,
    retry: true,
  },
  "vatsim-unreachable": {
    title: "VATSIM UNAVAILABLE",
    message: "COULD NOT REACH VATSIM CONNECT. IT MAY BE DOWN. TRY AGAIN IN A FEW MINUTES.",
    status: 502,
    retry: true,
  },
  "bad-response": {
    title: "SIGN-IN FAILED",
    message:
      "VATSIM SENT BACK SOMETHING UNEXPECTED. TRY AGAIN, AND TELL AN ADMIN IF IT KEEPS HAPPENING.",
    status: 502,
    retry: true,
  },
  suspended: {
    title: "ACCOUNT SUSPENDED",
    message: "CID {cid} IS SUSPENDED ON VATSIM. SUSPENDED ACCOUNTS CAN'T USE THIS SITE.",
    status: 403,
    retry: false,
  },
  "status-unknown": {
    title: "ACCOUNT STATUS UNKNOWN",
    message:
      "VATSIM DID NOT SAY WHETHER CID {cid} IS IN GOOD STANDING, SO ACCESS IS REFUSED. TRY AGAIN, AND TELL AN ADMIN IF IT KEEPS HAPPENING.",
    status: 403,
    retry: true,
  },
};

/** The HTTP status and page for a sign-in that didn't go through. */
export function signInFailedPage(
  reason: SignInFailure,
  returnTo: string,
  cid: number | null = null,
  now: Date = new Date(),
): { status: number; html: string } {
  const f = FAILURES[reason];
  const ret = encodeURIComponent(returnTo);
  const message = f.message.replace("{cid}", cid === null ? "YOUR ACCOUNT" : String(cid));
  const stamp = `${now.toISOString().slice(0, 16).replace("T", " ")}Z`;
  return {
    status: f.status,
    // No link to the live site: it needs a sign-in too, so it would only come back here.
    html: layout(
      "Sign-in failed",
      `        <h2>${esc(f.title)}</h2>
        <p class="alert" role="alert">${esc(message)}</p>
        ${f.retry ? `<p><a class="button" href="/auth/login?return=${ret}">TRY AGAIN</a></p>` : ""}
        <p><a class="button" href="/auth/login?switch=1&amp;return=${ret}">SIGN IN AS A DIFFERENT CID</a></p>
        <p class="dim">REASON: ${esc(reason.toUpperCase())} · ${stamp}</p>`,
      false,
    ),
  };
}

export function noBuildPage(which: string): string {
  return layout(
    "Not built",
    `        <p class="alert" role="alert">THE ${esc(which)} SITE HAS NOT BEEN BUILT ON THIS SERVER.</p>
        <p class="dim">RUN <code>npm run build:sites</code> AND RELOAD.</p>`,
  );
}
