import Docker from 'dockerode';
import { SANDBOX_IMAGES } from './types.js';
import { isDockerAvailable } from './executor.js';

const docker = new Docker();

/** How many containers to pre-warm per image. */
const POOL_SIZE = 2;

/** Max uses before a container is retired. */
const MAX_USES = 10;

interface PooledContainer {
  container: Docker.Container;
  image: string;
  uses: number;
  createdAt: number;
}

/**
 * Container pool that pre-warms containers for faster code execution.
 *
 * Falls back to on-demand container creation when the pool is empty.
 * If Docker is unavailable, checkout() returns null.
 */
export class ContainerPool {
  private pools = new Map<string, PooledContainer[]>();
  private warming = false;
  private available = false;

  /**
   * Initialize the pool by checking Docker availability
   * and pre-warming containers.
   */
  async init(): Promise<void> {
    this.available = await isDockerAvailable();
    if (!this.available) return;

    // Initialize pools for each image type
    for (const image of Object.values(SANDBOX_IMAGES)) {
      this.pools.set(image, []);
    }

    // Warm pools in the background — don't block startup
    this.warmPools().catch(() => {
      // Warming failed; on-demand creation will be used
    });
  }

  /**
   * Whether the pool has Docker access.
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Check out a container from the pool.
   * Returns null if Docker is unavailable.
   * Falls back to creating on-demand if pool is empty.
   */
  async checkout(image: string): Promise<PooledContainer | null> {
    if (!this.available) return null;

    const pool = this.pools.get(image);
    if (pool && pool.length > 0) {
      const entry = pool.shift()!;
      // Trigger background replenishment
      this.replenish(image).catch(() => {});
      return entry;
    }

    // On-demand creation
    try {
      const container = await this.createWarmContainer(image);
      if (!container) return null;
      return {
        container,
        image,
        uses: 0,
        createdAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Return a container to the pool after use.
   * Retires the container if it has exceeded MAX_USES.
   */
  async release(entry: PooledContainer): Promise<void> {
    entry.uses++;

    if (entry.uses >= MAX_USES) {
      // Retire: remove the container
      try {
        await entry.container.remove({ force: true });
      } catch {
        // Best-effort cleanup
      }
      // Trigger replenishment
      this.replenish(entry.image).catch(() => {});
      return;
    }

    const pool = this.pools.get(entry.image);
    if (pool) {
      pool.push(entry);
    } else {
      // No pool for this image — just clean up
      try {
        await entry.container.remove({ force: true });
      } catch {
        // Best-effort
      }
    }
  }

  /**
   * Drain all containers from the pool and remove them.
   */
  async drain(): Promise<void> {
    for (const [, pool] of this.pools) {
      for (const entry of pool) {
        try {
          await entry.container.remove({ force: true });
        } catch {
          // Best-effort
        }
      }
      pool.length = 0;
    }
  }

  /**
   * Pre-warm containers for all image types.
   */
  private async warmPools(): Promise<void> {
    if (this.warming) return;
    this.warming = true;

    try {
      for (const image of Object.values(SANDBOX_IMAGES)) {
        const pool = this.pools.get(image) ?? [];
        const needed = POOL_SIZE - pool.length;

        for (let i = 0; i < needed; i++) {
          try {
            const container = await this.createWarmContainer(image);
            if (container) {
              pool.push({
                container,
                image,
                uses: 0,
                createdAt: Date.now(),
              });
            }
          } catch {
            // Skip this container; we'll try again on next replenish
          }
        }

        this.pools.set(image, pool);
      }
    } finally {
      this.warming = false;
    }
  }

  /**
   * Replenish the pool for a specific image to maintain POOL_SIZE.
   */
  private async replenish(image: string): Promise<void> {
    const pool = this.pools.get(image);
    if (!pool) return;

    const needed = POOL_SIZE - pool.length;
    for (let i = 0; i < needed; i++) {
      try {
        const container = await this.createWarmContainer(image);
        if (container) {
          pool.push({
            container,
            image,
            uses: 0,
            createdAt: Date.now(),
          });
        }
      } catch {
        break;
      }
    }
  }

  /**
   * Create a warm container that is ready to execute code.
   * The container is created but NOT started — it will be started
   * when code is submitted for execution.
   */
  private async createWarmContainer(
    image: string,
  ): Promise<Docker.Container | null> {
    try {
      const container = await docker.createContainer({
        Image: image,
        Cmd: ['sleep', 'infinity'],
        User: '1000',
        NetworkDisabled: true,
        HostConfig: {
          Memory: 512 * 1024 * 1024,
          MemorySwap: 512 * 1024 * 1024,
          CpuPeriod: 100_000,
          CpuQuota: 100_000,
          NetworkMode: 'none',
          SecurityOpt: ['no-new-privileges'],
          ReadonlyRootfs: true,
          Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m' },
          AutoRemove: false,
        },
        Tty: false,
      });

      await container.start();
      return container;
    } catch {
      return null;
    }
  }
}

/** Shared container pool singleton. */
export const containerPool = new ContainerPool();
