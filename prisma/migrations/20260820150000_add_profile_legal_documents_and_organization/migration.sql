-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('PERSONAL', 'BUSINESS');

-- AlterTable
ALTER TABLE "employee_documents" ADD COLUMN     "category" "DocumentCategory" NOT NULL DEFAULT 'PERSONAL',
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "isPrivate" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "originalFileName" TEXT,
ALTER COLUMN "fileUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "employee_profiles" ADD COLUMN     "designation" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarStorageId" TEXT,
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "emergencyContactRelationship" TEXT,
ADD COLUMN     "nidNumber" TEXT;

-- CreateTable
CREATE TABLE "organization_profile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "registrationNumber" TEXT,
    "taxId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "country" TEXT,
    "logoUrl" TEXT,
    "logoStorageId" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_documents_userId_category_idx" ON "employee_documents"("userId", "category");

-- AddForeignKey
ALTER TABLE "organization_profile" ADD CONSTRAINT "organization_profile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

