import { PrismaClient, MovementType, InvoiceType, WorkOrderStatus, WorkOrderLotType, WorkOrderLotStatus, WorkOrderInvoiceLinkType, WorkOrderLossReasonCode, WorkOrderLossChargeTo, WorkOrderLossIncidentStatus, WorkOrderAutoAdjustMode, WorkOrderAdjustmentType, WorkOrderAdjustmentStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting Stock and Work Order Outsourcing Seeder...');

  const rootUser = await prisma.user.findFirst({
    where: { email: 'root@textilebill.local', deletedAt: null },
    include: { userCompanies: { include: { company: true } } }
  });

  if (!rootUser) throw new Error('Root user not found.');
  const tenantId = rootUser.tenantId;
  const companyId = rootUser.userCompanies[0].companyId;

  // --- 1. GENERATE STOCK MOVEMENTS ---
  console.log('\n📦 Retroactively generating Stock Movements for existing Invoices...');
  const invoices = await prisma.invoice.findMany({
    where: { companyId, deletedAt: null, type: { in: [InvoiceType.SALE, InvoiceType.PURCHASE] } },
    include: { items: true }
  });

  const movements = [];
  for (const inv of invoices) {
    const type = inv.type === InvoiceType.SALE ? MovementType.OUT : MovementType.IN;
    for (const item of inv.items) {
      if (!item.productId) continue;
      movements.push({
        tenantId, companyId,
        productId: item.productId,
        invoiceId: inv.id,
        type,
        quantity: item.quantity,
        date: inv.invoiceDate,
        notes: `System generated for Invoice ${inv.invoiceNumber}`,
      });
    }
  }

  if (movements.length > 0) {
    await prisma.stockMovement.createMany({ data: movements });
    console.log(`✅ Created ${movements.length} Stock Movement records.`);
  } else {
    console.log('⚠️ No products found in invoices to create stock movements.');
  }

  // --- 2. GENERATE REALISTIC WORK ORDERS ---
  console.log('\n🏭 Generating Realistic Closed Work Orders...');
  const customer = await prisma.account.findFirst({ where: { companyId, group: 'SUNDRY_DEBTORS' } });
  const vendor = await prisma.account.findFirst({ where: { companyId, group: 'SUNDRY_CREDITORS' } });

  if (!customer || !vendor) {
    throw new Error('Could not find debtor/creditor accounts to generate Work Orders.');
  }

  // Fetch financial year
  const fy = await prisma.financialYear.findFirst({ where: { companyId } });
  if (!fy) throw new Error('No FinancialYear found');

  // Create a Purchase Invoice to link
  const purchaseInv = await prisma.invoice.create({
    data: {
      tenantId, companyId, accountId: vendor.id, type: InvoiceType.PURCHASE,
      financialYearId: fy.id,
      invoiceNumber: 'PUR-WO-LINK-1', invoiceDate: new Date(),
      subTotal: 12000, taxAmount: 0, totalAmount: 12000,
    }
  });

  // Scenario A: Partial Outsource
  // We have an order of 1000 items, we handle 800, we outsource 200.
  const woA = await prisma.workOrder.create({
    data: {
      tenantId, companyId, orderRef: 'WO-PARTIAL-OUTSOURCE',
      customerAccountId: customer.id, itemName: 'Premium Silk Sarees',
      orderedQuantity: 1000, saleRate: 1500, // Expected Revenue: 1,500,000
      status: WorkOrderStatus.CLOSED, closedAt: new Date(), closedById: rootUser.id,
      lots: {
        create: [
          {
            tenantId, companyId, lotType: WorkOrderLotType.IN_HOUSE,
            quantity: 800, acceptedQuantity: 800, status: WorkOrderLotStatus.CLOSED
          },
          {
            tenantId, companyId, lotType: WorkOrderLotType.OUTSOURCED,
            vendorAccountId: vendor.id, quantity: 200, acceptedQuantity: 190, rejectedQuantity: 10,
            agreedRate: 800, // Vendor cost: 800 * 200 = 160,000
            status: WorkOrderLotStatus.CLOSED
          }
        ]
      }
    },
    include: { lots: true }
  });

  const outsourcedLotA = woA.lots.find(l => l.lotType === 'OUTSOURCED');
  if (outsourcedLotA) {
    // Loss incident for the 10 rejected items (10 * 800 = 8000 deduction)
    const incidentA = await prisma.workOrderLossIncident.create({
      data: {
        tenantId, companyId, workOrderId: woA.id, workOrderLotId: outsourcedLotA.id,
        amount: 8000, reasonCode: WorkOrderLossReasonCode.DAMAGE, reasonNote: 'Tears in fabric',
        chargeTo: WorkOrderLossChargeTo.VENDOR, status: WorkOrderLossIncidentStatus.POSTED,
        occurredAt: new Date()
      }
    });

    await prisma.workOrderAutoAdjustment.create({
      data: {
        tenantId, companyId, workOrderId: woA.id, lossIncidentId: incidentA.id,
        mode: WorkOrderAutoAdjustMode.LOSS_EXPENSE_NOTE, adjustmentType: WorkOrderAdjustmentType.LOSS_EXPENSE_NOTE,
        status: WorkOrderAdjustmentStatus.POSTED, amount: 8000, postedAt: new Date()
      }
    });

    await prisma.workOrderInvoiceLink.create({
      data: {
        tenantId, companyId, workOrderId: woA.id, workOrderLotId: outsourcedLotA.id,
        invoiceId: purchaseInv.id, linkType: WorkOrderInvoiceLinkType.PURCHASE
      }
    });
  }

  // Scenario B: Pure Outsource
  // We take order of 500 items, and fully outsource it.
  const woB = await prisma.workOrder.create({
    data: {
      tenantId, companyId, orderRef: 'WO-PURE-OUTSOURCE',
      customerAccountId: customer.id, itemName: 'Cotton Kurta Set',
      orderedQuantity: 500, saleRate: 1000, // Revenue: 500,000
      status: WorkOrderStatus.CLOSED, closedAt: new Date(), closedById: rootUser.id,
      lots: {
        create: [
          {
            tenantId, companyId, lotType: WorkOrderLotType.OUTSOURCED,
            vendorAccountId: vendor.id, quantity: 500, acceptedQuantity: 500,
            agreedRate: 600, // Cost: 300,000
            status: WorkOrderLotStatus.CLOSED
          }
        ]
      }
    },
    include: { lots: true }
  });

  if (woB.lots[0]) {
    await prisma.workOrderInvoiceLink.create({
      data: {
        tenantId, companyId, workOrderId: woB.id, workOrderLotId: woB.lots[0].id,
        invoiceId: purchaseInv.id, linkType: WorkOrderInvoiceLinkType.PURCHASE
      }
    });
  }

  console.log(`✅ Created 2 Highly Detailed Closed Work Orders with Invoices and Incidents.`);
  console.log('\n🎉 Successfully seeded Stock Movements and Realistic Outsourcing data.');
}

main()
  .catch((e) => {
    console.error('❌ Seeder Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
