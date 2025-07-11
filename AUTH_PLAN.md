# Supabase Authentication Implementation Plan

## Overview
This plan outlines the implementation of Supabase Auth for the Subtract Manufacturing admin dashboard. The implementation focuses on developer-friendly features with configurable settings for production deployment.

## Implementation Goals
- Simple onboarding with email/password authentication
- No auto-logout during development
- Configurable session management for production
- Minimal disruption to existing development workflow
- Seamless integration with existing user management

## Phase 1: Environment & Configuration Setup

### 1.1 Update Environment Variables
```env
# Remove NEXT_PUBLIC_ prefix (Remix doesn't need it)
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key  # For server-side operations

# Auth Configuration
AUTH_SESSION_DURATION=604800  # 7 days in seconds (development)
AUTH_REFRESH_THRESHOLD=3600   # Refresh token 1 hour before expiry
AUTH_REQUIRE_EMAIL_VERIFICATION=false  # Disable for development
```

### 1.2 Create Auth Configuration Module
Create `/app/config/auth.config.ts`:
```typescript
export const authConfig = {
  sessionDuration: Number(process.env.AUTH_SESSION_DURATION || 604800),
  refreshThreshold: Number(process.env.AUTH_REFRESH_THRESHOLD || 3600),
  requireEmailVerification: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true',
  redirectPaths: {
    login: '/login',
    afterLogin: '/',
    afterLogout: '/login',
    unauthorized: '/login'
  }
};
```

## Phase 2: Core Auth Implementation

### 2.1 Update Supabase Client
Enhance `/app/lib/supabase.ts` to include server-side client creation:

```typescript
// Browser client for client-side operations
export const supabase = createBrowserClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Server client factory for loader/action functions
export function createServerClient(request: Request) {
  const cookies = parseCookieHeader(request.headers.get('Cookie') ?? '');
  
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      auth: {
        storage: createCookieStorage(cookies)
      }
    }
  );
}
```

### 2.2 Session Management
Create `/app/lib/auth.server.ts` for server-side auth utilities:

```typescript
import { createServerClient } from './supabase';
import { redirect } from '@remix-run/node';
import { authConfig } from '~/config/auth.config';

export async function requireAuth(request: Request) {
  const supabase = createServerClient(request);
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session) {
    throw redirect(authConfig.redirectPaths.login);
  }
  
  return { session, supabase };
}

export async function getOptionalAuth(request: Request) {
  const supabase = createServerClient(request);
  const { data: { session } } = await supabase.auth.getSession();
  
  return { session, supabase };
}
```

### 2.3 Auth Context for Client-Side
Create `/app/contexts/AuthContext.tsx`:

```typescript
interface AuthContextType {
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  loading: boolean;
}
```

## Phase 3: Database Schema Updates

### 3.1 Update Users Table
Modify the existing users table to work with Supabase Auth:

```sql
-- Remove passwordHash column
ALTER TABLE users DROP COLUMN password_hash;

-- Ensure id matches Supabase auth.users.id
-- Add constraint to link with Supabase auth
ALTER TABLE users 
ADD CONSTRAINT users_auth_id_fkey 
FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
```

### 3.2 Create User Profiles View
Create a database view for easy user data access:

```sql
CREATE VIEW user_profiles AS
SELECT 
  u.id,
  u.email,
  u.name,
  u.created_at,
  au.last_sign_in_at,
  au.email_confirmed_at
FROM users u
JOIN auth.users au ON u.id = au.id;
```

## Phase 4: UI Components

### 4.1 Login Page
Create `/app/routes/login.tsx`:
- Email/password form
- "Remember me" checkbox (sets longer session)
- Simple, clean design matching existing UI
- No password complexity requirements for development

### 4.2 Update Navbar
Modify `/app/components/Navbar.tsx`:
- Replace hardcoded "A" with user initial
- Add dropdown with:
  - User email display
  - Sign out button
  - Optional: Profile settings link

