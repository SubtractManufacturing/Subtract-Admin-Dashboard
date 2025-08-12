import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { getDownloadUrl } from "~/lib/s3.server";
import { requireAuth } from "~/lib/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAuth(request);

  // The splat parameter (*) captures everything after /attachments/s3/
  const s3Key = params["*"];
  if (!s3Key) {
    throw new Response("S3 key is required", { status: 400 });
  }

  try {
    // Generate a presigned URL for the S3 object
    const downloadUrl = await getDownloadUrl(s3Key);

    // Redirect to the presigned URL
    return redirect(downloadUrl);
  } catch (error) {
    console.error('S3 download error:', error);
    throw new Response("Failed to generate download URL", { status: 500 });
  }
}