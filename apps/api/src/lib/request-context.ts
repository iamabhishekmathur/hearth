import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  orgId: string;
  userId?: string;
  sessionId?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/** Run a function with the given request context */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

/** Get the current request context (returns undefined if not in a context) */
export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}
