import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getPartMeshUrl } from "~/lib/parts";
import { requireAuth } from "~/lib/auth.server";

export async function loader({ params, request }: LoaderFunctionArgs) {
  await requireAuth(request);

  const partId = params.partId;
  if (!partId) {
    return json({ error: "Part ID is required" }, { status: 400 });
  }

  const result = await getPartMeshUrl(partId);

  if ("error" in result) {
    const statusCode = result.error === "Part not found" ? 404 :
                       result.error === "Part has no mesh file" ? 404 : 500;
    return json({ error: result.error }, { status: statusCode });
  }

  return json({ url: result.url });
}