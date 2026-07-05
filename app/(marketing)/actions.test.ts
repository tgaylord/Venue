import { describe, it, expect, vi, beforeEach } from "vitest";

const { addMock } = vi.hoisted(() => {
  return {
    addMock: vi.fn(),
  };
});

vi.mock("@/lib/waitlist", () => ({
  addWaitlistContact: addMock,
}));

import { joinWaitlist, type WaitlistFormState } from "@/app/(marketing)/actions";

const idle: WaitlistFormState = { status: "idle", message: "" };

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => addMock.mockReset());

describe("joinWaitlist", () => {
  it("returns success and never calls Resend when the honeypot is filled", async () => {
    const state = await joinWaitlist(idle, form({ email: "bot@spam.com", company: "Bot Inc" }));
    expect(state.status).toBe("success");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("returns success when the contact is added", async () => {
    addMock.mockResolvedValue({ ok: true });
    const state = await joinWaitlist(idle, form({ email: "owner@studio.com", company: "" }));
    expect(state.status).toBe("success");
    expect(state.message).toMatch(/on the list/i);
    expect(addMock).toHaveBeenCalledExactlyOnceWith("owner@studio.com");
  });

  it("surfaces an invalid email as a field error", async () => {
    addMock.mockResolvedValue({ ok: false, reason: "invalid_email" });
    const state = await joinWaitlist(idle, form({ email: "nope", company: "" }));
    expect(state.status).toBe("error");
    expect(state.message).toMatch(/email address/i);
  });

  it("gives a mailto fallback on API failure", async () => {
    addMock.mockResolvedValue({ ok: false, reason: "api_error" });
    const state = await joinWaitlist(idle, form({ email: "owner@studio.com", company: "" }));
    expect(state.status).toBe("error");
    expect(state.message).toContain("tgaylord2024@gmail.com");
  });
});
