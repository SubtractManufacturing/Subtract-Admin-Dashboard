ALTER TYPE "public"."attachment_document_kind" ADD VALUE 'customer_purchase_order' BEFORE 'packing_slip';--> statement-breakpoint
ALTER TYPE "public"."attachment_document_kind" ADD VALUE 'order_confirmation';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "po_number" text;