import type { S3Client } from "@aws-sdk/client-s3";

import { getEnv, requireEnv } from "../env.server";
import { createS3Client } from "../s3.server";

export type IntakeS3Config = {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

/**
 * The intake bucket is the drop box WordPress writes to. It has its own endpoint,
 * region, credentials, and bucket so it can live in a different account or
 * provider than the application bucket.
 */
export function getIntakeS3Config(): IntakeS3Config {
  return {
    endpoint: getEnv("INTAKE_S3_ENDPOINT") || undefined,
    region: getEnv("INTAKE_S3_REGION") || "us-east-1",
    accessKeyId: requireEnv("INTAKE_S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("INTAKE_S3_SECRET_ACCESS_KEY"),
    bucket: requireEnv("INTAKE_S3_BUCKET"),
  };
}

let intakeClient: S3Client | null = null;

export function getIntakeS3Client(): S3Client {
  if (!intakeClient) {
    intakeClient = createS3Client(getIntakeS3Config());
  }
  return intakeClient;
}
