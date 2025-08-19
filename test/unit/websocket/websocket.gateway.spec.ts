import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { JobberGateway } from '../../../src/websocket/websocket.gateway';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { PgBossService } from '../../../src/common/services/pg-boss.service';

interface MockSocket {
  id: string;
  handshake: {
    auth: Record<string, unknown>;
  };
  emit: jest.Mock;
  disconnect: jest.Mock;
}

describe('JobberGateway', () => {
  let gateway: JobberGateway;
  let prismaService: PrismaService;
  let pgBossService: PgBossService;

  const createMockSocket = (overrides: Partial<MockSocket> = {}): MockSocket => {
    return {
      id: 'test-socket-id',
      handshake: {
        auth: {},
      },
      emit: jest.fn(),
      disconnect: jest.fn(),
      ...overrides,
    };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
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
    gateway['server'] = {
      emit: jest.fn(),
    } as unknown as any;

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleConnection', () => {
    it('should disconnect socket when no customer token is provided', async () => {
      const socket = createMockSocket({
        handshake: { auth: {} },
      });

      await gateway.handleConnection(socket);

      expect(socket.emit).toHaveBeenCalledWith('error', 'Authentication required');
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('should disconnect socket when customer token is invalid', async () => {
      const socket = createMockSocket({
        handshake: { auth: { customerToken: 'invalid-token' } },
      });

      (prismaService.customerToken.findFirst as jest.Mock).mockResolvedValue(null);

      await gateway.handleConnection(socket);

      expect(socket.emit).toHaveBeenCalledWith('error', 'Invalid authentication token');
      expect(socket.disconnect).toHaveBeenCalled();
      expect(prismaService.customerToken.findFirst).toHaveBeenCalledWith({
        where: { token: 'invalid-token', isActive: true },
      });
    });

    it('should accept connection for valid customer token', async () => {
      const socket = createMockSocket({
        handshake: { auth: { customerToken: 'valid-token' } },
      });

      const tokenRecord = {
        id: '1',
        token: 'valid-token',
        customerId: 'customer-123',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prismaService.customerToken.findFirst as jest.Mock).mockResolvedValue(tokenRecord);

      await gateway.handleConnection(socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.emit).not.toHaveBeenCalledWith('error', expect.anything());
      expect(gateway['clients'].has('test-socket-id')).toBe(true);
    });
  });

  describe('handleSendJob', () => {
    beforeEach(() => {
      const socket = createMockSocket();
      gateway['clients'].set('test-socket-id', {
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

      (pgBossService.publish as jest.Mock).mockResolvedValue('job-123');

      const result = await gateway.handleSendJob(socket, jobData);

      expect(pgBossService.publish).toHaveBeenCalledWith(
        'customer-123/test-job',
        { message: 'Hello World' },
        expect.objectContaining({
          priority: 5,
          retryLimit: 3,
        }),
      );
      expect(result).toEqual({ jobId: 'job-123' });
    });

    it('should return error for unauthenticated client', async () => {
      const socket = createMockSocket({ id: 'unknown-socket' });
      const jobData = {
        name: 'test-job',
        data: { message: 'Hello World' },
      };

      const result = await gateway.handleSendJob(socket, jobData);

      expect(result).toEqual({ error: 'Client not authenticated' });
      expect(pgBossService.publish).not.toHaveBeenCalled();
    });
  });

  describe('handleRegisterWorker', () => {
    beforeEach(() => {
      const socket = createMockSocket();
      gateway['clients'].set('test-socket-id', {
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

      (pgBossService.subscribe as jest.Mock).mockResolvedValue(undefined);

      const result = await gateway.handleRegisterWorker(socket, workerData);

      expect(pgBossService.subscribe).toHaveBeenCalledWith('customer-123/test-job', expect.any(Function));
      expect(result).toEqual({ success: true });
    });
  });

  describe('Job Status Events', () => {
    it('should emit job started event to all clients', () => {
      const socket = createMockSocket();
      const eventData = { jobId: 'job-123' };

      gateway.handleJobStarted(socket, eventData);

      const serverEmit = gateway['server'].emit as jest.Mock;
      expect(serverEmit).toHaveBeenCalledWith('job_started', {
        jobId: 'job-123',
        startedAt: expect.any(Date),
      });
    });

    it('should emit job completed event to all clients', () => {
      const socket = createMockSocket();
      const eventData = {
        jobId: 'job-123',
        result: { success: true, data: 'completed' },
      };

      gateway.handleJobCompleted(socket, eventData);

      const serverEmitCompleted = gateway['server'].emit as jest.Mock;
      expect(serverEmitCompleted).toHaveBeenCalledWith('job_completed', {
        jobId: 'job-123',
        result: { success: true, data: 'completed' },
        completedAt: expect.any(Date),
      });
    });
  });
});
