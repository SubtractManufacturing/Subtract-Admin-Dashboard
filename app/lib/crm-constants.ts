export const CRM_PAGE_SIZE = 25;

export const COMMUNICATION_METHODS = [
  "call",
  "text",
  "email",
  "social_media_dm",
] as const;

export type CommunicationMethod = (typeof COMMUNICATION_METHODS)[number];

export const COMMUNICATION_METHOD_LABELS: Record<CommunicationMethod, string> =
  {
    call: "Call",
    text: "Text",
    email: "Email",
    social_media_dm: "Social media DM",
  };

export function isCommunicationMethod(
  value: string,
): value is CommunicationMethod {
  return (COMMUNICATION_METHODS as readonly string[]).includes(value);
}
