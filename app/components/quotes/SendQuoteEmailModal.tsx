import { QuoteSendEmail as QuoteEmailTemplate } from "~/emails/layouts/quote-send";
import { getDefaultBodyCopyForLayout } from "~/emails/registry";
import SendEmailModal from "~/components/email/SendEmailModal";
import { EMAIL_CONTEXT } from "~/lib/email/email-context-registry";

type QuotePreviewData = {
  id: number;
  quoteNumber: string;
  total: string | null;
  stripePaymentLinkUrl: string | null;
};

type CustomerPreviewData = {
  email: string | null;
  displayName: string | null;
};

type EmailAttachmentData = {
  id: string | number;
  fileName: string;
  fileSize: number | null;
};

interface SendQuoteEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onQueued?: () => void;
  quote: QuotePreviewData;
  customer: CustomerPreviewData | null;
  attachments: EmailAttachmentData[];
  /** From configured email template (Admin → Email) */
  defaultSubject?: string;
}

export default function SendQuoteEmailModal({
  isOpen,
  onClose,
  onQueued,
  quote,
  customer,
  attachments,
  defaultSubject,
}: SendQuoteEmailModalProps) {
  const subjectFallback =
    defaultSubject ??
    `Your Quote ${quote.quoteNumber} from Subtract Manufacturing`;

  return (
    <SendEmailModal
      isOpen={isOpen}
      onClose={onClose}
      onQueued={onQueued}
      title="Send Quote Email"
      toEmail={customer?.email}
      defaultSubject={subjectFallback}
      subjectResetKey={quote.quoteNumber}
      attachments={attachments}
      action="/email/queue"
      hiddenFields={{
        contextKey: EMAIL_CONTEXT.QUOTE_SEND,
        entityType: "quote",
        entityId: String(quote.id),
      }}
      preview={
        <QuoteEmailTemplate
          quoteNumber={quote.quoteNumber}
          customerName={customer?.displayName || "Customer"}
          total={quote.total || "0.00"}
          paymentLinkUrl={quote.stripePaymentLinkUrl ?? undefined}
          copy={getDefaultBodyCopyForLayout("quote-send")}
        />
      }
    />
  );
}
