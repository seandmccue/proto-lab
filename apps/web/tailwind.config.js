/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        accent: { DEFAULT: '#5030ce', soft: '#ede5ff', dark: '#3c219f' },
        warn: '#f28c1d',
        titanium: '#9aa3ad',
        blueprint: '#4a90e2',
      },
    },
  },
  plugins: [],
};
