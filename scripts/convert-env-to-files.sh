#!/usr/bin/env bash
# Convert getEnv/requireEnv keys in .env to KEY_FILE=.secrets/KEY for local *_FILE testing.
# Usage:
#   bash scripts/convert-env-to-files.sh
#   bash scripts/convert-env-to-files.sh --restore

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
BACKUP_FILE="$ROOT/.env.bak"
SECRETS_DIR="$ROOT/.secrets"

# Keys resolved via getEnv / requireEnv (app/lib/env.server.ts consumers).
ALLOWLIST=(
  DATABASE_URL
  DATABASE_DIRECT_URL
  DATABASE_SSL
  DATABASE_USE_PREPARE
  DATABASE_POOL_MAX
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_ANON_KEY
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SESSION_EXPIRY
  S3_ENDPOINT
  S3_REGION
  S3_ACCESS_KEY_ID
  S3_SECRET_ACCESS_KEY
  S3_BUCKET
  STRIPE_SECRET_KEY
  POSTMARK_SERVER_TOKEN
  POSTMARK_API_TOKEN
  POSTMARK_MESSAGE_STREAM
  EMAIL_DOMAIN
  PUBLIC_APP_URL
  CONVERSION_API_URL
  CONVERSION_API_TIMEOUT
  CONVERSION_POLLING_INTERVAL
  TOOLPATH_API_KEY
  RELEASE_VERSION
)

is_allowlisted() {
  local key="$1"
  local candidate
  for candidate in "${ALLOWLIST[@]}"; do
    if [[ "$candidate" == "$key" ]]; then
      return 0
    fi
  done
  return 1
}

# Strip outer quotes; for unquoted values, drop trailing " # comment".
# Also handles quoted values followed by inline comments: FOO="bar" # comment
normalize_value() {
  local value="$1"
  local dquote_re='^"(.*)"[[:space:]]*(#.*)?$'
  local squote_re="^'(.*)'[[:space:]]*(#.*)?$"
  if [[ "$value" =~ $dquote_re ]]; then
    value="${BASH_REMATCH[1]}"
  elif [[ "$value" =~ $squote_re ]]; then
    value="${BASH_REMATCH[1]}"
  else
    value="${value%% #*}"
    # trim trailing whitespace
    value="${value%"${value##*[![:space:]]}"}"
  fi
  printf '%s' "$value"
}

restore() {
  if [[ ! -f "$BACKUP_FILE" ]]; then
    echo "error: missing $BACKUP_FILE — nothing to restore" >&2
    exit 1
  fi

  cp "$BACKUP_FILE" "$ENV_FILE"
  rm -f "$BACKUP_FILE"
  if [[ -d "$SECRETS_DIR" ]]; then
    rm -rf "$SECRETS_DIR"
  fi
  echo "Restored .env from .env.bak and removed .secrets/"
}

convert() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "error: missing $ENV_FILE" >&2
    exit 1
  fi
  if [[ -f "$BACKUP_FILE" ]]; then
    echo "error: $BACKUP_FILE already exists — run with --restore first" >&2
    exit 1
  fi
  if [[ -d "$SECRETS_DIR" ]]; then
    echo "error: $SECRETS_DIR already exists — run with --restore first (or remove it)" >&2
    exit 1
  fi

  cp "$ENV_FILE" "$BACKUP_FILE"
  mkdir -p "$SECRETS_DIR"

  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  local converted=()
  local skipped_empty=()

  while IFS= read -r line || [[ -n "$line" ]]; do
    # Strip trailing carriage return for CRLF compatibility
    line="${line%$'\r'}"
    # Preserve blank lines and full-line comments
    if [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]]; then
      printf '%s\n' "$line" >>"$tmp"
      continue
    fi

    if [[ ! "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      printf '%s\n' "$line" >>"$tmp"
      continue
    fi

    local key="${BASH_REMATCH[1]}"
    local raw_value="${BASH_REMATCH[2]}"

    # Leave existing *_FILE entries and non-allowlist keys alone
    if [[ "$key" == *_FILE ]] || ! is_allowlisted "$key"; then
      printf '%s\n' "$line" >>"$tmp"
      continue
    fi

    local value
    value="$(normalize_value "$raw_value")"
    if [[ -z "$value" ]]; then
      skipped_empty+=("$key")
      printf '%s\n' "$line" >>"$tmp"
      continue
    fi

    # getEnv trims; a trailing newline on the secret file is fine
    printf '%s\n' "$value" >"$SECRETS_DIR/$key"
    printf '%s_FILE=.secrets/%s\n' "$key" "$key" >>"$tmp"
    converted+=("$key")
  done <"$ENV_FILE"

  mv "$tmp" "$ENV_FILE"
  trap - EXIT

  echo "Backed up .env → .env.bak"
  echo "Converted ${#converted[@]} key(s) to *_FILE under .secrets/:"
  if [[ ${#converted[@]} -gt 0 ]]; then
    printf '  - %s\n' "${converted[@]}"
  fi
  if [[ ${#skipped_empty[@]} -gt 0 ]]; then
    echo "Skipped empty allowlist key(s):"
    printf '  - %s\n' "${skipped_empty[@]}"
  fi
  echo
  echo "Test with: npm run dev"
  echo "Restore with: bash scripts/convert-env-to-files.sh --restore"
}

main() {
  case "${1:-}" in
    --restore)
      restore
      ;;
    "" )
      convert
      ;;
    -h|--help)
      echo "Usage: bash scripts/convert-env-to-files.sh [--restore]"
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      echo "Usage: bash scripts/convert-env-to-files.sh [--restore]" >&2
      exit 1
      ;;
  esac
}

main "$@"
