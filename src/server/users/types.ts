import type { UserRole } from "@/src/server/domain/identity";

export type ManagedUser = {
  readonly id: string;
  readonly username: string | null;
  readonly email: string | null;
  readonly displayName: string;
  readonly source: "LOCAL" | "EMBEDDED";
  readonly role: UserRole;
  readonly status: "ACTIVE" | "DISABLED";
  readonly mustChangePassword: boolean;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
};

export type LocalUserFields = {
  readonly username: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
};

export type CreateLocalUserResult = {
  readonly user: ManagedUser;
  readonly temporaryPassword: string;
};
