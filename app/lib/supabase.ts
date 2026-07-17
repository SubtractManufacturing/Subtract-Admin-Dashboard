import { createClient } from '@supabase/supabase-js';

// Browser-reachable module: keep plain process.env (no Node fs / env.server).
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Browser client - only for client-side operations */
export function createBrowserClient() {
  return createClient(
    supabaseUrl,
    supabaseAnonKey
  );
}
