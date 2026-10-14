import { prisma } from '../src/prisma.js';
import { performance } from 'node:perf_hooks';

async function bench(label, fn, n = 5) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    try { await fn(); } catch (e) { console.error(`  💥 ${label}: ${e.message}`); return; }
    times.push(performance.now() - t0);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  console.log(`  ${label.padEnd(30)} min=${min.toFixed(0)}ms avg=${avg.toFixed(0)}ms max=${max.toFixed(0)}ms`);
}

console.log('▶ Benchmark de queries (5x cada)\n');
await bench('SELECT 1 (raw)', () => prisma.$queryRaw`SELECT 1`);
await bench('user.findMany (10)', () => prisma.user.findMany({ take: 10 }));
await bench('user.findUnique', () => prisma.user.findUnique({ where: { email: 'admin@triad.com' } }));
await bench('student.findMany', () => prisma.student.findMany({ take: 10 }));
await bench('exercise.findMany', () => prisma.exercise.findMany({ take: 10 }));
await bench('membership.findMany + include', () => prisma.membership.findMany({
  take: 5,
  include: { student: true, plan: true },
}));
await bench('workoutPlan.findMany + include', () => prisma.workoutPlan.findMany({
  take: 5,
  include: { exercises: { include: { exercise: true } } },
}));

await prisma.$disconnect();