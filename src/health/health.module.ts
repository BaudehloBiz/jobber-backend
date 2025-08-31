import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config/dist/config.service";
import { TerminusModule } from "@nestjs/terminus";
import { LoggerService } from "src/common/services/logger";
import { RedisHealthIndicator, RedisService } from "src/common/services/redis";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  controllers: [HealthController],
  providers: [LoggerService, HealthService, RedisService, RedisHealthIndicator, ConfigService],
  imports: [TerminusModule.forRoot({ logger: true }), HttpModule],
})
export class HealthModule {}
