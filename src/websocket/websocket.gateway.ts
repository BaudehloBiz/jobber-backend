/* eslint-disable @typescript-eslint/no-explicit-any */
import { UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { CLS_ID, ClsGuard, ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import { Server, Socket } from 'socket.io';
import { LoggerService } from 'src/common/services/logger';
import { PgBossService } from 'src/common/services/pg-boss.service';
import { PrismaService } from 'src/prisma/prisma.service';

// Job-related interfaces
interface JobOptions {
  id?: string;
  priority?: number;
  startAfter?: Date | string;
  expireIn?: string;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  singletonKey?: string;
}

interface WorkOptions {
  teamSize?: number;
  teamConcurrency?: number;
}

interface BatchJob<T = unknown> {
  name: string;
  data: T;
  options?: JobOptions;
}

interface JobRequest {
  jobName: string;
  jobId: string;
}

interface ClientConnection {
  id: string;
  customerToken: string;
  customerId: string;
  connectedAt: Date;
  socket: Socket;
  workers: Set<string>;
}

export enum RequestStatus {
  OK = 'ok',
  ERROR = 'error',
}

@WebSocketGateway({ cors: { origin: '*' }, path: '/ws' })
@UseGuards(ClsGuard)
export class JobberGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server | { emit: (event: string, ...args: any[]) => void };

  constructor(
    private readonly cls: ClsService,
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
    private readonly logger: LoggerService,
  ) {}

  // Client connections storage
  private clients = new Map<string, ClientConnection>();

  async handleConnection(client: Socket) {
    await this.cls.run(async () => {
      this.cls.set(CLS_ID, randomUUID());
      this.logger.log(`Client connecting: ${client.id}`);

      // Extract auth token from handshake
      const customerToken = client.handshake.auth?.customerToken as string;

      if (!customerToken) {
        this.logger.warn(`Client ${client.id} rejected: missing customer token`);
        client.emit('error', 'Authentication required');
        client.disconnect();
        return;
      }

      // this.cls.setIfUndefined('CLS_ID', customerToken);
      await this._handleConnection(client, customerToken);
    });
  }

  async _handleConnection(client: Socket, customerToken: string) {
    // Look up customer ID from token
    try {
      const tokenRecord = await this.prisma.customerToken.findFirst({
        where: {
          token: customerToken,
          isActive: true,
        },
      });

      if (!tokenRecord) {
        this.logger.warn(`Client ${client.id} rejected: invalid customer token`);
        client.emit('error', 'Invalid authentication token');
        client.disconnect();
        return;
      }

      // Create client connection
      const clientConnection: ClientConnection = {
        id: `client-${tokenRecord.customerId}-${Date.now()}`,
        customerToken,
        customerId: tokenRecord.customerId,
        connectedAt: new Date(),
        socket: client,
        workers: new Set(),
      };

      this.clients.set(client.id, clientConnection);
      this.logger.log(`Client authenticated: ${client.id} ${clientConnection.id} (customer: ${tokenRecord.customerId})`);
      client.emit('client_ready', { id: clientConnection.id, customerId: tokenRecord.customerId });
    } catch (error) {
      this.logger.error(`Authentication error for client ${client.id}: ${(error as Error).message}`);
      client.emit('error', 'Authentication failed');
      client.disconnect();
      return;
    }
  }

  handleDisconnect(client: Socket) {
    const clientConnection = this.clients.get(client.id);
    if (clientConnection) {
      this.logger.log(`Client disconnected: ${clientConnection.id}`);
      this.clients.delete(client.id);
    }
  }

  @SubscribeMessage('send_job')
  async handleSendJob(@ConnectedSocket() client: Socket, @MessageBody() data: { name: string; data: unknown; options?: JobOptions }) {
    try {
      this.logger.log(`Client ${client.id} sending job: ${data.name}`);
      const clientConnection = this.clients.get(client.id);
      if (!clientConnection) {
        return { status: RequestStatus.ERROR, error: 'Client not authenticated' };
      }

      const customerId = clientConnection.customerId;
      const queueName = `${customerId}/${data.name}`;

      const jobOptions = {
        priority: data.options?.priority || 0,
        startAfter: data.options?.startAfter,
        expireIn: data.options?.expireIn,
        retryLimit: data.options?.retryLimit || 3,
        retryDelay: data.options?.retryDelay,
        retryBackoff: data.options?.retryBackoff,
        singletonKey: data.options?.singletonKey,
      };

      const jobId = await this.pgBoss.publish(queueName, data.data, jobOptions);
      this.logger.log(`Job sent to queue ${queueName}: ${jobId}`);
      return { status: RequestStatus.OK, jobId };
    } catch (error) {
      this.logger.error(`Failed to send job: ${(error as Error).message}`);
      return { status: RequestStatus.ERROR, error: (error as Error).message };
    }
  }

  @SubscribeMessage('schedule_job')
  async handleScheduleJob(@ConnectedSocket() client: Socket, @MessageBody() data: { name: string; cronPattern: string; data: unknown; options?: JobOptions }) {
    try {
      const clientConnection = this.clients.get(client.id);
      if (!clientConnection) {
        return { status: RequestStatus.ERROR, error: 'Client not authenticated' };
      }

      const customerId = clientConnection.customerId;
      const queueName = `${customerId}/${data.name}`;

      await this.pgBoss.schedule(queueName, data.cronPattern, data.data, data.options);

      this.logger.log(`Job scheduled: (${queueName}) - ${data.cronPattern}`);
      // This is a simplified implementation - you might want to implement proper cron scheduling
      return { status: RequestStatus.OK };
    } catch (error) {
      this.logger.error(`Failed to schedule job: ${(error as Error).message}`);
      return { status: RequestStatus.ERROR, error: (error as Error).message };
    }
  }

  @SubscribeMessage('register_worker')
  async handleRegisterWorker(@ConnectedSocket() client: Socket, @MessageBody() data: { jobName: string; options?: WorkOptions }) {
    const clientConnection = this.clients.get(client.id);
    if (!clientConnection) {
      return { status: RequestStatus.ERROR, error: 'Client not authenticated' };
    }

    const customerId = clientConnection.customerId;
    const queueName = `${customerId}/${data.jobName}`;

    clientConnection.workers.add(data.jobName);
    this.logger.log(`Worker registered: ${clientConnection.id} -> ${queueName}`);

    // Subscribe to the pg-boss queue for this worker
    try {
      await this.pgBoss.subscribe(queueName, async (jobs) => {
        for (const job of jobs) {
          this.logger.log(`Sending job ${job.id} to worker ${clientConnection.id}`);
          client.emit('work_request', {
            id: job.id,
            name: data.jobName,
            data: job.data,
            state: 'created',
            retryCount: 0,
            priority: 0,
            createdAt: new Date(),
          });
        }
        return Promise.resolve();
      });
    } catch (error) {
      this.logger.error(`Failed to subscribe to queue ${queueName}: ${(error as Error).message}`);
      return { status: RequestStatus.ERROR, error: `Failed to register worker: ${(error as Error).message}` };
    }

    return { status: RequestStatus.OK };
  }

  @SubscribeMessage('job_started')
  handleJobStarted(@ConnectedSocket() client: Socket, @MessageBody() data: JobRequest) {
    // With pg-boss, job status is handled internally
    // We can still emit events for real-time updates
    this.logger.log(`Job started: ${data.jobId}`);
    this.server.emit('job_started', { jobName: data.jobName, jobId: data.jobId, startedAt: new Date() });
  }

  @SubscribeMessage('job_completed')
  handleJobCompleted(@ConnectedSocket() client: Socket, @MessageBody() data: JobRequest & { result?: unknown }) {
    try {
      // Mark the job as completed in pg-boss
      // Note: pg-boss automatically handles completion when the worker function resolves
      this.logger.log(`Job completed: ${data.jobId}`);

      // Emit completion event to all clients
      this.server.emit('job_completed', {
        jobName: data.jobName,
        jobId: data.jobId,
        result: data.result,
        completedAt: new Date(),
      });
    } catch (error) {
      this.logger.error(`Error handling job completion: ${(error as Error).message}`);
    }
  }

  @SubscribeMessage('job_failed')
  handleJobFailed(@ConnectedSocket() client: Socket, @MessageBody() data: JobRequest & { error: string }) {
    try {
      this.logger.log(`Job failed: ${data.jobId} - ${data.error}`);

      // Emit failure event to all clients
      this.server.emit('job_failed', {
        jobName: data.jobName,
        jobId: data.jobId,
        error: data.error,
        failedAt: new Date(),
      });
    } catch (error) {
      this.logger.error(`Error handling job failure: ${(error as Error).message}`);
    }
  }

  @SubscribeMessage('send_batch')
  async handleSendBatch(@ConnectedSocket() client: Socket, @MessageBody() data: { jobs: BatchJob[] }) {
    try {
      const clientConnection = this.clients.get(client.id);
      if (!clientConnection) {
        return { status: RequestStatus.ERROR, error: 'Client not authenticated' };
      }

      const customerId = clientConnection.customerId;
      const batchId = randomUUID();
      const jobIds: string[] = [];

      for (const batchJob of data.jobs) {
        const queueName = `${customerId}/${batchJob.name}`;
        const jobOptions = {
          ...batchJob.options,
          batchId, // Add batch ID for tracking
        };

        const jobId = await this.pgBoss.publish(queueName, batchJob.data, jobOptions);
        jobIds.push(jobId);
      }

      this.logger.log(`Batch created: ${batchId} with ${data.jobs.length} jobs`);
      return { status: RequestStatus.OK, batchId, jobIds };
    } catch (error) {
      this.logger.error(`Failed to send batch: ${(error as Error).message}`);
      return { status: RequestStatus.ERROR, error: (error as Error).message };
    }
  }

  @SubscribeMessage('wait_for_batch')
  handleWaitForBatch(@ConnectedSocket() client: Socket, @MessageBody() data: { batchId: string }) {
    try {
      // For pg-boss, we need to implement batch waiting differently
      // This is a simplified implementation
      this.logger.log(`Waiting for batch: ${data.batchId}`);
      return { message: 'Batch waiting implemented via pg-boss' };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }

  @SubscribeMessage('get_job')
  async handleGetJob(@ConnectedSocket() client: Socket, @MessageBody() data: JobRequest) {
    try {
      const clientConnection = this.clients.get(client.id);
      if (!clientConnection) {
        return { status: RequestStatus.ERROR, error: 'Client not authenticated' };
      }

      const customerId = clientConnection.customerId;
      const queueName = `${customerId}/${data.jobName}`;

      // For pg-boss, we need to query the job from the database
      // This would require access to the pg-boss internal methods or database
      this.logger.log(`Getting job: ${data.jobId}`);
      const jobData = await this.pgBoss.boss.getJobById(queueName, data.jobId, { includeArchive: true });
      return { status: RequestStatus.OK, job: jobData };
    } catch (error) {
      return { status: RequestStatus.ERROR, error: (error as Error).message };
    }
  }

  @SubscribeMessage('cancel_job')
  async handleCancelJob(@ConnectedSocket() client: Socket, @MessageBody() data: JobRequest) {
    try {
      const clientConnection = this.clients.get(client.id);
      if (!clientConnection) {
        return { status: RequestStatus.ERROR, error: 'Client not authenticated' };
      }

      const customerId = clientConnection.customerId;
      const queueName = `${customerId}/${data.jobName}`;

      // For pg-boss, we need to use the cancel method with the appropriate queue name
      // Since we don't know the exact queue name, we'll need to try different possibilities
      // or store job metadata differently
      await this.pgBoss.cancel(queueName, data.jobId); // pg-boss cancel by job ID

      this.logger.log(`Job cancelled: ${data.jobId}`);
      this.server.emit('job_cancelled', { jobId: data.jobId, cancelledAt: new Date() });
      return { status: RequestStatus.OK };
    } catch (error) {
      this.logger.error(`Failed to cancel job: ${(error as Error).message}`);
      return { status: RequestStatus.ERROR, error: (error as Error).message };
    }
  }

  @SubscribeMessage('get_queue_size')
  async handleGetQueueSize(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { jobName: string; before: 'retry' | 'active' | 'completed' | 'cancelled' | 'failed' },
  ) {
    try {
      const clientConnection = this.clients.get(client.id);
      if (!clientConnection) {
        return { status: RequestStatus.ERROR, error: 'Client not authenticated' };
      }
      if (!data.jobName) {
        return { status: RequestStatus.ERROR, error: 'Job name is required' };
      }

      const customerId = clientConnection.customerId;

      // Get size for specific queue
      const queueName = `${customerId}/${data.jobName}`;
      this.logger.log(`Getting queue size for: ${queueName}`);

      const queueSize = await this.pgBoss.queueSize(queueName, data.before);

      return { status: RequestStatus.OK, queueSize };
    } catch (error) {
      this.logger.error(`Failed to get queue size: ${(error as Error).message}`);
      return { error: (error as Error).message };
    }
  }
}
