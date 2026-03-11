import { ActionFunctionArgs, LoaderFunctionArgs, json, redirect } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createServerClient } from "~/lib/supabase";
import { withAuthHeaders } from "~/lib/auth.server";
import { styles, formStyles } from "~/utils/tw-styles";
import {
  getPasswordPolicyChecks,
  normalizePassword,
  PASSWORD_MIN_LENGTH,
  validatePasswordPolicy,
} from "~/lib/password-policy";
import { checkPasswordAgainstHibp } from "~/lib/password-security.server";
import { passwordCheckRateLimiter } from "~/lib/rate-limiter";

interface PasswordCheckActionData {
  type: "password-check";
  checks: ReturnType<typeof getPasswordPolicyChecks>;
  policyError: string | null;
  hibpChecked: boolean;
  isPwned: boolean;
  pwnedCount: number;
  warning: string | null;
}

function isPasswordCheckActionData(data: unknown): data is PasswordCheckActionData {
  if (!data || typeof data !== "object") {
    return false;
  }

  return "type" in data && data.type === "password-check";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { supabase, headers } = createServerClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return withAuthHeaders(json({ hasServerSession: Boolean(user) }), headers);
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = (formData.get("intent") as string) || "submit";
  const accessToken = formData.get("access_token") as string;
  const refreshToken = formData.get("refresh_token") as string;
  const name = ((formData.get("name") as string) || "").trim();
  const rawPassword = (formData.get("password") as string) || "";
  const rawConfirmPassword = (formData.get("confirm_password") as string) || "";
  const normalizedPassword = normalizePassword(rawPassword);
  const normalizedConfirmPassword = normalizePassword(rawConfirmPassword);
  const passwordPolicyError = validatePasswordPolicy(normalizedPassword);

  if (intent === "checkPassword") {
    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const rateLimitKey = `setup-password-check:${clientIp}`;
    const { blocked } = passwordCheckRateLimiter.isBlocked(rateLimitKey);

    if (blocked) {
      return json<PasswordCheckActionData>(
        {
          type: "password-check",
          checks: getPasswordPolicyChecks(normalizedPassword),
          policyError: passwordPolicyError,
          hibpChecked: false,
          isPwned: false,
          pwnedCount: 0,
          warning: "Too many checks right now. Please continue and validate on submit.",
        },
        { status: 429 }
      );
    }

    passwordCheckRateLimiter.recordAttempt(rateLimitKey);

    if (passwordPolicyError) {
      return json<PasswordCheckActionData>({
        type: "password-check",
        checks: getPasswordPolicyChecks(normalizedPassword),
        policyError: passwordPolicyError,
        hibpChecked: false,
        isPwned: false,
        pwnedCount: 0,
        warning: null,
      });
    }

    const hibpResult = await checkPasswordAgainstHibp(normalizedPassword);
    return json<PasswordCheckActionData>({
      type: "password-check",
      checks: getPasswordPolicyChecks(normalizedPassword),
      policyError: null,
      hibpChecked: hibpResult.checked,
      isPwned: hibpResult.isPwned,
      pwnedCount: hibpResult.pwnedCount,
      warning:
        hibpResult.warning ??
        (hibpResult.isPwned
          ? "This password appears in known data breaches. You can continue, but we strongly recommend choosing a different password."
          : null),
    });
  }

  if (!name) {
    return json({ error: "Name is required." }, { status: 400 });
  }

  if (passwordPolicyError) {
    return json({ error: passwordPolicyError }, { status: 400 });
  }

  if (normalizedPassword !== normalizedConfirmPassword) {
    return json({ error: "Passwords do not match." }, { status: 400 });
  }

  const { supabase, headers } = createServerClient(request);

  if (accessToken && refreshToken) {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (sessionError) {
      console.error("Invite session error:", sessionError.message);
      return withAuthHeaders(
        json(
          { error: "Invite link has expired. Please request a new invite from your administrator." },
          { status: 400 }
        ),
        headers
      );
    }
  } else {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return withAuthHeaders(
        json(
          { error: "Invalid or expired invite link. Please request a new invite." },
          { status: 400 }
        ),
        headers
      );
    }
  }

  await checkPasswordAgainstHibp(normalizedPassword);

  const { error: updateError } = await supabase.auth.updateUser({
    password: normalizedPassword,
    data: { name },
  });

  if (updateError) {
    console.error("Password update error:", updateError.message);
    return withAuthHeaders(
      json(
        { error: "Failed to set up account. Please try again." },
        { status: 500 }
      ),
      headers
    );
  }

  return withAuthHeaders(redirect("/"), headers);
}

