export type UserRole = 'admin' | 'team_lead' | 'member' | 'viewer';

export type AuthProvider = 'email' | 'google' | 'github' | 'saml';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  teamId: string | null;
  authProvider: AuthProvider | null;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  teamId: string | null;
}
