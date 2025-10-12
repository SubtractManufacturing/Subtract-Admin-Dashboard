import { db } from "./db";
import {
  quotePriceCalculations,
  quotePriceCalculationTemplates,
  type NewQuotePriceCalculation,
  type QuotePriceCalculation,
  type NewQuotePriceCalculationTemplate,
  type QuotePriceCalculationTemplate,
  quoteLineItems,
} from "./db/schema";
import { eq, and, desc } from "drizzle-orm";
import { createEvent } from "./events";
import { calculateQuoteTotals } from "./quotes";

export type PriceCalculationEventContext = {
  quoteId: number;
  quotePartId?: string;
  quoteLineItemId?: number;
  calculatedBy: string;
  finalPrice: number;
};

// Get all price calculations for a quote
export async function getQuotePriceCalculations(quoteId: number): Promise<QuotePriceCalculation[]> {
  return await db
    .select()
    .from(quotePriceCalculations)
    .where(eq(quotePriceCalculations.quoteId, quoteId))
    .orderBy(desc(quotePriceCalculations.createdAt));
}

// Get price calculation for a specific line item
export async function getLineItemPriceCalculation(
  quoteLineItemId: number
): Promise<QuotePriceCalculation | null> {
  const results = await db
    .select()
    .from(quotePriceCalculations)
    .where(eq(quotePriceCalculations.quoteLineItemId, quoteLineItemId))
    .orderBy(desc(quotePriceCalculations.createdAt))
    .limit(1);

  return results[0] || null;
}

// Get price calculation for a specific part
export async function getPartPriceCalculation(
  quotePartId: string
): Promise<QuotePriceCalculation | null> {
  const results = await db
    .select()
    .from(quotePriceCalculations)
    .where(eq(quotePriceCalculations.quotePartId, quotePartId))
    .orderBy(desc(quotePriceCalculations.createdAt))
    .limit(1);

  return results[0] || null;
}

// Create a new price calculation
export async function createPriceCalculation(
  calculation: NewQuotePriceCalculation,
  userId: string
): Promise<QuotePriceCalculation> {
  const [newCalculation] = await db
    .insert(quotePriceCalculations)
    .values({
      ...calculation,
      calculatedBy: userId,
    })
    .returning();

  // Format final price to 2 decimal places
  const finalPrice = typeof calculation.finalPrice === 'string'
    ? parseFloat(calculation.finalPrice)
    : calculation.finalPrice;
  const formattedFinalPrice = finalPrice.toFixed(2);

  // Log event
  await createEvent({
    entityType: "quote",
    entityId: calculation.quoteId.toString(),
    eventType: "price_calculated",
    eventCategory: "financial",
    title: "Price Calculated",
    description: `Price calculated: $${formattedFinalPrice}`,
    metadata: {
      calculationId: newCalculation.id,
      quotePartId: calculation.quotePartId,
      quoteLineItemId: calculation.quoteLineItemId,
      finalPrice: formattedFinalPrice,
      leadTimeOption: calculation.leadTimeOption,
    },
    userId,
    userEmail: undefined,
  });

  // If there's an associated line item, update its price
  if (calculation.quoteLineItemId) {
    await updateLineItemPrice(
      calculation.quoteLineItemId,
      typeof calculation.finalPrice === 'string'
        ? parseFloat(calculation.finalPrice)
        : calculation.finalPrice,
      userId
    );
  }

  return newCalculation;
}

