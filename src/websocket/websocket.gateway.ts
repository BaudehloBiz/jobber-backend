import { ValidationPipe } from '@nestjs/common/pipes';
import { MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' }, path: '/ws' })
export class JobberGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('message')
  handleMessage(@MessageBody(new ValidationPipe()) data: string): string {
    return `Hello world: ${data}`;
  }
}
