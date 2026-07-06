export type CustomerSortBy = "default" | "recentOrders" | "recentQuotes" | "name";

export function parseCustomerSortBy(value: string | null): CustomerSortBy {
  if (
    value === "default" ||
    value === "recentOrders" ||
    value === "recentQuotes" ||
    value === "name"
  ) {
    return value;
  }

  return "default";
}
