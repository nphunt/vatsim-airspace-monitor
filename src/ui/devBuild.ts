/**
 * True for a development build: the dev server, or a production build made from any
 * branch but main (only main is deployed to GitHub Pages as the real site).
 */
export function isDevBuild(
  dev: boolean = import.meta.env.DEV,
  branch: string = __BUILD_BRANCH__,
): boolean {
  return dev || branch !== "main";
}
