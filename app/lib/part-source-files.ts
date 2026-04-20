/**
 * Classify uploaded filenames for quote part flows (CAD vs drawing/raster).
 */

const BREP_CAD_EXT = new Set([
  "step",
  "stp",
  "iges",
  "igs",
  "brep",
]);

const MESH_CAD_EXT = new Set(["stl", "obj", "gltf", "glb"]);

const OTHER_CAD_EXT = new Set([
  "sldprt",
  "x_t",
  "x_b",
  "sat",
  "prt",
]);

const DRAWING_EXT = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "dwg",
  "dxf",
  "heic",
]);

export function getExtension(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i + 1).toLowerCase();
}

export type PartSourceKind = "cad_brep" | "cad_mesh" | "cad_other" | "drawing" | "unknown";

export function classifyPartSourceFile(fileName: string): PartSourceKind {
  const ext = getExtension(fileName);
  if (BREP_CAD_EXT.has(ext)) return "cad_brep";
  if (MESH_CAD_EXT.has(ext)) return "cad_mesh";
  if (OTHER_CAD_EXT.has(ext)) return "cad_other";
  if (DRAWING_EXT.has(ext)) return "drawing";
  return "unknown";
}

export function isCadSourceFile(fileName: string): boolean {
  const k = classifyPartSourceFile(fileName);
  return k === "cad_brep" || k === "cad_mesh" || k === "cad_other";
}

export function isDrawingSourceFile(fileName: string): boolean {
  return classifyPartSourceFile(fileName) === "drawing";
}

export function contentTypeForDrawingFileName(fileName: string): string {
  const ext = getExtension(fileName);
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "dwg":
      return "application/acad";
    case "dxf":
      return "application/dxf";
    default:
      return "application/octet-stream";
  }
}
