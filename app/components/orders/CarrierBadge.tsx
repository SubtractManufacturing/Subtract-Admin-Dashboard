import { getCarrier, getTrackingUrl } from "~/lib/carriers";

type CarrierBadgeProps = {
  code: string | null | undefined;
  customName?: string | null;
  size?: "sm" | "md";
};

export function CarrierBadge({
  code,
  customName,
  size = "sm",
}: CarrierBadgeProps) {
  if (!code) return null;

  const sizeClass = size === "md" ? "px-2 py-1 text-xs" : "px-1.5 py-0.5 text-[11px]";

  if (code === "OTHER") {
    const label = customName?.trim() || "Other";
    return (
      <span
        className={`inline-flex shrink-0 items-center rounded font-bold bg-gray-500 text-white ${sizeClass}`}
      >
        {label}
      </span>
    );
  }

  const carrier = getCarrier(code);
  if (!carrier) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded font-bold ${carrier.badgeClass} ${sizeClass}`}
    >
      {carrier.abbr}
    </span>
  );
}

type TrackLinkProps = {
  code: string | null | undefined;
  trackingNumber: string;
};

export function TrackLink({ code, trackingNumber }: TrackLinkProps) {
  const url = getTrackingUrl(code, trackingNumber);
  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Track shipment"
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
    >
      Track
      <ExternalLinkIcon />
    </a>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}
