import { describe, expect, it } from "vitest";
import { escapeHtml, filterRows, statusAction } from "./admin.js";

describe("admin page helpers", () => {
  it("filters users and devices by searchable fields", () => {
    const items = [
      { id: "user-1", email: "alice@example.com", name: "Research PC", status: "active" },
      { id: "device-2", email: "bob@example.com", name: "Office Laptop", status: "disabled" },
    ];

    expect(filterRows(items, "alice")).toHaveLength(1);
    expect(filterRows(items, "office")).toHaveLength(1);
    expect(filterRows(items, "disabled")[0].id).toBe("device-2");
    expect(filterRows(items, "")).toHaveLength(2);
  });

  it("renders escaped status actions with the next target state", () => {
    const html = statusAction({ id: "user<'&", status: "active" }, "user");

    expect(html).toContain("data-status-kind=\"user\"");
    expect(html).toContain("data-status-next=\"disabled\"");
    expect(html).toContain(`data-status-target=\"${escapeHtml("user<'&")}\"`);
    expect(html).toContain("禁用");
    expect(html).not.toContain("<user");
  });

  it("renders an enable action for disabled rows", () => {
    expect(statusAction({ id: "device-1", status: "disabled" }, "device")).toContain("data-status-next=\"active\"");
  });
});
