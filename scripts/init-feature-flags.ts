import { initializeFeatureFlags } from "../app/lib/featureFlags";

async function init() {
  try {
    console.log("Initializing feature flags...");
    await initializeFeatureFlags();
    console.log("Feature flags initialized successfully!");
  } catch (error) {
    console.error("Failed to initialize feature flags:", error);
    process.exit(1);
  }
  process.exit(0);
}

init();