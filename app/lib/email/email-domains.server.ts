export function getAllowedEmailDomains(): string[] {
  const domainsEnv = process.env.EMAIL_DOMAIN || "";
  return domainsEnv
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailDomainAllowed(email: string): boolean {
  const allowedDomains = getAllowedEmailDomains();
  if (allowedDomains.length === 0) {
    // If no domains are configured, we might want to allow all or reject all.
    // For safety, if EMAIL_DOMAIN is not set, we should probably reject, but 
    // to avoid breaking existing setups before they configure it, we could warn.
    // Let's enforce it: if you want to send emails, you must configure EMAIL_DOMAIN.
    return false;
  }

  const parts = email.split("@");
  if (parts.length !== 2) return false;

  const domain = parts[1].toLowerCase();
  return allowedDomains.includes(domain);
}
