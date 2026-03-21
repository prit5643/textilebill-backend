const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, username: true, isActive: true }
  });
  require('fs').writeFileSync('users.json', JSON.stringify(users, null, 2));
  console.log("Done");
  process.exit(0);
}
check();

