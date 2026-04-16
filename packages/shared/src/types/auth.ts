export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface AuthResponse {
  data?: {
    id: string;
    email?: string;
    name?: string;
    role?: string;
  };
  error?: string;
  message?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  teamId: string | null;
  orgId: string | null;
}
