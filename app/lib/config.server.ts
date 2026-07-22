import packageJson from "../../package.json";
import { getEnv } from "./env.server";

function formatVersion(raw: string): string {
  return raw.startsWith("v") ? raw : `v${raw}`;
}

export function getAppConfig() {
  const rawVersion = getEnv("RELEASE_VERSION") || packageJson.version;
  return {
    // Use RELEASE_VERSION env var in production, fallback to package.json for local development
    version: formatVersion(rawVersion),
    // Environment based on NODE_ENV
    environment: process.env.NODE_ENV === "production" ? "Production" : "Development",
  };
}