export default function SetupPassword() {
  const { hasServerSession } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const passwordFetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [tokensReady, setTokensReady] = useState(false);
  const [tokens, setTokens] = useState<{ access_token: string; refresh_token: string } | null>(null);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passwordFetcherRef = useRef(passwordFetcher);
  const lastCheckedPasswordRef = useRef("");

  // Keep fetcher ref current without adding it to effect deps.
  passwordFetcherRef.current = passwordFetcher;

  const normalizedPassword = useMemo(() => normalizePassword(password), [password]);
  const checks = useMemo(() => getPasswordPolicyChecks(normalizedPassword), [normalizedPassword]);
  const passwordCheckData = isPasswordCheckActionData(passwordFetcher.data)
    ? passwordFetcher.data
    : null;
  const submitError =
    actionData && typeof actionData === "object" && "error" in actionData
      ? String(actionData.error)
      : null;
  const isCheckingPassword =
    passwordFetcher.state !== "idle" && normalizedPassword.length >= PASSWORD_MIN_LENGTH;
  const overLengthWarning = normalizedPassword.length > 100;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("sb-invite-tokens");
      if (!raw) {
        setExpired(!hasServerSession);
        setTokensReady(true);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed.access_token) {
        setExpired(!hasServerSession);
        setTokensReady(true);
        return;
      }
      setTokens(parsed);
      setTokensReady(true);
    } catch {
      setExpired(!hasServerSession);
      setTokensReady(true);
    }
  }, [hasServerSession]);

  useEffect(() => {
    if (passwordDebounceRef.current) {
      clearTimeout(passwordDebounceRef.current);
      passwordDebounceRef.current = null;
    }

    if (!normalizedPassword || !checks.hasMinimumLength || !checks.withinMaximumLength) {
      return;
    }

    // Skip if this exact password was already checked to prevent re-triggering
    // when the fetcher's own state changes (idle → submitting → idle).
    if (normalizedPassword === lastCheckedPasswordRef.current) {
      return;
    }

    const timeoutId = setTimeout(() => {
      lastCheckedPasswordRef.current = normalizedPassword;
      const checkFormData = new FormData();
      checkFormData.append("intent", "checkPassword");
      checkFormData.append("password", password);
      passwordFetcherRef.current.submit(checkFormData, { method: "POST" });
    }, 500);

    passwordDebounceRef.current = timeoutId;

    return () => clearTimeout(timeoutId);
    // passwordFetcher intentionally omitted from deps — including it would cause
    // an infinite loop because every submit changes passwordFetcher.state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checks.hasMinimumLength, checks.withinMaximumLength, normalizedPassword, password]);

  if (expired) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-md text-center">
          <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
            Invalid Invite Link
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            This invite link is invalid or has expired. Please contact your administrator to request
            a new invite.
          </p>
          <a href="/login" className={`${styles.button.primary} inline-block`}>
            Go to Login
          </a>
        </div>
      </div>
    );
  }

  if (!tokensReady) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-2xl font-bold mb-2 text-center text-gray-900 dark:text-gray-100">
          Welcome to Subtract
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-6">
          Set up your account to get started.
        </p>
        <Form method="post" className="space-y-4">
          <input type="hidden" name="access_token" value={tokens?.access_token ?? ""} />
          <input type="hidden" name="refresh_token" value={tokens?.refresh_token ?? ""} />

          <div>
            <label htmlFor="name" className={formStyles.label}>
              Full Name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              autoComplete="name"
              className={formStyles.input}
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label htmlFor="password" className={formStyles.label}>
              Password
            </label>
            <input
              type="password"
              id="password"
              name="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              className={formStyles.input}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <div className="mt-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Must be at least {PASSWORD_MIN_LENGTH} characters.</span>
              <span
                className={
                  normalizedPassword.length === 0
                    ? "text-gray-400 dark:text-gray-500"
                    : checks.hasMinimumLength
                    ? "text-green-700 dark:text-green-400"
                    : "text-gray-500 dark:text-gray-400"
                }
              >
                {normalizedPassword.length} / {PASSWORD_MIN_LENGTH}
              </span>
            </div>
            <div className="mt-2 space-y-1 text-xs" aria-live="polite">
              <p
                className={
                  checks.hasMinimumLength
                    ? "text-green-700 dark:text-green-400"
                    : "text-gray-600 dark:text-gray-400"
                }
              >
                {checks.hasMinimumLength ? "✓" : "•"} At least {PASSWORD_MIN_LENGTH} characters
              </p>
              {overLengthWarning && (
                <p className="text-red-600 dark:text-red-400">
                  Password must be 128 characters or fewer ({normalizedPassword.length} / 128)
                </p>
              )}
              {isCheckingPassword && (
                <p className="text-gray-600 dark:text-gray-400">
                  Checking breached-password database...
                </p>
              )}
              {passwordCheckData?.warning && (
                <p className="text-amber-700 dark:text-amber-400">{passwordCheckData.warning}</p>
              )}
              {passwordCheckData &&
                passwordCheckData.hibpChecked &&
                !passwordCheckData.isPwned &&
                !passwordCheckData.warning && (
                  <p className="text-green-700 dark:text-green-400">
                    Password was not found in known breach data.
                  </p>
                )}
              {passwordCheckData?.isPwned && passwordCheckData.pwnedCount > 0 && (
                <p className="text-amber-700 dark:text-amber-400">
                  Found in breach data {passwordCheckData.pwnedCount.toLocaleString()} times.
                </p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="confirm_password" className={formStyles.label}>
              Confirm Password
            </label>
            <input
              type="password"
              id="confirm_password"
              name="confirm_password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              className={formStyles.input}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>

          {submitError && (
            <div className="text-red-600 dark:text-red-400 text-sm">
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className={`${styles.button.primary} w-full`}
          >
            {isSubmitting ? "Setting up..." : "Create Account"}
          </button>
        </Form>
      </div>
    </div>
  );
}
