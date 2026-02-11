import packageJson from "../../package.json";

function formatVersion(raw: string): string {
  return raw.startsWith("v") ? raw : `v${raw}`;
}

export function getAppConfig() {
  const rawVersion = process.env.RELEASE_VERSION || packageJson.version;
  return {
    // Use RELEASE_VERSION env var in production, fallback to package.json for local development
    version: formatVersion(rawVersion),
    // Environment based on NODE_ENV
    environment: process.env.NODE_ENV === "production" ? "Production" : "Development",
  };
}