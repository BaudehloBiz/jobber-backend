#!/bin/bash

# Test runner for WebSocket gateway tests
echo "Running WebSocket Gateway Unit Tests..."

cd /Users/matt/Dev/jobber-backend

# Run unit tests
echo "=== Unit Tests ==="
npx jest test/unit/websocket/websocket.gateway.spec.ts --verbose --testTimeout=5000 --runInBand

echo ""
echo "=== Test Summary ==="
echo "Unit tests completed. Check output above for results."

# Note: E2E tests require actual server setup and may take longer
echo ""
echo "To run E2E tests separately:"
echo "npm run test:e2e test/e2e/websocket.e2e-spec.ts"
