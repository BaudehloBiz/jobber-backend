/*
  Warnings:

  - You are about to drop the `deleted_record` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "api_tokens" ALTER COLUMN "id" SET DEFAULT nanoid('tok'),
ALTER COLUMN "token" SET DEFAULT public.gen_random_uuid() || '-' || public.gen_random_uuid();

-- DropTable
DROP TABLE "deleted_record";

-- CreateTable
CREATE TABLE "customer_tokens" (
    "id" TEXT NOT NULL DEFAULT nanoid('cust'),
    "token" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customer_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_tokens_token_key" ON "customer_tokens"("token");

-- CreateIndex
CREATE INDEX "customer_tokens_token_idx" ON "customer_tokens"("token");

-- CreateIndex
CREATE INDEX "customer_tokens_customer_id_idx" ON "customer_tokens"("customer_id");
