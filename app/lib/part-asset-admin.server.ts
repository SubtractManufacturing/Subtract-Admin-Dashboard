import { json } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { canUsePartAssetAdmin, withAuthHeaders } from "./auth.server";
import { db } from "./db";
import { parts, quoteParts } from "./db/schema";
import { deleteCadVersion, getCadVersionById } from "./cadVersions";
import { getPart } from "./parts";
import {
  deleteQuotePartMesh,
  triggerQuotePartMeshConversion,
} from "./quote-part-mesh-converter.server";
import { deletePartMesh, triggerPartMeshConversion } from "./part-mesh-converter.server";
import {
  deleteQuotePartDrawing,
  deleteOrderPartDrawing,
} from "./technical-drawings.server";
import type { AttachmentEventContext } from "./attachments";
import { PART_ASSET_ADMIN_INTENT } from "./part-asset-admin.shared";

export type PartAssetAdminRoute =
  | { type: "quote"; quoteId: number }
  | { type: "order"; orderId: number; customerId: number | null }
  | { type: "customer"; customerId: number };

type UserBundle = {
  user: { id: string };
  userDetails: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  };
  headers: Headers;
};

async function assertCustomerPart(
  partId: string,
  customerId: number
): Promise<{ ok: true; part: NonNullable<Awaited<ReturnType<typeof getPart>>> } | { ok: false; response: Response }> {
  const part = await getPart(partId);
  if (!part || part.customerId !== customerId) {
    return {
      ok: false,
      response: json({ error: "Part not found" }, { status: 404 }),
    };
  }
  return { ok: true, part };
}

/**
 * If form intent is part asset admin, handle it and return a Response.
 * Otherwise return null so the route can continue its switch.
 */
