import { describe, expect, it } from "vitest";

import {
  boundingBoxFromStlBuffer,
  formatMeshBoundingBoxInches,
} from "./mesh-bounding-box.server";

describe("mesh bounding box", () => {
  it("formats millimeter sizes as inches like the 3D viewer", () => {
    expect(formatMeshBoundingBoxInches({ x: 25.4, y: 50.8, z: 12.7 })).toBe(
      '1.00" × 2.00" × 0.50"',
    );
  });

  it("parses ASCII STL vertices", () => {
    const stl = `solid test
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 25.4 0 0
      vertex 0 25.4 0
    endloop
  endfacet
  facet normal 0 0 1
    outer loop
      vertex 0 0 25.4
      vertex 25.4 0 0
      vertex 0 25.4 0
    endloop
  endfacet
endsolid test`;
    const size = boundingBoxFromStlBuffer(Buffer.from(stl, "utf8"));
    expect(size).toEqual({ x: 25.4, y: 25.4, z: 25.4 });
  });
});
