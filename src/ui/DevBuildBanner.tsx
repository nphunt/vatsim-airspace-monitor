import { signOut } from "../auth/authClient";
import { useMe } from "../auth/meContext";
import { isDevBuild } from "./devBuild";

/** A standing notice under the toolbar on development builds; nothing on main. */
export function DevBuildBanner() {
  const me = useMe();
  if (!isDevBuild()) return null;
  return (
    <p className="eram-dev-banner" role="note">
      DEVELOPMENT BUILD ({__BUILD_BRANCH__} {__BUILD_ID__}): NEW FEATURES ARE BEING TESTED, SOME
      THINGS MAY BREAK
      {me && (
        <span className="eram-dev-user">
          CID {me.cid}
          {me.pages.admin && <a href={`${import.meta.env.BASE_URL}admin/`}>ADMIN</a>}
          <button type="button" onClick={signOut}>
            SIGN OUT
          </button>
        </span>
      )}
    </p>
  );
}