export async function tryPartAssetAdminAction(
  formData: FormData,
  route: PartAssetAdminRoute,
  bundle: UserBundle
): Promise<Response | null> {
  if (formData.get("intent") !== PART_ASSET_ADMIN_INTENT) {
    return null;
  }

  if (!canUsePartAssetAdmin(bundle.userDetails.role)) {
    return withAuthHeaders(json({ error: "Forbidden" }, { status: 403 }), bundle.headers);
  }

  const operation = formData.get("operation") as string;
  const userId = bundle.user.id;
  const userEmail =
    bundle.userDetails.email || bundle.userDetails.name || "unknown";

  const attachmentCtx: AttachmentEventContext = {
    userId,
    userEmail: bundle.userDetails.email || bundle.userDetails.name || undefined,
  };

  try {
    switch (operation) {
      case "regenerateMesh": {
        if (route.type === "quote") {
          const quotePartId = formData.get("quotePartId") as string;
          if (!quotePartId) {
            return withAuthHeaders(
              json({ error: "quotePartId is required" }, { status: 400 }),
              bundle.headers
            );
          }
          const [qp] = await db
            .select()
            .from(quoteParts)
            .where(eq(quoteParts.id, quotePartId))
            .limit(1);
          if (!qp || qp.quoteId !== route.quoteId) {
            return withAuthHeaders(
              json({ error: "Quote part not found" }, { status: 404 }),
              bundle.headers
            );
          }
          if (!qp.partFileUrl) {
            return withAuthHeaders(
              json(
                { error: "No source file available for conversion" },
                { status: 400 }
              ),
              bundle.headers
            );
          }
          await db
            .update(quoteParts)
            .set({
              conversionStatus: "pending",
              meshConversionError: null,
              updatedAt: new Date(),
            })
            .where(eq(quoteParts.id, quotePartId));

          triggerQuotePartMeshConversion(quotePartId, qp.partFileUrl).catch(
            (err) =>
              console.error(
                `partAssetAdmin regenerateMesh quote part ${quotePartId}:`,
                err
              )
          );
          return withAuthHeaders(json({ success: true }), bundle.headers);
        }

        const partId = formData.get("partId") as string;
        if (!partId) {
          return withAuthHeaders(
            json({ error: "partId is required" }, { status: 400 }),
            bundle.headers
          );
        }
        const customerId =
          route.type === "order" ? route.customerId! : route.customerId;
        if (route.type === "order" && (customerId === null || customerId === undefined)) {
          return withAuthHeaders(
            json({ error: "Order has no customer" }, { status: 400 }),
            bundle.headers
          );
        }
        const check = await assertCustomerPart(partId, customerId as number);
        if (!check.ok) {
          return withAuthHeaders(check.response, bundle.headers);
        }
        if (!check.part.partFileUrl) {
          return withAuthHeaders(
            json(
              { error: "No source file available for conversion" },
              { status: 400 }
            ),
            bundle.headers
          );
        }
        await db
          .update(parts)
          .set({
            meshConversionStatus: "pending",
            meshConversionError: null,
            updatedAt: new Date(),
          })
          .where(eq(parts.id, partId));

        triggerPartMeshConversion(partId, check.part.partFileUrl).catch((err) =>
          console.error(`partAssetAdmin regenerateMesh part ${partId}:`, err)
        );
        return withAuthHeaders(json({ success: true }), bundle.headers);
      }

      case "clearMeshAndThumbnail": {
        if (route.type === "quote") {
          const quotePartId = formData.get("quotePartId") as string;
          if (!quotePartId) {
            return withAuthHeaders(
              json({ error: "quotePartId is required" }, { status: 400 }),
              bundle.headers
            );
          }
          const [qp] = await db
            .select()
            .from(quoteParts)
            .where(eq(quoteParts.id, quotePartId))
            .limit(1);
          if (!qp || qp.quoteId !== route.quoteId) {
            return withAuthHeaders(
              json({ error: "Quote part not found" }, { status: 404 }),
              bundle.headers
            );
          }
          await deleteQuotePartMesh(quotePartId, userId, userEmail, "admin");
          return withAuthHeaders(json({ success: true }), bundle.headers);
        }

        const partId = formData.get("partId") as string;
        if (!partId) {
          return withAuthHeaders(
            json({ error: "partId is required" }, { status: 400 }),
            bundle.headers
          );
        }
        const customerId =
          route.type === "order" ? route.customerId! : route.customerId;
        if (route.type === "order" && (customerId === null || customerId === undefined)) {
          return withAuthHeaders(
            json({ error: "Order has no customer" }, { status: 400 }),
            bundle.headers
          );
        }
        const check = await assertCustomerPart(partId, customerId as number);
        if (!check.ok) {
          return withAuthHeaders(check.response, bundle.headers);
        }
        await deletePartMesh(partId, userId, userEmail, "admin");
        return withAuthHeaders(json({ success: true }), bundle.headers);
      }

      case "deleteCadVersion": {
        const versionId = formData.get("versionId") as string;
        if (!versionId) {
          return withAuthHeaders(
            json({ error: "versionId is required" }, { status: 400 }),
            bundle.headers
          );
        }
        const version = await getCadVersionById(versionId);
        if (!version) {
          return withAuthHeaders(
            json({ error: "Version not found" }, { status: 404 }),
            bundle.headers
          );
        }
        if (version.entityType === "quote_part") {
          if (route.type !== "quote") {
            return withAuthHeaders(
              json(
                { error: "Quote CAD versions can only be managed from the quote page" },
                { status: 400 }
              ),
              bundle.headers
            );
          }
          const [qp] = await db
            .select()
            .from(quoteParts)
            .where(eq(quoteParts.id, version.entityId))
            .limit(1);
          if (!qp || qp.quoteId !== route.quoteId) {
            return withAuthHeaders(
              json({ error: "Version not on this quote" }, { status: 403 }),
              bundle.headers
            );
          }
        } else if (version.entityType === "part") {
          if (route.type === "quote") {
            return withAuthHeaders(
              json({ error: "Invalid context for this version" }, { status: 400 }),
              bundle.headers
            );
          }
          const customerId =
            route.type === "order" ? route.customerId! : route.customerId;
          if (route.type === "order" && (customerId === null || customerId === undefined)) {
            return withAuthHeaders(
              json({ error: "Order has no customer" }, { status: 400 }),
              bundle.headers
            );
          }
          const check = await assertCustomerPart(version.entityId, customerId as number);
          if (!check.ok) {
            return withAuthHeaders(check.response, bundle.headers);
          }
        } else {
          return withAuthHeaders(
            json({ error: "Unknown entity type" }, { status: 400 }),
            bundle.headers
          );
        }

        const del = await deleteCadVersion(versionId, userId, userEmail);
        if (!del.ok) {
          return withAuthHeaders(
            json({ error: del.error }, { status: del.status }),
            bundle.headers
          );
        }
        return withAuthHeaders(json({ success: true }), bundle.headers);
      }

      case "deleteTechnicalDrawing": {
        const drawingId = formData.get("drawingId") as string;
        if (!drawingId) {
          return withAuthHeaders(
            json({ error: "drawingId is required" }, { status: 400 }),
            bundle.headers
          );
        }
        if (route.type === "quote") {
          const quotePartId = formData.get("quotePartId") as string;
          if (!quotePartId) {
            return withAuthHeaders(
              json({ error: "quotePartId is required" }, { status: 400 }),
              bundle.headers
            );
          }
          const r = await deleteQuotePartDrawing(
            drawingId,
            quotePartId,
            route.quoteId,
            attachmentCtx,
            {
              userId,
              userEmail,
              quoteId: route.quoteId,
            }
          );
          if (!r.ok) {
            return withAuthHeaders(
              json({ error: r.error }, { status: r.status }),
              bundle.headers
            );
          }
          return withAuthHeaders(json({ success: true }), bundle.headers);
        }

        if (route.type === "order") {
          const partId = formData.get("partId") as string;
          if (!partId || route.customerId == null) {
            return withAuthHeaders(
              json({ error: "partId required" }, { status: 400 }),
              bundle.headers
            );
          }
          const r = await deleteOrderPartDrawing(
            drawingId,
            partId,
            route.customerId,
            attachmentCtx,
            {
              userId,
              userEmail,
              orderId: route.orderId,
            }
          );
          if (!r.ok) {
            return withAuthHeaders(
              json({ error: r.error }, { status: r.status }),
              bundle.headers
            );
          }
          return withAuthHeaders(json({ success: true }), bundle.headers);
        }

        return withAuthHeaders(
          json(
            { error: "Drawing delete from customer page is not supported here" },
            { status: 400 }
          ),
          bundle.headers
        );
      }

      default:
        return withAuthHeaders(
          json({ error: "Unknown part asset admin operation" }, { status: 400 }),
          bundle.headers
        );
    }
  } catch (e) {
    console.error("tryPartAssetAdminAction:", e);
    return withAuthHeaders(
      json({ error: "Failed to process request" }, { status: 500 }),
      bundle.headers
    );
  }
}
