ALTER TYPE "public"."integration_kind" ADD VALUE 'webhook';--> statement-breakpoint
ALTER TABLE "import_batch" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "import_batch" ALTER COLUMN "status" SET DEFAULT 'uploaded'::text;--> statement-breakpoint
DROP TYPE "public"."import_status";--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'parsed', 'validated', 'submitted', 'applied', 'rolled_back', 'rejected', 'cancelled', 'failed', 'quarantined');--> statement-breakpoint
ALTER TABLE "import_batch" ALTER COLUMN "status" SET DEFAULT 'uploaded'::"public"."import_status";--> statement-breakpoint
ALTER TABLE "import_batch" ALTER COLUMN "status" SET DATA TYPE "public"."import_status" USING "status"::"public"."import_status";--> statement-breakpoint
ALTER TABLE "import_batch" DROP COLUMN "errors";--> statement-breakpoint
ALTER TABLE "import_row" DROP COLUMN "message";--> statement-breakpoint
ALTER TABLE "import_row" DROP COLUMN "target_type";--> statement-breakpoint
ALTER TABLE "import_row" DROP COLUMN "target_id";--> statement-breakpoint
ALTER TABLE "import_row" DROP COLUMN "before";--> statement-breakpoint
ALTER TABLE "import_row" DROP COLUMN "after";