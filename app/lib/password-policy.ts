export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordPolicyChecks {
  hasMinimumLength: boolean;
  withinMaximumLength: boolean;
}

export function normalizePassword(password: string): string {
  return password.normalize("NFKC");
}

export function getPasswordPolicyChecks(password: string): PasswordPolicyChecks {
  return {
    hasMinimumLength: password.length >= PASSWORD_MIN_LENGTH,
    withinMaximumLength: password.length <= PASSWORD_MAX_LENGTH,
  };
}

export function validatePasswordPolicy(password: string): string | null {
  const checks = getPasswordPolicyChecks(password);
  if (!checks.hasMinimumLength) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }

  if (!checks.withinMaximumLength) {
    return `Password must be no more than ${PASSWORD_MAX_LENGTH} characters.`;
  }

  return null;
}
