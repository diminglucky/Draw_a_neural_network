import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("draft revision Visio export retirement", () => {
  const apps = new Set<ReturnType<typeof buildApp>>();

  afterEach(async () => {
    for (const app of apps) await app.close();
    apps.clear();
  });

  it("does not expose a draft-revision native export route", async () => {
    const app = buildApp();
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/figure-drafts/draft-structural/revisions/1/visio-exports",
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });
});
