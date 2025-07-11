import { ActionFunctionArgs, redirect } from "@remix-run/node";
import { createServerClient } from "~/lib/supabase";
import { withAuthHeaders } from "~/lib/auth.server";

export async function action({ request }: ActionFunctionArgs) {
  const { supabase, headers } = createServerClient(request);
  
  // Sign out the user
  await supabase.auth.signOut();
  
  return withAuthHeaders(redirect("/login"), headers);
}

export async function loader() {
  // Redirect to login if someone tries to GET /logout
  return redirect("/login");
}