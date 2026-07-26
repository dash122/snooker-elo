export type MemberSession = {
  email: string;
  username: string;
  statePlayerId?: string;
  displayName: string;
  avatar?: string | null;
  initials?: string | null;
  role: "admin" | "member";
};

export type MemberRow = {
  email: string;
  username: string;
  statePlayerId?: string;
  displayName: string;
  avatar?: string | null;
  initials?: string | null;
  role: "admin" | "member";
  active: boolean;
  joinedAt: string;
};
