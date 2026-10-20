import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadSharp(): (input: Buffer) => {
  flatten: (options: {
    background: { r: number; g: number; b: number };
  }) => { png: () => { toBuffer: () => Promise<Buffer> } };
} {
  return require("sharp");
}

/** Flatten alpha onto white so thumbnails read clearly on Discord's dark UI. */
export async function flattenJobBoardThumbnailOnWhite(
  imageBuffer: Buffer,
): Promise<Buffer> {
  const sharp = loadSharp();
  return sharp(imageBuffer)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
}
