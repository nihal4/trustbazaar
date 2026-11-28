// Where a step stands when the person is at step `at`: the ones before it are done, it is the current one, the ones after wait. One answer for every list of steps (the order's money, the
// ID check, the two-step sign-in, the handover), so no screen works it out for itself.
export type StepPhase = 'done' | 'current' | 'next';

export function phaseOf(index: number, at: number): StepPhase {
  if (index < at) return 'done';
  return index === at ? 'current' : 'next';
}

/** The same, as the numbered marks of a stepper name it in their stylesheets: done, now, next. */
export function stepMark(index: number, at: number): 'done' | 'now' | 'next' {
  const phase = phaseOf(index, at);
  return phase === 'current' ? 'now' : phase;
}
