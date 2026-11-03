/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        accent: { DEFAULT: '#1d6ff2', soft: '#e8f0fe', dark: '#1554bd' },
        warn: '#f28c1d',
        titanium: '#9aa3ad',
        blueprint: '#4a90e2',
      },
    },
  },
  plugins: [],
};
