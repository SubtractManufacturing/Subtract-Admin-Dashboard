import { LoaderFunctionArgs, ActionFunctionArgs, json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  
  return withAuthHeaders(
    json({ user, userDetails }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { supabase, headers } = createServerClient(request);
  
  // Sign out the user
  await supabase.auth.signOut();
  
  return withAuthHeaders(redirect("/login"), headers);
}

export default function ProtectedLayout() {
  return <Outlet />;
}