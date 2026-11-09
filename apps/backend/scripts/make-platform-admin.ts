// Grants the UDYOG platform-admin flag (backup, server sync, updates,
// download stats) to exactly one existing user, by email. There is no API
// and no env var for this on purpose: run it on the server.
//
//   dev:        pnpm --filter @nodedr-restaurant/backend make-platform-admin you@example.com
//   container:  docker exec nodedr-restaurant-backend node dist/scripts/make-platform-admin.js you@example.com
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2]?.trim();
  if (!email) {
    console.error('Usage: make-platform-admin <email>');
    process.exitCode = 1;
    return;
  }

  const users = await prisma.user.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, name: true, restaurantId: true, isPlatformAdmin: true },
  });
  console.log(`Users matching ${email}: ${users.length}`);

  if (users.length !== 1) {
    console.error(
      users.length === 0
        ? 'No user has this email. Nothing changed.'
        : 'More than one user has this email (in different restaurants). Nothing changed.',
    );
    process.exitCode = 1;
    return;
  }

  const [user] = users;
  if (user.isPlatformAdmin) {
    console.log(`${user.name} is already a platform admin.`);
    return;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { isPlatformAdmin: true },
  });
  console.log(`${user.name} (restaurant ${user.restaurantId}) is now a platform admin.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
