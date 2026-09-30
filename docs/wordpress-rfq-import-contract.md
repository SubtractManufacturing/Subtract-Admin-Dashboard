# ERP S3 import contract (WordPress RFQ Intake plugin)

**Purpose:** Exact import contract derived from current plugin code (not PRD/memory).  
**Plugin REST namespace:** `rfq/v1`  
**Session S3 prefix:** `intake/{session_id}/` (set on session create).

**Source-of-truth files (primary):**

| Area | File |
|------|------|
| S3 keys | `rfq-intake/includes/class-rfq-s3-key-builder.php` |
| Submit / receipt | `rfq-intake/includes/class-rfq-receipt-service.php` |
| Manifest validation | `rfq-intake/includes/class-rfq-manifest-validator.php` |
| Contact validation | `rfq-intake/includes/class-rfq-contact-validator.php` |
| REST / draft / uploads | `rfq-intake/includes/class-rfq-rest-controller.php` |
| Webhook | `rfq-intake/includes/class-rfq-webhook.php` |
| Client manifest build | `frontend/src/lib/manifest.ts`, `frontend/src/types/manifest.ts` |
| Constants | `rfq-intake/rfq-intake.php` |

---

## 1. Recent form / manifest changes (summary)

Most recent **manifest-impacting** change: commit `d865840` (2026-09-29), *feat: refine RFQ details flow and theme-safe buttons*.

| Change | Detail | Source |
|--------|--------|--------|
| **REMOVED** | `no_rush` from allowed `lead_time_preference` | `class-rfq-manifest-validator.php` `LEAD_TIME_PREFERENCES`; `frontend/src/types/manifest.ts` `LeadTimePreference` |
| **RETYPED / rules** | `global.required_delivery_date` | Required only when `lead_time_preference === "target_date"`; otherwise optional (`null` or omitted). If a non-empty string is sent for other lead times, still validated as `YYYY-MM-DD` and not before today (UTC) | `class-rfq-manifest-validator.php`; `frontend/src/lib/manifest.ts` `buildManifest()` |
| **UI** | Global step field order; target date only for “Meet Target Date”; labels in `leadTime.ts` | `frontend/src/steps/StepGlobal.tsx`, `frontend/src/lib/leadTime.ts` |
| **UI only** (commit `6792805`) | Part meta: quantity/material/tolerance/notes first; threads + target price under collapsible “More details” | `frontend/src/steps/StepPartMeta.tsx` |

No manifest JSON key renames in those commits.

---

## 2. S3 layout

### 2.1 Folders under `intake/{session_id}/`

| Prefix | Written by | Contents |
|--------|------------|----------|
| `parts/` | Presigned PUT after `POST /sessions/{id}/upload-urls` with `file_type: "part"` | Part/CAD blobs; submit HeadObject expects `Content-Type: application/octet-stream` |
| `drawings/` | Same with `file_type: "drawing"` | PDF, PNG, JPEG (allowed MIME types on upload + submit) |
| `meta/manifest.json` | Successful submit | Final manifest JSON |
| `meta/receipt.json` | Successful submit (after manifest) | Receipt index JSON |
| `meta/draft.json` | `PUT /sessions/{id}/draft` (autosave) | Draft snapshot JSON — **not** a completed submission |

Session prefix on create: `intake/{session_id}/` (`RFQ_REST_Controller::create_session`).

### 2.2 Object key format (CAD + drawings)

From `RFQ_S3_Key_Builder::build_file_key()`:

```text
intake/{session_id}/{parts|drawings}/{file_id}_{sanitized_filename}
```

| Rule | Detail | Source |
|------|--------|--------|
| Separator | Single underscore `_` between upload id and filename | `class-rfq-s3-key-builder.php` |
| `file_id` | New UUID v4 per upload-urls request (`generate_file_id()`) — **not** `part_id` | `class-rfq-rest-controller.php` upload-urls; `class-rfq-s3-key-builder.php` |
| `sanitized_filename` | `basename`; `\` → `/`; `[^a-zA-Z0-9.\-]` → `_`; empty → `file`; max **100** chars | `sanitize_filename()` |
| Unicode | Non-ASCII → `_` (same regex) | `sanitize_filename()` |
| Example | `bracket (v2).step` → `bracket__v2_.step` | `tests/php/unit/S3KeyBuilderTest.php` |

### 2.3 Drawings under `parts/`?

Submit validation classifies keys by path: `#/parts/#` → part, `#/drawings/#` → drawing (`RFQ_Receipt_Service::file_category_for_key`). Keys in `drawing_file_keys` must be under `drawings/`. Official uploads use `drawings/` when `file_type === "drawing"`.

