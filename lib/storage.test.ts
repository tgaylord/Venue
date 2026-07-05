import { describe, it, expect, beforeAll } from "vitest";
import { getSignedUploadUrl, getSignedDownloadUrl } from "@/lib/storage";

beforeAll(() => {
  process.env.R2_ACCOUNT_ID = "test-account";
  process.env.R2_ACCESS_KEY_ID = "test-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret";
  process.env.R2_BUCKET = "venue-photos";
});

describe("storage signed URLs", () => {
  it("produces an upload URL for a key against the R2 endpoint", async () => {
    const url = await getSignedUploadUrl("studios/s1/bookings/b1/pre/item1.jpg", "image/jpeg");
    expect(url).toContain("test-account.r2.cloudflarestorage.com");
    expect(url).toContain("venue-photos");
    expect(url).toContain("item1.jpg");
    expect(url).toContain("X-Amz-Signature");
  });

  it("produces a download URL for a key", async () => {
    const url = await getSignedDownloadUrl("studios/s1/bookings/b1/post/item2.jpg");
    expect(url).toContain("item2.jpg");
    expect(url).toContain("X-Amz-Expires");
  });
});
