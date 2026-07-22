import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getEnv } from "~/lib/env.server";

export const loader: LoaderFunction = async () => {
  return json(
    {
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "subtract-frontend",
      version: getEnv("RELEASE_VERSION") || "Unable to load version",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    }
  );
};
