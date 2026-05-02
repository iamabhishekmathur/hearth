import type { ReactNode } from 'react';

/**
 * Extension hook for the web app.
 *
 * Cloud routes (and any other downstream consumer) can register pages
 * and sidebar items without modifying OSS source. The OSS Router consults
 * the registry before falling back to its own route table; the OSS
 * Sidebar merges registered nav items into its list.
 *
 * Usage from a cloud module:
 *
 *   import { registerWebExtension } from '@hearth/web/extensions/register';
 *   import { AdminPage } from './admin-page';
 *
 *   registerWebExtension({
 *     routes: [
 *       { matches: (route) => route.startsWith('/admin'), render: () => <AdminPage /> },
 *     ],
 *     navItems: [
 *       { label: 'Admin', route: '/admin', icon: 'shield' },
 *     ],
 *   });
 *
 * Registration must happen at module-load time of the cloud entrypoint,
 * before the OSS app renders.
 */

export interface WebExtensionRoute {
  /** Returns true when this extension should render for the given hash route. */
  matches: (route: string) => boolean;
  /** Render function — returns the page React tree. */
  render: () => ReactNode;
}

export interface WebExtensionNavItem {
  label: string;
  route: string;
  /** Icon name from the OSS icon set (HIcon name prop). Optional. */
  icon?: string;
  /** If set, the item only renders for users with the given role(s). */
  requiredRoles?: Array<'admin' | 'team_lead' | 'member' | 'viewer'>;
}

export interface WebExtension {
  routes?: WebExtensionRoute[];
  navItems?: WebExtensionNavItem[];
}

const extensions: WebExtension[] = [];

/** Add an extension to the registry. */
export function registerWebExtension(extension: WebExtension): void {
  extensions.push(extension);
}

/** Find the first registered route matching the given hash route, if any. */
export function findExtensionRoute(route: string): WebExtensionRoute | null {
  for (const ext of extensions) {
    const match = ext.routes?.find((r) => r.matches(route));
    if (match) return match;
  }
  return null;
}

/** Flatten and return every registered nav item (Sidebar consumes this). */
export function getExtensionNavItems(): WebExtensionNavItem[] {
  return extensions.flatMap((ext) => ext.navItems ?? []);
}
