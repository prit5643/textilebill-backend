import { PrismaClient, EntityStatus, UserRole, AccountGroupType, ProductType, GstConsiderAs } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Password@123', 10);
  let credContent = '# Dummy Data Credentials\n\nAll users have the password: `Password@123`\n\n';

  const tenantsData = [
    { name: 'Alpha Group', slug: 'alpha-group' },
    { name: 'Beta Corp', slug: 'beta-corp' },
    { name: 'Gamma LLC', slug: 'gamma-llc' }
  ];

  for (let i = 0; i < tenantsData.length; i++) {
    const tData = tenantsData[i];
    let tenant = await prisma.tenant.findUnique({ where: { slug: tData.slug } });
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          name: tData.name,
          slug: tData.slug,
          status: EntityStatus.ACTIVE
        }
      });
    }

    credContent += `## Tenant: ${tenant.name}\n\n`;

    // Create 2 companies
    const companiesData = [
      { name: `${tenant.name} - Branch 1`, city: 'Mumbai' },
      { name: `${tenant.name} - Branch 2`, city: 'Delhi' }
    ];

    const companies = [];
    for (const cData of companiesData) {
      let company = await prisma.company.findFirst({
        where: { tenantId: tenant.id, name: cData.name }
      });
      if (!company) {
        company = await prisma.company.create({
          data: {
            tenantId: tenant.id,
            name: cData.name,
            city: cData.city,
            status: EntityStatus.ACTIVE
          }
        });
      }
      companies.push(company);

      // Create few products
      const productsData = [
        { name: 'Cotton Shirt', price: 500, type: ProductType.GOODS, gstConsiderAs: GstConsiderAs.TAXABLE, unit: 'PCS' },
        { name: 'Silk Saree', price: 2000, type: ProductType.GOODS, gstConsiderAs: GstConsiderAs.TAXABLE, unit: 'PCS' }
      ];
      for (const p of productsData) {
        const prodExist = await prisma.product.findFirst({ where: { companyId: company.id, name: p.name }});
        if (!prodExist) {
          await prisma.product.create({
            data: {
              tenantId: tenant.id,
              companyId: company.id,
              name: p.name,
              price: p.price,
              type: p.type,
              gstConsiderAs: p.gstConsiderAs,
              unit: p.unit
            }
          });
        }
      }

      // Create few parties and accounts
      const partiesData = [
        { name: `Customer A of ${company.name}`, type: AccountGroupType.SUNDRY_DEBTORS },
        { name: `Customer B of ${company.name}`, type: AccountGroupType.SUNDRY_DEBTORS },
        { name: `Supplier X of ${company.name}`, type: AccountGroupType.SUNDRY_CREDITORS }
      ];

      for (const p of partiesData) {
        let party = await prisma.party.findFirst({ where: { tenantId: tenant.id, name: p.name }});
        if (!party) {
          party = await prisma.party.create({
            data: {
              tenantId: tenant.id,
              name: p.name
            }
          });
        }
        let account = await prisma.account.findFirst({ where: { partyId: party.id, companyId: company.id }});
        if (!account) {
          await prisma.account.create({
            data: {
              tenantId: tenant.id,
              companyId: company.id,
              partyId: party.id,
              group: p.type
            }
          });
        }
      }
      credContent += `### Company: ${company.name} (${cData.city})\n`;
    }

    // Owner User
    const ownerEmail = `owner@${tData.slug}.com`;
    let ownerUser = await prisma.user.findUnique({ where: { email: ownerEmail } });
    if (!ownerUser) {
      ownerUser = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: ownerEmail,
          passwordHash,
          name: `${tenant.name} Owner`
        }
      });
    }

    // Assign owner to both companies
    for (const company of companies) {
      const uc = await prisma.userCompany.findFirst({
        where: { userId: ownerUser.id, companyId: company.id }
      });
      if (!uc) {
        await prisma.userCompany.create({
          data: {
            tenantId: tenant.id,
            userId: ownerUser.id,
            companyId: company.id,
            role: UserRole.OWNER
          }
        });
      }
    }

    credContent += `- **Owner Login**: \`${ownerEmail}\` (Access to both branches)\n`;

    // Manager Users
    for (let c = 0; c < companies.length; c++) {
      const company = companies[c];
      const managerEmail = `manager${c+1}@${tData.slug}.com`;
      let managerUser = await prisma.user.findUnique({ where: { email: managerEmail } });
      if (!managerUser) {
        managerUser = await prisma.user.create({
          data: {
            tenantId: tenant.id,
            email: managerEmail,
            passwordHash,
            name: `${company.name} Manager`
          }
        });
        await prisma.userCompany.create({
          data: {
            tenantId: tenant.id,
            userId: managerUser.id,
            companyId: company.id,
            role: UserRole.MANAGER
          }
        });
      }
      credContent += `- **Manager Login for ${company.name}**: \`${managerEmail}\`\n`;
    }
    credContent += '\n';
  }

  // Write cred.md
  // Root level docs dir relative to this script running inside backend
  const outPath = path.join(__dirname, '../../docs/cred.md');
  fs.writeFileSync(outPath, credContent, 'utf-8');
  console.log(`Dummy data seeded. Credentials written to ${outPath}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
