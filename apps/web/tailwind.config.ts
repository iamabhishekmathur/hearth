import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hearth: {
          50: '#fef7ee',
          100: '#fdedd3',
          200: '#fad7a5',
          300: '#f6ba6d',
          400: '#f19332',
          500: '#ee7a12',
          600: '#df6008',
          700: '#b9480a',
          800: '#93390f',
          900: '#773110',
          950: '#401606',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};

export default config;