### 4.3 Auth Guard Layout
Create `/app/routes/_protected.tsx` as a parent layout:
```typescript
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await requireAuth(request);
  return json({ user: session.user });
}

export default function ProtectedLayout() {
  const { user } = useLoaderData<typeof loader>();
  
  return (
    <AuthContext.Provider value={{ user }}>
      <Outlet />
    </AuthContext.Provider>
  );
}
```

## Phase 5: Route Protection

### 5.1 Update Routes
Move all protected routes under the `_protected` layout:
- `_protected._index.tsx` (dashboard)
- `_protected.customers.tsx`
- `_protected.vendors.tsx`
- `_protected.orders.tsx`
- `_protected.ActionItems.tsx`

### 5.2 Public Routes
Keep these routes public:
- `/login` - Login page
- `/signup` - Optional signup page
- `/forgot-password` - Optional password reset

## Phase 6: Development Features

### 6.1 Auto-Login for Development
Create `/app/lib/dev-auth.ts`:
```typescript
export async function setupDevAuth() {
  if (process.env.NODE_ENV === 'development' && process.env.DEV_AUTO_LOGIN) {
    // Auto-login with dev credentials
    const email = process.env.DEV_USER_EMAIL;
    const password = process.env.DEV_USER_PASSWORD;
    // Implementation details...
  }
}
```

### 6.2 Session Persistence
- Use Supabase's built-in session persistence
- Configure longer session duration for development
- Implement "Remember me" functionality

## Phase 7: Production Considerations

### 7.1 Environment-Specific Settings
```typescript
const isDevelopment = process.env.NODE_ENV === 'development';

export const authSettings = {
  session: {
    duration: isDevelopment ? 7 * 24 * 60 * 60 : 8 * 60 * 60, // 7 days dev, 8 hours prod
    autoRefresh: true,
    persistSession: isDevelopment
  },
  security: {
    requireEmailVerification: !isDevelopment,
    enforcePasswordPolicy: !isDevelopment,
    enable2FA: false // Future enhancement
  }
};
```

### 7.2 Security Headers
Add security headers in production:
```typescript
export function getSecurityHeaders() {
  return {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  };
}
```

## Phase 8: Migration Strategy

### 8.1 Existing Data Migration
1. Create Supabase auth users for existing users table entries
2. Link existing users to Supabase auth users
3. Migrate any existing sessions

### 8.2 Rollback Plan
- Keep existing users table structure initially
- Implement feature flag for auth activation
- Maintain backward compatibility during transition

## Implementation Timeline

1. **Day 1-2**: Environment setup, core auth implementation
2. **Day 3-4**: UI components (login page, navbar updates)
3. **Day 5-6**: Route protection, testing
4. **Day 7**: Development features, documentation

## Testing Strategy

### Development Testing
- Create test accounts with different roles
- Test session persistence across browser restarts
- Verify no unexpected logouts during development

### Production Testing
- Test session timeout behavior
- Verify email verification flow
- Test password reset functionality
- Load test authentication endpoints

## Configuration Quick Reference

### Development `.env`:
```env
# Supabase
SUPABASE_URL=your_url
SUPABASE_ANON_KEY=your_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key

# Dev Auth
AUTH_SESSION_DURATION=604800
AUTH_REQUIRE_EMAIL_VERIFICATION=false
DEV_AUTO_LOGIN=true
DEV_USER_EMAIL=dev@example.com
DEV_USER_PASSWORD=devpassword123
```

### Production `.env`:
```env
# Supabase
SUPABASE_URL=your_url
SUPABASE_ANON_KEY=your_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key

# Prod Auth
AUTH_SESSION_DURATION=28800
AUTH_REQUIRE_EMAIL_VERIFICATION=true
AUTH_REFRESH_THRESHOLD=3600
```

## Next Steps

1. Review and approve this plan
2. Set up Supabase Auth in your Supabase project
3. Begin implementation following the phases outlined
4. Create test users for development
5. Plan user migration strategy if needed

## Notes

- This plan prioritizes developer experience while maintaining security
- All features are configurable via environment variables
- The implementation is incremental and can be rolled back if needed
- Focus is on email/password auth initially, with social logins as future enhancement