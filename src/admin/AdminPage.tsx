import { useEffect, useState } from "react";
import {
  ACCESS_PAGES,
  PAGE_TITLES,
  type AccessPage,
  type AccessResponse,
} from "../../auth-worker/src/pages";
import { useMe } from "../auth/meContext";
import { parseCids } from "../auth/access";
import { AuthError, fetchAccess, saveAccess, signOut } from "../auth/authClient";

type Lists = Record<AccessPage, number[]>;

const PAGE_NOTES: Record<AccessPage, string> = {
  dev: "CIDS THAT MAY OPEN THE DEVELOPMENT SITE. ADMINS ALWAYS CAN.",
  admin: "CIDS THAT MAY OPEN THIS PAGE AND EDIT THESE LISTS. ADMINS CAN OPEN EVERY PAGE.",
};

function sameLists(a: Lists, b: Lists): boolean {
  return ACCESS_PAGES.every(
    (p) => a[p].length === b[p].length && a[p].every((cid, i) => cid === b[p][i]),
  );
}

function PageList({
  page,
  cids,
  locked,
  onChange,
}: {
  page: AccessPage;
  cids: number[];
  locked: number[];
  onChange: (cids: number[]) => void;
}) {
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState<string[]>([]);

  const add = () => {
    const parsed = parseCids(input);
    setInvalid(parsed.invalid);
    if (parsed.cids.length === 0) return;
    onChange([...new Set([...cids, ...parsed.cids])].sort((a, b) => a - b));
    setInput(parsed.invalid.join(" "));
  };

  return (
    <section className="eram-admin-page" aria-labelledby={`admin-${page}`}>
      <h2 id={`admin-${page}`}>{PAGE_TITLES[page]}</h2>
      <p className="dim">{PAGE_NOTES[page]}</p>
      <ul>
        {locked.map((cid) => (
          <li key={`locked-${cid}`}>
            <span className="cid">{cid}</span>
            <span className="dim">BUILT-IN ADMIN</span>
          </li>
        ))}
        {cids.map((cid) => (
          <li key={cid}>
            <span className="cid">{cid}</span>
            <button type="button" onClick={() => onChange(cids.filter((c) => c !== cid))}>
              REMOVE
            </button>
          </li>
        ))}
        {cids.length === 0 && locked.length === 0 && <li className="dim">NO CIDS</li>}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label>
          ADD CID{" "}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            inputMode="numeric"
            placeholder="1234567"
            aria-label={`Add CIDs to ${PAGE_TITLES[page]}`}
          />
        </label>
        <button type="submit">ADD</button>
      </form>
      {invalid.length > 0 && <p className="alert">NOT A CID: {invalid.join(" ")}</p>}
    </section>
  );
}

/** Edits which CIDs may open each access-controlled page (admins only; see AccessGate). */
export function AdminPage() {
  const me = useMe();
  const [loaded, setLoaded] = useState<AccessResponse | null>(null);
  const [draft, setDraft] = useState<Lists | null>(null);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const apply = (a: AccessResponse) => {
    setLoaded(a);
    setDraft(a.pages);
  };

  useEffect(() => {
    fetchAccess().then(apply, (e) =>
      setStatus({ error: true, text: `COULD NOT LOAD THE LISTS: ${String(e?.message ?? e)}` }),
    );
  }, []);

  if (!loaded || !draft) {
    return (
      <main className="eram-admin">
        <h1>ACCESS ADMIN</h1>
        <p className={status?.error ? "alert" : "dim"}>{status?.text ?? "LOADING…"}</p>
      </main>
    );
  }

  const dirty = !sameLists(draft, loaded.pages);
  const removesSelf =
    me !== null &&
    !loaded.superadmins.includes(me.cid) &&
    loaded.pages.admin.includes(me.cid) &&
    !draft.admin.includes(me.cid);

  const save = async () => {
    if (removesSelf && !window.confirm("YOU ARE REMOVING YOUR OWN ADMIN ACCESS. SAVE ANYWAY?")) {
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      apply(await saveAccess({ pages: draft, baseVersion: loaded.version }));
      setStatus({ error: false, text: "SAVED." });
    } catch (e) {
      if (e instanceof AuthError && e.status === 409) {
        const current = (e.body as { current?: AccessResponse } | undefined)?.current;
        if (current) setLoaded(current);
        setStatus({
          error: true,
          text: "ANOTHER ADMIN CHANGED THE LISTS SINCE YOU LOADED THEM. DISCARD TO SEE THEIR VERSION, THEN MAKE YOUR CHANGES AGAIN.",
        });
      } else {
        setStatus({ error: true, text: `NOT SAVED: ${String((e as Error)?.message ?? e)}` });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="eram-admin">
      <header>
        <h1>ACCESS ADMIN</h1>
        <span>
          {me && <>SIGNED IN AS CID {me.cid} </>}
          <a href={import.meta.env.BASE_URL}>BACK TO THE SITE</a>{" "}
          <button type="button" onClick={signOut}>
            SIGN OUT
          </button>
        </span>
      </header>
      <p className="dim">
        {loaded.updatedAt
          ? `LAST CHANGED ${loaded.updatedAt.replace("T", " ").slice(0, 16)}Z BY CID ${loaded.updatedBy}.`
          : "NO CHANGES SAVED YET."}{" "}
        CHANGES APPLY THE NEXT TIME SOMEONE LOADS THE PAGE.
      </p>
      {ACCESS_PAGES.map((p) => (
        <PageList
          key={p}
          page={p}
          cids={draft[p]}
          locked={p === "admin" ? loaded.superadmins : []}
          onChange={(cids) => setDraft({ ...draft, [p]: cids })}
        />
      ))}
      <div className="eram-admin-actions">
        <button type="button" disabled={!dirty || saving} onClick={save}>
          {saving ? "SAVING…" : "SAVE CHANGES"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setDraft(loaded.pages);
            setStatus(null);
          }}
        >
          DISCARD
        </button>
        {dirty && <span className="caution">UNSAVED CHANGES</span>}
        {status && (
          <span className={status.error ? "alert" : undefined} role="status">
            {status.text}
          </span>
        )}
      </div>
    </main>
  );
}
