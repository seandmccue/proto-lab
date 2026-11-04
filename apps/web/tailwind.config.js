/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { md: '6px', lg: '8px', xl: '10px', '2xl': '12px' },
      colors: {
        // semantic theme colors (see src/index.css :root)
        ink: '#e8edf3',
        ink2: '#c3cbd6',
        muted: '#8b96a6',
        dim: '#5f6b7b',
        line: '#232a34',
        line2: '#323b48',
        surface: '#12161c',
        surface2: '#181d25',
        surface3: '#1f252f',
        viewport: '#0d1016',
        accent: { DEFAULT: '#2f7cff', soft: '#15283f', dark: '#5c97ff', hi: '#5c97ff' },
        pass: '#34d399',
        fail: '#fb7185',
        warn: '#f5a524',
        titanium: '#9aa3ad',
        blueprint: '#4a90e2',
      },
    },
  },
  plugins: [],
};
