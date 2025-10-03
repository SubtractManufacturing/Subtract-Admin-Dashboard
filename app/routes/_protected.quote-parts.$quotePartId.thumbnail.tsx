import { ActionFunctionArgs, json } from "@remix-run/node";
import { db } from "~/lib/db";
import { quoteParts } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { uploadFile } from "~/lib/s3.server";
import { requireAuth } from "~/lib/auth.server";

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAuth(request);

  const { quotePartId } = params;
  if (!quotePartId) {
    return json({ error: "Quote part ID is required" }, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return json({ error: "No file provided" }, { status: 400 });
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate S3 key for the thumbnail
    const timestamp = Date.now();
    const key = `quote-parts/${quotePartId}/thumbnails/${timestamp}-thumbnail.png`;

    // Upload to S3
    const uploadResult = await uploadFile({
      key,
      buffer,
      contentType: file.type || 'image/png',
      fileName: `${quotePartId}-thumbnail.png`
    });

    // Store just the S3 key (not a full URL)
    // The loader will generate signed URLs when needed
    await db
      .update(quoteParts)
      .set({ thumbnailUrl: uploadResult.key, updatedAt: new Date() })
      .where(eq(quoteParts.id, quotePartId));

    return json({ success: true, thumbnailUrl: uploadResult.key });
  } catch (error) {
    console.error("Error uploading quote part thumbnail:", error);
    return json({ error: "Failed to upload thumbnail" }, { status: 500 });
  }
}
