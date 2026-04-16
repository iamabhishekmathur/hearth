export interface SandboxConfig {
  image: string;
  timeoutMs: number;
  memoryLimit: string;
  cpuLimit: number;
  network: 'none' | 'restricted';
}

export interface ExecutionRequest {
  language: 'python' | 'node';
  code: string;
  timeoutMs?: number;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

export const DEFAULT_CONFIG: SandboxConfig = {
  image: 'hearth-sandbox:python',
  timeoutMs: 60000,
  memoryLimit: '512m',
  cpuLimit: 1.0,
  network: 'none',
};

export const SANDBOX_IMAGES = {
  python: 'python:3.12-slim',
  node: 'node:22-alpine',
} as const;
