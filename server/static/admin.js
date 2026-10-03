// The admin page (/admin/): edits which CIDs may open each access-controlled page.
// Plain browser JavaScript so it ships with the server, not with either site build.
// The server only serves /admin/ to admins; /api/access checks again on every call.

/** @typedef {"admin"} AccessPage */
/** @typedef {Record<AccessPage, number[]>} Lists */

/** @type {AccessPage[]} */
const PAGES = ["admin"];

const TITLES = { admin: "ADMIN PAGE" };

const NOTES = {
  admin: "CIDS THAT MAY OPEN THIS PAGE AND EDIT THESE LISTS. ADMINS CAN OPEN EVERY PAGE.",
};

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {{ cid: number } | null} */
let me = null;
/** @type {{ pages: Lists, superadmins: number[], version: number, updatedAt: string | null, updatedBy: number | null } | null} */
let loaded = null;
/** @type {Lists | null} */
let draft = null;
let saving = false;

/** A VATSIM CID: a positive whole number of at most 8 digits. */
function isCid(/** @type {number} */ n) {
  return Number.isInteger(n) && n > 0 && n <= 99_999_999;
}

/** CIDs typed or pasted in, separated by spaces, commas, semicolons or newlines. */
function parseCids(/** @type {string} */ text) {
  /** @type {number[]} */
  const cids = [];
  /** @type {string[]} */
  const invalid = [];
  for (const tok of text.split(/[\s,;]+/).filter(Boolean)) {
    const n = /^\d+$/.test(tok) ? Number(tok) : NaN;
    if (isCid(n)) cids.push(n);
    else invalid.push(tok);
  }
  return { cids, invalid };
}

function sameLists(/** @type {Lists} */ a, /** @type {Lists} */ b) {
  return PAGES.every((p) => a[p].length === b[p].length && a[p].every((c, i) => c === b[p][i]));
}

/** @param {string} tag @param {Record<string, string>} [attrs] @param {(Node | string)[]} [kids] */
function el(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

function setStatus(/** @type {string} */ text, error = false) {
  const s = $("status");
  s.textContent = text;
  s.className = error ? "alert" : "";
}

async function call(/** @type {string} */ method, /** @type {unknown} */ body) {
  const res = await fetch("/api/access", {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

function renderPage(/** @type {AccessPage} */ page) {
  if (!loaded || !draft) return el("section");
  const cids = draft[page];
  const locked = page === "admin" ? loaded.superadmins : [];
  const list = el("ul");
  for (const cid of locked) {
    list.append(
      el("li", {}, [
        el("span", { class: "cid" }, [String(cid)]),
        el("span", { class: "dim" }, ["BUILT-IN ADMIN"]),
      ]),
    );
  }
  for (const cid of cids) {
    const remove = el("button", { type: "button" }, ["REMOVE"]);
    remove.addEventListener("click", () => {
      if (!draft) return;
      draft = { ...draft, [page]: draft[page].filter((c) => c !== cid) };
      render();
    });
    list.append(el("li", {}, [el("span", { class: "cid" }, [String(cid)]), remove]));
  }
  if (cids.length === 0 && locked.length === 0)
    list.append(el("li", { class: "dim" }, ["NO CIDS"]));

  const input = /** @type {HTMLInputElement} */ (
    el("input", {
      inputmode: "numeric",
      placeholder: "1234567",
      "aria-label": `Add CIDs to ${TITLES[page]}`,
    })
  );
  const bad = el("p", { class: "alert", hidden: "" });
  const form = el("form", {}, [
    el("label", {}, ["ADD CID ", input]),
    el("button", { type: "submit" }, ["ADD"]),
  ]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!draft) return;
    const parsed = parseCids(input.value);
    if (parsed.cids.length) {
      draft = {
        ...draft,
        [page]: [...new Set([...draft[page], ...parsed.cids])].sort((a, b) => a - b),
      };
      render();
      // render() replaced this section; carry the leftovers into the new one.
      const again = /** @type {HTMLInputElement | null} */ (
        document.querySelector(`#page-${page} input`)
      );
      if (again) {
        again.value = parsed.invalid.join(" ");
        again.focus();
      }
    }
    const shown = /** @type {HTMLElement | null} */ (
      document.querySelector(`#page-${page} p.alert`)
    );
    if (shown) {
      shown.hidden = parsed.invalid.length === 0;
      shown.textContent = `NOT A CID: ${parsed.invalid.join(" ")}`;
    }
  });

  return el(
    "section",
    { class: "admin-page", id: `page-${page}`, "aria-labelledby": `h-${page}` },
    [
      el("h2", { id: `h-${page}` }, [TITLES[page]]),
      el("p", { class: "dim" }, [NOTES[page]]),
      list,
      form,
      bad,
    ],
  );
}

function render() {
  if (!loaded || !draft) return;
  $("info").textContent =
    (loaded.updatedAt
      ? `LAST CHANGED ${loaded.updatedAt.replace("T", " ").slice(0, 16)}Z BY CID ${loaded.updatedBy}.`
      : "NO CHANGES SAVED YET.") + " CHANGES APPLY ON THE NEXT PAGE LOAD.";
  $("pages").replaceChildren(...PAGES.map(renderPage));
  const dirty = !sameLists(draft, loaded.pages);
  $("actions").hidden = false;
  /** @type {HTMLButtonElement} */ ($("save")).disabled = !dirty || saving;
  /** @type {HTMLButtonElement} */ ($("save")).textContent = saving ? "SAVING…" : "SAVE CHANGES";
  /** @type {HTMLButtonElement} */ ($("discard")).disabled = saving;
  $("dirty").hidden = !dirty;
}

async function save() {
  if (!loaded || !draft) return;
  const removesSelf =
    me !== null &&
    !loaded.superadmins.includes(me.cid) &&
    loaded.pages.admin.includes(me.cid) &&
    !draft.admin.includes(me.cid);
  if (removesSelf && !window.confirm("YOU ARE REMOVING YOUR OWN ADMIN ACCESS. SAVE ANYWAY?"))
    return;
  saving = true;
  setStatus("");
  render();
  try {
    const { res, json } = await call("PUT", { pages: draft, baseVersion: loaded.version });
    if (res.ok) {
      loaded = json;
      draft = json.pages;
      setStatus("SAVED.");
    } else if (res.status === 409) {
      if (json?.current) loaded = json.current;
      setStatus(
        "ANOTHER ADMIN CHANGED THE LISTS SINCE YOU LOADED THEM. DISCARD TO SEE THEIR VERSION, THEN MAKE YOUR CHANGES AGAIN.",
        true,
      );
    } else {
      setStatus(`NOT SAVED: ${json?.error ?? `HTTP ${res.status}`}`, true);
    }
  } catch (e) {
    setStatus(`NOT SAVED: ${String(e)}`, true);
  } finally {
    saving = false;
    render();
  }
}

async function start() {
  $("save").addEventListener("click", save);
  $("discard").addEventListener("click", () => {
    if (!loaded) return;
    draft = loaded.pages;
    setStatus("");
    render();
  });
  try {
    const meRes = await fetch("/api/me");
    if (meRes.ok) {
      me = await meRes.json();
      $("who").textContent = `SIGNED IN AS CID ${me?.cid} `;
    }
    const { res, json } = await call("GET");
    if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
    loaded = json;
    draft = json.pages;
    render();
  } catch (e) {
    $("info").textContent =
      `COULD NOT LOAD THE LISTS: ${String(e instanceof Error ? e.message : e)}`;
    $("info").className = "alert";
  }
}

start();
