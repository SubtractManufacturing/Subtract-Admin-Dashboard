import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/lib/db/index.js";
import { parts } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDownloadUrl } from "~/lib/s3.server";

export const loader: LoaderFunction = async ({ params }) => {
  const partId = params.partId;

  if (!partId) {
    return json({ error: "Part ID is required" }, { status: 400 });
  }

  try {
    // Get the part from database
    const [part] = await db
      .select()
      .from(parts)
      .where(eq(parts.id, partId))
      .limit(1);

    if (!part) {
      return json({ error: "Part not found" }, { status: 404 });
    }

    if (!part.partMeshUrl) {
      return json({ error: "Part has no mesh file" }, { status: 404 });
    }

    // Extract the S3 key from the mesh URL
    let key: string;
    const meshUrl = part.partMeshUrl;
    
    // Handle different URL formats
    if (meshUrl.includes("/storage/v1/")) {
      // Supabase storage URL format
      const parts = meshUrl.split("/storage/v1/s3/");
      if (parts[1]) {
        const bucketAndKey = parts[1];
        // Remove bucket name (testing-bucket/) to get the key
        key = bucketAndKey.replace(/^[^/]+\//, "");
      } else {
        return json({ error: "Invalid mesh URL format" }, { status: 500 });
      }
    } else if (meshUrl.includes("parts/") && meshUrl.includes("/mesh/")) {
      // Direct S3 key format
      const urlParts = meshUrl.split("/");
      const partsIndex = urlParts.indexOf("parts");
      if (partsIndex >= 0) {
        key = urlParts.slice(partsIndex).join("/");
      } else {
        key = meshUrl;
      }
    } else {
      // Try to extract key from full URL
      const urlParts = meshUrl.split("/");
      const partsIndex = urlParts.findIndex(p => p === "parts");
      if (partsIndex >= 0) {
        key = urlParts.slice(partsIndex).join("/");
      } else {
        return json({ error: "Cannot extract key from mesh URL" }, { status: 500 });
      }
    }

    // Generate a signed URL for the mesh file
    const signedUrl = await getDownloadUrl(key, 3600); // 1 hour expiry

    // Return the signed URL
    return json({ url: signedUrl });
  } catch (error) {
    console.error("Error getting mesh URL:", error);
    return json(
      { error: "Failed to generate mesh URL" },
      { status: 500 }
    );
  }
};