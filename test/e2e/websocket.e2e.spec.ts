import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import io from 'socket.io-client';
import { LoggerService } from 'src/common/services/logger';
import { PgBossService } from '../../src/common/services/pg-boss.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { JobberGateway, RequestStatus } from '../../src/websocket/websocket.gateway';

describe('JobberGateway (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let pgBossService: PgBossService;
  let clientSocket: SocketIOClient.Socket;

  const testCustomerToken = 'test-customer-token-e2e';
  const testCustomerId = 'test-customer-e2e';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ClsModule.forRoot({
          guard: { mount: true },
        }),
      ],
      providers: [
        LoggerService,
        JobberGateway,
        {
          provide: PrismaService,
          useValue: {
            customerToken: {
              findFirst: jest.fn(),
            },
          },
        },
        {
          provide: PgBossService,
          useValue: {
            publish: jest.fn(),
            subscribe: jest.fn(),
            cancel: jest.fn(),
            queueSize: jest.fn(),
            schedule: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));

    // Gateway is tested through WebSocket connections
    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    pgBossService = moduleFixture.get<PgBossService>(PgBossService);

    await app.listen(3001);
  });

  afterAll(async () => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.close();
    }
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('WebSocket Connection', () => {
    it('should reject connection without authentication token', (done) => {
      const socket = io('http://localhost:3001', {
        path: '/ws',
        transports: ['websocket'],
        timeout: 1000,
        forceNew: true,
      });

      socket.on('error', (error) => {
        expect(error).toBe('Authentication required');
        socket.close();
        done();
      });

      socket.on('connect_error', () => {
        // Connection should fail
        expect(true).toBe(false);
        socket.close();
        done();
      });
    });

    it('should reject connection with invalid token', (done) => {
      (prismaService.customerToken.findFirst as jest.Mock).mockResolvedValue(null);

      const socket = io('http://localhost:3001', {
        path: '/ws',
        auth: { customerToken: 'invalid-token' },
        transports: ['websocket'],
        timeout: 1000,
      });

      socket.on('error', (error) => {
        expect(error).toBe('Invalid authentication token');
        socket.close();
        done();
      });

      socket.on('connect_error', () => {
        socket.close();
        done();
      });
    });

    it('should accept connection with valid token', (done) => {
      const tokenRecord = {
        id: '1',
        token: testCustomerToken,
        customerId: testCustomerId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prismaService.customerToken.findFirst as jest.Mock).mockResolvedValue(tokenRecord);

      const socket = io('http://localhost:3001', {
        path: '/ws',
        auth: { customerToken: testCustomerToken },
        transports: ['websocket'],
        timeout: 2000,
      });

      socket.on('connect', () => {
        expect(socket.connected).toBe(true);
        clientSocket = socket;
        done();
      });

      socket.on('connect_error', (error) => {
        done(error);
      });
    });
  });

  describe('Job Operations', () => {
    beforeEach((done) => {
      if (clientSocket && clientSocket.connected) {
        done();
        return;
      }

      const tokenRecord = {
        id: '1',
        token: testCustomerToken,
        customerId: testCustomerId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prismaService.customerToken.findFirst as jest.Mock).mockResolvedValue(tokenRecord);

      clientSocket = io('http://localhost:3001', {
        path: '/ws',
        auth: { customerToken: testCustomerToken },
        transports: ['websocket'],
        timeout: 2000,
      });

      clientSocket.on('connect', () => {
        done();
      });

      clientSocket.on('connect_error', (error) => {
        done(error);
      });
    });

    it('should send job successfully', (done) => {
      (pgBossService.publish as jest.Mock).mockResolvedValue('job-123');

      const jobData = {
        name: 'test-job',
        data: { message: 'Hello E2E Test' },
        options: { priority: 1 },
      };

      clientSocket.emit('send_job', jobData, (response: { jobId?: string; error?: string }) => {
        expect(response.jobId).toBe('job-123');
        expect(pgBossService.publish).toHaveBeenCalledWith(
          `${testCustomerId}/test-job`,
          { message: 'Hello E2E Test' },
          expect.objectContaining({ priority: 1 }),
        );
        done();
      });
    });

    it('should register worker successfully', (done) => {
      (pgBossService.subscribe as jest.Mock).mockResolvedValue(undefined);

      const workerData = {
        jobName: 'test-worker-job',
        options: { teamConcurrency: 2 },
      };

      clientSocket.emit('register_worker', workerData, (response: { status: RequestStatus; error?: string }) => {
        expect(response.status).toBe(RequestStatus.OK);
        expect(pgBossService.subscribe).toHaveBeenCalledWith(`${testCustomerId}/test-worker-job`, expect.any(Function));
        done();
      });
    });

    it('should send batch jobs successfully', (done) => {
      (pgBossService.publish as jest.Mock).mockResolvedValueOnce('batch-job-1').mockResolvedValueOnce('batch-job-2');

      const batchData = {
        jobs: [
          { name: 'batch-job-1', data: { id: 1 } },
          { name: 'batch-job-2', data: { id: 2 } },
        ],
      };

      clientSocket.emit('send_batch', batchData, (response: { batchId?: string; jobIds?: string[]; error?: string }) => {
        expect(response.batchId).toBeDefined();
        expect(response.jobIds).toEqual(['batch-job-1', 'batch-job-2']);
        expect(pgBossService.publish).toHaveBeenCalledTimes(2);
        done();
      });
    });

    it('should cancel job successfully', (done) => {
      (pgBossService.cancel as jest.Mock).mockResolvedValue(undefined);

      const cancelData = { jobName: 'test-job', jobId: 'job-to-cancel' };

      clientSocket.emit('cancel_job', cancelData, (response: { status: RequestStatus; error?: string }) => {
        expect(response.status).toBe(RequestStatus.OK);
        expect(pgBossService.cancel).toHaveBeenCalledWith('test-customer-e2e/test-job', 'job-to-cancel');
        done();
      });
    });
  });

  describe('Job Status Events', () => {
    beforeEach((done) => {
      if (clientSocket && clientSocket.connected) {
        done();
        return;
      }

      const tokenRecord = {
        id: '1',
        token: testCustomerToken,
        customerId: testCustomerId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prismaService.customerToken.findFirst as jest.Mock).mockResolvedValue(tokenRecord);

      clientSocket = io('http://localhost:3001', {
        path: '/ws',
        auth: { customerToken: testCustomerToken },
        transports: ['websocket'],
        timeout: 2000,
      });

      clientSocket.on('connect', () => {
        done();
      });

      clientSocket.on('connect_error', (error) => {
        done(error);
      });
    });

    it('should receive job started events', (done) => {
      clientSocket.on('job_started', (data: { jobId: string; startedAt: Date }) => {
        expect(data.jobId).toBe('job-started-123');
        expect(data.startedAt).toBeDefined();
        done();
      });

      // Simulate job started event
      clientSocket.emit('job_started', { jobId: 'job-started-123' });
    });

    it('should receive job completed events', (done) => {
      clientSocket.on('job_completed', (data: { jobId: string; result: Record<string, unknown>; completedAt: Date }) => {
        expect(data.jobId).toBe('job-completed-123');
        expect(data.result).toEqual({ success: true });
        expect(data.completedAt).toBeDefined();
        done();
      });

      // Simulate job completed event
      clientSocket.emit('job_completed', {
        jobId: 'job-completed-123',
        result: { success: true },
      });
    });

    it('should receive job failed events', (done) => {
      clientSocket.on('job_failed', (data: { jobId: string; error: string; failedAt: Date }) => {
        expect(data.jobId).toBe('job-failed-123');
        expect(data.error).toBe('Test error');
        expect(data.failedAt).toBeDefined();
        done();
      });

      // Simulate job failed event
      clientSocket.emit('job_failed', {
        jobId: 'job-failed-123',
        error: 'Test error',
      });
    });
  });

  describe('Queue Management', () => {
    beforeEach((done) => {
      if (clientSocket && clientSocket.connected) {
        done();
        return;
      }

      const tokenRecord = {
        id: '1',
        token: testCustomerToken,
        customerId: testCustomerId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prismaService.customerToken.findFirst as jest.Mock).mockResolvedValue(tokenRecord);

      clientSocket = io('http://localhost:3001', {
        path: '/ws',
        auth: { customerToken: testCustomerToken },
        transports: ['websocket'],
        timeout: 2000,
      });

      clientSocket.on('connect', () => {
        done();
      });

      clientSocket.on('connect_error', (error) => {
        done(error);
      });
    });

    it('should get queue size for specific job', (done) => {
      (pgBossService.queueSize as jest.Mock).mockResolvedValue(0);

      const sizeData = { jobName: 'specific-job' };

      clientSocket.emit(
        'get_queue_size',
        sizeData,
        (response: { queueSize?: { waiting: number; active: number; completed: number; failed: number }; error?: string }) => {
          expect(response.queueSize).toEqual(0);
          done();
        },
      );
    });

    it('should schedule job', (done) => {
      (pgBossService.schedule as jest.Mock).mockResolvedValue(undefined);
      const scheduleData = {
        name: 'scheduled-job',
        cronPattern: '0 * * * *',
        data: { message: 'Hourly job' },
      };

      clientSocket.emit('schedule_job', scheduleData, (response: { status: RequestStatus; error?: string }) => {
        expect(response.status).toBe(RequestStatus.OK);
        done();
      });
    });
  });

  describe('Error Handling', () => {
    beforeEach((done) => {
      if (clientSocket && clientSocket.connected) {
        done();
        return;
      }

      const tokenRecord = {
        id: '1',
        token: testCustomerToken,
        customerId: testCustomerId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prismaService.customerToken.findFirst as jest.Mock).mockResolvedValue(tokenRecord);

      clientSocket = io('http://localhost:3001', {
        path: '/ws',
        auth: { customerToken: testCustomerToken },
        transports: ['websocket'],
        timeout: 2000,
      });

      clientSocket.on('connect', () => {
        done();
      });

      clientSocket.on('connect_error', (error) => {
        done(error);
      });
    });

    it('should handle job publish errors', (done) => {
      (pgBossService.publish as jest.Mock).mockRejectedValue(new Error('Publish failed'));

      const jobData = {
        name: 'failing-job',
        data: { message: 'This will fail' },
      };

      clientSocket.emit('send_job', jobData, (response: { jobId?: string; error?: string }) => {
        expect(response.error).toBe('Publish failed');
        done();
      });
    });

    it('should handle worker registration errors', (done) => {
      (pgBossService.subscribe as jest.Mock).mockRejectedValue(new Error('Subscribe failed'));

      const workerData = {
        jobName: 'failing-worker',
        options: { teamConcurrency: 1 },
      };

      clientSocket.emit('register_worker', workerData, (response: { success?: boolean; error?: string }) => {
        expect(response.error).toBe('Failed to register worker: Subscribe failed');
        done();
      });
    });

    it('should handle job cancellation errors', (done) => {
      (pgBossService.cancel as jest.Mock).mockRejectedValue(new Error('Cancel failed'));

      const cancelData = { jobId: 'job-cancel-fail' };

      clientSocket.emit('cancel_job', cancelData, (response: { success?: boolean; error?: string }) => {
        expect(response.error).toBe('Cancel failed');
        done();
      });
    });
  });
});
