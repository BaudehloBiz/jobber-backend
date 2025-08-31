import { TestingModule } from '@nestjs/testing';
import { createId as cuid } from '@paralleldrive/cuid2';
import { Job, PgBossService } from 'src/common/services/pg-boss.service';
import { createModule } from 'test/helpers/unit-module.helper';

describe('PgBossService', () => {
  let service: PgBossService;
  let module: TestingModule;

  beforeAll(async () => {
    module = await createModule();

    service = module.get<PgBossService>(PgBossService);
  });

  afterAll(async () => {
    await module.close();
  });

  it('Should be defined', () => {
    expect(service).toBeDefined();
  });

  it('Should execute a job', async () => {
    const queueName = `TestQueue-${cuid()}`;
    const expected = { test: 'test' };
    await service.createQueue(queueName);
    await service.subscribe(queueName, queueRunner);
    await service.publish(queueName, { test: 'test' });
    async function queueRunner(job: Job[]): Promise<void> {
      expect(job[0].data).toEqual(expected);
    }
  });

  it('Should cope with a crashing subscriber', async () => {
    const queueName = `TestQueue-${cuid()}`;
    await service.createQueue(queueName);
    await service.subscribe(queueName, queueRunner);
    let isRetry = false;
    await service.publish(queueName, { test: 'test' }, { retryLimit: 1 });
    async function queueRunner(job: Job[]): Promise<void> {
      if (isRetry) {
        expect(isRetry).toBe(true);
      }
      isRetry = true;
      throw new Error(`Throwing up over job ${job[0].id}`);
    }
  });

  it('Should do a scheduled job', async () => {
    const queueName = `TestQueue-${cuid()}`;
    await service.createQueue(queueName);
    await service.subscribe(queueName, queueRunner);
    const currentTime = Date.now();
    await service.publish(queueName, { test: 'test' }, { startAfter: 5 });
    async function queueRunner(job: Job[]): Promise<void> {
      const now = Date.now();
      expect(job[0].id).toBeDefined();
      expect(now - currentTime).toBeGreaterThan(4000);
    }
  });

  // it('Should send errors to sentry', async () => {
  //   expect.hasAssertions();

  //   const queueName = `TestQueue-${cuid()}` as AvailableQueues;
  //   await service.subscribe(queueName, queueRunner);
  //   const jobId = await service.publish(queueName, { test: 'test' }, { retryLimit: 1 });

  //   expect(jobId).toBeDefined();
  //   await expect(async () => {
  //     await service.wait(jobId);
  //   }).rejects.toThrow();

  //   async function queueRunner(job: Job): Promise<void> {
  //     throw new Error(`Throwing up over job ${job.id}`);
  //   }
  // });
});
