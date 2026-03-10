import { ActionFunctionArgs, LoaderFunctionArgs, json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { createServerClient } from "~/lib/supabase";
import { withAuthHeaders } from "~/lib/auth.server";
import { styles, formStyles } from "~/utils/tw-styles";

export async function loader({ request }: LoaderFunctionArgs) {
  const { supabase, headers } = createServerClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return withAuthHeaders(json({ hasServerSession: Boolean(user) }), headers);
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const accessToken = formData.get("access_token") as string;
  const refreshToken = formData.get("refresh_token") as string;
  const name = ((formData.get("name") as string) || "").trim();
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirm_password") as string;

  if (!name) {
    return json({ error: "Name is required." }, { status: 400 });
  }

  if (!password || password.length < 8) {
    return json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  if (password !== confirmPassword) {
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

  const { error: updateError } = await supabase.auth.updateUser({
    password,
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
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [tokensReady, setTokensReady] = useState(false);
  const [tokens, setTokens] = useState<{ access_token: string; refresh_token: string } | null>(null);
  const [expired, setExpired] = useState(false);

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
              autoFocus
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
              minLength={8}
              autoComplete="new-password"
              className={formStyles.input}
            />
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
              minLength={8}
              autoComplete="new-password"
              className={formStyles.input}
            />
          </div>

          {actionData?.error && (
            <div className="text-red-600 dark:text-red-400 text-sm">
              {actionData.error}
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
