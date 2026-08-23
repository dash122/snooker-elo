export type MemberSession = {
  email: string;
  username: string;
  statePlayerId?: string;
  displayName: string;
  avatar?: string | null;
  initials?: string | null;
  iconColour?: string | null;
  googleLinked?: boolean;
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
