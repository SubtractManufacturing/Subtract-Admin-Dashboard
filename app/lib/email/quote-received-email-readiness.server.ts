import { getCustomer } from "~/lib/customers";
import { resolveEmailTemplateForContext } from "~/lib/email/templates.server";
import { isOutboundEmailEnabled } from "~/lib/featureFlags";
import { getQuote } from "~/lib/quotes";
import { inferQuoteReceivedContextKey } from "~/lib/email/handlers/quote-received-email.server";
import { resolveQuoteTokens } from "~/lib/email/resolve/quote.server";
import { resolveToAddressFromTemplate } from "~/lib/email/resolve-to-address.server";

export type QuoteReceivedEmailReadiness = {
  outboundEnabled: boolean;
  templateConfigured: boolean;
  customerHasEmail: boolean;
  toResolvable: boolean;
  canSend: boolean;
  disabledReason: string | null;
  contextKey: ReturnType<typeof inferQuoteReceivedContextKey> | null;
};

export async function getQuoteReceivedEmailReadiness(
  quoteId: number,
): Promise<QuoteReceivedEmailReadiness> {
  const outboundEnabled = await isOutboundEmailEnabled();
  const quote = await getQuote(quoteId);
  if (!quote || quote.isArchived) {
    return {
      outboundEnabled,
      templateConfigured: false,
      customerHasEmail: false,
      toResolvable: false,
      canSend: false,
      disabledReason: quote ? "Quote is archived" : "Quote not found",
      contextKey: null,
    };
  }

  const contextKey = inferQuoteReceivedContextKey(quote);
  const template = await resolveEmailTemplateForContext(contextKey);
  const templateConfigured = Boolean(template);

  const customer = quote.customerId
    ? await getCustomer(quote.customerId)
    : null;
  const customerHasEmail = Boolean(customer?.email?.trim());

  let toResolvable = false;
  if (templateConfigured && template) {
    try {
      const tokens = await resolveQuoteTokens(String(quoteId));
      const toResult = resolveToAddressFromTemplate(
        template.template.toTemplate ?? "{{customerEmail}}",
        tokens,
      );
      toResolvable = toResult.ok;
    } catch {
      toResolvable = false;
    }
  }

  let disabledReason: string | null = null;
  if (!outboundEnabled) {
    disabledReason = "Outbound email is disabled.";
  } else if (!templateConfigured) {
    disabledReason = "No quote received email template is configured.";
  } else if (!toResolvable) {
    disabledReason = "Recipient could not be resolved from the template To field.";
  }

  const canSend =
    outboundEnabled && templateConfigured && toResolvable && !quote.isArchived;

  return {
    outboundEnabled,
    templateConfigured,
    customerHasEmail,
    toResolvable,
    canSend,
    disabledReason,
    contextKey,
  };
}
