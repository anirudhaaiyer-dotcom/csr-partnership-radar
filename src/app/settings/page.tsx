import { SettingsClient } from '@/components/SettingsClient';
import { writesEnabled } from '@/lib/auth';
import { repo } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const settings = await repo().getSettings();
  return (
    <>
      <h1>Settings</h1>
      <p className="sub">Rules and inputs the scoring reads. Verdicts are computed in code from these values.</p>
      <SettingsClient settings={settings} writable={writesEnabled()} />
    </>
  );
}
