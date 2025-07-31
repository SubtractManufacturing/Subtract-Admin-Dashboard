/**
 * Validates and sanitizes redirect URLs to prevent open redirect vulnerabilities
 */
export function isValidRedirectUrl(url: string | null, request: Request): boolean {
  if (!url) return false;

  try {
    // Parse the URL
    const redirectUrl = new URL(url, request.url);
    const currentUrl = new URL(request.url);

    // Only allow redirects to the same origin
    if (redirectUrl.origin !== currentUrl.origin) {
      return false;
    }

    // Additional checks for suspicious patterns
    const suspiciousPatterns = [
      /javascript:/i,
      /data:/i,
      /vbscript:/i,
      /file:/i,
      /about:/i,
      /%0d/i,
      /%0a/i,
      /\\x/i,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(url)) {
        return false;
      }
    }

    return true;
  } catch (error) {
    // Invalid URL
    return false;
  }
}

/**
 * Gets a safe redirect URL, defaulting to fallback if the provided URL is invalid
 */
export function getSafeRedirectUrl(
  url: string | null,
  request: Request,
  fallback: string = "/"
): string {
  if (!url) return fallback;
  
  // If it's already a relative path starting with /, it's safe
  if (url.startsWith("/") && !url.startsWith("//")) {
    // Additional validation for relative paths
    const suspiciousPatterns = [
      /\.\.\//, // Directory traversal
      /%2e%2e/i, // URL encoded directory traversal
      /\/{3,}/, // Multiple slashes
    ];
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(url)) {
        return fallback;
      }
    }
    
    return url;
  }
  
  // For absolute URLs, validate thoroughly
  return isValidRedirectUrl(url, request) ? url : fallback;
}

/**
 * List of allowed redirect paths for authentication flows
 */
export const ALLOWED_AUTH_REDIRECTS = [
  "/",
  "/dashboard",
  "/customers",
  "/vendors",
  "/orders",
  "/ActionItems",
  "/settings",
  "/login",
];

/**
 * Checks if a path is in the allowed list of auth redirects
 */
export function isAllowedAuthRedirect(path: string): boolean {
  return ALLOWED_AUTH_REDIRECTS.some(allowed => 
    path === allowed || path.startsWith(allowed + "/") || path.startsWith(allowed + "?")
  );
}