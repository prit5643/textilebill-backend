import type { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface User {
      id: string;
      email?: string;
      role: UserRole;
      companyRole?: string;
      tenantId?: string | null;
    }

    interface Request {
      companyId?: string;
    }
  }
}

export {};
