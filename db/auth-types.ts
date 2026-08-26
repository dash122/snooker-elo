export type MemberSession = {
  email: string;
  username: string;
  statePlayerId?: string;
  displayName: string;
  avatar?: string | null;
  initials?: string | null;
  iconColour?: string | null;
  googleLinked?: boolean;
  // false for an account created by Google sign-in: the stored password hash is
  // a placeholder the member has never seen, so nothing may ask them for it.
  hasPassword?: boolean;
  role: "admin" | "member";
};

export type MemberRow = {
  email: string;
  username: string;
  statePlayerId?: string;
  displayName: string;
  avatar?: string | null;
  initials?: string | null;
  iconColour?: string | null;
  googleLinked?: boolean;
  role: "admin" | "member";
  active: boolean;
  joinedAt: string;
};
