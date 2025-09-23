import type { EventLog } from "~/lib/events";

/**
 * Transforms event titles and descriptions for the timeline component
 * to be more concise and contextual since the timeline is already scoped
 * to a specific entity
 */
export function formatEventForTimeline(event: EventLog): {
  title: string;
  description: string | null;
} {
  const metadata = event.metadata as Record<string, unknown> | null;

  // Handle order update events
  if (event.eventType === "order_updated") {
    // Check if we have the expected metadata structure
    if (!metadata?.changes || !metadata?.updatedFields) {
      // Fallback for older events or different structure
      const cleanDescription = event.description?.replace(/^Updated fields:\s*/i, "");
      return {
        title: "Order Updated",
        description: cleanDescription || null
      };
    }

    const changes = metadata.changes as Record<string, { old: unknown; new: unknown }>;
    const updatedFields = metadata.updatedFields as string[];

    // Handle specific field updates with more detail
    if (updatedFields && updatedFields.length === 1) {
      const field = updatedFields[0];
      const change = changes ? changes[field] : undefined;

      if (field === "shipDate" && change) {
        const oldDate = change.old ? new Date(change.old as string | number).toLocaleDateString() : "Not set";
        const newDate = change.new ? new Date(change.new as string | number).toLocaleDateString() : "Not set";
        return {
          title: "Ship Date Updated",
          description: `${oldDate} → ${newDate}`
        };
      }

      if (field === "dueDate" && change) {
        const oldDate = change.old ? new Date(change.old as string | number).toLocaleDateString() : "Not set";
        const newDate = change.new ? new Date(change.new as string | number).toLocaleDateString() : "Not set";
        return {
          title: "Due Date Updated",
          description: `${oldDate} → ${newDate}`
        };
      }

      if (field === "poNumber" && change) {
        return {
          title: "PO Number Updated",
          description: `${change.old || "Not set"} → ${change.new || "Not set"}`
        };
      }

      if (field === "quantity" && change) {
        return {
          title: "Quantity Updated",
          description: `${change.old || 0} → ${change.new || 0} units`
        };
      }

      if (field === "totalAmount" && change) {
        const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
        return {
          title: "Total Amount Updated",
          description: `${formatter.format(Number(change.old) || 0)} → ${formatter.format(Number(change.new) || 0)}`
        };
      }
    }

    // Handle multiple field updates
    if (updatedFields && updatedFields.length > 1) {
      return {
        title: "Multiple Fields Updated",
        description: updatedFields.map(field => {
          const change = changes ? changes[field] : undefined;
          if (field.endsWith("Date") && change && change.old && change.new) {
            return `${field}: ${new Date(change.old as string | number).toLocaleDateString()} → ${new Date(change.new as string | number).toLocaleDateString()}`;
          }
          return field;
        }).join(", ")
      };
    }
  }

  // Handle status changes
  if (event.eventType === "status_change") {
    const prevStatus = metadata?.previousStatus || "Unknown";
    const newStatus = metadata?.newStatus || event.title.split(" to ")[1] || "Unknown";
    return {
      title: "Status Changed",
      description: `${prevStatus} → ${newStatus}`
    };
  }

  // Handle vendor assignments
  if (event.eventType === "vendor_assigned") {
    const vendorName = typeof metadata?.vendorName === 'string' ? metadata.vendorName : null;
    const vendorId = metadata?.vendorId;
    return {
      title: "Vendor Assigned",
      description: vendorName || (vendorId ? `Vendor ID: ${vendorId}` : null)
    };
  }

  // Handle note events
  if (event.eventType === "note_added") {
    const content = metadata?.content;
    const notePreview = content && typeof content === 'string' ?
      content.substring(0, 50) + (content.length > 50 ? "..." : "") :
      null;
    return {
      title: "Note Added",
      description: notePreview
    };
  }

  if (event.eventType === "note_updated") {
    return {
      title: "Note Updated",
      description: null
    };
  }

  if (event.eventType === "note_archived") {
    return {
      title: "Note Archived",
      description: null
    };
  }

  // Handle attachment events
  if (event.eventType === "attachment_created" || event.eventType === "file_uploaded") {
    return {
      title: "File Uploaded",
      description: typeof metadata?.fileName === 'string' ? metadata.fileName : "Unknown file"
    };
  }

  if (event.eventType === "attachment_deleted") {
    return {
      title: "File Deleted",
      description: typeof metadata?.fileName === 'string' ? metadata.fileName : null
    };
  }

  // Handle part events
  if (event.eventType === "part_added") {
    const partInfo = [];
    if (metadata?.partNumber) partInfo.push(`#${metadata.partNumber}`);
    if (metadata?.quantity) partInfo.push(`Qty: ${metadata.quantity}`);
    if (metadata?.unitPrice) {
      const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
      partInfo.push(formatter.format(metadata.unitPrice as number));
    }
    return {
      title: "Part Added",
      description: partInfo.length > 0 ? partInfo.join(" • ") : null
    };
  }

  if (event.eventType === "part_removed") {
    return {
      title: "Part Removed",
      description: metadata?.partNumber ? `#${metadata.partNumber}` : null
    };
  }

  if (event.eventType === "part_updated") {
    return {
      title: "Part Updated",
      description: metadata?.partNumber ? `#${metadata.partNumber}` : null
    };
  }

  // Handle quote events
  if (event.eventType === "quote_created") {
    return {
      title: "Quote Created",
      description: metadata?.quoteNumber ? `#${metadata.quoteNumber}` : null
    };
  }

  if (event.eventType === "quote_converted") {
    return {
      title: "Quote Converted to Order",
      description: metadata?.orderNumber ? `Order #${metadata.orderNumber}` : null
    };
  }

  // Handle financial events
  if (event.eventCategory === "financial") {
    if (event.title.includes("Invoice")) {
      return {
        title: event.title.replace(/Order #\d+\s*/, ""),
        description: metadata?.invoiceNumber ? `Invoice #${metadata.invoiceNumber}` : null
      };
    }
    if (event.title.includes("Payment")) {
      const amount = metadata?.amount;
      if (amount) {
        const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
        return {
          title: "Payment Received",
          description: formatter.format(amount as number)
        };
      }
    }
  }

  // Handle creation events - remove redundant entity references
  if (event.eventType === "order_created") {
    return {
      title: "Order Created",
      description: `Initial status: ${metadata?.status || "Pending"}`
    };
  }

  if (event.eventType === "customer_created" || event.eventType === "vendor_created") {
    return {
      title: event.entityType === "customer" ? "Customer Created" : "Vendor Created",
      description: null
    };
  }

  // Remove entity reference from title if it matches the current entity
  let cleanTitle = event.title;

  // Remove patterns like "Order #XXX updated -" or "Order #XXX"
  if (event.entityType === "order") {
    cleanTitle = cleanTitle.replace(/^Order #[\w-]+\s*(-|updated -|created -|:)?\s*/i, "");
  }
  if (event.entityType === "customer") {
    cleanTitle = cleanTitle.replace(/^Customer\s+"[^"]+"\s*(-|updated -|created -|:)?\s*/i, "");
  }
  if (event.entityType === "vendor") {
    cleanTitle = cleanTitle.replace(/^Vendor\s+"[^"]+"\s*(-|updated -|created -|:)?\s*/i, "");
  }
  if (event.entityType === "part") {
    cleanTitle = cleanTitle.replace(/^Part #[\w-]+\s*(-|updated -|created -|:)?\s*/i, "");
  }
  if (event.entityType === "quote") {
    cleanTitle = cleanTitle.replace(/^Quote #[\w-]+\s*(-|updated -|created -|:)?\s*/i, "");
  }

  // If we cleaned the title and it's now empty or just "updated", provide a better default
  if (!cleanTitle || cleanTitle.trim() === "updated" || cleanTitle.trim() === "created") {
    cleanTitle = event.eventType
      .split("_")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  return {
    title: cleanTitle || event.title,
    description: event.description
  };
}