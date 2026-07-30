export const USER_ROLES = ["USER", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const IDENTITY_SOURCES = ["LOCAL", "EMBEDDED"] as const;
export type IdentitySource = (typeof IDENTITY_SOURCES)[number];

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
