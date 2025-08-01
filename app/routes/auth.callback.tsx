import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { createServerClient } from "~/lib/supabase";
import { withAuthHeaders } from "~/lib/auth.server";
import { getSafeRedirectUrl, isAllowedAuthRedirect } from "~/lib/url-validator";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const token = url.searchParams.get("token"); // Some Supabase versions use 'token' instead
  const type = url.searchParams.get("type");
  const nextParam = url.searchParams.get("next");
  
  // Validate and sanitize the redirect URL
  const next = getSafeRedirectUrl(nextParam, request, "/");
  
  // Additional validation for auth redirects
  if (!isAllowedAuthRedirect(next)) {
    console.warn(`Blocked suspicious redirect attempt to: ${nextParam}`);
  }

  const { supabase, headers } = createServerClient(request);

  // Handle OAuth callback
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error) {
      return withAuthHeaders(redirect(next), headers);
    }
  }

  // Handle email confirmation (including email change confirmations)
  const verifyToken = token_hash || token;
  if (verifyToken && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: verifyToken,
      type: type as "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email",
    });

    if (!error) {
      // For email change, redirect to settings with success message
      if (type === "email_change" || type === "email") {
        return withAuthHeaders(
          redirect("/settings?message=Email successfully updated"),
          headers
        );
      }
      // For other types, redirect to next or home
      return withAuthHeaders(redirect(next), headers);
    }

    // If verification failed, redirect with error
    return redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  // Handle errors passed in URL (from Supabase redirects)
  const error = url.searchParams.get("error_description");
  if (error) {
    return redirect(`/login?error=${encodeURIComponent(error)}`);
  }

  return redirect("/login");
}