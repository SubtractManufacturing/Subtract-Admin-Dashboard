import { describe, expect, it } from "vitest";

import {
  chooseCopyStrategy,
  MAX_SERVER_SIDE_COPY_BYTES,
  sharesStorageAccount,
} from "./copy-strategy";

const APP = {
  endpoint: "https://project.supabase.co/storage/v1/s3",
  region: "us-east-1",
  accessKeyId: "key-a",
};

describe("sharesStorageAccount", () => {
  it("matches the same endpoint, region, and access key", () => {
    expect(
      sharesStorageAccount(APP, { ...APP, endpoint: `${APP.endpoint.toUpperCase()}/` }),
    ).toBe(true);
  });

  it("treats two unset endpoints (AWS) as the same endpoint", () => {
    expect(
      sharesStorageAccount(
        { region: "us-west-2", accessKeyId: "key-a" },
        { endpoint: "", region: "us-west-2", accessKeyId: "key-a" },
      ),
    ).toBe(true);
  });

  it.each([
    ["a different endpoint", { endpoint: "https://other.example.com" }],
    ["a different region", { region: "eu-west-1" }],
    ["a different access key", { accessKeyId: "key-b" }],
    ["a missing access key", { accessKeyId: "" }],
  ])("does not match %s", (_label, override) => {
    expect(sharesStorageAccount(APP, { ...APP, ...override })).toBe(false);
  });
});

describe("chooseCopyStrategy", () => {
  it("uses a server-side copy within one account for objects up to 5 GiB", () => {
    expect(
      chooseCopyStrategy({ sameAccount: true, sizeBytes: MAX_SERVER_SIDE_COPY_BYTES }),
    ).toBe("server_side");
  });

  it("streams objects larger than a single CopyObject request allows", () => {
    expect(
      chooseCopyStrategy({
        sameAccount: true,
        sizeBytes: MAX_SERVER_SIDE_COPY_BYTES + 1,
      }),
    ).toBe("stream");
  });

  it("streams between different accounts or providers", () => {
    expect(chooseCopyStrategy({ sameAccount: false, sizeBytes: 1 })).toBe("stream");
  });
});
