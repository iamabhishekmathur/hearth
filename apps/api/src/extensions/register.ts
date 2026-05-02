import type { Express } from 'express';

/**
 * Extension hook for the API.
 *
 * Cloud (and any other downstream consumer of Hearth) can attach routes
 * and middleware to the Express app without modifying OSS source. The
 * OSS index.ts calls `applyApiExtensions(app)` after its own routes are
 * mounted but before the error handler.
 *
 * Usage from a cloud module (lives outside this OSS repo):
 *
 *   import { registerApiExtension } from '@hearth/api/extensions/register';
 *
 *   registerApiExtension((app) => {
 *     app.use('/api/v1/billing', billingRouter);
 *   });
 *
 * The registration must happen BEFORE the OSS app finishes booting —
 * typically at the top of the cloud entrypoint, before importing OSS.
 */

export type ApiExtension = (app: Express) => void | Promise<void>;

const extensions: ApiExtension[] = [];

/** Add an extension function to the registry. */
export function registerApiExtension(extension: ApiExtension): void {
  extensions.push(extension);
}

/**
 * Apply every registered extension to the Express app. Called once during
 * OSS app boot, after OSS routes are mounted and before the error handler.
 */
export async function applyApiExtensions(app: Express): Promise<void> {
  for (const ext of extensions) {
    await ext(app);
  }
}

/** Read-only view for diagnostics — how many extensions are registered. */
export function registeredExtensionCount(): number {
  return extensions.length;
}
