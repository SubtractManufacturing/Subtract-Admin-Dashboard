CREATE TABLE "cad_file_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"is_current_version" boolean DEFAULT false NOT NULL,
	"s3_key" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer,
	"content_type" text,
	"uploaded_by" text,
	"uploaded_by_email" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cad_file_versions" ADD CONSTRAINT "cad_file_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cad_versions_entity_idx" ON "cad_file_versions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "cad_versions_current_idx" ON "cad_file_versions" USING btree ("entity_type","entity_id","is_current_version");--> statement-breakpoint
CREATE INDEX "cad_versions_version_idx" ON "cad_file_versions" USING btree ("entity_type","entity_id","version");