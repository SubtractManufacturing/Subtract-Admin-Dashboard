import { createServerClient as createSupabaseServerClient, parse, serialize } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

// Get environment variables (remove NEXT_PUBLIC_ prefix)
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Browser client - only for client-side operations
export function createBrowserClient() {
  return createClient(
    supabaseUrl,
    supabaseAnonKey
  );
}

// Server client for loader/action functions
export function createServerClient(request: Request) {
  const cookies = parse(request.headers.get('Cookie') ?? '');
  const headers = new Headers();

  const supabase = createSupabaseServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        get(key) {
          return cookies[key];
        },
        set(key, value, options) {
          headers.append('Set-Cookie', serialize(key, value, options));
        },
        remove(key, options) {
          headers.append('Set-Cookie', serialize(key, '', options));
        },
      },
    }
  );

  return { supabase, headers };
}