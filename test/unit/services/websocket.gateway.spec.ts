import { Test, TestingModule } from '@nestjs/testing';
import { JobberGateway } from '../../../src/websocket/websocket.gateway';
import { createAppModuleForTest } from 'src/app.module';

describe('WebsocketGateway', () => {
  let gateway: JobberGateway;

  beforeEach(async () => {
    const appModules = await createAppModuleForTest();
    const module: TestingModule = await Test.createTestingModule(appModules).compile();

    gateway = module.get<JobberGateway>(JobberGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
