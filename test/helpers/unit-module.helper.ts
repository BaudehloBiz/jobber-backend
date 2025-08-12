import { createAppModule } from 'src/app.module';
import { Type } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from 'generated/prisma/client';

export async function createModule(controllers?: Type<unknown>[], prismaClient?: PrismaClient): Promise<TestingModule> {
  const appModule = await createAppModule(controllers, prismaClient);

  const moduleRef = await Test.createTestingModule({
    controllers: appModule.controllers,
    providers: appModule.providers,
    imports: appModule.imports,
  }).compile();

  await moduleRef.init();

  return moduleRef;
}
