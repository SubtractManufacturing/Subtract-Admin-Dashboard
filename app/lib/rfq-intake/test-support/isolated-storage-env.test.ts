import { describe, expect, it } from "vitest";

import { exactEnv, resolveIsolatedStorageConfig } from "./isolated-storage-env";

const VALID = {
  RFQ_STORAGE_TEST_ENDPOINT: "http://localhost:9090",
  RFQ_STORAGE_TEST_ACCESS_KEY_ID: "test",
  RFQ_STORAGE_TEST_SECRET_ACCESS_KEY: "test",
  RFQ_STORAGE_TEST_APP_BUCKET: "rfq-contract",
  RFQ_STORAGE_TEST_INTAKE_BUCKET: "rfq-intake-contract",
};

describe("resolveIsolatedStorageConfig", () => {
  it("accepts a fully configured local endpoint", () => {
    expect(resolveIsolatedStorageConfig(VALID)).toMatchObject({
      endpoint: "http://localhost:9090",
      appBucket: "rfq-contract",
      region: "us-east-1",
    });
  });

  it("refuses to run when nothing is configured, even with S3 settings present", () => {
    expect(() =>
      resolveIsolatedStorageConfig({
        S3_ENDPOINT: "https://real.example.com",
        S3_ACCESS_KEY_ID: "real",
        S3_SECRET_ACCESS_KEY: "real",
        S3_BUCKET: "real",
      }),
    ).toThrow(/refused to run/);
  });

  it("names every missing variable", () => {
    expect(() =>
      resolveIsolatedStorageConfig({ ...VALID, RFQ_STORAGE_TEST_APP_BUCKET: undefined }),
    ).toThrow(
      /RFQ_STORAGE_TEST_APP_BUCKET/,
    );
  });

  it.each([
    "https://abc.supabase.co/storage/v1/s3",
    "https://s3.us-east-2.amazonaws.com",
  ])("refuses the remote endpoint %s", (endpoint) => {
    expect(() =>
      resolveIsolatedStorageConfig({ ...VALID, RFQ_STORAGE_TEST_ENDPOINT: endpoint }),
    ).toThrow(/not a local endpoint/);
  });

  it("refuses a shared bucket", () => {
    expect(() =>
      resolveIsolatedStorageConfig({
        ...VALID,
        RFQ_STORAGE_TEST_INTAKE_BUCKET: VALID.RFQ_STORAGE_TEST_APP_BUCKET,
      }),
    ).toThrow(/must differ/);
  });
});

describe("exactEnv", () => {
  it("ignores a differently cased key, as Windows process.env would not", () => {
    expect(exactEnv("S3_ENDPOINT", { S3_Endpoint: "https://real.example.com" })).toBe(
      undefined,
    );
    expect(exactEnv("S3_ENDPOINT", { S3_ENDPOINT: "http://localhost:9090" })).toBe(
      "http://localhost:9090",
    );
  });

  it("treats a blank value as unset", () => {
    expect(exactEnv("NAME", { NAME: "  " })).toBeUndefined();
  });
});
