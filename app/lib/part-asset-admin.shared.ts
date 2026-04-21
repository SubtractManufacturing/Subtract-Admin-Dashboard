export const PART_ASSET_ADMIN_INTENT = "partAssetAdmin";

export type PartAssetAdminOperation =
  | "regenerateMesh"
  | "clearMeshAndThumbnail"
  | "deleteCadVersion"
  | "deleteTechnicalDrawing";
