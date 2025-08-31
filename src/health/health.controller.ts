import { Controller, Get } from "@nestjs/common";
import { HealthCheck, type HealthCheckResult } from "@nestjs/terminus";
import type { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
    return this.healthService.checkHealth();
  }
}
