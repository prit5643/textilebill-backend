/**
 * Script to verify and fix user page permissions
 * Run this to ensure all users have proper access to reports page
 */
import { PrismaClient } from '@prisma/client';
import {
  ROLE_PERMISSION_DEFAULTS,
  clonePagePermissions,
} from '../src/common/constants/page-permissions';

const prisma = new PrismaClient();

async function fixUserPermissions() {
  console.log('Starting user permissions fix...');

  const userCompanies = await prisma.userCompany.findMany({
    select: {
      id: true,
      userId: true,
      companyId: true,
      role: true,
      pagePermissions: true,
    },
  });

  let fixed = 0;
  let issues = 0;

  for (const uc of userCompanies) {
    // Check if user has proper permissions for their role
    const roleDefaults = ROLE_PERMISSION_DEFAULTS[uc.role as any];
    
    if (!roleDefaults) {
      console.warn(
        `⚠️  Invalid role "${uc.role}" for user ${uc.userId} in company ${uc.companyId}`,
      );
      issues++;
      continue;
    }

    // If reports is disabled but should be enabled, log it
    if (!roleDefaults.reports?.enabled) {
      console.warn(
        `⚠️  Reports disabled for role ${uc.role} user ${uc.userId} in company ${uc.companyId}`,
      );
      issues++;
    }

    // If pagePermissions is null, that's OK - defaults will be used
    if (uc.pagePermissions === null) {
      continue;
    }

    // Validate that pagePermissions is a proper object
    if (typeof uc.pagePermissions !== 'object' || Array.isArray(uc.pagePermissions)) {
      console.warn(
        `⚠️  Invalid pagePermissions format for user ${uc.userId} in company ${uc.companyId}`,
      );
      // Reset to null so defaults will be used
      await prisma.userCompany.update({
        where: { id: uc.id },
        data: { pagePermissions: null },
      });
      fixed++;
      issues++;
    }
  }

  console.log(`✅ Permissions fix complete`);
  console.log(`   Fixed: ${fixed}`);
  console.log(`   Issues found: ${issues}`);

  if (issues > 0) {
    console.log(`\n⚠️  Please review and fix the ${issues} issues found above`);
  }

  await prisma.$disconnect();
}

fixUserPermissions().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
