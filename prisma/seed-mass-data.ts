import {
  PrismaClient, InvoiceType, ExpenseStatus, PersonType,
  CostCenterType, SalaryAdvanceStatus, ReimbursementStatus, MovementType,
} from '@prisma/client';

const prisma = new PrismaClient();
const rand = (min: number, max: number) => Math.round(Math.random() * (max - min) + min);
const randD = (min: number, max: number) => parseFloat((Math.random() * (max - min) + min).toFixed(2));
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

const FABRICS = ['Pure Silk Saree', 'Banarasi Dupatta', 'Cotton Kurta Fabric', 'Georgette Saree',
  'Linen Shirting', 'Polyester Suiting', 'Viscose Blend', 'Chiffon Dress Material',
  'Woolen Shawl', 'Muslin Cotton', 'Satin Fabric', 'Denim Roll', 'Khadi Fabric',
  'Jacquard Brocade', 'Chanderi Silk', 'Velvet Fabric', 'Rayon Printed', 'Jute Blend'];

const CUSTOMERS = ['Arvind Mills Ltd', 'Vardhman Textiles Pvt Ltd', 'Welspun India Ltd',
  'Trident Group Ltd', 'Bombay Dyeing & Mfg', 'Raymond Limited', 'Siyaram Silk Mills',
  'Garden Vareli Ltd', 'Oswal Woollen Mills', 'Mafatlal Industries', 'Alok Industries',
  'Himatsingka Seide', 'Nitin Spinners Ltd', 'Sangam India Ltd', 'KPR Mill Limited',
  'Sportking India Ltd', 'Pratibha Syntex', 'AYM Syntex', 'Rupa & Company', 'Gokaldas Exports'];

const VENDORS = ['Reliance Retail Ventures', 'Pantaloons Fashion', 'Tata Trent Ltd',
  'Shoppers Stop Ltd', 'Future Lifestyle', 'Aditya Birla Fashion', 'TCNS Clothing',
  'Vedant Fashions', 'Biba Apparels', 'Fabindia Overseas', 'Manyavar Retailers',
  'Asha Textile Trading', 'Bharat Fabrics', 'Sunrise Traders', 'National Yarn Depot',
  'Agro Synthetic Ltd', 'Premier Weave Industries', 'Shree Ram Fabrics', 'Mehta Trading Co', 'Patel Textiles'];

const EXP_CATS = [
  { name: 'Machine Maintenance', code: 'MACH' }, { name: 'Raw Material Transport', code: 'TRANS' },
  { name: 'Factory Electricity', code: 'ELEC' }, { name: 'Dye & Chemical Purchase', code: 'DYE' },
  { name: 'Packaging Materials', code: 'PKG' }, { name: 'Staff Canteen', code: 'CANT' },
  { name: 'Admin & Office Supplies', code: 'TENANT_ADMIN' }, { name: 'Travel & Conveyance', code: 'TRAVEL' },
  { name: 'Repair & Maintenance', code: 'REPAIR' }, { name: 'Insurance Premium', code: 'INS' },
  { name: 'Audit & Legal Fees', code: 'LEGAL' }, { name: 'IT & Software', code: 'IT' },
  { name: 'Security Services', code: 'SEC' }, { name: 'Water & Utilities', code: 'UTIL' },
  { name: 'Marketing & Advertising', code: 'MKT' },
];

const EMPLOYEES = [
  'Rajesh Kumar', 'Priya Sharma', 'Mohammed Farooq', 'Sunita Patel', 'Amit Singh',
  'Kavita Nair', 'Ravi Chandran', 'Deepa Rao', 'Sanjay Mehta', 'Anita Desai',
  'Vijay Reddy', 'Meena Joshi', 'Prakash Gupta', 'Lalita Verma', 'Suresh Yadav',
  'Rekha Tiwari', 'Ramesh Pandey', 'Geeta Bhatt', 'Manoj Saxena', 'Shobha Pillai',
  'Arjun Malhotra', 'Pooja Agrawal', 'Dinesh Bose', 'Sushma Thakur', 'Kamal Jain',
  'Nisha Kapoor', 'Harish Srivastava', 'Usha Mishra', 'Ganesh Patil', 'Lakshmi Iyer',
  'Arun Kumar Singh', 'Sarita Dubey', 'Devendra Chauhan', 'Pushpa Yadav', 'Mukesh Tomar',
  'Kamla Rawat', 'Bharat Chaudhary', 'Santosh Sharma', 'Kusum Verma', 'Renu Agarwal',
];

