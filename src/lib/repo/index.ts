import { createMemoryRepo } from './memory';
import { createSupabaseRepo } from './supabase';
import type { Repo } from './types';

const g = globalThis as unknown as { __csrRepo?: Repo };

/**
 * With SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set, data persists in Supabase.
 * Without them the app runs in demo mode on the seeded items, and changes are not saved.
 */
export function getRepo(): Repo {
  if (g.__csrRepo) return g.__csrRepo;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  g.__csrRepo = url && key ? createSupabaseRepo(url, key) : createMemoryRepo({ seed: true, demo: true });
  return g.__csrRepo;
}
