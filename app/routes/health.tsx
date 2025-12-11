import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";

export const loader: LoaderFunction = async () => {
  return json(
    {
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "subtract-frontend",
      version: process.env.RELEASE_VERSION || "Unable to load version",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    }
  );
};