### 2.4 Other objects under session prefix

Plugin writes **only** the paths above. Extra objects (e.g. orphan part files) do **not** block submit (`SubmitTest::test_submit_ignores_extra_objects_in_session_prefix`). Orphans not listed in manifest are ignored for import validation.

---

## 3. Example JSON (fixture-shaped, redacted)

### 3.1 `receipt.json`

Exact fields written in `RFQ_Receipt_Service::submit` (`receipt_payload`). `submitted_at` = `gmdate('c')`.

```json
{
  "receipt_number": "RFQ-20260930-000042",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "submitted_at": "2026-09-30T01:04:05+00:00",
  "manifest_key": "intake/550e8400-e29b-41d4-a716-446655440000/meta/manifest.json"
}
```

### 3.2 `manifest.json` (2 parts: one with 2 drawings, one with none)

Matches validator/submit test shapes; keys use `{file_id}_{sanitized_name}` as server generates.

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "contact": {
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane@example.com",
    "company": null,
    "phone": "5551234567",
    "phone_country_code": "1",
    "job_title": null
  },
  "parts": [
    {
      "part_id": "550e8400-e29b-41d4-a716-446655440001",
      "part_file_key": "intake/550e8400-e29b-41d4-a716-446655440000/parts/a1b2c3d4-e5f6-4789-a012-3456789abcde_bracket.step",
      "drawing_file_keys": [
        "intake/550e8400-e29b-41d4-a716-446655440000/drawings/b2c3d4e5-f6a7-4890-b123-456789abcdef0_drawing-a.pdf",
        "intake/550e8400-e29b-41d4-a716-446655440000/drawings/c3d4e5f6-a7b8-4901-c234-567890abcdef1_drawing-b.png"
      ],
      "material": "Aluminum 6061",
      "tolerance": "standard",
      "tolerance_detail": null,
      "threads_features": null,
      "quantity": 10,
      "target_unit_price": 12.5,
      "notes": null
    },
    {
      "part_id": "550e8400-e29b-41d4-a716-446655440002",
      "part_file_key": "intake/550e8400-e29b-41d4-a716-446655440000/parts/d4e5f6a7-b8c9-4012-d345-67890abcdef12_housing.step",
      "drawing_file_keys": [],
      "material": "1018 Steel",
      "tolerance": "precision",
      "tolerance_detail": null,
      "quantity": 1,
      "target_unit_price": null,
      "notes": "Rush review"
    }
  ],
  "global": {
    "required_delivery_date": null,
    "lead_time_preference": "standard",
    "shipping_destination": {
      "postal_code": "90210"
    },
    "po_number": null,
    "nda_required": false,
    "notes": null
  }
}
```

### 3.3 ERP webhook request

Fired on `rfq_receipt_created` after manifest + receipt S3 writes and successful WP DB index update.

| Item | Value | Source |
|------|-------|--------|
| Method | `POST` | `class-rfq-webhook.php` |
| URL | WordPress option `rfq_erp_webhook_url` | `get_option('rfq_erp_webhook_url')` |
| Timeout | 5 seconds | `TIMEOUT_SECONDS` |
| Blocking | `false` (async) | `wp_remote_post` args |
| Retries | **None** in plugin | single POST; errors logged |
| Duplicate webhook | **One** per successful first submit; idempotent resubmit does not redispatch | `WebhookSubmitTest::test_idempotent_resubmit_does_not_redispatch_webhook` |

**Headers:**

```http
Content-Type: application/json
X-RFQ-Signature: <64-char lowercase hex>
```

- Signature = `hash_hmac('sha256', $body, $secret)` — **raw hex**, not `sha256=` prefix.
- Signed bytes = exact UTF-8 JSON body from `wp_json_encode($payload)`.
- Secret = `RFQ_Secrets::get_secret('rfq_erp_webhook_secret')`.
- If URL blank → skip. If URL set but secret missing → skip + `error_log`.

**Body:**

```json
{
  "receipt_number": "RFQ-20260930-000042",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "receipt_key": "intake/550e8400-e29b-41d4-a716-446655440000/meta/receipt.json"
}
```

**Customer success:** Submit returns 200 + `receipt_number` even if webhook fails or is unconfigured (`WebhookSubmitTest`).

---

## 4. Field tables

### 4.1 `receipt.json`

| Field | JSON type | Always present? | Null / empty? | Notes |
|-------|-----------|-----------------|---------------|-------|
| `receipt_number` | string | yes | non-empty | See §4.1.1 |
| `session_id` | string | yes | UUID v4 | |
| `submitted_at` | string | yes | non-empty | ISO 8601 via `gmdate('c')` |
| `manifest_key` | string | yes | non-empty | `intake/{session_id}/meta/manifest.json` |

#### 4.1.1 `receipt_number` format and uniqueness

- Format: `RFQ-{YYYYMMDD}-{6-digit-seq}` via `RFQ_Receipt_Service::allocate_receipt_number()`.
- Allocation: MySQL `{prefix}rfq_receipt_sequences` with `INSERT ... ON DUPLICATE KEY UPDATE seq = LAST_INSERT_ID(seq + 1)`.
- Same session retry → same receipt; body not rewritten (`SubmitTest::test_submit_retry_returns_same_receipt_without_rewriting_objects`).
- New session → new number.
- **Not** regenerated for an already-receipted session on success path.

#### 4.1.2 Write order and immutability

1. Put `meta/manifest.json`
2. Allocate receipt number
3. Put `meta/receipt.json`
4. Update WP `rfq_sessions` (`status=submitted`, …)
5. `do_action('rfq_receipt_created')` → webhook

If receipt put fails after manifest → partial state (logged). If receipt exists in S3, resubmit returns early without rewriting manifest/receipt (`resolve_existing_receipt`). After submit, plugin blocks contact/upload-urls/draft (403). **Unknown:** direct S3 writes by non-plugin actors after receipt.

---

### 4.2 `manifest.json` — top level

| Path | Type | Required | Null / empty | Allowed / notes |
|------|------|----------|--------------|-----------------|
| `session_id` | string | yes | UUID v4 | Must match URL session |
| `contact` | object | yes | — | |
| `parts` | array | yes | length 1–`RFQ_MAX_PARTS` (20) | |
| `global` | object | yes | — | |

**Not** in manifest top level: `schema_version`, `submitted_at`, receipt number. (`RFQ_INTAKE_SCHEMA_VERSION` is WP DB only.)

---

### 4.3 `contact`

Validated with `RFQ_Contact_Validator::normalize_and_validate()` on submit. **Stored manifest = request JSON as validated** (not replaced with normalized copy in `put_json`).

| Path | Type | Required | Null / empty | Allowed / source |
|------|------|----------|--------------|------------------|
| `first_name` | string | yes | trimmed non-empty | |
| `last_name` | string | yes | trimmed non-empty | |
| `email` | string | yes | valid email | |
| `company` | string | no | `null` / omit; empty → null on PATCH | optional |
| `phone` | string | no | `null`/omit, or **digits only** | national number; max 15 after libphonenumber parse |
| `phone_country_code` | string | conditional | required iff `phone` set; 1–4 digit calling code | **separate field** (not single E.164 field) |
| `job_title` | string | no | Official UI always sends `null` | optional if API sends string |

Phone: validate parse of `+{phone_country_code}{phone}` with libphonenumber (`class-rfq-contact-validator.php`). Frontend `normalizePhone()` stores national number + calling code (`frontend/src/lib/phone.ts`).

---

### 4.4 `parts[]`

| Path | Type | Required | Null / empty | Allowed / source |
|------|------|----------|--------------|------------------|
| `part_id` | string | yes | UUID v4; unique in manifest | client UUID per part row |
| `part_file_key` | string | yes | non-empty; under `.../parts/`; HeadObject exists | from upload-urls `file_key` |
| `drawing_file_keys` | array | yes | may be `[]` | each key non-empty; under `.../drawings/` |
| `material` | string | yes | non-empty trimmed | **free text** (UI combobox allows off-catalog); **no server enum** |
| `tolerance` | string | yes | `standard`, `precision`, `custom` | |
| `tolerance_detail` | string | conditional | required non-empty iff `tolerance === "custom"` | else null/omit |
| `threads_features` | string | no | null/omit OK | |
| `quantity` | number | yes | integer ≥ 1 (JSON int or whole float) | |
| `target_unit_price` | number | no | null/omit; if set: ≥ 0, ≤ 2 decimal places | **no currency field** in manifest |
| `notes` | string | no | null/omit OK | |

Official client (`buildManifest`) includes only parts with confirmed part upload; confirmed drawings only in `drawing_file_keys`.

---

### 4.5 `global`

| Path | Type | Required | Null / empty | Allowed / source |
|------|------|----------|--------------|------------------|
| `lead_time_preference` | string | yes | `standard`, `target_date`, `expedited`, `economy` | **`no_rush` removed** |
| `required_delivery_date` | string | conditional | `YYYY-MM-DD`; required + not past UTC if `target_date`; else null/omit OK; if non-empty string otherwise, still validated | compared to **UTC today** |
| `shipping_destination` | object | yes | — | |
| `shipping_destination.postal_code` | string | yes | non-empty; US ZIP or CA postal | `RFQ_Postal_Code::is_valid`; DB index normalized, manifest as submitted |
| `po_number` | string | no | null/omit | |
| `nda_required` | boolean | yes | must be JSON **boolean** | not `"true"`, `1`, etc. |
| `notes` | string | no | null/omit | |

---

## 5. WordPress constraints (errors ERP will never see if submit succeeded)

| Constraint | Value | Source |
|------------|-------|--------|
| Part max size | 524_288_000 bytes (500 MiB) | `PART_MAX_BYTES` |
| Drawing max size | 52_428_800 bytes (50 MiB) | `DRAWING_MAX_BYTES` |
| Total submission size | **No explicit cap** | — |
| Max parts | 20 | `RFQ_MAX_PARTS` |
| Max drawings per part | **No explicit cap** | practical limit: `RFQ_MAX_UPLOAD_URLS_PER_SESSION` = **200** per session (parts + drawings) |
| Sanitized filename max | 100 chars | `SANITIZED_FILENAME_MAX_LENGTH` |
| Part upload content type | `application/octet-stream` only | upload-urls + submit HeadObject |
| Drawing content types | `application/pdf`, `image/png`, `image/jpeg` | upload-urls + submit HeadObject |
| CAD file extensions (server) | **Not validated** | any filename if type/size pass |
| CAD extensions (UI) | No `accept` on part dropzone; helper text mentions STEP/IGES/STL/SLDPRT | `UploadDropzone.tsx` |
| Drawing extensions (UI) | `.pdf`, `.png`, `.jpg`, `.jpeg` | `StepUploads.tsx`, `resolveDrawingContentType()` |
| Session create rate | 10/hour/IP | `RFQ_SESSION_RATE_LIMIT` |

Submit also runs full manifest validation + HeadObject on every declared file key + path category match + size/content-type checks (`RFQ_Receipt_Service::validate_manifest_file_keys`).

---

## 6. Import correctness checklist

| Topic | Behavior |
|-------|----------|
| **Completed submission** | `meta/receipt.json` exists (treat `manifest.json` without receipt as incomplete) |
| **Edit after receipt** | 403 on contact, upload-urls, draft; submit returns existing `receipt_number` |
| **Same email, multiple RFQs** | No dedup; independent sessions |
| **Abandoned / partial** | `draft.json` or orphan S3 files ≠ complete; only receipt marks done |
| **Webhook optional** | Poll S3 for `meta/receipt.json`; webhook is accelerator only |
| **Idempotent import** | Same receipt may be seen once from webhook and once from poll; import worker must dedupe by `receipt_number` |

---

## 7. ERP importer flow (recommended)

1. Discover work: webhook and/or list/scan `intake/*/meta/receipt.json`.
2. Read `receipt.json` → get `manifest_key`, `receipt_number`, `session_id`.
3. Read `manifest.json` from `manifest_key`.
4. For each `part_file_key` and each `drawing_file_keys[]`, copy from intake bucket (HeadObject optional sanity check).
5. Persist quote keyed by `receipt_number` (idempotent).
6. After successful import, delete intake prefix (per product plan — confirm ops policy).

---

## 8. Unknown / not determined from code

| Item | Status |
|------|--------|
| Currency for `target_unit_price` | **Unknown** — numeric only; UI displays `$` |
| Whether manifest `postal_code` is normalized in S3 object | Stored as client submitted; WP DB uses normalized postal |
| Post-receipt S3 mutation by non-plugin clients | **Unknown** |
| Exact `wp_json_encode` flags for S3 Unicode | `JSON_THROW_ON_ERROR` on put; otherwise WP defaults |
| Live production bucket samples | Examples above are **test/fixture-shaped** |

---

## 9. Key implementation references (line anchors)

- Receipt payload fields: `class-rfq-receipt-service.php` (~L75–97, ~L187–221)
- File key pattern: `class-rfq-s3-key-builder.php` (~L28–63)
- Manifest validator enums: `class-rfq-manifest-validator.php` (~L9–20, parts/global validation)
- Webhook: `class-rfq-webhook.php` (~L15–64)
- Upload URL → key (note `file_id` vs `part_id`): `class-rfq-rest-controller.php` (~L323–335)
- Client manifest: `frontend/src/lib/manifest.ts` `buildManifest()`

*Generated for ERP-side importer development. Re-read cited PHP/TS files if plugin version changes.*
