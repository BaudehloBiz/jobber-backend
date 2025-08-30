import { LoggerService } from './logger';
import * as Sentry from '@sentry/nestjs';
import { HttpException, Injectable, OnApplicationShutdown, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import PgBoss from 'pg-boss';

export type Job<T = object> = PgBoss.Job<T>;
export type WorkHandler<T> = PgBoss.WorkHandler<T>;

const MAX_QUEUE_WAIT = parseInt(process.env.MAX_QUEUE_WAIT || '25000', 10);

class PgBossServiceError extends Error {}

@Injectable()
export class PgBossService implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown {
  public boss: PgBoss;

  constructor(private readonly logger: LoggerService) {}

  async onModuleInit(): Promise<void> {
    if (this.boss) {
      return;
    }

    this.logger.log(`Bootstraping pg-boss on ${process.env.DATABASE_URL}`);
    if (process.env.DATABASE_URL) {
      this.boss = new PgBoss({
        connectionString: process.env.DATABASE_URL,
      });
      this.boss.on('error', (error) => this.logger.error(error));
      await this.boss.start();
    } else {
      throw new Error('DATABASE_URL environment variable not set');
    }
  }

  onApplicationShutdown(): void {
    this.logger.log(`Application being shutdown`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.boss) {
      return;
    }
    this.logger.log(`Shutting down pg-boss`);
    this.boss.off('error', (error) => this.logger.error(error));
    await this.boss.stop({
      // destroy: true, // close DB connection
      // graceful: false, // allow jobs to finish processing
      wait: true,
    });
  }

  async createQueue(queueName: string): Promise<void> {
    if (!this.boss) {
      throw new Error(`Attempt to create queue ${queueName} before application is bootstrapped`);
    }
    this.logger.log(`Creating queue ${queueName}`);
    await this.boss.createQueue(queueName);
  }

  async publish<T = object>(queue: string, payload: T, _options: PgBoss.SendOptions = {}): Promise<string> {
    try {
      return await this._publish(queue, payload, _options);
    } catch (e) {
      if (e instanceof PgBossServiceError) {
        await this.createQueue(queue);
        return await this._publish(queue, payload, _options);
      }
      throw e;
    }
  }

  async _publish<T = object>(queue: string, payload: T, _options: PgBoss.SendOptions = {}): Promise<string> {
    if (!this.boss) {
      throw new Error(`Attempt to publish to ${queue} before application is bootstrapped`);
    }
    const options: PgBoss.SendOptions = {
      ..._options,
      retryBackoff: _options.retryBackoff ?? true,
      retryDelay: _options.retryDelay ?? 1,
      retryLimit: _options.retryLimit ?? 5,
    };

    this.logger.log(`Attempt to publish payload ${JSON.stringify(payload)} to ${queue} with options: ${JSON.stringify(options)}`);
    const jobId = await this.boss.send(queue, payload as object, options);
    if (!jobId) {
      throw new PgBossServiceError(`Failed to publish job to ${queue} using options: ${JSON.stringify(options)}`);
    }
    return jobId;
  }

  async subscribe<T>(queue: string, callback: PgBoss.WorkHandler<T>): Promise<string | null> {
    if (!this.boss) {
      throw new Error(`Attempt to subscribe to ${queue} before application is bootstrapped`);
    }
    this.logger.debug(`Subscribing to ${queue}`);
    const cb = async (job: PgBoss.Job<T>[]): Promise<void> => {
      try {
        await callback(job);
      } catch (error) {
        this.logger.error(`Error in job ${JSON.stringify(job)}: ${JSON.stringify(error)}`);
        Sentry.captureException(error);
        throw error;
      }
    };
    return this.boss.work<T>(queue, cb);
  }

  async cancel(name: string, id: string): Promise<void> {
    if (!this.boss) {
      throw new Error(`Attempt to cancel task ${id} from queue ${name} before application is bootstrapped`);
    }
    return this.boss.cancel(name, id);
  }

  async wait(name: string, id: string, maxWaitTime = MAX_QUEUE_WAIT): Promise<void> {
    if (!this.boss) {
      throw new Error(`Attempt to wait for task ${id} before application is bootstrapped`);
    }

    const endTime = Date.now() + maxWaitTime;
    while (true) {
      const job = await this.boss.getJobById(name, id);
      if (job?.state === 'completed' || job?.state === 'cancelled') {
        break;
      }
      // Note retry is here because we only wait for jobs in tests.
      if (job?.state === 'failed' || job?.state === 'retry') {
        this.logger.error(`Job with id ${id} failed with state: ${job?.state} and output: ${JSON.stringify(job?.output)}`);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument
        const err = new HttpException({ message: job.output['message'], statusCode: job.output['status'] }, job.output['status']);
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (Date.now() > endTime) {
        throw new Error(`Job with id ${id} did not complete in ${maxWaitTime}ms`);
      }
    }
  }
}
