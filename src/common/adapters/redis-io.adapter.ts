import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { INestApplicationContext, Injectable } from '@nestjs/common';
import { RedisClientT, RedisService } from '../services/redis';

@Injectable()
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private redisService: RedisService<RedisClientT>;

  constructor(app: INestApplicationContext) {
    super(app);
    this.redisService = app.get(RedisService);
  }

  async connectToRedis(): Promise<void> {
    const pubClient = await this.redisService.getClient();
    if (!pubClient) {
      throw new Error('Failed to get Redis client: pubClient is undefined.');
    }

    const subClient = pubClient.duplicate();

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createIOServer(port: number, options?: ServerOptions): any {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const server = super.createIOServer(port, options);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    server.adapter(this.adapterConstructor);
    return server;
  }
}
