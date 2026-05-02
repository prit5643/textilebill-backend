import { PrismaClient, ExpenseSourceType, ExpenseStatus, InvoiceType, InvoiceStatus, MovementType, AccountGroupType, VoucherType, WorkOrderStatus } from '@prisma/client';

const prisma = new PrismaClient();

function randomDate(start: Date, end: Date) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

async function main() {
  console.log('🚀 Starting Analytics Seeder for root@textilebill.local...');

  const rootUser = await prisma.user.findFirst({
    where: { email: 'root@textilebill.local', deletedAt: null },
    include: { userCompanies: { include: { company: { include: { financialYears: true } } } } }
  });

  if (!rootUser) {
    throw new Error('Root user not found. Please run normal seed first.');
  }

  const tenantId = rootUser.tenantId;
  const userCompany = rootUser.userCompanies[0];
  if (!userCompany) {
    throw new Error('Root user has no associated company.');
  }
  const companyId = userCompany.companyId;
  const fy = userCompany.company.financialYears[0];
  if (!fy) {
    throw new Error('No financial year found for the company.');
  }

  console.log(`✅ Identified Tenant: ${tenantId}, Company: ${companyId}`);

  // --- EXPENSES ---
  console.log('\n💸 Generating 250 random expenses...');
  const catNames = ['Office Supplies', 'Travel', 'Marketing', 'Utilities'];
  const categories = [];
  for (const name of catNames) {
    let cat = await prisma.expenseCategory.findFirst({ where: { tenantId, companyId, name, deletedAt: null } });
    if (!cat) {
      cat = await prisma.expenseCategory.create({ data: { tenantId, companyId, name } });
    }
    categories.push(cat);
  }

  const expensesData = [];
  for (let i = 0; i < 250; i++) {
    const amt = Math.floor(Math.random() * 5000) + 100;
    const cat = categories[Math.floor(Math.random() * categories.length)];
    expensesData.push({
      tenantId,
      companyId,
      categoryId: cat.id,
      expenseDate: randomDate(fy.startDate, fy.endDate > new Date() ? new Date() : fy.endDate),
      amount: amt,
      sourceType: Math.random() > 0.5 ? ExpenseSourceType.COMPANY_CASH : ExpenseSourceType.COMPANY_BANK,
      status: ExpenseStatus.APPROVED,
      notes: `Generated Demo Expense #${i + 1}`
    });
  }
  await prisma.expenseEntry.createMany({ data: expensesData });
  console.log('✅ Created 250 Expenses.');

  // --- ACCOUNTS & PARTIES ---
  console.log('\n📦 Setting up demo parties & accounts...');
  const customerParty = await prisma.party.upsert({
    where: { id: 'demo-analytics-customer' },
    update: {},
    create: { id: 'demo-analytics-customer', tenantId, name: 'Analytics Bulk Buyer', gstin: '24BULK1234F1Z5' }
  });
  const customerAccount = await prisma.account.upsert({
    where: { id: 'demo-analytics-cust-acc' },
    update: {},
    create: { id: 'demo-analytics-cust-acc', tenantId, companyId, partyId: customerParty.id, group: AccountGroupType.SUNDRY_DEBTORS, openingBalance: 0 }
  });

  const vendorParty = await prisma.party.upsert({
    where: { id: 'demo-analytics-vendor' },
    update: {},
    create: { id: 'demo-analytics-vendor', tenantId, name: 'Analytics Master Weaver', gstin: '24WEAVE123F1Z5' }
  });
  const vendorAccount = await prisma.account.upsert({
    where: { id: 'demo-analytics-vend-acc' },
    update: {},
    create: { id: 'demo-analytics-vend-acc', tenantId, companyId, partyId: vendorParty.id, group: AccountGroupType.SUNDRY_CREDITORS, openingBalance: 0 }
  });

  // --- PRODUCTS ---
  let product = await prisma.product.findFirst({ where: { tenantId, companyId, deletedAt: null } });
  if (!product) {
    product = await prisma.product.create({
      data: { tenantId, companyId, name: 'Bulk Analytics Saree', unit: 'PCS', price: 1000, buyingPrice: 600, taxRate: 5 }
    });
  }

  // --- INVOICES (Sales & Purchases) ---
  console.log('\n🧾 Generating 100 Sales Invoices and 50 Purchase Invoices...');
  let totalSalesAmt = 0;
  for (let i = 0; i < 100; i++) {
    const qty = Math.floor(Math.random() * 50) + 10;
    const rate = Number(product.price) || 1000;
    const subTotal = qty * rate;
    const tax = subTotal * 0.05;
    const totalAmount = subTotal + tax;
    totalSalesAmt += totalAmount;

    await prisma.invoice.create({
      data: {
        tenantId, companyId, accountId: customerAccount.id, financialYearId: fy.id,
        invoiceNumber: `A-SALE-${1000 + i}`,
        invoiceDate: randomDate(fy.startDate, new Date()),
        type: InvoiceType.SALE,
        status: InvoiceStatus.ACTIVE,
        subTotal, taxAmount: tax, discountAmount: 0, totalAmount,
        items: {
          create: { tenantId, companyId, productId: product.id, quantity: qty, rate, taxRate: 5, taxAmount: tax, amount: subTotal }
        }
      }
    });
  }
  
  for (let i = 0; i < 50; i++) {
    const qty = Math.floor(Math.random() * 100) + 20;
    const rate = Number(product.buyingPrice) || 600;
    const subTotal = qty * rate;
    const tax = subTotal * 0.05;
    const totalAmount = subTotal + tax;

    await prisma.invoice.create({
      data: {
        tenantId, companyId, accountId: vendorAccount.id, financialYearId: fy.id,
        invoiceNumber: `A-PUR-${1000 + i}`,
        invoiceDate: randomDate(fy.startDate, new Date()),
        type: InvoiceType.PURCHASE,
        status: InvoiceStatus.ACTIVE,
        subTotal, taxAmount: tax, discountAmount: 0, totalAmount,
        items: {
          create: { tenantId, companyId, productId: product.id, quantity: qty, rate, taxRate: 5, taxAmount: tax, amount: subTotal }
        }
      }
    });
  }

  // --- WORK ORDERS ---
  console.log('\n🏭 Generating 30 Outsourcing Work Orders...');
  for (let i = 0; i < 30; i++) {
    const qty = Math.floor(Math.random() * 100) + 50;
    const saleRate = Number(product.price) || 1000;
    const vendorRate = Number(product.buyingPrice) || 600;

    await prisma.workOrder.create({
      data: {
        tenantId, companyId,
        orderRef: `A-WO-${1000 + i}`,
        customerAccountId: customerAccount.id,
        itemName: product.name,
        orderedQuantity: qty,
        saleRate: saleRate,
        status: WorkOrderStatus.OPEN,
        lots: {
          create: {
            tenantId, companyId,
            lotType: 'OUTSOURCED',
            quantity: qty,
            vendorAccountId: vendorAccount.id,
            agreedRate: vendorRate
          }
        }
      }
    });
  }

  console.log('\n🎉 Successfully seeded massive dataset into root tenant.');
  console.log(`- 250 Expenses`);
  console.log(`- 100 Sales Invoices`);
  console.log(`- 50 Purchase Invoices`);
  console.log(`- 30 Outsourcing Work Orders`);
  console.log(`Refresh your dashboard at http://localhost:3000 to see the analytics.`);
}

main()
  .catch((e) => {
    console.error('❌ Seeder Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
