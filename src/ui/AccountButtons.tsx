import { here, useAccount } from "../auth/useMe";

/**
 * VATSIM sign-in at the right end of the toolbar, when the Express server (server/) serves
 * the page. Signed in, it shows the CID and, for admins, a button to the admin page.
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
  return (
    <span className="eram-tb-account">
      <span className="eram-tb-readout" title={me.name ? `Signed in as ${me.name}` : undefined}>
        CID {me.cid}
      </span>
      {me.pages.admin && (
        <a className="eram-tb-btn" href="/admin/" title="Edit who can open the admin page">
          ADMIN
        </a>
      )}
      <a
        className="eram-tb-btn"
        href={`/auth/login?switch=1&return=${here()}`}
        title="Sign in with a different VATSIM CID"
      >
        SWITCH
      </a>
      <form method="post" action={`/auth/logout?return=${here()}`}>
        <button type="submit" className="eram-tb-btn">
          SIGN OUT
        </button>
      </form>
    </span>
  );
}
