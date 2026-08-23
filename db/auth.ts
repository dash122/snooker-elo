export type { MemberSession, MemberRow } from "./auth-types";

import * as backend from "./auth.pg";

export type { GoogleMemberLookup } from "./auth.pg";

export async function resolveGoogleMember(email: string, googleId: string) {
  return backend.resolveGoogleMember(email, googleId);
}

export async function connectGoogleMember(memberEmail: string, googleId: string) {
  return backend.connectGoogleMember(memberEmail, googleId);
}

export async function getCurrentMember() {
  return backend.getCurrentMember();
}

export async function requireMember(role?: "admin") {
  return backend.requireMember(role);
}

export async function verifyCredentials(username: string, password: string) {
  return backend.verifyCredentials(username, password);
}

export async function createMember(username: string, email: string, displayName: string, password: string, role: "admin" | "member", statePlayerId?: string) {
  return backend.createMember(username, email, displayName, password, role, statePlayerId);
}

export async function checkSignupAvailability(username: string | null, email: string | null) {
  return backend.checkSignupAvailability(username, email);
}

export type { NewSignupPlayer } from "./auth.pg";

export async function createMemberWithPlayer(input: Parameters<typeof backend.createMemberWithPlayer>[0]) {
  return backend.createMemberWithPlayer(input);
}

export async function updateMember(email: string, input: { username?: string; newEmail?: string; password?: string; currentPassword?: string }) {
  return backend.updateMember(email, input);
}

export type ProfileResult = "ok" | "username-taken" | "email-taken";

export async function updateProfile(email: string, input: { username: string; newEmail: string; displayName: string; avatar?: string | null; initials?: string | null; iconColour?: string | null }): Promise<ProfileResult> {
  return backend.updateProfile(email, input);
}

export async function deactivateMember(email: string, currentPassword: string) {
  return backend.deactivateMember(email, currentPassword);
}

export async function deleteMember(email: string) {
  return backend.deleteMember(email);
}

export async function adminUpdateMember(email: string, input: { username: string; newEmail: string; displayName: string; password?: string; statePlayerId?: string | null }) {
  return backend.adminUpdateMember(email, input);
}

export async function hasMembers() {
  return backend.hasMembers();
}
export async function needsOnboarding(email: string) {
  return backend.needsOnboarding(email);
}
export async function savePreliminaryRating(email: string, preliminaryRating: number, finalRating: number, at: string) {
  return backend.savePreliminaryRating(email, preliminaryRating, finalRating, at);
}
export async function createSession(email: string) {
  return backend.createSession(email);
}

export async function deleteCurrentSession() {
  return backend.deleteCurrentSession();
}

export async function listMembers() {
  return backend.listMembers();
}

export async function syncMemberPlayerProfiles(players: { id: string; name: string; short: string; colour?: string | null }[]) {
  return backend.syncMemberPlayerProfiles(players);
}
