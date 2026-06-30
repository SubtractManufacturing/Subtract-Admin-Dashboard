export function buildToolpathReportHref(opts: {
  toolpathReportUrl?: string | null;
  toolpathPartId?: string | null;
}): string | null {
  if (opts.toolpathReportUrl) return opts.toolpathReportUrl;
  if (opts.toolpathPartId) return `/toolpath/report/${opts.toolpathPartId}`;
  return null;
}
