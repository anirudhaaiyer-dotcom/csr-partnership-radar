import { createMemoryRepo } from './memory';
import { createNeonRepo } from './neon';
import type { Repo } from './types';

const g = globalThis as unknown as { __csrRepo?: Repo };

/**
 * With DATABASE_URL set (Neon Postgres connection string), data persists in Neon.
 * Without it the app runs in demo mode on the seeded items, and changes are not saved.
 */
export function getRepo(): Repo {
  if (g.__csrRepo) return g.__csrRepo;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  g.__csrRepo = url ? createNeonRepo(url) : createMemoryRepo({ seed: true, demo: true });
  return g.__csrRepo;
}
