-- AlterTable
ALTER TABLE "api_tokens" ALTER COLUMN "id" SET DEFAULT nanoid('tok'),
ALTER COLUMN "token" SET DEFAULT public.gen_random_uuid() || '-' || public.gen_random_uuid();

-- AlterTable
ALTER TABLE "customer_tokens" ALTER COLUMN "id" SET DEFAULT nanoid('tok'),
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
