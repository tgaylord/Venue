import { describe, it, expect } from "vitest";
import { renderTestEmail } from "@/lib/email";

describe("email rendering", () => {
  it("renders the test template to HTML containing the name", async () => {
    const html = await renderTestEmail({ name: "Trent" });
    expect(html).toContain("VenueDash");
    expect(html).toContain("Trent");
    expect(html).toContain("<html");
  });
});
