import { useState, useEffect, useCallback, useRef } from "react";
import {
  json,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher, Link, useRevalidator } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getThreadById, getEmailAttachments } from "~/lib/emails";
import { getActiveSendAsAddresses } from "~/lib/emailSendAsAddresses";
import { sendReply } from "~/lib/postmark/postmark-client.server";
import Breadcrumbs from "~/components/Breadcrumbs";
import Button from "~/components/shared/Button";
import { EmailMessage } from "~/components/email/EmailMessage";
import { ReplyComposer } from "~/components/email/ReplyComposer";
import type { Email, EmailAttachment } from "~/lib/db/schema";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { headers } = await requireAuth(request);

  const threadId = params.threadId;
  if (!threadId) {
    throw new Response("Thread ID is required", { status: 400 });
  }

  // Fetch thread with all emails
  const threadData = await getThreadById(threadId);
  if (!threadData) {
    throw new Response("Thread not found", { status: 404 });
  }

  // Fetch attachments for all emails in the thread
  const emailsWithAttachments = await Promise.all(
    threadData.emails.map(async (email) => {
      const attachments = await getEmailAttachments(email.id);
      return { email, attachments };
    })
  );

  // Get send-as addresses for reply composer
  const sendAsAddresses = await getActiveSendAsAddresses();

  return withAuthHeaders(
    json({
      thread: threadData.thread,
      emailsWithAttachments,
      sendAsAddresses,
    }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { headers } = await requireAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sendReply") {
    const replyToEmailId = formData.get("replyToEmailId") as string;
    const from = formData.get("from") as string;
    const body = formData.get("body") as string;
    const to = formData.get("to") as string | null;

    if (!replyToEmailId || !from || !body) {
      return withAuthHeaders(
        json({ error: "Missing required fields" }, { status: 400 }),
        headers
      );
    }

    try {
      const result = await sendReply({
        replyToEmailId: parseInt(replyToEmailId),
        from,
        body,
        to: to || undefined,
      });

      if (result.success) {
        return withAuthHeaders(json({ success: true }), headers);
      } else {
        return withAuthHeaders(
          json({ error: result.error }, { status: 400 }),
          headers
        );
      }
    } catch (error) {
      console.error("Failed to send reply:", error);
      return withAuthHeaders(
        json({ error: "Failed to send reply" }, { status: 500 }),
        headers
      );
    }
  }

  return withAuthHeaders(
    json({ error: "Invalid intent" }, { status: 400 }),
    headers
  );
}

export default function ThreadViewPage() {
  const { thread, emailsWithAttachments, sendAsAddresses } =
    useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [hasScrolledInitially, setHasScrolledInitially] = useState(false);

  // State for reply target (which email to reply to)
  const [replyToEmail, setReplyToEmail] = useState<Email | null>(null);

  // Get the last email in the thread as default reply target
  const lastEmail = emailsWithAttachments[emailsWithAttachments.length - 1]?.email;

  // Scroll to bottom on initial load (shows most recent message)
  useEffect(() => {
    if (!hasScrolledInitially && bottomRef.current) {
      // Use scrollIntoView on the bottom element - more reliable than scrollTop
      bottomRef.current.scrollIntoView({ behavior: "instant", block: "end" });
      setHasScrolledInitially(true);
    }
  }, [hasScrolledInitially, emailsWithAttachments]);

  // Handle reply button click on individual emails
  const handleReply = useCallback((email: Email) => {
    setReplyToEmail(email as Email);
    // Scroll to bottom where composer is
    setTimeout(() => {
      document.getElementById("reply-composer")?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }, 100);
  }, []);

  // Handle successful reply
  const handleReplySuccess = useCallback(() => {
    setReplyToEmail(null);
    // Revalidate to fetch the new email, then scroll to bottom
    revalidator.revalidate();
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 500);
  }, [revalidator]);

  const breadcrumbs = [
    { label: "Emails", href: "/emails" },
    { label: thread.subject },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <Breadcrumbs items={breadcrumbs} />

        <div className="mt-4">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            {thread.subject}
          </h1>

          {/* Thread metadata */}
          <div className="flex flex-wrap items-center gap-4 mt-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {thread.emailCount} {thread.emailCount === 1 ? "message" : "messages"}
            </span>

            {/* Entity badges */}
            <div className="flex flex-wrap gap-2">
              {thread.quoteId && (
                <Link
                  to={`/quotes/${thread.quoteId}`}
                  className="text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
                >
                  Quote #{thread.quoteId}
                </Link>
              )}
              {thread.orderId && (
                <Link
                  to={`/orders/${thread.orderId}`}
                  className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                >
                  Order #{thread.orderId}
                </Link>
              )}
              {thread.customerId && (
                <Link
                  to={`/customers/${thread.customerId}`}
                  className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                >
                  Customer #{thread.customerId}
                </Link>
              )}
            </div>

            {/* Participants */}
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Participants:{" "}
              <span className="text-gray-700 dark:text-gray-300">
                {thread.participants.slice(0, 3).join(", ")}
                {thread.participants.length > 3 &&
                  ` +${thread.participants.length - 3} more`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Email messages */}
      <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-800">
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {emailsWithAttachments.map(({ email, attachments }, index) => (
            <EmailMessage
              key={email.id}
              email={email as Email}
              attachments={attachments as EmailAttachment[]}
              isFirst={index === 0}
              isLast={index === emailsWithAttachments.length - 1}
              onReply={handleReply}
            />
          ))}
        </div>

        {/* Reply composer */}
        {lastEmail && (
          <div id="reply-composer">
            <ReplyComposer
              replyToEmail={(replyToEmail || lastEmail) as Email}
              sendAsAddresses={sendAsAddresses}
              onSuccess={handleReplySuccess}
              onCancel={() => setReplyToEmail(null)}
            />
          </div>
        )}
        
        {/* Scroll anchor at bottom */}
        <div ref={bottomRef} />
      </div>

      {/* Back button (mobile-friendly) */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 md:hidden">
        <Link to="/emails">
          <Button variant="secondary" className="w-full">
            Back to Inbox
          </Button>
        </Link>
      </div>
    </div>
  );
}
