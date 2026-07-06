import { describe, it, expect } from "vitest";
import { renderTestEmail, renderOwnerBookingRequest, renderRenterRequestReceived } from "@/lib/email";

describe("email rendering", () => {
  it("renders the test template to HTML containing the name", async () => {
    const html = await renderTestEmail({ name: "Trent" });
    expect(html).toContain("VenueDash");
    expect(html).toContain("Trent");
    expect(html).toContain("<html");
  });
});

describe("booking emails", () => {
  it("owner email includes renter, event, and dashboard link", async () => {
    const html = await renderOwnerBookingRequest({
      studioName: "Westview Studio", renterName: "Maya Reeves", eventType: "Birthday celebration",
      when: "Sat, Jul 18, 6:00 PM – 10:00 PM", headcount: 25, byob: true, outsideVendors: false,
      notes: "Balloon arch", dashboardUrl: "https://venuedash.example/dashboard",
    });
    expect(html).toContain("Maya Reeves");
    expect(html).toContain("Birthday celebration");
    expect(html).toContain("https://venuedash.example/dashboard");
  });

  it("renter email includes the status link and studio name", async () => {
    const html = await renderRenterRequestReceived({
      studioName: "Westview Studio", when: "Sat, Jul 18, 6:00 PM – 10:00 PM",
      statusUrl: "https://venuedash.example/status/abc",
    });
    expect(html).toContain("Westview Studio");
    expect(html).toContain("https://venuedash.example/status/abc");
  });
});
