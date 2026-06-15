import { useState } from 'react';
import type { SessionUser } from '@hearth/shared';
import { HRailItem, HAvatar } from '@/components/ui/primitives';
import { getExtensionNavItems } from '@/extensions/register';

interface SidebarProps {
  user: SessionUser;
  currentRoute: string;
  onNavigate: (route: string) => void;
  onLogout: () => void;
}

export function Sidebar({ user, currentRoute, onNavigate, onLogout }: SidebarProps) {
  const active = (route: string) => currentRoute.startsWith(route);
  const initials = user.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
  const [menuOpen, setMenuOpen] = useState(false);
  // Cloud / downstream consumers can register extra nav items via the
  // extension hook. Filtered by required role if specified.
  const extensionItems = getExtensionNavItems().filter((item) => {
    if (!item.requiredRoles || item.requiredRoles.length === 0) return true;
    return item.requiredRoles.includes(user.role as 'admin' | 'team_lead' | 'member' | 'viewer');
  });

  return (
    <aside
      className="flex h-full flex-col items-center border-r border-hearth-border bg-hearth-rail animate-fade-in"
      style={{ width: 76, minWidth: 76 }}
    >
      {/* Logo */}
      <div
        className="mt-4 mb-3.5 grid place-items-center rounded-md text-white font-display font-semibold"
        style={{
          width: 36, height: 36,
          background: 'var(--hearth-accent-grad)',
          fontSize: 17, letterSpacing: -0.5,
        }}
      >
        H
      </div>

      {/* Primary nav */}
      <nav className="flex flex-col items-center gap-1">
        <HRailItem icon="chat" label="Chat" active={active('/chat')} onClick={() => onNavigate('/chat')} />
        <HRailItem icon="board" label="Tasks" active={active('/tasks')} onClick={() => onNavigate('/tasks')} />
        <HRailItem icon="clock" label="Routines" active={active('/routines')} onClick={() => onNavigate('/routines')} />
        <HRailItem icon="skills" label="Skills" active={active('/skills')} onClick={() => onNavigate('/skills')} />
        <HRailItem icon="memory" label="Memory" active={active('/memory')} onClick={() => onNavigate('/memory')} />
      </nav>

      {/* Bottom nav */}
      <div className="mt-auto mb-4 flex flex-col items-center gap-1">
        <HRailItem icon="activity" label="Activity" active={active('/activity')} dot onClick={() => onNavigate('/activity')} />
        <HRailItem icon="decisions" label="Decisions" active={active('/decisions')} onClick={() => onNavigate('/decisions')} />
        {extensionItems.map((item) => (
          <HRailItem
            key={item.route}
            icon={item.icon ?? 'settings'}
            label={item.label}
            active={active(item.route)}
            onClick={() => onNavigate(item.route)}
          />
        ))}
        <HRailItem icon="settings" label="Settings" active={active('/settings')} onClick={() => onNavigate('/settings')} />
        <div className="relative mt-2">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            title={user.name}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <HAvatar initials={initials} size={32} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div
                role="menu"
                className="absolute bottom-0 left-full z-40 ml-2 w-52 rounded-lg border border-hearth-border bg-hearth-bg p-1.5 shadow-lg animate-fade-in"
              >
                <div className="px-2.5 py-2">
                  <p className="truncate text-sm font-medium text-hearth-text">{user.name}</p>
                  <p className="truncate text-xs text-hearth-text-faint">{user.email}</p>
                </div>
                <div className="my-1 h-px bg-hearth-border" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onNavigate('/settings'); }}
                  className="w-full rounded-md px-2.5 py-1.5 text-left text-sm text-hearth-text hover:bg-hearth-chip"
                >
                  Settings
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onLogout(); }}
                  className="w-full rounded-md px-2.5 py-1.5 text-left text-sm text-hearth-text hover:bg-hearth-chip"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
