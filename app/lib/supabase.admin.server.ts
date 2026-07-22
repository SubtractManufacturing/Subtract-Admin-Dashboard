import { createClient } from "@supabase/supabase-js";
import { getEnv } from "./env.server";

const supabaseUrl =
  getEnv("SUPABASE_URL") || getEnv("NEXT_PUBLIC_SUPABASE_URL")!;
const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY")!;

export function createAdminClient() {
  if (!supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
