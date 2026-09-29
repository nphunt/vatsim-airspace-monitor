// Server-rendered pages: sign-in, access denied, sign-in errors and a missing build.

import { PAGE_TITLES, type AccessPage } from "./access.ts";

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function layout(title: string, body: string): string {
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
        <p><a href="/">GO TO THE LIVE SITE</a></p>
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

export function signInPage(page: AccessPage, returnTo: string, error?: string): string {
  return layout(
    "Sign in",
    `        <h2>${esc(PAGE_TITLES[page])}</h2>
        ${error ? `<p class="alert" role="alert">${esc(error)}</p>` : ""}
        <p>SIGN IN WITH YOUR VATSIM ACCOUNT TO CHECK YOUR ACCESS.</p>
        <p><a class="button" href="/auth/login?return=${encodeURIComponent(returnTo)}">SIGN IN WITH VATSIM</a></p>`,
  );
}

export function deniedPage(page: AccessPage, cid: number, returnTo: string): string {
  return layout(
    "Access denied",
    `        <h2>${esc(PAGE_TITLES[page])}</h2>
        <p class="alert" role="alert">ACCESS DENIED: CID ${cid} DOES NOT HAVE ACCESS TO THE ${esc(PAGE_TITLES[page])}. ASK AN ADMIN FOR ACCESS.</p>
        <p class="dim">GIVE THE ADMIN YOUR CID: ${cid}</p>
        ${signOutForm(returnTo)}`,
  );
}

export function errorPage(message: string, retry?: string): string {
  return layout(
    "Sign-in problem",
    `        <p class="alert" role="alert">${esc(message)}</p>
        ${retry ? `<p><a class="button" href="${esc(retry)}">TRY AGAIN</a></p>` : ""}`,
  );
}

export function noBuildPage(which: string): string {
  return layout(
    "Not built",
    `        <p class="alert" role="alert">THE ${esc(which)} SITE HAS NOT BEEN BUILT ON THIS SERVER.</p>
        <p class="dim">RUN <code>npm run build:sites</code> AND RELOAD.</p>`,
  );
}
