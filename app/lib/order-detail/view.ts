/**
 * Presentation rules for the Order detail page: delivery priority and the
 * delivery banner, status labels and colours, progress, vendor-pay share.
 * Pure and client-safe, so the rules are testable without rendering the page.
 */

export type OrderPriority = "Critical" | "High" | "Normal";

/** Due today or overdue is Critical; within five business days is High. */
export function orderPriority(businessDaysToDelivery: number | null): OrderPriority {
  if (businessDaysToDelivery == null) return "Normal";
  if (businessDaysToDelivery <= 0) return "Critical";
  if (businessDaysToDelivery <= 5) return "High";
  return "Normal";
}

export type DeliveryBanner =
  | { show: false; color: "none"; message: "" }
  | { show: true; color: "amber" | "orange" | "red"; message: string };

const plural = (n: number) => (n === 1 ? "" : "s");

/**
 * The banner above the order. `delivery` is null when no Delivery date is set,
 * which always warns; otherwise it appears only inside five business days.
 */
export function deliveryBanner(
  delivery: { businessDays: number; dateLabel: string } | null,
): DeliveryBanner {
  if (!delivery) {
    return {
      show: true,
      color: "amber",
      message: "No Delivery Date set. Set a Delivery Date to track this order.",
    };
  }
  const { businessDays: days, dateLabel } = delivery;
  if (days > 5) return { show: false, color: "none", message: "" };
  if (days >= 1) {
    return {
      show: true,
      color: "orange",
      message: `Delivery Date is in ${days} business day${plural(days)} (${dateLabel})`,
    };
  }
  if (days === 0) {
    return { show: true, color: "red", message: `Delivery Date is today (${dateLabel})` };
  }
  const ago = Math.abs(days);
  return {
    show: true,
    color: "red",
    message: `Delivery Date was ${ago} business day${plural(ago)} ago (${dateLabel})`,
  };
}

export function orderStatusLabel(status: string): string {
  switch (status) {
    case "Waiting_For_Shop_Selection":
      return "Waiting for Shop Selection";
    case "In_Production":
      return "In Production";
    case "In_Inspection":
      return "In Inspection";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function orderStatusBadgeClasses(status: string): string {
  switch (status.toLowerCase()) {
    case "waiting_for_shop_selection":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
    case "in_production":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    case "in_inspection":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
    case "shipped":
      return "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300";
    case "delivered":
      return "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400";
    case "completed":
      return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
    case "cancelled":
      return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
    case "archived":
      return "bg-gray-900 text-gray-100 dark:bg-gray-950 dark:text-gray-300";
    default:
      // Pending and anything unknown
      return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300";
  }
}

export function orderPriorityBadgeClasses(priority: string): string {
  switch (priority) {
    case "Critical":
      return "bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100";
    case "High":
      return "bg-orange-200 text-orange-900 dark:bg-orange-800 dark:text-orange-100";
    default:
      return "bg-green-200 text-green-900 dark:bg-green-800 dark:text-green-100";
  }
}

const STATUS_PROGRESS: Readonly<Record<string, number>> = {
  Pending: 10,
  Waiting_For_Shop_Selection: 20,
  In_Production: 50,
  In_Inspection: 75,
  Shipped: 90,
  Delivered: 95,
  Completed: 100,
  Cancelled: 0,
  Archived: 100,
};

/** Percent complete shown on the progress bar. */
export function orderProgress(status: string): number {
  return STATUS_PROGRESS[status] ?? 0;
}

/** Vendor pay as a percent of the order total; 0 when there is no total. */
export function vendorPayPercentage(vendorPay: string | null, totalPrice: string | null): number {
  const total = parseFloat(totalPrice || "0");
  if (!(total > 0)) return 0;
  return (parseFloat(vendorPay || "0") / total) * 100;
}

/** "$1,234.50"; empty reads as "$0.00". */
export function formatOrderMoney(amount: string | null | undefined): string {
  if (!amount) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    parseFloat(amount),
  );
}

export function formatOrderDate(date: Date | string | null | undefined): string {
  if (!date) return "--";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "numeric", day: "numeric" });
}
