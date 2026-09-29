import { here, useAccount } from "../auth/useMe";

/** True on the development site, which the server serves at /dev/. */
function onDevSite(base: string = import.meta.env.BASE_URL): boolean {
  return /\/dev\/$/.test(base);
}

/**
 * VATSIM sign-in at the right end of the toolbar, when the Express server (server/) serves
 * the page. Signed in, it shows the CID and buttons for the pages that CID may open: the
 * development site (or back to the live site from it) and the admin page.
 */
export function AccountButtons() {
  const account = useAccount();
  if (account.kind === "none") return null;

  if (account.kind === "signed-out") {
    return (
      <span className="eram-tb-account">
        <a
          className="eram-tb-btn"
          href={`/auth/login?return=${here()}`}
          title="Sign in with your VATSIM account"
        >
          SIGN IN
        </a>
      </span>
    );
  }

  const { me } = account;
  const dev = onDevSite();
  return (
    <span className="eram-tb-account">
      <span className="eram-tb-readout" title={me.name ? `Signed in as ${me.name}` : undefined}>
        CID {me.cid}
      </span>
      {dev ? (
        <a className="eram-tb-btn" href="/" title="Go to the live site">
          LIVE
        </a>
      ) : (
        me.pages.dev && (
          <a className="eram-tb-btn" href="/dev/" title="Go to the development site">
            DEV
          </a>
        )
      )}
      {me.pages.admin && (
        <a className="eram-tb-btn" href="/admin/" title="Edit who can open the development site">
          ADMIN
        </a>
      )}
      <form method="post" action={`/auth/logout?return=${dev ? "%2F" : here()}`}>
        <button type="submit" className="eram-tb-btn">
          SIGN OUT
        </button>
      </form>
    </span>
  );
}
