import { type ReactNode, type ButtonHTMLAttributes, useState } from 'react';
import { HIcon } from './icon';

// ---- Button ----------------------------------------------------------------

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'accent' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  icon?: string;
  iconRight?: string;
  full?: boolean;
}

export function HButton({
  children, variant = 'secondary', size = 'md', icon, iconRight, full, className = '', ...props
}: ButtonProps) {
  const base = 'inline-flex items-center gap-1.5 whitespace-nowrap font-semibold transition-all duration-fast ease-hearth rounded-md cursor-pointer';
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-3.5 py-2 text-[13px]' };
  const variants = {
    primary: 'bg-hearth-text text-hearth-text-inverse border-none hover:opacity-90',
    accent: 'text-white border-none hover:opacity-90',
    secondary: 'bg-hearth-card text-hearth-text border border-hearth-border-strong hover:border-hearth-accent',
    ghost: 'bg-transparent text-hearth-text-muted border border-transparent hover:bg-hearth-chip',
  };
  const accentGradStyle = variant === 'accent' ? { background: 'var(--hearth-accent-grad)' } : undefined;
  const width = full ? 'w-full justify-center' : '';

  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${width} ${className}`}
      style={accentGradStyle}
      {...props}
    >
      {icon && <HIcon name={icon} size={14} />}
      {children}
      {iconRight && <HIcon name={iconRight} size={14} />}
    </button>
  );
}

// ---- Pill (tab-style) ------------------------------------------------------

interface PillProps {
  children: ReactNode;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
}

export function HPill({ children, active, muted, onClick }: PillProps) {
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center whitespace-nowrap rounded-pill px-3 py-[5px] text-[13px] font-sans transition-all duration-fast ease-hearth ${
        active
          ? 'bg-hearth-card border border-hearth-border text-hearth-text font-semibold shadow-hearth-1'
          : `border border-transparent font-medium ${muted ? 'text-hearth-text-faint' : 'text-hearth-text-muted'}`
      } ${onClick ? 'cursor-pointer' : ''}`}
    >
      {children}
    </span>
  );
}

// ---- Chip (neutral token) --------------------------------------------------

interface ChipProps {
  children: ReactNode;
  icon?: string;
}

export function HChip({ children, icon }: ChipProps) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill bg-hearth-chip px-2.5 py-1 text-[12.5px] font-medium text-hearth-text-muted font-sans">
      {icon && <HIcon name={icon} size={12} />}
      {children}
    </span>
  );
}

// ---- Tool-trace pill -------------------------------------------------------

interface ToolPillProps {
  children: ReactNode;
  state?: 'done' | 'running' | 'error' | 'idle';
}

export function HToolPill({ children, state = 'done' }: ToolPillProps) {
  const dotColor = {
    done: 'bg-hearth-ok',
    running: 'bg-hearth-accent',
    error: 'bg-hearth-err',
    idle: 'bg-hearth-text-faint',
  }[state];

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill bg-hearth-chip border border-hearth-border px-2.5 py-1 text-xs font-medium text-hearth-text-muted font-sans">
      <span
        className={`h-1.5 w-1.5 rounded-full ${dotColor}`}
        style={state === 'running' ? { animation: 'hpulse 1.2s var(--hearth-ease) infinite' } : undefined}
      />
      {children}
    </span>
  );
}

// ---- Card ------------------------------------------------------------------

interface CardProps {
  children: ReactNode;
  variant?: 'default' | 'alt' | 'hero' | 'ghost';
  padding?: string;
  className?: string;
  onClick?: () => void;
}

