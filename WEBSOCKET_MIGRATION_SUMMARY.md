# WebSocket Gateway Migration to pg-boss

## Overview

This document summarizes the changes made to migrate the WebSocket gateway from an in-memory queue system to using pg-boss with customer-specific queue prefixes.

## Changes Made

### 1. Database Schema Changes

- **Added `CustomerToken` model** in `prisma/schema.prisma`:
  - Maps customer tokens to customer IDs
  - Includes fields: `id`, `token`, `customerId`, `description`, `isActive`, `createdAt`, `updatedAt`
  - Indexed on `token` and `customerId` for performance
  - Maps to underlying table `customer_tokens`

### 2. Authentication Changes

- **Enhanced connection handler** in `WebSocketGateway`:
  - Looks up `customerId` from `customerToken` in the database
  - Validates token exists and is active
  - Stores customer ID in client connection for queue prefixing

### 3. Queue Architecture Changes

- **Replaced in-memory storage** with pg-boss queues:
  - Removed in-memory maps: `jobs`, `jobQueues`, `activeJobs`, `completedJobs`, `failedJobs`, `scheduledJobs`
  - Each queue is prefixed with `{customerId}/` format
  - Example: `customer-001/email-processing`

### 4. Job Management Changes

- **`send_job`**: Now publishes to pg-boss with customer-prefixed queue name
- **`register_worker`**: Subscribes to customer-specific queue using pg-boss
- **`send_batch`**: Creates multiple jobs in customer-specific queues
- **Job status handlers**: Updated to work with pg-boss job lifecycle

### 5. API Compatibility

All existing WebSocket message handlers maintain the same interface:

- `send_job`
- `schedule_job`
- `register_worker`
- `job_started`, `job_completed`, `job_failed`
- `send_batch`, `wait_for_batch`
- `get_job`, `cancel_job`, `get_queue_size`

## Queue Naming Convention

- **Format**: `{customerId}/{jobName}`
- **Example**: `customer-001/email-processing`
- **Benefits**:
  - Complete isolation between customers
  - Easy monitoring and debugging per customer
  - Scalable across multiple customer instances

## Testing Setup

A test customer token was created:

- Token: `test-customer-token-123`
- Customer ID: `customer-001`
- Status: Active

## Migration Notes

- **Database migration**: Applied as `20250812202402_add_customer_tokens`
- **No breaking changes** to existing WebSocket API
- **Improved reliability**: Jobs persist across server restarts
- **Better scalability**: Can handle multiple worker instances
- **Enhanced monitoring**: pg-boss provides built-in job monitoring

## Implementation Details

- Maintained existing error handling patterns
- Added proper TypeScript typing for all new interfaces
- Preserved existing logging for debugging
- Real-time events still broadcast to all connected clients
- Queue subscription happens when workers register

## Future Enhancements

1. **Cron scheduling**: Currently simplified - could be enhanced with proper cron job scheduling
2. **Queue metrics**: Could implement real queue size reporting via pg-boss internal tables
3. **Job retrieval**: Could implement proper job status lookup via pg-boss database queries
4. **Batch operations**: Could enhance batch waiting with proper pg-boss batch tracking
