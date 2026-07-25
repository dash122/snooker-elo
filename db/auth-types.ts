export type MemberSession = {
  email: string;
  username: string;
  statePlayerId?: string;
  displayName: string;
  role: "admin" | "member";
};

export type MemberRow = {
  email: string;
  username: string;
  statePlayerId?: string;
  displayName: string;
  role: "admin" | "member";
  active: boolean;
  joinedAt: string;
};
