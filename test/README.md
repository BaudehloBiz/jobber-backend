# WebSocket Gateway Test Suite

This comprehensive test suite covers the JobberGateway functionality including unit tests and end-to-end tests.

## Test Structure

```
test/
├── unit/
│   └── websocket/
│       └── websocket.gateway.spec.ts    # Unit tests for WebSocket gateway
├── e2e/
│   └── websocket.e2e-spec.ts           # End-to-end WebSocket tests
└── jest-e2e.json                       # E2E test configuration
```

## Unit Tests (`test/unit/websocket/websocket.gateway.spec.ts`)

### Test Coverage

1. **Connection Handling**
   - ✅ Rejects connections without customer token
   - ✅ Rejects connections with invalid customer token
   - ✅ Accepts connections with valid customer token
   - ✅ Handles database errors gracefully during authentication

2. **Job Operations**
   - ✅ Publishes jobs to pg-boss with customer-specific queue prefixes
   - ✅ Returns errors for unauthenticated clients
   - ✅ Handles job publishing errors

3. **Worker Registration**
   - ✅ Registers workers for customer-specific job queues
   - ✅ Handles worker registration errors
   - ✅ Validates client authentication before registration

4. **Job Status Events**
   - ✅ Emits job started events to all clients
   - ✅ Emits job completed events with results
   - ✅ Emits job failed events with error details

### Key Features Tested

- **Customer Isolation**: All queues are prefixed with customer ID (`customer-123/job-name`)
- **Authentication**: Database-backed token validation using CustomerToken model
- **Error Handling**: Comprehensive error scenarios and graceful degradation
- **pg-boss Integration**: Proper job publishing and worker subscription

## End-to-End Tests (`test/e2e/websocket.e2e-spec.ts`)

### Test Coverage

1. **WebSocket Connection Flow**
   - ✅ Connection rejection without authentication
   - ✅ Connection rejection with invalid tokens
   - ✅ Successful connection with valid tokens

2. **Real-time Job Operations**
   - ✅ Job sending with customer prefixing
   - ✅ Worker registration and subscription
   - ✅ Batch job operations
   - ✅ Job cancellation

3. **Event Broadcasting**
   - ✅ Job status event distribution
   - ✅ Real-time updates to connected clients

4. **Queue Management**
   - ✅ Queue size reporting
   - ✅ Job scheduling operations

5. **Error Scenarios**
   - ✅ Network error handling
   - ✅ Service failure scenarios
   - ✅ Malformed request handling

## Test Configuration

### Unit Test Configuration
- Uses Jest with NestJS testing utilities
- Mocks PrismaService and PgBossService
- Isolated test environment with proper cleanup

### E2E Test Configuration (`jest-e2e.json`)
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "moduleNameMapping": {
    "^src/(.*)$": "<rootDir>/src/$1"
  },
  "testTimeout": 30000
}
```

## Running Tests

### Unit Tests
```bash
# Run all unit tests
npm test test/unit/websocket/websocket.gateway.spec.ts

# Run with coverage
npm run test:cov test/unit/websocket/websocket.gateway.spec.ts

# Run in watch mode
npm run test:watch test/unit/websocket/websocket.gateway.spec.ts
```

### E2E Tests
```bash
# Run E2E tests
npm run test:e2e test/e2e/websocket.e2e-spec.ts

# Run with debug output
npm run test:e2e -- --verbose test/e2e/websocket.e2e-spec.ts
```

### All WebSocket Tests
```bash
# Use the provided test runner script
./run-websocket-tests.sh
```

## Test Dependencies

### Installed Packages
- `socket.io-client`: WebSocket client for E2E testing
- `@types/socket.io-client`: TypeScript definitions

### Mock Strategy
- **PrismaService**: Mocked with Jest to simulate database operations
- **PgBossService**: Mocked to test job queue operations without actual pg-boss instance
- **Socket.IO**: Custom mock objects for unit tests, real connections for E2E tests

## Customer Token Authentication Flow

The tests validate the complete authentication flow:

1. **Client Connection**: WebSocket connection with `customerToken` in auth headers
2. **Token Validation**: Database lookup in `customer_tokens` table
3. **Customer Mapping**: Socket associated with customer ID for queue isolation
4. **Queue Prefixing**: All operations use `{customerId}/{jobName}` format

## Queue Architecture Testing

The test suite validates the customer-specific queue architecture:

- **Queue Naming**: `customer-123/job-name` format
- **Isolation**: Each customer's jobs are isolated in separate queues
- **Scalability**: Multiple workers can subscribe to customer-specific queues
- **Persistence**: pg-boss provides persistent job storage

## Error Handling Coverage

Comprehensive error scenarios are tested:

- Database connection failures during authentication
- pg-boss service unavailability
- Network disconnections and reconnections
- Invalid job payloads and malformed requests
- Authorization failures and expired tokens

## Performance Considerations

The test suite includes scenarios for:

- Multiple concurrent connections
- Batch job processing
- High-frequency job submissions
- Worker scaling and load distribution

## Integration Points

Tests validate integration with:

- **Prisma ORM**: Customer token lookups and database operations
- **pg-boss**: Job queue publishing, subscription, and management
- **Socket.IO**: Real-time WebSocket communication
- **NestJS**: Dependency injection and module system

## Future Enhancements

Potential test suite improvements:

1. **Load Testing**: Add performance tests with multiple concurrent clients
2. **Database Integration**: Tests with actual PostgreSQL database
3. **Redis Integration**: If caching is added for customer tokens
4. **Monitoring**: Test suite for metrics and health checks
5. **Security**: Additional authentication and authorization scenarios

This comprehensive test suite ensures the WebSocket gateway works correctly with pg-boss job queues, customer authentication, and real-time event handling.