const COST_CENTERS = [
  { name: 'Weaving Unit - Block A', code: 'CC-WU-A', scopeType: CostCenterType.DEPARTMENT },
  { name: 'Dyeing & Finishing Dept', code: 'CC-DYE', scopeType: CostCenterType.DEPARTMENT },
  { name: 'Quality Control Lab', code: 'CC-QC', scopeType: CostCenterType.DEPARTMENT },
  { name: 'Spinning Division', code: 'CC-SPIN', scopeType: CostCenterType.DEPARTMENT },
  { name: 'Export Operations Hub', code: 'CC-EXP', scopeType: CostCenterType.DEPARTMENT },
  { name: 'Monthly Overhead Pool', code: 'CC-OVHD', scopeType: CostCenterType.MONTHLY_POOL },
  { name: 'Power Loom Section', code: 'CC-PLM', scopeType: CostCenterType.MACHINE },
  { name: 'Warping Machine Bay', code: 'CC-WARP', scopeType: CostCenterType.MACHINE },
  { name: 'Order Lot FY2526-001', code: 'CC-LOT-001', scopeType: CostCenterType.LOT },
  { name: 'Order Lot FY2526-002', code: 'CC-LOT-002', scopeType: CostCenterType.LOT },
];

const CITIES = ['Mumbai', 'Surat', 'Ahmedabad', 'Delhi', 'Bangalore', 'Ludhiana', 'Coimbatore', 'Bhiwandi'];

async function findOrCreate<T>(
  findFn: () => Promise<T | null>,
  createFn: () => Promise<T>
): Promise<T> {
  return (await findFn()) ?? (await createFn());
}

