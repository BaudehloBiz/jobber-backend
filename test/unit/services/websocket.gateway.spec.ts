import { Test, TestingModule } from '@nestjs/testing';
import { JobberGateway } from '../../../src/websocket/websocket.gateway';

describe('WebsocketGateway', () => {
  let gateway: JobberGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JobberGateway],
    }).compile();

    gateway = module.get<JobberGateway>(JobberGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
