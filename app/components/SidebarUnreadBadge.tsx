export function SidebarUnreadBadge({
  count,
  compact,
}: {
  count: number;
  compact: boolean;
}) {
  if (count <= 0) return null;

  return (
    <span
      className={
        compact
          ? "absolute -right-1 -top-1 inline-flex min-h-[14px] min-w-[14px] items-center justify-center rounded-full bg-red-500 px-[3px] text-[9px] font-semibold leading-none text-white tabular-nums"
          : "inline-flex min-h-[1.125rem] min-w-[1.125rem] shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-semibold tabular-nums text-white"
      }
      aria-hidden
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
