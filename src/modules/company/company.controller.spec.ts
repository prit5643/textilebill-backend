import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

describe('CompanyController', () => {
  let controller: CompanyController;
  let companyService: jest.Mocked<Pick<CompanyService, 'findAllForActor'>>;

  beforeEach(() => {
    companyService = {
      findAllForActor: jest.fn(),
    };

    controller = new CompanyController(
      companyService as unknown as CompanyService,
    );
  });

  it('passes actor context and pagination to findAllForActor', async () => {
    await controller.findAll('tenant-1', 'user-1', 'STAFF', 2, 50);

    expect(companyService.findAllForActor).toHaveBeenCalledWith(
      'tenant-1',
      2,
      50,
      { userId: 'user-1', role: 'STAFF' },
      'default',
    );
  });

  it('forwards header view for lightweight switcher payloads', async () => {
    await controller.findAll('tenant-1', 'user-1', 'STAFF', 1, 25, 'header');

    expect(companyService.findAllForActor).toHaveBeenCalledWith(
      'tenant-1',
      1,
      25,
      { userId: 'user-1', role: 'STAFF' },
      'header',
    );
  });
});
