import { ActionFunctionArgs, LoaderFunctionArgs, json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation, useLoaderData } from "@remix-run/react";
import { createServerClient } from "~/lib/supabase";
import { withAuthHeaders } from "~/lib/auth.server";
import { styles } from "~/utils/tw-styles";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  return json({ error });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const { supabase, headers } = createServerClient(request);

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return withAuthHeaders(
      json({ error: error.message }, { status: 400 }),
      headers
    );
  }

  return withAuthHeaders(redirect("/", { headers }), headers);
}

export default function Login() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-900 dark:text-gray-100">
          Subtract Admin Login
        </h2>
        <Form method="post" className="space-y-4">
          <div>
            <label htmlFor="email" className={styles.form.label}>
              Email
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              defaultValue="Admin@test.com"
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