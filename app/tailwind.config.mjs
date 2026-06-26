import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,tsx,ts}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      // Hermes Agent brand gold (from the app icon's gradient): light → core → deep.
      colors: {
        hermes: {
          300: '#FFF27A',
          400: '#FFD229',
          500: '#F4A900',
        },
      },
    },
  },
  plugins: [typography],
};
