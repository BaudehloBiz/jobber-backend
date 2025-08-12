import { DynamicModule, Global, Module } from '@nestjs/common';
import { PrismaClient } from 'generated/prisma/client';
import { PrismaService } from './prisma.service';
import { CacheModule } from '@nestjs/cache-manager';

@Global()
@Module({
  imports: [CacheModule.register()],
  providers: [PrismaService],
  exports: [PrismaService],
})
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
