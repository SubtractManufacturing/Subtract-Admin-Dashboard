# RFQ intake S3 and IAM Terraform spec

## Goal

Manage the development RFQ intake storage and its access through the new Terraform repository. GitHub Actions should authenticate to AWS with GitHub OIDC; the workflow must not store an AWS access key and secret. The WordPress plugin and ERP need a separate, narrowly scoped runtime identity.

## Known application contract

The ERP reads these settings (do not commit credential values):

| Setting | Development value |
| --- | --- |
| `S3_BUCKET` | `serp-dev-rfq-intake-jtam` |
| `S3_REGION` | `us-west-1` |
| `S3_ENDPOINT` | `https://s3.us-west-1.amazonaws.com` |
| `S3_ACCESS_KEY_ID` | Runtime credential, injected from a secret store or untracked local environment |
| `S3_SECRET_ACCESS_KEY` | Runtime credential, injected from a secret store or untracked local environment |

The WordPress plugin uploads directly to S3 using a presigned `PUT` URL. Its development browser origin is `http://serp-rfq-dev.local`. The ERP also checks bucket access and processes objects under `intake/`.

## Resources to manage

Use explicit Terraform resources rather than an all-purpose bucket module so each security setting is visible in plan output.

### RFQ intake bucket

Manage the bucket named `serp-dev-rfq-intake-jtam` in `us-west-1` with:

- S3 Block Public Access enabled for all four controls.
- Object ownership set to `BucketOwnerEnforced`; do not use ACLs.
- Default server-side encryption with SSE-S3 (`AES256`).
- Versioning enabled for recovery from accidental object deletion or overwrite. Do not configure automatic object expiration until RFQ retention requirements are decided.
- A bucket policy denying non-TLS (`aws:SecureTransport = false`) requests. Do not add public-read or public-write permissions.
- `force_destroy = false`, so Terraform cannot empty the bucket as a side effect of destroying it.
- No bucket website hosting, static hosting, or public access.

Expected Terraform resources: `aws_s3_bucket`, `aws_s3_bucket_public_access_block`, `aws_s3_bucket_ownership_controls`, `aws_s3_bucket_server_side_encryption_configuration`, `aws_s3_bucket_versioning`, `aws_s3_bucket_policy`, and `aws_s3_bucket_cors_configuration`.

### Browser CORS

Configure this narrow development rule:

```hcl
cors_rule {
  allowed_origins = ["http://serp-rfq-dev.local"]
  allowed_methods = ["PUT"]
  allowed_headers = ["content-type"]
  max_age_seconds = 3600
}
```

Add the exact HTTPS origin for any deployed WordPress site in a separate environment-specific value. Do not use `*`. CORS only permits the browser request; IAM and bucket policy continue to control S3 authorization.

### Application runtime IAM policy

Create a dedicated policy such as `serp-dev-rfq-intake-app`, attached only to the plugin/ERP runtime principal. Keep object access under `intake/`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CheckAndListRfqBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::serp-dev-rfq-intake-jtam"
    },
    {
      "Sid": "ManageRfqIntakeObjects",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::serp-dev-rfq-intake-jtam/intake/*"
    }
  ]
}
```

`ListBucket` is bucket-scoped and intentionally has no prefix condition because the plugin health check uses `HeadBucket`; S3 authorizes that check with `s3:ListBucket`. Object permissions remain restricted to `intake/*`. Do not grant `s3:*`, ACL actions, bucket policy/configuration actions, or access to other buckets to this runtime principal.

If the WordPress host supports an AWS role, use that role instead of an IAM user and access key. For local WordPress development where role credentials are unavailable, use a dedicated IAM user with one access key. Do not create the access key through `aws_iam_access_key` in Terraform: its secret would be stored in Terraform state. Create/rotate the key through a controlled secret-provisioning step and put the secret in the host's secret store or untracked local `.env`.

### GitHub Actions deployment identity

Create or reuse the account's GitHub OIDC provider for `token.actions.githubusercontent.com` with audience `sts.amazonaws.com`. Create a Terraform deployment role whose trust policy restricts `sub` to the exact new IaC repository and the protected deployment branch or GitHub environment. Obtain the repository owner/name and environment name before applying.

The workflow should use OIDC (`aws-actions/configure-aws-credentials`) and a role ARN, with no long-lived AWS keys in GitHub secrets. Grant only the actions required to manage this named bucket and the dedicated application policy. Keep IAM administration for the GitHub deployment role in a bootstrap/admin path so a routine deployment cannot change its own trust policy or expand its own permissions.

Store Terraform state in a separate, pre-existing state bucket, not the RFQ intake bucket. Enable state-bucket encryption, versioning, public access block, and S3 native state locking (`use_lockfile = true`). Restrict state access to the deployment role and authorized operators; state can contain sensitive values even when Terraform marks them sensitive.

## Environment and secret handling

- Keep bucket name and region as environment-specific Terraform inputs/outputs.
- Publish the S3 endpoint, bucket, and region to the application deployment configuration.
- Deliver runtime credentials through a secret store or local untracked environment. Never put the secret in Terraform outputs, `.tfvars`, GitHub workflow YAML, logs, or committed `.env` files.
- Keep development and production buckets, application identities, GitHub environments, and state isolated.
- The app should continue generating presigned URLs server-side. Do not expose the AWS access key or secret to browser JavaScript.

## Migration and deletion sequence

1. Reauthenticate the AWS CLI and inventory the exact bucket contents, object versions, IAM policy names/ARNs, and runtime principal. The prior root CLI session expired, so this live inventory has not yet been rechecked.
2. Review whether existing RFQ objects must be retained. Back up required objects and versions before any destructive operation.
3. Prefer importing the existing bucket and exact IAM resources into Terraform state, then apply the desired settings. This avoids a bucket-name gap and preserves uploaded RFQs while making Terraform the owner of future changes.
4. If the explicit requirement is to destroy and recreate the bucket, first choose an empty/new bucket name or schedule a cutover. The same globally unique bucket name cannot be recreated until the old bucket has been deleted; deleting it destroys the stored RFQs. Do not set `force_destroy = true` to bypass this safeguard.
5. For IAM cleanup, identify the exact policy and user created for this integration, detach the policy, deactivate/delete its access key, then remove the policy/user only after the replacement identity has passed the application health check and an upload/processing cycle.
6. Run Terraform plan and review every create/update/delete. Apply only after confirming the bucket data disposition and account/region. Verify health check, browser preflight, file upload, ERP retrieval, and cleanup against the managed resources.

## Acceptance criteria

- Terraform plan shows only the intended RFQ bucket, its bucket-level security/CORS settings, the app runtime permission, and GitHub deployment role/policy changes.
- No public access is enabled, and object access is restricted to `intake/*`.
- A browser preflight from `http://serp-rfq-dev.local` for `PUT` with `content-type` succeeds.
- Plugin health check succeeds; a test upload and the ERP's normal object retrieval/deletion flow succeed.
- GitHub Actions obtains credentials by OIDC, and neither the workflow nor Terraform state exposes runtime secret values.
- Destruction of a non-empty bucket is prevented by Terraform's `force_destroy = false`.
