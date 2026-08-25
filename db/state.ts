import * as backend from "./state.pg";

export async function getState() {
  return backend.getState();
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
