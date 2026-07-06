import { describe, it, expect } from "vitest";
import { parseKind, isInAppWebview, sha256Hex } from "@/lib/capture";

describe("parseKind", () => {
  it("accepts pre/post, rejects others", () => {
    expect(parseKind("pre")).toBe("pre");
    expect(parseKind("post")).toBe("post");
    expect(parseKind("PRE")).toBeNull();
    expect(parseKind("x")).toBeNull();
  });
});

describe("isInAppWebview", () => {
  it("flags known in-app browsers", () => {
    expect(isInAppWebview("Mozilla/5.0 ... [FBAN/FBIOS;FBAV/...]")).toBe(true);
    expect(isInAppWebview("Mozilla/5.0 ... Instagram 300.0")).toBe(true);
    expect(isInAppWebview("Mozilla/5.0 ... GmailApp")).toBe(true);
  });
  it("passes real Safari/Chrome", () => {
    expect(isInAppWebview("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605 Version/17.0 Mobile/15E148 Safari/604.1")).toBe(false);
  });
});

describe("sha256Hex", () => {
  it("hashes known bytes (empty → e3b0c442...)", async () => {
    const hex = await sha256Hex(new Uint8Array([]).buffer);
    expect(hex).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
