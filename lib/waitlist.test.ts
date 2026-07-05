import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    contacts = { create: createMock };
  },
}));

import { isValidEmail, addWaitlistContact } from "@/lib/waitlist";

beforeEach(() => {
  createMock.mockReset();
  process.env.RESEND_API_KEY = "re_test_key";
});

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("owner@studio.com")).toBe(true);
  });
  it("accepts an address with surrounding whitespace", () => {
    expect(isValidEmail("  owner@studio.com  ")).toBe(true);
  });
  it("rejects garbage", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
  });
});

describe("addWaitlistContact", () => {
  it("creates a Resend contact with the trimmed, lowercased email", async () => {
    createMock.mockResolvedValue({ data: { id: "c_1" }, error: null });
    const result = await addWaitlistContact("  Owner@Studio.COM ");
    expect(result).toEqual({ ok: true });
    expect(createMock).toHaveBeenCalledExactlyOnceWith({ email: "owner@studio.com" });
  });

  it("returns invalid_email without calling Resend", async () => {
    const result = await addWaitlistContact("nope");
    expect(result).toEqual({ ok: false, reason: "invalid_email" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("treats an already-existing contact as success", async () => {
    createMock.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Contact already exists" },
    });
    const result = await addWaitlistContact("owner@studio.com");
    expect(result).toEqual({ ok: true });
  });

  it("maps other API errors to api_error", async () => {
    createMock.mockResolvedValue({
      data: null,
      error: { name: "internal_server_error", message: "boom" },
    });
    const result = await addWaitlistContact("owner@studio.com");
    expect(result).toEqual({ ok: false, reason: "api_error" });
  });

  it("returns api_error when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    const result = await addWaitlistContact("owner@studio.com");
    expect(result).toEqual({ ok: false, reason: "api_error" });
    expect(createMock).not.toHaveBeenCalled();
  });
});
