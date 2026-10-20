import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { downloadFromS3, extractS3Key } from "../s3.server";

export type MeshSizeMm = { x: number; y: number; z: number };

export function formatMeshBoundingBoxInches(size: MeshSizeMm): string {
  const toIn = (mm: number) => (mm / 25.4).toFixed(2);
  return `${toIn(size.x)}" × ${toIn(size.y)}" × ${toIn(size.z)}"`;
}

function emptyMinMax() {
  return {
    min: new Vector3(Infinity, Infinity, Infinity),
    max: new Vector3(-Infinity, -Infinity, -Infinity),
  };
}

function includePoint(
  min: Vector3,
  max: Vector3,
  x: number,
  y: number,
  z: number,
) {
  min.x = Math.min(min.x, x);
  min.y = Math.min(min.y, y);
  min.z = Math.min(min.z, z);
  max.x = Math.max(max.x, x);
  max.y = Math.max(max.y, y);
  max.z = Math.max(max.z, z);
}

function sizeFromMinMax(min: Vector3, max: Vector3): MeshSizeMm | null {
  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) return null;
  const size = new Vector3().subVectors(max, min);
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) return null;
  return { x: size.x, y: size.y, z: size.z };
}

export function boundingBoxFromStlBuffer(buffer: Buffer): MeshSizeMm | null {
  const header = buffer.subarray(0, 80).toString("utf8");
  const isAscii = header.trim().toLowerCase().startsWith("solid");

  const { min, max } = emptyMinMax();

  if (isAscii) {
    const text = buffer.toString("utf8");
    const vertexPattern =
      /vertex\s+([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)\s+([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)\s+([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi;
    let match: RegExpExecArray | null;
    let points = 0;
    while ((match = vertexPattern.exec(text)) !== null) {
      includePoint(min, max, Number(match[1]), Number(match[2]), Number(match[3]));
      points++;
    }
    if (points === 0) return null;
    return sizeFromMinMax(min, max);
  }

  if (buffer.length < 84) return null;
  const triangleCount = buffer.readUInt32LE(80);
  const expectedLength = 84 + triangleCount * 50;
  if (triangleCount === 0 || expectedLength > buffer.length) return null;

  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    offset += 12;
    for (let vertex = 0; vertex < 3; vertex++) {
      const x = buffer.readFloatLE(offset);
      const y = buffer.readFloatLE(offset + 4);
      const z = buffer.readFloatLE(offset + 8);
      includePoint(min, max, x, y, z);
      offset += 12;
    }
    offset += 2;
  }

  return sizeFromMinMax(min, max);
}

async function boundingBoxFromGlbBuffer(
  buffer: Buffer,
): Promise<MeshSizeMm | null> {
  const loader = new GLTFLoader();
  const arrayBuffer = Uint8Array.from(buffer).buffer;
  const gltf = await loader.parseAsync(arrayBuffer, "");
  const box = new Box3();
  gltf.scene.updateMatrixWorld(true);
  box.setFromObject(gltf.scene);
  const size = new Vector3();
  box.getSize(size);
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) return null;
  return { x: size.x, y: size.y, z: size.z };
}

export async function loadPartMeshApproxSizeInches(
  partMeshUrl: string | null,
): Promise<string | null> {
  if (!partMeshUrl?.trim()) return null;

  try {
    const buffer = await downloadFromS3(partMeshUrl);
    const key = extractS3Key(partMeshUrl);
    const extension = key.split(".").pop()?.toLowerCase() ?? "";

    let sizeMm: MeshSizeMm | null = null;
    if (extension === "stl") {
      sizeMm = boundingBoxFromStlBuffer(buffer);
    } else if (extension === "glb" || extension === "gltf") {
      sizeMm = await boundingBoxFromGlbBuffer(buffer);
    }

    return sizeMm ? formatMeshBoundingBoxInches(sizeMm) : null;
  } catch (error) {
    console.warn("Job board mesh bounding box skipped:", error);
    return null;
  }
}