export function HCard({ children, variant = 'default', padding = 'p-4', className = '', onClick }: CardProps) {
  const variants = {
    default: 'bg-hearth-card border border-hearth-border',
    alt: 'bg-hearth-card-alt border border-hearth-border',
    hero: 'border',
    ghost: 'bg-transparent border border-dashed border-hearth-border-strong',
  };
  const heroStyle = variant === 'hero'
    ? { background: 'linear-gradient(135deg, var(--hearth-accent-soft), var(--hearth-accent-soft-2))', borderColor: 'color-mix(in srgb, var(--hearth-accent) 40%, transparent)' }
    : undefined;

  return (
    <div
      onClick={onClick}
      className={`rounded-lg ${variants[variant]} ${padding} ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={heroStyle}
    >
      {children}
    </div>
  );
}

// ---- Eyebrow label ---------------------------------------------------------

export function HEyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`hearth-eyebrow ${className}`}>{children}</div>
  );
}

// ---- Badge -----------------------------------------------------------------

interface BadgeProps {
  children: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn' | 'err' | 'info' | 'accent';
}

export function HBadge({ children, tone = 'neutral' }: BadgeProps) {
  const tones = {
    neutral: 'bg-hearth-chip text-hearth-text-muted',
    ok: 'text-hearth-ok',
    warn: 'text-hearth-warn',
    err: 'text-hearth-err',
    info: 'text-hearth-info',
    accent: 'text-hearth-accent',
  };
  const bgTones: Record<string, React.CSSProperties | undefined> = {
    ok: { background: 'color-mix(in srgb, var(--hearth-ok) 14%, transparent)' },
    warn: { background: 'color-mix(in srgb, var(--hearth-warn) 14%, transparent)' },
    err: { background: 'color-mix(in srgb, var(--hearth-err) 14%, transparent)' },
    info: { background: 'color-mix(in srgb, var(--hearth-info) 14%, transparent)' },
    accent: { background: 'var(--hearth-accent-soft)' },
  };

  return (
    <span
      className={`inline-block whitespace-nowrap rounded-pill px-2 py-[2px] text-[11px] font-semibold uppercase tracking-wide font-sans ${tones[tone]}`}
      style={bgTones[tone]}
    >
      {children}
    </span>
  );
}

// ---- Kbd -------------------------------------------------------------------

export function HKbd({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-xs bg-hearth-chip border border-hearth-border px-1.5 py-0.5 text-[11px] font-medium font-mono text-hearth-text-muted">
      {children}
    </span>
  );
}

// ---- Avatar ----------------------------------------------------------------

interface AvatarProps {
  kind?: 'user' | 'agent';
  size?: number;
  initials?: string;
  glyph?: string;
}

export function HAvatar({ kind = 'user', size = 28, initials, glyph = 'H' }: AvatarProps) {
  if (kind === 'agent') {
    return (
      <div
        className="grid place-items-center text-white font-display font-semibold flex-shrink-0"
        style={{
          width: size, height: size,
          borderRadius: 'var(--hearth-radius-sm)',
          background: 'var(--hearth-accent-grad)',
          fontSize: size * 0.48,
          letterSpacing: -0.3,
        }}
      >
        {glyph}
      </div>
    );
  }
  return (
    <div
      className="grid place-items-center text-white font-sans font-semibold rounded-full flex-shrink-0"
      style={{
        width: size, height: size,
        background: 'var(--hearth-accent-2)',
        fontSize: size * 0.4,
      }}
    >
      {initials}
    </div>
  );
}

// ---- Input -----------------------------------------------------------------

interface InputProps {
  label?: string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  icon?: string;
  suffix?: string;
  type?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  className?: string;
}

export function HInput({ label, placeholder, value, defaultValue, icon, suffix, type = 'text', onChange, onKeyDown, autoFocus, className = '' }: InputProps) {
  const [focus, setFocus] = useState(false);
  return (
    <label className={`flex flex-col gap-1.5 font-sans ${className}`}>
      {label && <span className="text-[12.5px] text-hearth-text-muted font-medium">{label}</span>}
      <div
        className={`flex items-center gap-2 rounded-md px-3 py-[9px] transition-all duration-fast ease-hearth ${
          focus ? 'border-hearth-accent shadow-hearth-focus' : 'border-hearth-border-strong'
        } bg-hearth-card border`}
      >
        {icon && <HIcon name={icon} size={14} color="var(--hearth-text-faint)" />}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          autoFocus={autoFocus}
          className="flex-1 border-none outline-none bg-transparent text-hearth-text text-[13.5px] font-sans placeholder:text-hearth-text-faint"
        />
        {suffix && <span className="text-xs text-hearth-text-faint font-mono">{suffix}</span>}
      </div>
    </label>
  );
}

// ---- RailItem (sidebar nav button) -----------------------------------------

interface RailItemProps {
  icon: string;
  label: string;
  active?: boolean;
  badge?: string;
  dot?: boolean;
  onClick?: () => void;
}

export function HRailItem({ icon, label, active, badge, dot, onClick }: RailItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`relative flex w-14 flex-col items-center gap-[3px] rounded-md px-0 py-2 transition-all duration-fast ease-hearth ${
        active
          ? 'bg-hearth-card text-hearth-text shadow-[0_0_0_1px_var(--hearth-border)]'
          : 'text-hearth-text-muted hover:bg-hearth-card/50'
      }`}
    >
      <HIcon name={icon} size={17} color={active ? 'var(--hearth-text)' : 'var(--hearth-text-muted)'} />
      <div className={`text-[10px] tracking-[0.2px] ${active ? 'font-semibold' : 'font-medium'}`}>{label}</div>
      {badge && (
        <div className="absolute top-1 right-1.5 min-w-[15px] rounded-pill px-[5px] py-[1px] text-center text-[9.5px] font-bold text-white" style={{ background: 'var(--hearth-accent)' }}>
          {badge}
        </div>
      )}
      {dot && (
        <div className="absolute top-2 right-3.5 h-1.5 w-1.5 rounded-full" style={{ background: 'var(--hearth-accent)' }} />
      )}
    </button>
  );
}
