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

const REPO_URL = "https://github.com/nphunt/vatsim-airspace-monitor";

const DISCLAIMER =
  "Airspace Monitor is an independent, community-made tool. It is not affiliated with, endorsed by, or operated by VATSIM, VATUSA, or any ARTCC. For flight simulation use only. Not for real-world navigation or air traffic control.";

function layout(title: string, body: string, liveLink = true): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <meta name="robots" content="noindex" />
    <title>${esc(title)} · Airspace Monitor</title>
    <link rel="icon" type="image/svg+xml" href="/_vam/logo.svg" />
    <link rel="stylesheet" href="/_vam/style.css" />
  </head>
  <body>
    <main class="gate">
      <div class="gate-box">
        <h1 class="brand"><img src="/_vam/logo.svg" alt="" width="28" height="28" />AIRSPACE MONITOR</h1>
${body}
${liveLink ? `        <p><a href="/">GO TO THE LIVE SITE</a></p>\n` : ""}        <p class="dim fine">${esc(DISCLAIMER)} <a href="/privacy">PRIVACY</a></p>
      </div>
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

/** The privacy policy. Public (no sign-in), so people can read it before signing in. */
export function privacyPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>Privacy Policy · Airspace Monitor</title>
    <link rel="icon" type="image/svg+xml" href="/_vam/logo.svg" />
    <link rel="stylesheet" href="/_vam/style.css" />
  </head>
  <body>
    <main class="doc">
      <h1 class="brand"><img src="/_vam/logo.svg" alt="" width="28" height="28" />AIRSPACE MONITOR</h1>
      <h2>Privacy Policy</h2>
      <p class="dim">DRAFT · Last updated 2026-09-29. Not legal advice; have it reviewed before you rely on it.</p>

      <p>${esc(DISCLAIMER)}</p>

      <h3>Who runs this</h3>
      <p>[OPERATOR NAME / VIRTUAL FACILITY], a volunteer. Questions and requests: open an issue at <a href="${REPO_URL}/issues">${REPO_URL}</a> or contact [CONTACT EMAIL].</p>

      <h3>What we receive when you sign in</h3>
      <p>Airspace Monitor asks VATSIM Connect for your <b>full name</b> and <b>VATSIM details</b>. We receive your CID, your name, and your rating and account status. The status is used only to refuse suspended accounts. We do not ask for your email address, and we never see your VATSIM password.</p>

      <h3>What we store</h3>
      <ul>
        <li><b>A sign-in cookie</b> (signed, HttpOnly) holding your CID and name, so you stay signed in. It expires on its own and is removed when you sign out. Two short-lived helper cookies are used while signing in and after signing out.</li>
        <li><b>Access lists</b>: CIDs that an administrator has allowed onto the development site or the admin page. Only administrators change them.</li>
        <li><b>Server logs</b>: when you sign in or are refused, the server logs your CID (and rating, for a successful sign-in) with the time. Administrator changes to the access lists are logged with the administrator's CID. Logs stay on the server host and are not shared.</li>
        <li><b>In your browser only</b>: your settings, including the CID you enter for My Position, are saved in this browser's local storage. They are never sent to our server.</li>
      </ul>
      <p>We do not store your name anywhere on the server beyond the sign-in cookie, and we do not keep a list of everyone who has signed in.</p>

      <h3>Live traffic data</h3>
      <p>Your browser fetches the public VATSIM data feed directly from data.vatsim.net, so VATSIM sees your IP address as it does for any visitor to its feed. The feed contains pilots and controllers; Airspace Monitor never shows or stores pilot names.</p>

      <h3>What we do not do</h3>
      <ul>
        <li>No analytics, advertising, or tracking scripts. Fonts are served from this site.</li>
        <li>We do not sell or share your information. The only outside party involved is VATSIM, as the sign-in provider and the data feed.</li>
      </ul>

      <h3>Your choices</h3>
      <ul>
        <li>Sign out at any time from the toolbar or the admin page; that removes the sign-in cookie.</li>
        <li>Clear this site's data in your browser to remove saved settings.</li>
        <li>Ask us to remove your CID from an access list, or to delete log entries that mention you, using the contact above.</li>
      </ul>

      <h3>Changes</h3>
      <p>If this policy changes, the date above changes with it.</p>

      <p><a href="/">BACK TO AIRSPACE MONITOR</a></p>
    </main>
  </body>
</html>
`;
}
