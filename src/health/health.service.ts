import { Injectable } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config/dist/config.service";
import type {
  DiskHealthIndicator,
  HealthCheckResult,
  HealthCheckService,
  PrismaHealthIndicator,
} from "@nestjs/terminus";
import type { LoggerService } from "src/common/services/logger";
import type { RedisClientT, RedisHealthIndicator, RedisService } from "src/common/services/redis";
import type { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class HealthService {
  constructor(
    readonly _logger: LoggerService,
    private readonly configService: ConfigService<{
      REDIS_MEMORY_THRESHOLD_BYTES: number;
      DISK_THRESHOLD_PERCENT: number;
    }>,
    private readonly health: HealthCheckService,
    private readonly disk: DiskHealthIndicator,
    private readonly prisma: PrismaService, // Assuming PrismaService is imported from the correct path
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisService: RedisService<RedisClientT>, // Assuming RedisService is imported from the correct path
    private readonly redisHealth: RedisHealthIndicator, // Assuming RedisHealthIndicator is imported from the correct path
  ) {}

  async checkHealth(): Promise<HealthCheckResult> {
    const redisMemoryThreshold = this.configService.get<number>("REDIS_MEMORY_THRESHOLD_BYTES", 1000000000, {
      infer: true,
    }) as number; // Default to 1GB if not set
    const diskThreshold = this.configService.get<number>("DISK_THRESHOLD_PERCENT", 0.75, { infer: true }) as number; // Default to 75% if not set
    return this.health.check([
      () =>
        this.disk.checkStorage("storage", {
          path: "/",
          thresholdPercent: diskThreshold,
        }),
      () => this.prismaHealth.pingCheck("prisma", this.prisma),
      async () =>
        this.redisHealth.isHealthy("redis", {
          client: await this.redisService.getClient(),
          memoryThreshold: redisMemoryThreshold,
        }),
    ]);
  }
}
