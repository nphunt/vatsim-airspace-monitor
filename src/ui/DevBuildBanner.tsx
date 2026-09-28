import { isDevBuild } from "./devBuild";

/** A standing notice under the toolbar on development builds; nothing on main. */
export function DevBuildBanner() {
  if (!isDevBuild()) return null;
  return (
    <p className="eram-dev-banner" role="note">
      DEVELOPMENT BUILD ({__BUILD_BRANCH__} {__BUILD_ID__}): NEW FEATURES ARE BEING TESTED, SOME
      THINGS MAY BREAK
    </p>
  );
}
