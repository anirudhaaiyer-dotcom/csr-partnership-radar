import type { Settings, SignalLevel, TriCheck, Verdict } from './types';

export interface VerdictInput {
  signal: SignalLevel;
  explicitPartnerSearch: boolean;
  total: number;
  beneficiaryPoints: number;
  checks: { schedule_vii: TriCheck; section135: TriCheck; exclusions: TriCheck };
  readiness: TriCheck;
  settings: Pick<Settings, 'call_min' | 'watch_min' | 'fit_floor'>;
}

/**
 * Order of precedence (checks are evaluated before score, and a high score never overrides a failed check):
 * 1 readiness failed -> excluded
 * 2 any failed check -> excluded
 * 3 policy signal -> policy (not scored)
 * 4 explicit partner search with Schedule VII passed -> call, whatever the total
 * 5 score bands
 * 6 Call is capped at Watch by: beneficiary points under the fit floor, or Schedule VII unknown
 * Section 135 unknown never caps; it adds a verify step to the next action.
 */
export function decide(i: VerdictInput): { verdict: Verdict; reason: string } {
  if (i.readiness.state === 'failed') return { verdict: 'excluded', reason: 'NGO readiness check failed' };
  const failed = (['schedule_vii', 'section135', 'exclusions'] as const).find((k) => i.checks[k].state === 'failed');
  if (failed) {
    const name = failed === 'schedule_vii' ? 'Schedule VII fit' : failed === 'section135' ? 'Section 135 applicability' : 'Exclusions';
    return { verdict: 'excluded', reason: `${name} check failed` };
  }
  if (i.signal === 'policy') return { verdict: 'policy', reason: 'Policy update, not scored' };

  if (i.explicitPartnerSearch && i.checks.schedule_vii.state === 'passed') {
    return { verdict: 'call', reason: 'Explicit partner search and the mandatory checks passed' };
  }

  const { call_min, watch_min, fit_floor } = i.settings;
  if (i.total >= call_min) {
    if (i.beneficiaryPoints < fit_floor) return { verdict: 'watch', reason: `Score ${i.total} but beneficiary fit is below ${fit_floor} points` };
    if (i.checks.schedule_vii.state === 'unknown') return { verdict: 'watch', reason: `Score ${i.total} but Schedule VII fit is not established` };
    return { verdict: 'call', reason: `Score ${i.total} meets the Call threshold of ${call_min}` };
  }
  if (i.total >= watch_min) return { verdict: 'watch', reason: `Score ${i.total} is in the Watch range` };
  return { verdict: 'skip', reason: `Score ${i.total} is below ${watch_min}` };
}
