import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hearth: {
          bg: 'var(--hearth-bg)',
          rail: 'var(--hearth-rail)',
          card: 'var(--hearth-card)',
          'card-alt': 'var(--hearth-card-alt)',
          chip: 'var(--hearth-chip)',
          border: 'var(--hearth-border)',
          'border-strong': 'var(--hearth-border-strong)',
          text: 'var(--hearth-text)',
          'text-muted': 'var(--hearth-text-muted)',
          'text-faint': 'var(--hearth-text-faint)',
          'text-inverse': 'var(--hearth-text-inverse)',
          accent: 'var(--hearth-accent)',
          'accent-2': 'var(--hearth-accent-2)',
          'accent-soft': 'var(--hearth-accent-soft)',
          ok: 'var(--hearth-ok)',
          warn: 'var(--hearth-warn)',
          err: 'var(--hearth-err)',
          info: 'var(--hearth-info)',
        },
      },
      fontFamily: {
        display: 'var(--hearth-font-display)',
        sans: 'var(--hearth-font-sans)',
        mono: 'var(--hearth-font-mono)',
      },
      borderRadius: {
        xs: 'var(--hearth-radius-xs)',
        sm: 'var(--hearth-radius-sm)',
        md: 'var(--hearth-radius-md)',
        lg: 'var(--hearth-radius-lg)',
        xl: 'var(--hearth-radius-xl)',
        pill: 'var(--hearth-radius-pill)',
      },
      boxShadow: {
        'hearth-1': 'var(--hearth-shadow-1)',
        'hearth-2': 'var(--hearth-shadow-2)',
        'hearth-3': 'var(--hearth-shadow-3)',
        'hearth-4': 'var(--hearth-shadow-4)',
        'hearth-focus': 'var(--hearth-ring-focus)',
      },
      spacing: {
        'h-1': 'var(--hearth-space-1)',
        'h-2': 'var(--hearth-space-2)',
        'h-3': 'var(--hearth-space-3)',
        'h-4': 'var(--hearth-space-4)',
        'h-5': 'var(--hearth-space-5)',
        'h-6': 'var(--hearth-space-6)',
        'h-8': 'var(--hearth-space-8)',
        'h-10': 'var(--hearth-space-10)',
        'h-12': 'var(--hearth-space-12)',
        'h-16': 'var(--hearth-space-16)',
      },
      transitionDuration: {
        instant: 'var(--hearth-dur-instant)',
        fast: 'var(--hearth-dur-fast)',
        base: 'var(--hearth-dur-base)',
        slow: 'var(--hearth-dur-slow)',
      },
      transitionTimingFunction: {
        hearth: 'var(--hearth-ease)',
        'hearth-out': 'var(--hearth-ease-out)',
        'hearth-in': 'var(--hearth-ease-in)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};

export default config;
