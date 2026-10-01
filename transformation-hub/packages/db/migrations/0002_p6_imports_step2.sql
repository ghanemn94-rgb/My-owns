CREATE TABLE "import_output" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"record_type" varchar(32) NOT NULL,
	"record_id" uuid NOT NULL,
	"record_code" varchar(64),
	"created_version" integer NOT NULL,
	"rolled_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_output_type_ck" CHECK ("import_output"."record_type" in ('risk', 'task', 'source_claim', 'change_request'))
);
--> statement-breakpoint
CREATE TABLE "import_sheet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"sheet_no" integer NOT NULL,
	"name" text NOT NULL,
	"rows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_execution_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"adapter_key" varchar(64) NOT NULL,
	"operation" varchar(24) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"code" varchar(64),
	"detail" text,
	"actor_user_id" uuid,
	"correlation_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"adapter_key" varchar(64) NOT NULL,
	"delivery_id" varchar(128) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sender_timestamp" timestamp with time zone NOT NULL,
	"status" varchar(16) DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "import_batch" ALTER COLUMN "filename" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ALTER COLUMN "summary" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "import_batch" ALTER COLUMN "summary" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "import_row" ALTER COLUMN "normalized" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "import_row" ALTER COLUMN "normalized" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "code" varchar(32) NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "file_type" varchar(16) NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "sha256" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "size_bytes" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "classification" "classification" NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "quarantine_key" text;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "failure_code" varchar(64);--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "failure_detail" text;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "sheets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "headers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "findings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "preview_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "rolled_back_by" uuid;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "rollback_reason" text;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "errors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "notes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "formula_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "match_type" varchar(32);--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "match_id" uuid;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "match_code" varchar(64);--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "governed_reason" varchar(32);--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "diff" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "duplicate_of_row" integer;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "decision" varchar(16);--> statement-breakpoint
ALTER TABLE "integration_connection" ADD COLUMN "adapter_key" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD COLUMN "last_check_code" varchar(64);--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "message_code" varchar(96);--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "message_params" jsonb;--> statement-breakpoint
ALTER TABLE "import_output" ADD CONSTRAINT "import_output_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_output" ADD CONSTRAINT "import_output_batch_fk" FOREIGN KEY ("project_id","batch_id") REFERENCES "public"."import_batch"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_sheet" ADD CONSTRAINT "import_sheet_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_sheet" ADD CONSTRAINT "import_sheet_batch_fk" FOREIGN KEY ("project_id","batch_id") REFERENCES "public"."import_batch"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_execution_log" ADD CONSTRAINT "integration_execution_log_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_output_batch_idx" ON "import_output" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_sheet_uq" ON "import_sheet" USING btree ("batch_id","sheet_no");--> statement-breakpoint
CREATE INDEX "integration_execution_log_idx" ON "integration_execution_log" USING btree ("org_id","adapter_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_nonce_uq" ON "webhook_delivery" USING btree ("org_id","adapter_key","delivery_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_status_idx" ON "webhook_delivery" USING btree ("org_id","adapter_key","status","created_at");--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_document_fk" FOREIGN KEY ("project_id","document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_batch_code_uq" ON "import_batch" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "import_batch_status_idx" ON "import_batch" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connection_adapter_uq" ON "integration_connection" USING btree ("org_id","adapter_key");--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_kind_ck" CHECK ("import_batch"."kind" in ('risk', 'task', 'decision', 'source_claims', 'document_claims'));--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_file_type_ck" CHECK ("import_batch"."file_type" in ('xlsx', 'csv', 'docx', 'pdf', 'png', 'jpeg'));--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_approval_ck" CHECK ("import_batch"."status" not in ('applied', 'rolled_back') or ("import_batch"."approved_by" is not null and "import_batch"."approved_at" is not null and "import_batch"."applied_at" is not null));--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_not_self_ck" CHECK ("import_batch"."approved_by" is null or "import_batch"."approved_by" <> "import_batch"."created_by");--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_decision_ck" CHECK ("import_row"."decision" is null or "import_row"."decision" in ('accepted', 'declined'));