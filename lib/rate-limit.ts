// In-memory sliding-window limiter. Resets on deploy and isn't shared across
// serverless instances, so it's a soft throttle against casual abuse/scripts
// rather than a hard guarantee — a persisted (DB or Redis) limiter would be
// needed to bound a determined attacker with many instances to hit.
const attempts = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

// Bound memory: drop old keys the next time we happen to touch the map.
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, times] of attempts) {
    if (!times.some(t => now - t < WINDOW_MS)) attempts.delete(key);
  }
}

export function checkAttempt(key: string, max = MAX_ATTEMPTS, windowMs = WINDOW_MS): boolean {
  const now = Date.now();
  sweep(now);
  const times = (attempts.get(key) ?? []).filter(t => now - t < windowMs);
  if (times.length >= max) {
    attempts.set(key, times);
    return false;
  }
  times.push(now);
  attempts.set(key, times);
  return true;
}

// Same window as checkAttempt but split into a read and a write: a login
// endpoint wants to reject once a key is over budget without every
// *successful* request also eating into that budget. Many members can share
// one public IP (office wifi, mobile carrier NAT), so counting successes
// against the same bucket as failures means one member's login can lock out
// everyone else behind that IP. Call isBlocked before doing the real work,
// then recordFailure only when it actually fails.
export function isBlocked(key: string, max = MAX_ATTEMPTS, windowMs = WINDOW_MS): boolean {
  const now = Date.now();
  sweep(now);
  const times = (attempts.get(key) ?? []).filter(t => now - t < windowMs);
  attempts.set(key, times);
  return times.length >= max;
}

export function recordFailure(key: string, windowMs = WINDOW_MS): void {
  const now = Date.now();
  const times = (attempts.get(key) ?? []).filter(t => now - t < windowMs);
  times.push(now);
  attempts.set(key, times);
}
