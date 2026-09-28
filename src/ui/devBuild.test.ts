import { describe, expect, it } from "vitest";
import { isDevBuild } from "./devBuild";

describe("isDevBuild", () => {
  it("only a production build from main is not a development build", () => {
    expect(isDevBuild(false, "main")).toBe(false);
    expect(isDevBuild(false, "development")).toBe(true);
    expect(isDevBuild(false, "unknown")).toBe(true);
    expect(isDevBuild(true, "main")).toBe(true); // the dev server, whatever the branch
  });
});