async function main() {
  console.log('🚀 Starting Massive Data Seeder (Crore-Scale)...');

  const rootUser = await prisma.user.findFirst({
    where: { email: 'root@textilebill.local', deletedAt: null },
    include: { userCompanies: true }
  });
  if (!rootUser) throw new Error('Root user not found.');
  const { tenantId, id: userId } = rootUser;
  const companyId = rootUser.userCompanies[0].companyId;

  const fy = await prisma.financialYear.findFirst({ where: { companyId } });
  if (!fy) throw new Error('No FinancialYear found.');

  // ── 1. Product Options ─────────────────────────────────────────────────────
  console.log('🏷️  Product Options...');
  const optionKinds = {
    CATEGORY: ['Sarees', 'Suit Fabric', 'Shirting', 'Suiting', 'Home Textiles', 'Industrial', 'Woolen', 'Synthetic'],
    BRAND: ['TxtilePro', 'FabricElite', 'WeaveMaster', 'GoldenThread', 'RegentWeave', 'SilkRoute'],
    UOM: ['Metres', 'Kg', 'Roll', 'Bundle', 'Piece', 'Box'],
    CARD_TYPE: ['Cotton', 'Silk', 'Polyester', 'Nylon', 'Linen', 'Wool', 'Blended'],
    CLASSIFICATION: ['Premium', 'Standard', 'Economy', 'Export Grade', 'Domestic Grade'],
  };
  const opts: Record<string, any[]> = {};
  for (const [kind, names] of Object.entries(optionKinds)) {
    opts[kind] = [];
    for (const name of names) {
      const o = await findOrCreate(
        () => prisma.productOption.findFirst({ where: { companyId, kind: kind as any, name, deletedAt: null } }),
        () => prisma.productOption.create({ data: { tenantId, companyId, kind: kind as any, name } })
      );
      opts[kind].push(o);
    }
  }
  console.log('  ✅ Product options ready');

  // ── 2. Products ────────────────────────────────────────────────────────────
  console.log('📦 Products...');
  const products: any[] = [];
  for (let i = 0; i < FABRICS.length; i++) {
    const name = FABRICS[i];
    const p = await findOrCreate(
      () => prisma.product.findFirst({ where: { companyId, name, deletedAt: null } }),
      () => prisma.product.create({
        data: {
          tenantId, companyId, name,
          sku: `FAB-${String(i + 1).padStart(3, '0')}`,
          type: 'GOODS',
          price: randD(600, 3500),
          buyingPrice: randD(200, 1200),
          taxRate: pick([5, 12, 18]),
          gstConsiderAs: 'TAXABLE',
          hsnCode: `520${rand(100, 999)}`,
          categoryId: pick(opts.CATEGORY).id,
          brandId: pick(opts.BRAND).id,
          uomId: pick(opts.UOM).id,
          cardTypeId: pick(opts.CARD_TYPE).id,
          classificationId: pick(opts.CLASSIFICATION).id,
        }
      })
    );
    products.push(p);
  }
  console.log(`  ✅ ${products.length} products`);

  // ── 3. Parties + Accounts ──────────────────────────────────────────────────
  console.log('🏦 Accounts...');
  const makeAccount = async (name: string, group: 'SUNDRY_DEBTORS' | 'SUNDRY_CREDITORS') => {
    const existing = await prisma.account.findFirst({
      where: { companyId, deletedAt: null, party: { name } }
    });
    if (existing) return existing;
    const party = await prisma.party.create({
      data: {
        tenantId, name,
        gstin: `2${rand(1, 9)}${Math.random().toString(36).slice(2, 13).toUpperCase()}`,
        city: pick(CITIES),
        phone: `9${rand(100000000, 999999999)}`,
      }
    });
    return prisma.account.create({
      data: {
        tenantId, companyId, partyId: party.id, group,
        openingBalance: randD(500000, group === 'SUNDRY_DEBTORS' ? 50000000 : 15000000),
        openingBalanceType: pick(['DR', 'CR']),
        creditLimit: randD(1000000, 10000000),
        paymentDays: pick([15, 30, 45, 60, 90]),
      }
    });
  };

  const customerAccounts: any[] = [];
  const vendorAccounts: any[] = [];
  for (const name of CUSTOMERS) customerAccounts.push(await makeAccount(name, 'SUNDRY_DEBTORS'));
  for (const name of VENDORS) vendorAccounts.push(await makeAccount(name, 'SUNDRY_CREDITORS'));
  console.log(`  ✅ ${customerAccounts.length} customers + ${vendorAccounts.length} vendors`);

  // ── 4. Large Invoices ──────────────────────────────────────────────────────
  console.log('🧾 Crore-scale Invoices...');
  let invCount = 0;
  for (let i = 0; i < 120; i++) {
    const isSale = i % 2 === 0;
    const account = isSale ? pick(customerAccounts) : pick(vendorAccounts);
    const product = pick(products);
    const qty = randD(500, 8000);
    const rate = randD(800, 4500);
    const subtotal = parseFloat((qty * rate).toFixed(2));
    const tax = parseFloat((subtotal * 0.12).toFixed(2));
    const total = parseFloat((subtotal + tax).toFixed(2));
    const invNum = `BULK-${isSale ? 'S' : 'P'}-${5000 + i}`;
    const existing = await prisma.invoice.findFirst({ where: { companyId, invoiceNumber: invNum } });
    if (existing) continue;
    await prisma.invoice.create({
      data: {
        tenantId, companyId, accountId: account.id, financialYearId: fy.id,
        invoiceNumber: invNum, invoiceDate: daysAgo(rand(1, 365)),
        type: isSale ? InvoiceType.SALE : InvoiceType.PURCHASE,
        status: 'ACTIVE', subTotal: subtotal, taxAmount: tax, totalAmount: total,
        notes: `Bulk order — ${product.name} — ${qty}m @ ₹${rate}`,
        items: {
          create: [{
            tenantId, companyId, productId: product.id,
            productName: product.name, productUnit: 'MTR',
            rate, quantity: qty,
            amount: subtotal, taxRate: 12, taxAmount: tax,
          }]
        }
      }
    });
    invCount++;
  }
  console.log(`  ✅ ${invCount} new invoices`);

  // ── 5. Expense Categories ──────────────────────────────────────────────────
  console.log('📂 Expense Categories...');
  const expCats: any[] = [];
  for (const { name, code } of EXP_CATS) {
    const ec = await findOrCreate(
      () => prisma.expenseCategory.findFirst({ where: { companyId, name, deletedAt: null } }),
      () => prisma.expenseCategory.create({ data: { tenantId, companyId, name, code } })
    );
    expCats.push(ec);
  }

  // ── 6. Employees ───────────────────────────────────────────────────────────
  console.log('👷 Employees...');
  const employees: any[] = [];
  for (const name of EMPLOYEES) {
    const emp = await findOrCreate(
      () => prisma.companyPerson.findFirst({ where: { companyId, name, deletedAt: null } }),
      () => prisma.companyPerson.create({
        data: {
          tenantId, companyId, name,
          personType: pick([PersonType.WORKER, PersonType.MANAGER, PersonType.PARTNER]),
          phone: `8${rand(100000000, 999999999)}`,
          joinedAt: daysAgo(rand(180, 1000)),
        }
      })
    );
    employees.push(emp);
  }
  console.log(`  ✅ ${employees.length} employees`);

  // ── 7. Salary Profiles ─────────────────────────────────────────────────────
  console.log('💰 Salary Profiles...');
  for (const emp of employees) {
    const exists = await prisma.salaryProfile.findFirst({ where: { companyId, personId: emp.id, isActive: true } });
    if (!exists) {
      await prisma.salaryProfile.create({
        data: { tenantId, companyId, personId: emp.id, monthlyGross: rand(18000, 185000), isActive: true, effectiveFrom: daysAgo(365) }
      });
    }
  }

  // ── 8. Salary Advances ─────────────────────────────────────────────────────
  console.log('💳 Salary Advances...');
  for (let i = 0; i < 60; i++) {
    const emp = pick(employees);
    const amount = rand(5000, 80000);
    await prisma.salaryAdvance.create({
      data: {
        tenantId, companyId, personId: emp.id, amount,
        advanceDate: daysAgo(rand(1, 200)),
        reason: pick(['Medical emergency', 'Festival advance', 'Home repair', 'Education fees', 'Marriage expenses']),
        status: pick([SalaryAdvanceStatus.ACTIVE, SalaryAdvanceStatus.PARTIALLY_ADJUSTED, SalaryAdvanceStatus.SETTLED]),
        remainingAmount: Math.floor(amount * Math.random()),
        settledAmount: 0,
      }
    });
  }
  console.log('  ✅ 60 salary advances');

  // ── 9. Expense Entries (large amounts) ────────────────────────────────────
  console.log('🧾 Expense Entries...');
  const statuses = [ExpenseStatus.DRAFT, ExpenseStatus.SUBMITTED, ExpenseStatus.APPROVED, ExpenseStatus.SETTLED, ExpenseStatus.REJECTED];
  for (let i = 0; i < 150; i++) {
    await prisma.expenseEntry.create({
      data: {
        tenantId, companyId, categoryId: pick(expCats).id,
        personId: Math.random() > 0.4 ? pick(employees).id : null,
        expenseDate: daysAgo(rand(1, 300)),
        amount: rand(15000, 2500000),
        sourceType: pick(['COMPANY_CASH', 'COMPANY_BANK', 'PERSONAL', 'PERSONAL_OUT_OF_POCKET'] as any[]),
        status: pick(statuses), referenceId: `REF-${rand(10000, 99999)}`,
        notes: `Factory operational expense — batch ${rand(100, 999)}`,
        createdById: userId,
      }
    });
  }
  console.log('  ✅ 150 expense entries');

  // ── 10. Reimbursement Claims ───────────────────────────────────────────────
  console.log('🔄 Reimbursement Claims...');
  const rNotes = ['Field travel', 'Client entertainment', 'Trade fair', 'Tool purchase', 'Medical', 'Courier', 'Uniform', 'Safety equipment'];
  for (let i = 0; i < 80; i++) {
    await prisma.reimbursementClaim.create({
      data: {
        tenantId, companyId, personId: pick(employees).id,
        claimDate: daysAgo(rand(1, 180)), amount: rand(2000, 75000),
        status: pick([ReimbursementStatus.DRAFT, ReimbursementStatus.SUBMITTED, ReimbursementStatus.SETTLED, ReimbursementStatus.REJECTED]),
        notes: pick(rNotes),
      }
    });
  }
  console.log('  ✅ 80 reimbursement claims');

  // ── 11. Cost Centers ───────────────────────────────────────────────────────
  console.log('🏗️  Cost Centers...');
  for (const cc of COST_CENTERS) {
    await findOrCreate(
      () => prisma.costCenter.findFirst({ where: { companyId, code: cc.code } }),
      () => prisma.costCenter.create({
        data: { tenantId, companyId, name: cc.name, code: cc.code, scopeType: cc.scopeType, isActive: true, startDate: daysAgo(365), endDate: daysAgo(-180) }
      })
    );
  }
  console.log(`  ✅ ${COST_CENTERS.length} cost centers`);

  // ── 12. Additional Stock Movements ────────────────────────────────────────
  console.log('📊 Stock Movements...');
  for (let i = 0; i < 100; i++) {
    const product = pick(products);
    const type = pick([MovementType.IN, MovementType.OUT]);
    await prisma.stockMovement.create({
      data: {
        tenantId, companyId, productId: product.id, type,
        quantity: randD(50, 5000), date: daysAgo(rand(1, 300)),
        notes: type === 'IN' ? `Received — Batch ${rand(1000, 9999)}` : `Dispatched — Lot ${rand(1000, 9999)}`,
      }
    });
  }
  console.log('  ✅ 100 stock movements');

  console.log('\n🎉 Massive data seeding complete!');
}

main()
  .catch(e => { console.error('❌ Seeder failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
