import { describe, expect, it } from "vitest";

import wordpressManifest from "./fixtures/wordpress-manifest.json";
import wordpressManifestV2 from "./fixtures/wordpress-manifest-v2.json";
import wordpressReceipt from "./fixtures/wordpress-receipt.json";
import {
  composeIntakeFinish,
  composeIntakeMaterial,
  IntakeValidationError,
  parseManifest,
  parseReceipt,
  quoteIntakeNote,
} from "./package";
import type { ReceiptPointer } from "./types";

const RECEIPT_KEY = wordpressReceipt.manifest_key.replace(
  "meta/manifest.json",
  "meta/receipt.json",
);

function receiptPointer(overrides: Partial<ReceiptPointer> = {}): ReceiptPointer {
  return {
    receiptNumber: wordpressReceipt.receipt_number,
    sessionId: wordpressReceipt.session_id,
    receiptKey: RECEIPT_KEY,
    manifestKey: wordpressReceipt.manifest_key,
    submittedAt: wordpressReceipt.submitted_at,
    ...overrides,
  };
}

describe("parseReceipt", () => {
  it("accepts the WordPress receipt contract", () => {
    expect(parseReceipt(wordpressReceipt, RECEIPT_KEY)).toEqual({
      receiptNumber: "RFQ-20260930-000042",
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
      receiptKey: RECEIPT_KEY,
      manifestKey: wordpressReceipt.manifest_key,
      submittedAt: "2026-09-30T01:04:05+00:00",
    });
  });

  it("rejects a receipt without submitted_at", () => {
    const receipt = { ...wordpressReceipt };
    delete (receipt as { submitted_at?: string }).submitted_at;
    expect(() => parseReceipt(receipt, RECEIPT_KEY)).toThrow(IntakeValidationError);
  });
});

describe("composeIntakeFinish", () => {
  it("joins finish segments with dashes", () => {
    expect(
      composeIntakeFinish({
        finish: "Cerakote",
        finishColor: "Burnt Bronze",
        finishSpecification: null,
      }),
    ).toBe("Cerakote - Burnt Bronze");
  });
});

describe("composeIntakeMaterial", () => {
  it("appends plastic color to material", () => {
    expect(composeIntakeMaterial("Acetal", "Black")).toBe("Acetal - Black");
  });
});

describe("parseManifest", () => {
  it("accepts the WordPress manifest contract and formats phone with country code", () => {
    const manifest = parseManifest(wordpressManifest, receiptPointer());
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.contact.phone).toBe("+15551234567");
    expect(manifest.parts).toHaveLength(2);
    expect(manifest.parts[0].drawings).toHaveLength(2);
    expect(manifest.parts[1].drawings).toHaveLength(0);
    expect(manifest.parts[0].note).toContain("Target price: 12.5");
    expect(manifest.ndaRequired).toBe(false);
    expect(manifest.leadTimePreference).toBe("standard");
  });

  it("rejects phone without a country code", () => {
    expect(() =>
      parseManifest(
        {
          ...wordpressManifest,
          contact: { ...wordpressManifest.contact, phone_country_code: null },
        },
        receiptPointer(),
      ),
    ).toThrow(/country code/i);
  });

  it("rejects a non-boolean nda_required", () => {
    expect(() =>
      parseManifest(
        {
          ...wordpressManifest,
          global: { ...wordpressManifest.global, nda_required: "false" },
        },
        receiptPointer(),
      ),
    ).toThrow(/nda required must be a boolean/i);
  });

  it("rejects drawing keys outside the drawings folder", () => {
    expect(() =>
      parseManifest(
        {
          ...wordpressManifest,
          parts: [
            {
              ...wordpressManifest.parts[0],
              drawing_file_keys: [wordpressManifest.parts[0].part_file_key],
            },
          ],
        },
        receiptPointer(),
      ),
    ).toThrow(/drawings folder/i);
  });

  it("rejects CAD keys outside the parts folder", () => {
    expect(() =>
      parseManifest(
        {
          ...wordpressManifest,
          parts: [
            {
              ...wordpressManifest.parts[0],
              part_file_key: wordpressManifest.parts[0].drawing_file_keys[0],
            },
          ],
        },
        receiptPointer(),
      ),
    ).toThrow(/parts folder/i);
  });

  it("preserves unknown tolerance values verbatim", () => {
    const manifest = parseManifest(
      {
        ...wordpressManifest,
        parts: [{ ...wordpressManifest.parts[0], tolerance: "no_rush" }],
      },
      receiptPointer(),
    );
    expect(manifest.parts[0].tolerance).toBe("no_rush");
    expect(manifest.parts[0].note).toContain("Primary tolerance: no_rush");
  });

  it("labels custom tolerance detail in the part note", () => {
    const manifest = parseManifest(
      {
        ...wordpressManifest,
        parts: [
          {
            ...wordpressManifest.parts[0],
            tolerance: "custom",
            tolerance_detail: "+/- 0.002 in",
          },
        ],
      },
      receiptPointer(),
    );
    expect(manifest.parts[0].note).toContain("Custom tolerance: +/- 0.002 in");
  });

  it("rejects unsupported manifest versions", () => {
    expect(() =>
      parseManifest({ ...wordpressManifest, manifest_version: 3 }, receiptPointer()),
    ).toThrow(/manifest version 3 is not supported/i);
  });

  it("parses manifest v2 with composed finish, material, and slim notes", () => {
    const manifest = parseManifest(wordpressManifestV2, receiptPointer());
    expect(manifest.manifestVersion).toBe(2);
    expect(manifest.parts[0]).toMatchObject({
      material: "6061-T6 Aluminum",
      finish: "Anodize Type II - Black",
      tolerance: '+/- 0.005"',
    });
    expect(manifest.parts[0].note).toBe(
      [
        "Deburr all edges",
        "Threads / features: 4-40 helicoils",
        "Target price: 12.5",
      ].join("\n"),
    );
    expect(manifest.parts[0].note).not.toContain("Material:");
    expect(manifest.parts[0].note).not.toContain("Primary tolerance");

    expect(manifest.parts[1]).toMatchObject({
      material: "Acetal - Natural",
      finish: null,
      tolerance: '+/- 0.010"',
    });
    expect(manifest.parts[1].note).toBe("");
  });

  it("does not require tolerance detail for custom in manifest v2", () => {
    const manifest = parseManifest(
      {
        ...wordpressManifestV2,
        parts: [
          {
            ...wordpressManifestV2.parts[0],
            tolerance: "+/- 0.00394\"",
            tolerance_detail: null,
          },
        ],
      },
      receiptPointer(),
    );
    expect(manifest.parts[0].tolerance).toBe('+/- 0.00394"');
  });
});

describe("quoteIntakeNote", () => {
  it("includes job title and quote requested at from the receipt", () => {
    const manifest = parseManifest(
      {
        ...wordpressManifest,
        contact: { ...wordpressManifest.contact, job_title: "Buyer" },
      },
      receiptPointer(),
    );
    const note = quoteIntakeNote(manifest, receiptPointer());
    expect(note).toContain("Job title: Buyer");
    expect(note).toContain("Quote requested at: 2026-09-30T01:04:05+00:00");
    expect(note).toContain("Lead-time preference: standard");
  });
});
