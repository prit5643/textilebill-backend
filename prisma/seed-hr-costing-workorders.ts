import { PrismaClient, PersonType, CostCenterType, ReimbursementStatus, SalaryAdvanceStatus, ExpenseAttachmentType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting Deep HR, Costing, and Work Order Seeder...');

  const rootUser = await prisma.user.findFirst({
    where: { email: 'root@textilebill.local', deletedAt: null },
    include: { userCompanies: { include: { company: true } } }
  });

  if (!rootUser) throw new Error('Root user not found.');
  const tenantId = rootUser.tenantId;
  const companyId = rootUser.userCompanies[0].companyId;

  // 1. HR: Company Persons & Salary Profiles
  console.log('\n👥 Generating Employees and Salary Profiles...');
  const employees = [];
  for (let i = 0; i < 50; i++) {
    const person = await prisma.companyPerson.create({
      data: {
        tenantId, companyId,
        personType: PersonType.WORKER,
        name: `Mock Employee ${i + 1}`,
        status: 'ACTIVE'
      }
    });

    await prisma.salaryProfile.create({
      data: {
        tenantId, companyId,
        personId: person.id,
        monthlyGross: 25000 + (Math.random() * 5000),
        isActive: true
      }
    });

    if (Math.random() > 0.5) {
      await prisma.salaryAdvance.create({
        data: {
          tenantId, companyId, personId: person.id,
          amount: 5000,
          advanceDate: new Date(),
          remainingAmount: 5000,
          status: SalaryAdvanceStatus.ACTIVE
        }
      });
    }

    employees.push(person);
  }
  console.log('✅ Created 50 Employees with Salaries & Advances.');

  // 2. COSTING: Cost Centers and Allocations
  console.log('\n💰 Generating Cost Centers & Allocating Expenses...');
  const ccProd = await prisma.costCenter.create({
    data: { tenantId, companyId, name: 'Main Production Line', scopeType: CostCenterType.DEPARTMENT, isActive: true }
  });
  const ccAdmin = await prisma.costCenter.create({
    data: { tenantId, companyId, name: 'Administrative Overhead', scopeType: CostCenterType.MONTHLY_POOL, isActive: true }
  });

  const expenses = await prisma.expenseEntry.findMany({ where: { companyId, deletedAt: null }, take: 100 });
  
  const attachments = [];
  const allocations = [];

  for (const exp of expenses) {
    // 50% split for cost allocations
    allocations.push({
      tenantId, companyId, expenseEntryId: exp.id,
      costCenterId: ccProd.id, allocatedAmount: Number(exp.amount) * 0.5
    });
    allocations.push({
      tenantId, companyId, expenseEntryId: exp.id,
      costCenterId: ccAdmin.id, allocatedAmount: Number(exp.amount) * 0.5
    });

    // Mock attachment (Bill/Proof)
    attachments.push({
      tenantId, companyId, expenseEntryId: exp.id,
      fileName: `bill_${exp.id.substring(0, 5)}.pdf`,
      filePath: '/mock/path/bill.pdf',
      fileUrl: 'https://example.com/mock-bill.pdf',
      mimeType: 'application/pdf',
      attachmentType: ExpenseAttachmentType.BILL_IMAGE,
      createdById: rootUser.id
    });
  }

  await prisma.costAllocation.createMany({ data: allocations });
  await prisma.expenseAttachment.createMany({ data: attachments });
  console.log(`✅ Allocated 100 Expenses to Cost Centers and attached Proofs/Bills.`);

  console.log('\n🎉 Successfully seeded deep HR, Costing, and Attachment data.');
}

main()
  .catch((e) => {
    console.error('❌ Seeder Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
