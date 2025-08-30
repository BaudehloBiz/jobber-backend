import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { StatsD } from 'hot-shots';
import { LoggerService } from 'src/common/services/logger';
import { Environment } from 'src/common/enums';
import { Decimal, Metric, MetricHistogram } from '@prisma/client/runtime/library';
import { Prisma, PrismaClient } from 'generated/prisma/client';

const configService = new ConfigService();
const intervalTime = parseFloat(configService.get<string>('PRISMA_STATS_PERIOD', '10000'));

// recursive function looping deeply throug an object to find Decimals
const transformDecimalsToNumbers = (obj: object): void => {
  if (!obj) {
    return;
  }

  for (const key of Object.keys(obj)) {
    if (Decimal.isDecimal(obj[key])) {
      obj[key] = obj[key].toNumber();
    } else if (typeof obj[key] === 'object') {
      transformDecimalsToNumbers(obj[key] as object);
    }
  }
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private previousHistograms: Metric<MetricHistogram>[] | null = null;

  constructor(
    private readonly metrics: StatsD,
    private readonly logger: LoggerService,
  ) {
    super({ log: [{ emit: 'event', level: 'query' }] });

    this.logger.log(`Prisma v${Prisma.prismaVersion.client}`);

    // One day I will figure out how to make this work cleanly.
    // The problem is: this.$extends() returns a new PrismaClient to be used.
    /*
    this.$extends({
      query: {
        async $allOperations({ operation, model, args, query }): Promise<unknown> {
          const start = process.hrtime.bigint();
          console.log(`Prisma query: ${operation} on ${model} with args: ${JSON.stringify(args)}`);
          const result = (await query(args)) as unknown;
          const end = process.hrtime.bigint();
          metrics.timing(`prisma.sql.${operation}.${model || 'no_model'}`, (end - start) as unknown as number);
          transformDecimalsToNumbers(result as object);
          return result;
        },
      },
    });
    */

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.$use(async (params, next): Promise<any> => {
      // const result = await this.metrics.asyncTimer(next, `prisma.sql.${params.action}.${params.model || "no_model"}`)(params);
      const start = process.hrtime.bigint();
      this.logger.debug(`Prisma call: ${params.action} on ${params.model} with params: ${JSON.stringify(params.args)}`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await next(params);
      const end = process.hrtime.bigint();
      this.metrics.timing(`prisma.sql.${params.action}.${params.model || 'no_model'}`, (end - start) as unknown as number);

      transformDecimalsToNumbers(result as object);

      return result;
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  @Interval(intervalTime)
  async metricsSender(): Promise<void> {
    if (process.env.NODE_ENV != Environment.production) {
      return;
    }

    const metrics = await this.$metrics.json();

    metrics.counters.forEach((counter: { key: string; value: number }) => {
      this.metrics.gauge(`prisma.${counter.key}`, counter.value, (...res) => {
        return res;
      });
    });

    metrics.gauges.forEach((counter: { key: string; value: number }) => {
      this.metrics.gauge(`prisma.${counter.key}`, counter.value, (...res) => {
        return res;
      });
    });
  }
}
