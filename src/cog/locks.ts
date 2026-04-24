import { deleteState, getState, setState } from "../store/db.js";

export const REFLECT_LOCK_KEY = "reflect_running";
export const LOCK_TTL_MS = 30 * 60 * 1000;

export function acquireReflectLock(now = Date.now()): boolean {
  const existing = getState(REFLECT_LOCK_KEY);
  if (existing) {
    const lockTime = Number.parseInt(existing, 10);
    if (Number.isFinite(lockTime) && now - lockTime < LOCK_TTL_MS) {
      return false;
    }
  }

  setState(REFLECT_LOCK_KEY, String(now));
  return true;
}

export function releaseReflectLock(): void {
  deleteState(REFLECT_LOCK_KEY);
}
