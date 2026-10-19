/** Monotonic id so stdout from a superseded Behave process cannot mutate the live panel. */
let activeBehaveLiveSession = 0;

export function nextBehaveLiveSessionId(): number {
  return ++activeBehaveLiveSession;
}

export function isCurrentBehaveLiveSession(id: number): boolean {
  return id === activeBehaveLiveSession;
}
