import { ActionFunctionArgs, LoaderFunctionArgs, json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation, useLoaderData, useNavigate } from "@remix-run/react";
import { useEffect } from "react";
import { createServerClient } from "~/lib/supabase";
import { withAuthHeaders } from "~/lib/auth.server";
import { styles } from "~/utils/tw-styles";
import { loginRateLimiter } from "~/lib/rate-limiter";
import { createLoginAuditLog } from "~/lib/audit-log";
import { getSafeRedirectUrl } from "~/lib/url-validator";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const next = url.searchParams.get("next");
  return json({ error, next });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const next = formData.get("next") as string;

  // Get client IP for rate limiting
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || 
                   request.headers.get("x-real-ip") || 
                   "unknown";
  
  // Get supabase client and headers first
  const { supabase, headers } = createServerClient(request);
  
  // Check rate limiting
  const rateLimitKey = `login:${clientIp}:${email.toLowerCase()}`;
  const { blocked, remainingAttempts, retryAfter } = loginRateLimiter.isBlocked(rateLimitKey);
  
  if (blocked) {
    const retryAfterMinutes = Math.ceil((retryAfter!.getTime() - Date.now()) / 60000);
    await createLoginAuditLog({
      email,
      ipAddress: clientIp,
      userAgent: request.headers.get("user-agent") || "unknown",
      success: false,
      failureReason: "rate_limited"
    });
    
    return withAuthHeaders(
      json({ 
        error: `Too many login attempts. Please try again in ${retryAfterMinutes} minutes.`,
        rateLimited: true 
      }, { status: 429 }),
      headers
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Record failed attempt
    loginRateLimiter.recordAttempt(rateLimitKey);
    
    await createLoginAuditLog({
      email,
      ipAddress: clientIp,
      userAgent: request.headers.get("user-agent") || "unknown",
      success: false,
      failureReason: error.message
    });
    
    const attemptsMessage = remainingAttempts && remainingAttempts > 1 
      ? ` (${remainingAttempts - 1} attempts remaining)`
      : "";
    
    return withAuthHeaders(
      json({ 
        error: error.message + attemptsMessage,
        remainingAttempts: remainingAttempts ? remainingAttempts - 1 : undefined
      }, { status: 400 }),
      headers
    );
  }

  // Reset rate limiter on successful login
  loginRateLimiter.reset(rateLimitKey);
  
  // Log successful login
  await createLoginAuditLog({
    email,
    userId: data.user?.id,
    ipAddress: clientIp,
    userAgent: request.headers.get("user-agent") || "unknown",
    success: true
  });

  // Validate and use the redirect URL
  const safeRedirectUrl = getSafeRedirectUrl(next, request, "/");
  return withAuthHeaders(redirect(safeRedirectUrl, { headers }), headers);
}

export default function Login() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    const hash = window.location.hash;
    // #region agent log
    fetch('http://127.0.0.1:7778/ingest/889b560c-9294-49a5-a4da-43cf8565d260',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2a4a0a'},body:JSON.stringify({sessionId:'2a4a0a',location:'login.tsx:useEffect',message:'Hash fragment detected',data:{hash:hash||'(empty)',hasAccessToken:hash?.includes('access_token'),hasError:hash?.includes('error')},timestamp:Date.now(),hypothesisId:'H2,H3,H5'})}).catch(()=>{});
    // #endregion
    if (!hash || !hash.includes("access_token")) return;

    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");

    // #region agent log
    fetch('http://127.0.0.1:7778/ingest/889b560c-9294-49a5-a4da-43cf8565d260',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2a4a0a'},body:JSON.stringify({sessionId:'2a4a0a',location:'login.tsx:useEffect:parsed',message:'Parsed hash params',data:{hasAccessToken:Boolean(accessToken),hasRefreshToken:Boolean(refreshToken),type:type},timestamp:Date.now(),hypothesisId:'H3,H5'})}).catch(()=>{});
    // #endregion

    if (accessToken && type === "invite") {
      try {
        sessionStorage.setItem(
          "sb-invite-tokens",
          JSON.stringify({ access_token: accessToken, refresh_token: refreshToken })
        );
        // #region agent log
        fetch('http://127.0.0.1:7778/ingest/889b560c-9294-49a5-a4da-43cf8565d260',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2a4a0a'},body:JSON.stringify({sessionId:'2a4a0a',location:'login.tsx:useEffect:stored',message:'Tokens stored, navigating to setup-password',data:{storedOk:true},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
      } catch {
        // sessionStorage unavailable — fall through to normal login
        return;
      }
      window.history.replaceState(null, "", "/login");
      navigate("/setup-password", { replace: true });
    }
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-900 dark:text-gray-100">
          Subtract Admin Login
        </h2>
        <Form method="post" className="space-y-4">
          {loaderData?.next && (
            <input type="hidden" name="next" value={loaderData.next} />
          )}
          <div>
            <label htmlFor="email" className={styles.form.label}>
              Email
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              className={styles.form.input}
            />
          </div>
          <div>
            <label htmlFor="password" className={styles.form.label}>
              Password
            </label>
            <input
              type="password"
              id="password"
              name="password"
              required
              className={styles.form.input}
            />
          </div>
          {(loaderData?.error || actionData?.error) && (
            <div className="text-red-600 dark:text-red-400 text-sm">
              {loaderData?.error || actionData?.error}
            </div>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className={`${styles.button.primary} w-full`}
          >
            {isSubmitting ? "Signing in..." : "Sign In"}
          </button>
        </Form>
      </div>
    </div>
  );
}