import * as backend from "./state.pg";

export async function getState() {
  return backend.getState();
}

/* Document plus its content version, from a single query — see state.pg.ts. */
export async function getStateDocument() {
  return backend.getStateDocument();
}

/* Cheap content version on its own, for answering a conditional GET. */
export async function getStateVersion() {
  return backend.getStateVersion();
}

export async function getSettings() {
  return backend.getSettings();
}

export async function putState(data: string) {
  return backend.putState(data);
}

export async function deleteState() {
  return backend.deleteState();
}

export async function listSnapshots(limit?: number) {
  return backend.listSnapshots(limit);
}

export async function restoreSnapshot(id: number) {
  return backend.restoreSnapshot(id);
}
