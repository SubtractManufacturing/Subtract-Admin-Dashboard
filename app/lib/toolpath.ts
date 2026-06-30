export function isAllowedToolpathReportUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === "https://app.toolpath.com" &&
      /^\/parts\/[a-z0-9]+\/report$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export function buildToolpathReportHref(opts: {
  toolpathReportUrl?: string | null;
  toolpathPartId?: string | null;
}): string | null {
  if (opts.toolpathReportUrl && isAllowedToolpathReportUrl(opts.toolpathReportUrl)) {
    return opts.toolpathReportUrl;
  }
  if (opts.toolpathPartId) return `/toolpath/report/${opts.toolpathPartId}`;
  return null;
}
