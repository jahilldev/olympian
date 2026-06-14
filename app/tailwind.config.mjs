/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,tsx,ts}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
