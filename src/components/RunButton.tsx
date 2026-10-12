'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RunButton({ disabled, title }: { disabled?: boolean; title?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  async function run(probe: boolean) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ probe }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setMsg(`Run ${data.status}: ${data.reviewed} reviewed, ${data.extracted} extracted, ${data.queued} queued.`);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function testDigest() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/digest/test', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setMsg(`Test digest sent to ${data.to}.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="row" style={{ gap: 8 }}>
      <button className="btn" type="button" disabled={disabled || busy} title={title} onClick={() => run(false)}>{busy ? 'Running…' : 'Run now'}</button>
      <button className="btn" type="button" disabled={disabled || busy} title="Sends one [TEST] copy of the digest to the recipient address" onClick={testDigest}>Send test digest</button>
      <button className="btn" type="button" disabled={disabled || busy} title="Also queries GDELT and records counts by source" onClick={() => run(true)}>Run source probe</button>
      {msg && <span className="meta" role="status">{msg}</span>}
    </span>
  );
}
