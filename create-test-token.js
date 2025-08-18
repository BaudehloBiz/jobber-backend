const {PrismaClient} = require('./generated/prisma/client');

async function main() {
  const prisma = new PrismaClient();

  try {
    // Create a test customer token
    const customerToken = await prisma.customerToken.create({
      data: {
        token: 'test-customer-token-123',
        customerId: 'customer-001',
        description: 'Test customer token for development',
        isActive: true,
      },
    });

    console.log('Created customer token:', customerToken);
  } catch (error) {
    console.error('Error creating customer token:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
