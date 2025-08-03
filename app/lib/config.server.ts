import packageJson from "../../package.json";

export function getAppConfig() {
  return {
    version: packageJson.version,
    isStaging: process.env.STAGING === "true",
  };
}