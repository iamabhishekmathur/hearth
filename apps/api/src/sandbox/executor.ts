import Docker from 'dockerode';
import type { ExecutionRequest, ExecutionResult } from './types.js';
import { SANDBOX_IMAGES } from './types.js';

const docker = new Docker();

/** Memory limit in bytes (512 MB). */
const MEMORY_LIMIT = 512 * 1024 * 1024;

/** Default execution timeout in ms. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** CPU quota: 1.0 CPU = 100000 microseconds per 100000 period. */
const CPU_PERIOD = 100_000;
const CPU_QUOTA = 100_000; // 1.0 CPU

/**
 * Check whether the Docker daemon is reachable.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute code inside a sandboxed Docker container.
 *
 * Security constraints:
 * - Network disabled (NetworkMode: 'none')
 * - Memory capped at 512 MB
 * - CPU limited to 1 core
 * - Runs as non-root (User: '1000')
 * - No new privileges (SecurityOpt: ['no-new-privileges'])
 * - Read-only root filesystem
 * - Temporary /tmp mounted for scratch space
 */
export async function executeCode(
  request: ExecutionRequest,
): Promise<ExecutionResult> {
  const available = await isDockerAvailable();
  if (!available) {
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

  // Build the command to run
  const cmd =
    request.language === 'python'
      ? ['python3', '-c', request.code]
      : ['node', '-e', request.code];

  const startTime = Date.now();
  let container: Docker.Container | undefined;
  let timedOut = false;

  try {
    container = await docker.createContainer({
      Image: image,
      Cmd: cmd,
      User: '1000',
      NetworkDisabled: true,
      HostConfig: {
        Memory: MEMORY_LIMIT,
        MemorySwap: MEMORY_LIMIT, // no swap
        CpuPeriod: CPU_PERIOD,
        CpuQuota: CPU_QUOTA,
        NetworkMode: 'none',
        SecurityOpt: ['no-new-privileges'],
        ReadonlyRootfs: true,
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m' },
        AutoRemove: false,
      },
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    await container.start();

    // Race between container finishing and timeout
    const waitPromise = container.wait();
    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), timeoutMs),
    );

    const result = await Promise.race([waitPromise, timeoutPromise]);

    if (result === 'timeout') {
      timedOut = true;
      try {
        await container.kill();
      } catch {
        // Container may have already exited
      }
    }

    // Collect logs
    const logStream = await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
    });

    const { stdout, stderr } = demuxDockerLogs(logStream);

    const exitCode = timedOut
      ? 124 // standard timeout exit code
      : typeof result === 'object' && 'StatusCode' in result
        ? result.StatusCode
        : 1;

    return {
      stdout,
      stderr,
      exitCode,
      durationMs: Date.now() - startTime,
      timedOut,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown execution error';
    return {
      stdout: '',
      stderr: `Execution failed: ${message}`,
      exitCode: 1,
      durationMs: Date.now() - startTime,
      timedOut: false,
    };
  } finally {
    // Clean up the container
    if (container) {
      try {
        await container.remove({ force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

/**
 * Demultiplex Docker log output into stdout and stderr.
 *
 * Docker multiplexed logs use an 8-byte header per frame:
 *   [stream_type(1)][0(3)][size(4)][payload(size)]
 * stream_type: 1 = stdout, 2 = stderr
 */
function demuxDockerLogs(buffer: Buffer): {
  stdout: string;
  stderr: string;
} {
  let stdout = '';
  let stderr = '';

  // If it's a string (shouldn't happen but guard), treat as stdout
  if (typeof buffer === 'string') {
    return { stdout: buffer, stderr: '' };
  }

  let offset = 0;
  while (offset < buffer.length) {
    // Need at least 8 bytes for the header
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
