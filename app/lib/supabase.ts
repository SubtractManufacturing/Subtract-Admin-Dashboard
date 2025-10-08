import { createServerClient as createSupabaseServerClient, parse, serialize } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

// Get environment variables (remove NEXT_PUBLIC_ prefix)
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Session expiry in seconds (undefined means no expiry)
const sessionExpirySeconds = process.env.SESSION_EXPIRY
  ? parseInt(process.env.SESSION_EXPIRY, 10)
  : undefined;

const LAST_ACTIVITY_COOKIE = 'sb-last-activity';

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
  let sessionExpired = false;

  // Check session expiry if configured
  if (sessionExpirySeconds !== undefined) {
    const lastActivity = cookies[LAST_ACTIVITY_COOKIE];
    if (lastActivity) {
      const lastActivityTime = parseInt(lastActivity, 10);
      const now = Math.floor(Date.now() / 1000);
      const timeSinceLastActivity = now - lastActivityTime;

      if (timeSinceLastActivity > sessionExpirySeconds) {
        sessionExpired = true;
      }
    }
  }

  const supabase = createSupabaseServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        get(key) {
          // Return null for auth cookies if session expired
          if (sessionExpired && key.startsWith('sb-')) {
            return null;
          }
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

  // Update last activity timestamp if session is active and not expired
  if (!sessionExpired && sessionExpirySeconds !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    headers.append(
      'Set-Cookie',
      serialize(LAST_ACTIVITY_COOKIE, now.toString(), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: sessionExpirySeconds,
      })
    );
  }

  // Clear last activity cookie if session expired
  if (sessionExpired) {
    headers.append(
      'Set-Cookie',
      serialize(LAST_ACTIVITY_COOKIE, '', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 0,
      })
    );
  }

  return { supabase, headers };
}