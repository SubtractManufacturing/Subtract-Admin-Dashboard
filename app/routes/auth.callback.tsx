import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { createServerClient } from "~/lib/supabase";
import { withAuthHeaders } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (code) {
    const { supabase, headers } = createServerClient(request);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error) {
      return withAuthHeaders(redirect("/"), headers);
    }
  }

  return redirect("/login");
}