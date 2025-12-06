import packageJson from "../../package.json";

export function getAppConfig() {
  return {
    // Use RELEASE_VERSION env var in production, fallback to package.json for local development
    version: process.env.RELEASE_VERSION || packageJson.version,
    isStaging: process.env.STAGING === "true",
  };
}