// Update line item price based on calculation
export async function updateLineItemPrice(
  lineItemId: number,
  totalPrice: number,
  userId: string
): Promise<void> {
  // Get the current line item to get quantity
  const [lineItem] = await db
    .select()
    .from(quoteLineItems)
    .where(eq(quoteLineItems.id, lineItemId))
    .limit(1);

  if (!lineItem) {
    throw new Error("Line item not found");
  }

  const quantity = lineItem.quantity;
  // Calculate unit price from total price
  const unitPrice = quantity > 0 ? totalPrice / quantity : 0;

  // Update the line item prices
  await db
    .update(quoteLineItems)
    .set({
      unitPrice: unitPrice.toFixed(2),
      totalPrice: totalPrice.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(quoteLineItems.id, lineItemId));

  // Recalculate quote totals after updating line item
  await calculateQuoteTotals(lineItem.quoteId);

  // Log event
  await createEvent({
    entityType: "quote",
    entityId: lineItem.quoteId.toString(),
    eventType: "line_item_price_updated",
    eventCategory: "financial",
    title: "Line Item Price Updated",
    description: `Line item price updated: $${totalPrice.toFixed(2)} ÷ ${quantity} = $${unitPrice.toFixed(2)} per unit`,
    metadata: {
      lineItemId,
      unitPrice: unitPrice.toFixed(2),
      quantity,
      totalPrice: totalPrice.toFixed(2),
    },
    userId,
    userEmail: undefined,
  });
}

// Get all calculation templates
export async function getCalculationTemplates(
  userId?: string
): Promise<QuotePriceCalculationTemplate[]> {
  if (userId) {
    return await db
      .select()
      .from(quotePriceCalculationTemplates)
      .where(
        and(
          eq(quotePriceCalculationTemplates.createdBy, userId),
          eq(quotePriceCalculationTemplates.isGlobal, false)
        )
      )
      .orderBy(quotePriceCalculationTemplates.name);
  }

  // Return only global templates if no user specified
  return await db
    .select()
    .from(quotePriceCalculationTemplates)
    .where(eq(quotePriceCalculationTemplates.isGlobal, true))
    .orderBy(quotePriceCalculationTemplates.name);
}

// Create a new template
export async function createCalculationTemplate(
  template: NewQuotePriceCalculationTemplate,
  userId: string
): Promise<QuotePriceCalculationTemplate> {
  const [newTemplate] = await db
    .insert(quotePriceCalculationTemplates)
    .values({
      ...template,
      createdBy: userId,
    })
    .returning();

  // Log event
  await createEvent({
    entityType: "system",
    entityId: "quote_calculator",
    eventType: "template_created",
    eventCategory: "system",
    title: "Template Created",
    description: `Calculation template created: ${template.name}`,
    metadata: {
      templateId: newTemplate.id,
      templateName: template.name,
      isGlobal: template.isGlobal,
    },
    userId,
    userEmail: undefined,
  });

  return newTemplate;
}

// Delete a template
export async function deleteCalculationTemplate(
  templateId: number,
  userId: string
): Promise<void> {
  const [template] = await db
    .select()
    .from(quotePriceCalculationTemplates)
    .where(eq(quotePriceCalculationTemplates.id, templateId))
    .limit(1);

  if (!template) {
    throw new Error("Template not found");
  }

  // Only allow deletion by creator or if it's a global template and user is admin
  if (template.createdBy !== userId && !template.isGlobal) {
    throw new Error("Not authorized to delete this template");
  }

  await db
    .delete(quotePriceCalculationTemplates)
    .where(eq(quotePriceCalculationTemplates.id, templateId));

  // Log event
  await createEvent({
    entityType: "system",
    entityId: "quote_calculator",
    eventType: "template_deleted",
    eventCategory: "system",
    title: "Template Deleted",
    description: `Calculation template deleted: ${template.name}`,
    metadata: {
      templateId,
      templateName: template.name,
    },
    userId,
    userEmail: undefined,
  });
}

// Batch create calculations for multiple parts
export async function batchCreatePriceCalculations(
  calculations: NewQuotePriceCalculation[],
  userId: string
): Promise<QuotePriceCalculation[]> {
  const newCalculations = await db
    .insert(quotePriceCalculations)
    .values(
      calculations.map((calc) => ({
        ...calc,
        calculatedBy: userId,
      }))
    )
    .returning();

  // Calculate total value with proper formatting
  const totalValue = calculations.reduce((sum, c) => {
    const price = typeof c.finalPrice === 'string'
      ? parseFloat(c.finalPrice)
      : c.finalPrice;
    return sum + price;
  }, 0);

  // Log batch event
  await createEvent({
    entityType: "quote",
    entityId: calculations[0].quoteId.toString(),
    eventType: "batch_price_calculated",
    eventCategory: "financial",
    title: "Batch Price Calculation",
    description: `Batch price calculation for ${calculations.length} items`,
    metadata: {
      calculationIds: newCalculations.map((c) => c.id),
      itemCount: calculations.length,
      totalValue: totalValue.toFixed(2),
    },
    userId,
    userEmail: undefined,
  });

  // Update line item prices
  for (const calc of calculations) {
    if (calc.quoteLineItemId) {
      const price = typeof calc.finalPrice === 'string'
        ? parseFloat(calc.finalPrice)
        : calc.finalPrice;
      await updateLineItemPrice(calc.quoteLineItemId, price, userId);
    }
  }

  return newCalculations;
}

// Get the most recent calculation for each part in a quote
export async function getLatestCalculationsForQuote(
  quoteId: number
): Promise<QuotePriceCalculation[]> {
  // This query gets the latest calculation for each unique part
  const calculations = await db
    .select()
    .from(quotePriceCalculations)
    .where(eq(quotePriceCalculations.quoteId, quoteId))
    .orderBy(desc(quotePriceCalculations.createdAt));

  // Group by part and keep only the latest
  const latestByPart = new Map<string | null, QuotePriceCalculation>();

  for (const calc of calculations) {
    const key = calc.quotePartId || `line-item-${calc.quoteLineItemId}`;
    if (!latestByPart.has(key)) {
      latestByPart.set(key, calc);
    }
  }

  return Array.from(latestByPart.values());
}