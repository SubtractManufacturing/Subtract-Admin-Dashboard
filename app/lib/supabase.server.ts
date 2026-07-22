import {
  createServerClient as createSupabaseServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { getEnv } from './env.server';

const supabaseUrl =
  getEnv('SUPABASE_URL') || getEnv('NEXT_PUBLIC_SUPABASE_URL')!;
const supabaseAnonKey =
  getEnv('SUPABASE_ANON_KEY') || getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')!;

const sessionExpiryRaw = getEnv('SESSION_EXPIRY');
const parsedExpiry = sessionExpiryRaw ? parseInt(sessionExpiryRaw, 10) : NaN;
const sessionExpirySeconds =
  Number.isFinite(parsedExpiry) && parsedExpiry > 0
    ? parsedExpiry
    : undefined;

const LAST_ACTIVITY_COOKIE = 'sb-last-activity';

function isAuthCookie(key: string): boolean {
  return key.startsWith('sb-') && key !== LAST_ACTIVITY_COOKIE;
}

function clearCookieOptions(): CookieOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  };
}

/** Server client for loader/action functions */
export function createServerClient(request: Request) {
  const cookieList = parseCookieHeader(request.headers.get('Cookie') ?? '');
  const cookies: Record<string, string> = {};
  for (const { name, value } of cookieList) {
    cookies[name] = value ?? '';
  }
  const headers = new Headers();
  let sessionExpired = false;

  if (sessionExpirySeconds !== undefined) {
    const lastActivity = cookies[LAST_ACTIVITY_COOKIE];
    const hasAuthCookies = Object.keys(cookies).some(
      (key) => isAuthCookie(key) && cookies[key],
    );

    if (lastActivity) {
      const lastActivityTime = parseInt(lastActivity, 10);
      const now = Math.floor(Date.now() / 1000);
      if (
        !Number.isFinite(lastActivityTime) ||
        now - lastActivityTime > sessionExpirySeconds
      ) {
        sessionExpired = true;
      }
    } else if (hasAuthCookies) {
      // Inactivity marker missing but auth cookies remain → treat as expired
      sessionExpired = true;
    }
  }

  const supabase = createSupabaseServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        get(key: string) {
          if (sessionExpired && isAuthCookie(key)) {
            return null;
          }
          return cookies[key];
        },
        set(key: string, value: string, options: CookieOptions) {
          headers.append('Set-Cookie', serializeCookieHeader(key, value, options));
        },
        remove(key: string, options: CookieOptions) {
          headers.append('Set-Cookie', serializeCookieHeader(key, '', options));
        },
      },
    }
  );

  if (!sessionExpired && sessionExpirySeconds !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    headers.append(
      'Set-Cookie',
      serializeCookieHeader(LAST_ACTIVITY_COOKIE, now.toString(), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: sessionExpirySeconds,
      })
    );
  }

  if (sessionExpired) {
    for (const key of Object.keys(cookies)) {
      if (isAuthCookie(key)) {
        headers.append(
          'Set-Cookie',
          serializeCookieHeader(key, '', clearCookieOptions()),
        );
      }
    }
    headers.append(
      'Set-Cookie',
      serializeCookieHeader(LAST_ACTIVITY_COOKIE, '', clearCookieOptions()),
    );
  }

  return { supabase, headers };
}
