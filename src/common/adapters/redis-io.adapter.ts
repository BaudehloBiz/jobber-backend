import { type INestApplicationContext, Injectable } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type { ServerOptions } from "socket.io";
import { type RedisClientT, RedisService } from "../services/redis";

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
      throw new Error("Failed to get Redis client: pubClient is undefined.");
    }

    const subClient = pubClient.duplicate();

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  // biome-ignore lint/suspicious/noExplicitAny: Needed for compatibility
  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}
