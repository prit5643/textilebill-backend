-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderLotType" AS ENUM ('IN_HOUSE', 'OUTSOURCED');

-- CreateEnum
CREATE TYPE "WorkOrderLotStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "WorkOrderInvoiceLinkType" AS ENUM ('SALE', 'PURCHASE');

-- CreateEnum
CREATE TYPE "WorkOrderLossReasonCode" AS ENUM ('QUALITY', 'DAMAGE', 'SHORTAGE', 'DELIVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkOrderLossChargeTo" AS ENUM ('VENDOR', 'CUSTOMER', 'OUR_COMPANY');

-- CreateEnum
CREATE TYPE "WorkOrderAutoAdjustMode" AS ENUM ('SALE_RETURN', 'PURCHASE_RETURN', 'LOSS_EXPENSE_NOTE');

-- CreateEnum
CREATE TYPE "WorkOrderLossIncidentStatus" AS ENUM ('PENDING', 'POSTED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WorkOrderAdjustmentType" AS ENUM ('SALE_RETURN', 'PURCHASE_RETURN', 'LOSS_EXPENSE_NOTE');

-- CreateEnum
CREATE TYPE "WorkOrderAdjustmentStatus" AS ENUM ('PENDING', 'POSTED', 'FAILED', 'REVERSED');

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderRef" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "orderedQuantity" DECIMAL(12,3) NOT NULL,
    "saleRate" DECIMAL(14,2) NOT NULL,
    "expectedDeliveryDate" DATE,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "splitOverrideReason" TEXT,
    "splitOverrideAt" TIMESTAMP(3),
    "splitOverrideById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeOverrideReason" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderLot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "lotType" "WorkOrderLotType" NOT NULL,
    "status" "WorkOrderLotStatus" NOT NULL DEFAULT 'OPEN',
    "quantity" DECIMAL(12,3) NOT NULL,
    "acceptedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "rejectedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "vendorAccountId" TEXT,
    "agreedRate" DECIMAL(14,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderInvoiceLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "workOrderLotId" TEXT,
    "invoiceId" TEXT NOT NULL,
    "linkType" "WorkOrderInvoiceLinkType" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderInvoiceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderLossIncident" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "workOrderLotId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "reasonCode" "WorkOrderLossReasonCode" NOT NULL,
    "reasonNote" TEXT NOT NULL,
    "chargeTo" "WorkOrderLossChargeTo" NOT NULL,
    "status" "WorkOrderLossIncidentStatus" NOT NULL DEFAULT 'PENDING',
    "occurredAt" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderLossIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderAutoAdjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "lossIncidentId" TEXT NOT NULL,
    "mode" "WorkOrderAutoAdjustMode" NOT NULL,
    "adjustmentType" "WorkOrderAdjustmentType" NOT NULL,
    "status" "WorkOrderAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderAutoAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_companyId_idx" ON "WorkOrder"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "WorkOrder_customerAccountId_idx" ON "WorkOrder"("customerAccountId");

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE INDEX "WorkOrder_deletedAt_idx" ON "WorkOrder"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_companyId_orderRef_key" ON "WorkOrder"("companyId", "orderRef");

-- CreateIndex
CREATE INDEX "WorkOrderLot_tenantId_companyId_idx" ON "WorkOrderLot"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "WorkOrderLot_workOrderId_idx" ON "WorkOrderLot"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderLot_vendorAccountId_idx" ON "WorkOrderLot"("vendorAccountId");

-- CreateIndex
CREATE INDEX "WorkOrderInvoiceLink_tenantId_companyId_idx" ON "WorkOrderInvoiceLink"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "WorkOrderInvoiceLink_workOrderId_idx" ON "WorkOrderInvoiceLink"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderInvoiceLink_invoiceId_idx" ON "WorkOrderInvoiceLink"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderInvoiceLink_workOrderLotId_key" ON "WorkOrderInvoiceLink"("workOrderLotId");

-- CreateIndex
CREATE INDEX "WorkOrderLossIncident_tenantId_companyId_idx" ON "WorkOrderLossIncident"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "WorkOrderLossIncident_workOrderId_idx" ON "WorkOrderLossIncident"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderLossIncident_workOrderLotId_idx" ON "WorkOrderLossIncident"("workOrderLotId");

-- CreateIndex
CREATE INDEX "WorkOrderLossIncident_status_idx" ON "WorkOrderLossIncident"("status");

-- CreateIndex
CREATE INDEX "WorkOrderAutoAdjustment_tenantId_companyId_idx" ON "WorkOrderAutoAdjustment"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "WorkOrderAutoAdjustment_workOrderId_idx" ON "WorkOrderAutoAdjustment"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderAutoAdjustment_status_idx" ON "WorkOrderAutoAdjustment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderAutoAdjustment_lossIncidentId_key" ON "WorkOrderAutoAdjustment"("lossIncidentId");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_customerAccountId_tenantId_fkey" FOREIGN KEY ("customerAccountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_updatedById_tenantId_fkey" FOREIGN KEY ("updatedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_splitOverrideById_tenantId_fkey" FOREIGN KEY ("splitOverrideById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_closedById_tenantId_fkey" FOREIGN KEY ("closedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLot" ADD CONSTRAINT "WorkOrderLot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLot" ADD CONSTRAINT "WorkOrderLot_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLot" ADD CONSTRAINT "WorkOrderLot_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLot" ADD CONSTRAINT "WorkOrderLot_vendorAccountId_tenantId_fkey" FOREIGN KEY ("vendorAccountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderInvoiceLink" ADD CONSTRAINT "WorkOrderInvoiceLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderInvoiceLink" ADD CONSTRAINT "WorkOrderInvoiceLink_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderInvoiceLink" ADD CONSTRAINT "WorkOrderInvoiceLink_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderInvoiceLink" ADD CONSTRAINT "WorkOrderInvoiceLink_workOrderLotId_fkey" FOREIGN KEY ("workOrderLotId") REFERENCES "WorkOrderLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderInvoiceLink" ADD CONSTRAINT "WorkOrderInvoiceLink_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderInvoiceLink" ADD CONSTRAINT "WorkOrderInvoiceLink_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLossIncident" ADD CONSTRAINT "WorkOrderLossIncident_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLossIncident" ADD CONSTRAINT "WorkOrderLossIncident_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLossIncident" ADD CONSTRAINT "WorkOrderLossIncident_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLossIncident" ADD CONSTRAINT "WorkOrderLossIncident_workOrderLotId_fkey" FOREIGN KEY ("workOrderLotId") REFERENCES "WorkOrderLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLossIncident" ADD CONSTRAINT "WorkOrderLossIncident_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderAutoAdjustment" ADD CONSTRAINT "WorkOrderAutoAdjustment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderAutoAdjustment" ADD CONSTRAINT "WorkOrderAutoAdjustment_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderAutoAdjustment" ADD CONSTRAINT "WorkOrderAutoAdjustment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderAutoAdjustment" ADD CONSTRAINT "WorkOrderAutoAdjustment_lossIncidentId_fkey" FOREIGN KEY ("lossIncidentId") REFERENCES "WorkOrderLossIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderAutoAdjustment" ADD CONSTRAINT "WorkOrderAutoAdjustment_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
