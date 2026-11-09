import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import QuoteDetailPage, {
  QuoteDetailErrorBoundary,
} from "~/components/quotes/QuoteDetailPage";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { handleQuoteAction } from "~/lib/quote-detail/action.server";
import { loadQuoteDetail } from "~/lib/quote-detail/loader";
import { createQuoteLoaderDeps } from "~/lib/quote-detail/loader.server";

// Thin by design: what loads, what each action does and what renders all live
// behind seams. See docs/architecture-map.md ("Detail routes").

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const data = await loadQuoteDetail(
    { quoteId: params.quoteId, user, userDetails },
    createQuoteLoaderDeps(),
  );
  return withAuthHeaders(json(data), headers);
}

export async function action(args: ActionFunctionArgs) {
  return handleQuoteAction(args);
}

export default function QuoteDetailRoute() {
  return <QuoteDetailPage />;
}

export function ErrorBoundary() {
  return <QuoteDetailErrorBoundary />;
}
