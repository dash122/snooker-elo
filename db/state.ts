import * as backend from "./state.pg";

export async function getState() {
  return backend.getState();
}

export async function putState(data: string) {
  return backend.putState(data);
}

export async function deleteState() {
  return backend.deleteState();
}
