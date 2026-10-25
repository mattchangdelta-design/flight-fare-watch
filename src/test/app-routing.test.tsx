import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";

import { routes } from "@/routes";

// Match routes without rendering: pages touch Supabase, which the test run lacks.
const leafPath = (url: string) => matchRoutes(routes, url)?.at(-1)?.route.path;

describe("App routing", () => {
  it.each(["/", "/signin", "/signup", "/app"])(
    "matches a page for %s instead of not found",
    (url) => {
      expect(leafPath(url)).toBe(url);
    },
  );

  it("falls back to the not-found page for unknown paths", () => {
    expect(leafPath("/does-not-exist")).toBe("*");
  });
});
