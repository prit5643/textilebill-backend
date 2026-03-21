import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<
    Pick<
      UsersService,
      'getCompanyAccess' | 'addCompanyAccess' | 'removeCompanyAccess'
    >
  >;

  beforeEach(() => {
    usersService = {
      getCompanyAccess: jest.fn(),
      addCompanyAccess: jest.fn(),
      removeCompanyAccess: jest.fn(),
    };

    controller = new UsersController(usersService as unknown as UsersService);
  });

  it('passes actor context to getCompanyAccess', async () => {
    await controller.getCompanyAccess('user-1', 'TENANT_ADMIN', 'tenant-1');

    expect(usersService.getCompanyAccess).toHaveBeenCalledWith('user-1', {
      role: 'TENANT_ADMIN',
      tenantId: 'tenant-1',
    });
  });

  it('passes actor context to addCompanyAccess', async () => {
    await controller.addCompanyAccess(
      'user-1',
      'company-1',
      'TENANT_ADMIN',
      'tenant-1',
    );

    expect(usersService.addCompanyAccess).toHaveBeenCalledWith(
      'user-1',
      'company-1',
      {
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
      },
    );
  });

  it('passes actor context to removeCompanyAccess', async () => {
    await controller.removeCompanyAccess(
      'user-1',
      'company-1',
      'TENANT_ADMIN',
      'tenant-1',
    );

    expect(usersService.removeCompanyAccess).toHaveBeenCalledWith(
      'user-1',
      'company-1',
      {
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
      },
    );
  });
});
