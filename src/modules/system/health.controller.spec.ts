import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns an ok liveness payload', () => {
    const controller = new HealthController();

    const result = controller.health();

    expect(result.status).toBe('ok');
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});
