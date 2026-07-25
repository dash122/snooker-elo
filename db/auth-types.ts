export type MemberSession = {
  email: string;
  displayName: string;
  role: "admin" | "member";
};

export type MemberRow = {
  email: string;
  displayName: string;
  role: "admin" | "member";
  active: boolean;
  joinedAt: string;
};
