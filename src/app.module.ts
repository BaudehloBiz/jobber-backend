import { DynamicModule, ExecutionContext, ModuleMetadata, Type } from '@nestjs/common';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HotShotsModule } from 'nestjs-hot-shots';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Cluster, RedisManagerService, RedisService } from './common/services/redis';
import Redis from 'ioredis';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { APP_FILTER } from '@nestjs/core';
import { PrismaClient } from 'generated/prisma/client';
import { PgBossService } from './common/services/pg-boss.service';
import { ClsModule } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import { LoggerService } from './common/services/logger';
import { JobberGateway } from './websocket/websocket.gateway';
import { Socket } from 'socket.io';

// app.module.ts
export async function createAppModule(controllers?: Type<unknown>[], prismaClient?: PrismaClient): Promise<DynamicModule> {
  const appModule = await createAppModuleForTest(controllers, prismaClient);
  return {
    ...appModule,
    module: class AppModule {},
  };
}

export async function createAppModuleForTest(controllers?: Type<unknown>[], prismaClient?: PrismaClient): Promise<ModuleMetadata> {
  const redisService = new RedisService();
  const redisClient = (await redisService.getClient()) as Redis | Cluster;
  const throttlerStorage = new ThrottlerStorageRedisService({ lazyConnect: true });
  throttlerStorage.redis = redisClient;
  const throttlerModule = ThrottlerModule.forRoot({
    throttlers: [
      {
        ttl: seconds(60),
        limit: 100,
      },
    ],
    storage: throttlerStorage,
  });

  return {
    controllers,
    imports: [
      ClsModule.forRoot({
        global: true,
        guard: {
          mount: true,
          generateId: true,
          idGenerator: (ctx: ExecutionContext): string => {
            return ctx.getType() == 'ws'
              ? ctx.switchToWs().getClient<Socket>().id
              : `${ctx.switchToHttp().getRequest<Request>().headers['x-request-id'] || randomUUID()}`;
          },
        },
      }),
      SentryModule.forRoot(),
      prismaClient ? PrismaModule.forTest(prismaClient) : PrismaModule,
      HealthModule,
      ConfigModule.forRoot(),
      HotShotsModule.forRoot({
        // StatsD
        host: process.env.STATSD_HOST || 'statsd.disco',
        port: parseInt(process.env.STATSD_PORT || '8125', 10),
        mock: process.env.NODE_ENV !== 'production' || process.env.STATSD_MOCK === 'true',
      }),
      throttlerModule,
    ],
    providers: [
      LoggerService,
      {
        provide: APP_FILTER,
        useClass: SentryGlobalFilter,
      },
      AppService,
      { provide: RedisService, useValue: redisService },
      RedisManagerService,
      PgBossService,
      JobberGateway,
    ],
  };
}
