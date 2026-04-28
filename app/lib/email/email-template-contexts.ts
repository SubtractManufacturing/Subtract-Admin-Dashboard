// Backward-compatible re-export. Prefer importing from:
// ~/lib/email/email-context-registry
export {
  EMAIL_CONTEXT as EMAIL_TEMPLATE_CONTEXT,
  EMAIL_CONTEXTS as EMAIL_TEMPLATE_CONTEXT_DEFINITIONS,
  isEmailContextKey as isEmailTemplateContextKey,
  type EmailContextKey as EmailTemplateContextKey,
} from "./email-context-registry";
