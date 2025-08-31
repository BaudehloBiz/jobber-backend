import { Test, TestingModule } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { LoggerService } from 'src/common/services/logger';
import { PgBossService } from '../../../src/common/services/pg-boss.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { JobberGateway, RequestStatus } from '../../../src/websocket/websocket.gateway';

describe('JobberGateway', () => {
  let gateway: JobberGateway;
  let prismaService: PrismaService;
  let pgBossService: PgBossService;

  const createMockSocket = (overrides = {}) => ({
    id: 'test-socket-id',
    handshake: { auth: {} },
    emit: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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
          },
        },
      ],
    }).compile();

    gateway = module.get<JobberGateway>(JobberGateway);
    prismaService = module.get(PrismaService);
    pgBossService = module.get(PgBossService);

    // Mock the server property
    gateway.server = { emit: jest.fn() };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleConnection', () => {
    it('should disconnect socket when no customer token is provided', async () => {
      const socket = createMockSocket({ handshake: { auth: {} } });

      await gateway.handleConnection(socket as any);

      expect(socket.emit).toHaveBeenCalledWith('error', 'Authentication required');
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('should disconnect socket when customer token is invalid', async () => {
      const socket = createMockSocket({
        handshake: { auth: { customerToken: 'invalid-token' } },
      });

      jest.spyOn(prismaService.customerToken, 'findFirst').mockResolvedValue(null);

      await gateway.handleConnection(socket as any);

      expect(socket.emit).toHaveBeenCalledWith('error', 'Invalid authentication token');
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('should accept connection for valid customer token', async () => {
      const socket = createMockSocket({
        handshake: { auth: { customerToken: 'valid-token' } },
      });

      const tokenRecord = {
        id: '1',
        token: 'valid-token',
        customerId: 'customer-123',
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prismaService.customerToken, 'findFirst').mockResolvedValue(tokenRecord);

      await gateway.handleConnection(socket as any);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.emit).not.toHaveBeenCalledWith('error', expect.anything());
    });
  });

  describe('handleSendJob', () => {
    beforeEach(() => {
      const socket = createMockSocket();
      (gateway as any).clients.set('test-socket-id', {
        id: 'client-customer-123-1234567890',
        customerToken: 'valid-token',
        customerId: 'customer-123',
        connectedAt: new Date(),
        socket,
        workers: new Set(),
      });
    });

    it('should publish job to pg-boss with customer prefix', async () => {
      const socket = createMockSocket();
      const jobData = {
        name: 'test-job',
        data: { message: 'Hello World' },
        options: { priority: 5, retryLimit: 3 },
      };

      jest.spyOn(pgBossService, 'publish').mockResolvedValue('job-123');

      const result = await gateway.handleSendJob(socket as any, jobData);

      expect(pgBossService.publish).toHaveBeenCalledWith(
        'customer-123/test-job',
        { message: 'Hello World' },
        expect.objectContaining({
          priority: 5,
          retryLimit: 3,
        }),
      );
      expect(result).toEqual({ jobId: 'job-123', status: RequestStatus.OK });
    });

    it('should return error for unauthenticated client', async () => {
      const socket = createMockSocket({ id: 'unknown-socket' });
      const jobData = {
        name: 'test-job',
        data: { message: 'Hello World' },
      };

      const result = await gateway.handleSendJob(socket as any, jobData);

      expect(result).toEqual({ status: RequestStatus.ERROR, error: 'Client not authenticated' });
      expect(pgBossService.publish).not.toHaveBeenCalled();
    });
  });

  describe('handleRegisterWorker', () => {
    beforeEach(() => {
      const socket = createMockSocket();
      (gateway as any).clients.set('test-socket-id', {
        id: 'client-customer-123-1234567890',
        customerToken: 'valid-token',
        customerId: 'customer-123',
        connectedAt: new Date(),
        socket,
        workers: new Set(),
      });
    });

    it('should register worker for specific job queue', async () => {
      const socket = createMockSocket();
      const workerData = {
        jobName: 'test-job',
        options: { teamConcurrency: 5 },
      };

      jest.spyOn(pgBossService, 'subscribe').mockResolvedValue(null);

      const result = await gateway.handleRegisterWorker(socket as any, workerData);

      expect(pgBossService.subscribe).toHaveBeenCalledWith('customer-123/test-job', expect.any(Function));
      expect(result).toEqual({ status: RequestStatus.OK });
    });
  });

  describe('Job Status Events', () => {
    it('should emit job started event to all clients', () => {
      const socket = createMockSocket();
      const eventData = { jobName: 'test-job', jobId: 'job-123' };

      gateway.handleJobStarted(socket as any, eventData);

      const serverEmit = (gateway as any).server.emit;
      expect(serverEmit).toHaveBeenCalledWith('job_started', {
        jobName: 'test-job',
        jobId: 'job-123',
        startedAt: expect.any(Date),
      });
    });

    it('should emit job completed event to all clients', () => {
      const socket = createMockSocket();
      const eventData = {
        jobName: 'test-job',
        jobId: 'job-123',
        result: { success: true, data: 'completed' },
      };

      gateway.handleJobCompleted(socket as any, eventData);

      const serverEmit = (gateway as any).server.emit;
      expect(serverEmit).toHaveBeenCalledWith('job_completed', {
        jobName: 'test-job',
        jobId: 'job-123',
        result: { success: true, data: 'completed' },
        completedAt: expect.any(Date),
      });
    });
  });
});
