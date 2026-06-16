const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeHardDeleteAt(
  archivedAt: Date,
  retentionDays: number,
): Date {
  return new Date(archivedAt.getTime() + retentionDays * MS_PER_DAY);
}

export function formatArchiveExpiry(
  hardDeleteAt: Date,
  now: Date = new Date(),
): string {
  const diffMs = hardDeleteAt.getTime() - now.getTime();
  if (diffMs <= 0) {
    return "Expired";
  }

  const diffHours = Math.ceil(diffMs / (60 * 60 * 1000));
  if (diffHours < 24) {
    return diffHours === 1 ? "Expires in 1 hour" : `Expires in ${diffHours} hours`;
  }

  const diffDays = Math.ceil(diffMs / MS_PER_DAY);
  return diffDays === 1 ? "Expires in 1 day" : `Expires in ${diffDays} days`;
}

export type SerializedArchivedLineItem = {
  id: number;
  name: string;
  quantity: number;
  archivedAt: string;
  hardDeleteAt: string;
  quotePartId?: string | null;
  partId?: string | null;
};
