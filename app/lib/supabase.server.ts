import { createServerClient as createSupabaseServerClient, parse, serialize } from '@supabase/ssr';
import { getEnv } from './env.server';

const supabaseUrl =
  getEnv('SUPABASE_URL') || getEnv('NEXT_PUBLIC_SUPABASE_URL')!;
const supabaseAnonKey =
  getEnv('SUPABASE_ANON_KEY') || getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')!;

const sessionExpiryRaw = getEnv('SESSION_EXPIRY');
const sessionExpirySeconds = sessionExpiryRaw
  ? parseInt(sessionExpiryRaw, 10)
  : undefined;

const LAST_ACTIVITY_COOKIE = 'sb-last-activity';

/** Server client for loader/action functions */
export function createServerClient(request: Request) {
  const cookies = parse(request.headers.get('Cookie') ?? '');
  const headers = new Headers();
  let sessionExpired = false;

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
        get(key: string) {
          if (sessionExpired && key.startsWith('sb-')) {
            return null;
          }
          return cookies[key];
        },
        set(key: string, value: string, options: Parameters<typeof serialize>[2]) {
          headers.append('Set-Cookie', serialize(key, value, options));
        },
        remove(key: string, options: Parameters<typeof serialize>[2]) {
          headers.append('Set-Cookie', serialize(key, '', options));
        },
      },
    }
  );

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
