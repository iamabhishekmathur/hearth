import Docker from 'dockerode';
import type { ExecutionRequest, ExecutionResult } from './types.js';
import { SANDBOX_IMAGES } from './types.js';
import { isDockerAvailable } from './executor.js';
import { containerPool } from './container-pool.js';

const docker = new Docker();

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * High-level sandbox manager that ties together the executor and container pool.
 *
 * Provides a single `execute()` method that:
 * 1. Checks out a warm container from the pool (or creates one on-demand)
 * 2. Runs the user code inside it with exec
 * 3. Captures stdout/stderr and enforces timeout
 * 4. Returns the container to the pool (or retires it)
 *
 * Falls back to the standalone executor if no pooled containers are available.
 */
export class SandboxManager {
  private dockerAvailable = false;
  private initialized = false;

  /**
   * Initialize the sandbox manager: check Docker availability and warm the pool.
   */
  async init(): Promise<void> {
    this.dockerAvailable = await isDockerAvailable();
    if (this.dockerAvailable) {
      await containerPool.init();
    }
    this.initialized = true;
  }

  /**
   * Whether the sandbox is available (Docker is running).
   */
  isAvailable(): boolean {
    return this.dockerAvailable;
  }

  /**
   * Execute code in a sandboxed container.
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    if (!this.initialized) {
      await this.init();
    }

    if (!this.dockerAvailable) {
      return {
        stdout: '',
        stderr: 'Sandbox unavailable \u2014 Docker not running',
        exitCode: 1,
        durationMs: 0,
        timedOut: false,
      };
    }

    const image = SANDBOX_IMAGES[request.language];
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Try to get a pooled container first
    const pooled = await containerPool.checkout(image);

    if (pooled) {
      return this.executeInPooledContainer(pooled, request, timeoutMs);
    }

    // Fallback: create a one-off container via the executor
    const { executeCode } = await import('./executor.js');
    return executeCode(request);
  }

  /**
   * Execute code inside a pooled (already-running) container using docker exec.
   */
  private async executeInPooledContainer(
    pooled: { container: Docker.Container; image: string; uses: number; createdAt: number },
    request: ExecutionRequest,
    timeoutMs: number,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    let timedOut = false;

    const cmd =
      request.language === 'python'
        ? ['python3', '-c', request.code]
        : ['node', '-e', request.code];

    try {
      const exec = await pooled.container.exec({
        Cmd: cmd,
        AttachStdout: true,
        AttachStderr: true,
        User: '1000',
      });

      const stream = await exec.start({ Detach: false, Tty: false });

      // Collect output with timeout
      const { stdout, stderr } = await this.collectOutput(stream, timeoutMs);

      const inspectResult = await exec.inspect();
      const exitCode = inspectResult.ExitCode ?? 1;

      // Return container to pool
      await containerPool.release(pooled);

      return {
        stdout,
        stderr,
        exitCode,
        durationMs: Date.now() - startTime,
        timedOut: false,
      };
    } catch (err) {
      timedOut = (err as Error).message === 'EXECUTION_TIMEOUT';

      if (timedOut) {
        // Kill and remove the tainted container — don't return to pool
        try {
          await pooled.container.remove({ force: true });
        } catch {
          // Best-effort
        }

        return {
          stdout: '',
          stderr: 'Execution timed out',
          exitCode: 124,
          durationMs: Date.now() - startTime,
          timedOut: true,
        };
      }

      // Other error — try to return container to pool
      try {
        await containerPool.release(pooled);
      } catch {
        // Best-effort
      }

      const message =
        err instanceof Error ? err.message : 'Unknown execution error';
      return {
        stdout: '',
        stderr: `Execution failed: ${message}`,
        exitCode: 1,
        durationMs: Date.now() - startTime,
        timedOut: false,
      };
    }
  }

  /**
   * Collect stdout/stderr from a Docker exec stream with a timeout.
   */
  private collectOutput(
    stream: NodeJS.ReadableStream,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      const timer = setTimeout(() => {
        stream.removeAllListeners();
        try {
          (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
        } catch {
          // Best-effort
        }
        reject(new Error('EXECUTION_TIMEOUT'));
      }, timeoutMs);

      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      stream.on('end', () => {
        clearTimeout(timer);
        const buffer = Buffer.concat(chunks);
        const demuxed = this.demuxDockerStream(buffer);
        resolve(demuxed);
      });

      stream.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Demultiplex Docker stream output into stdout and stderr.
   */
  private demuxDockerStream(buffer: Buffer): {
    stdout: string;
    stderr: string;
  } {
    let stdout = '';
    let stderr = '';
    let offset = 0;

    while (offset < buffer.length) {
      if (offset + 8 > buffer.length) break;

      const streamType = buffer[offset];
      const frameSize = buffer.readUInt32BE(offset + 4);
      offset += 8;

      if (offset + frameSize > buffer.length) break;

      const payload = buffer.subarray(offset, offset + frameSize).toString('utf8');

      if (streamType === 1) {
        stdout += payload;
      } else if (streamType === 2) {
        stderr += payload;
      }

      offset += frameSize;
    }

    return { stdout, stderr };
  }

  /**
   * Shut down the sandbox manager and drain the container pool.
   */
  async shutdown(): Promise<void> {
    await containerPool.drain();
  }
}

/** Singleton sandbox manager. */
export const sandboxManager = new SandboxManager();
