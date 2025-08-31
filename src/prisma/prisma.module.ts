import { CacheModule } from "@nestjs/cache-manager";
import { type DynamicModule, Global, Module } from "@nestjs/common";
import type { PrismaClient } from "generated/prisma/client";
import { LoggerService } from "src/common/services/logger";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  imports: [CacheModule.register()],
  providers: [LoggerService, PrismaService],
  exports: [PrismaService],
})
// biome-ignore lint/complexity/noStaticOnlyClass: This is just NestJS style
export class PrismaModule {
  // with the help of `DynamicModule` we can import `PrismaModule` with existing client.
  static forTest(prismaClient: PrismaClient): DynamicModule {
    return {
      module: PrismaModule,
      providers: [
        {
          provide: PrismaService,
          useFactory: () => prismaClient as PrismaService,
        },
      ],
      exports: [PrismaService],
    };
  }
}
