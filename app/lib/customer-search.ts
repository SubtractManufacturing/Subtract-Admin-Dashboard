/** Client-safe Customer search for picking merge candidates by hand. */

export type CustomerSearchRecord = {
  id: number;
  displayName: string;
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
};

const digitsOf = (value: string) => value.replace(/\D/g, "");

/** A search token matches a field by substring, or a phone by its digits. */
function tokenMatches(
  token: string,
  fields: string[],
  phoneDigits: string,
): boolean {
  if (fields.some((field) => field.includes(token))) return true;
  const digits = digitsOf(token);
  return digits.length >= 3 && phoneDigits.includes(digits);
}

/**
 * Customers matching every whitespace-separated word of `query` in their name,
 * company, contact, email or phone (phones match by digits, so "555 1234"
 * finds "(555) 123-4567"). Names that start with the first word come first;
 * otherwise the original order is kept. An empty query lists everyone.
 */
export function searchCustomers(
  records: CustomerSearchRecord[],
  query: string,
  limit = 50,
): { results: CustomerSearchRecord[]; total: number } {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { results: records.slice(0, limit), total: records.length };
  }

  const ranked: Array<{ record: CustomerSearchRecord; rank: number; index: number }> = [];
  records.forEach((record, index) => {
    const name = record.displayName.toLowerCase();
    const fields = [
      name,
      record.companyName,
      record.contactName,
      record.email,
      record.phone,
    ].map((field) => (field ?? "").toLowerCase());
    const phoneDigits = digitsOf(record.phone ?? "");
    if (!tokens.every((token) => tokenMatches(token, fields, phoneDigits))) return;

    const first = tokens[0];
    const rank = name.startsWith(first)
      ? 0
      : fields.some((field) => field.startsWith(first))
        ? 1
        : 2;
    ranked.push({ record, rank, index });
  });

  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return {
    results: ranked.slice(0, limit).map((entry) => entry.record),
    total: ranked.length,
  };
}
