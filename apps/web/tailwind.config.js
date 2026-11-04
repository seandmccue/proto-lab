/** @type {import('tailwindcss').Config} */
const channel = (name) => `rgb(var(--${name}-rgb) / <alpha-value>)`;

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
        // semantic theme colors, resolved from the CSS variables in src/index.css so they follow data-theme
        ink: channel('ink'),
        ink2: channel('ink-2'),
        muted: channel('muted'),
        dim: channel('dim'),
        line: channel('line'),
        line2: channel('line-strong'),
        surface: channel('panel'),
        surface2: channel('panel-2'),
        surface3: channel('panel-3'),
        viewport: channel('viewport'),
        accent: { DEFAULT: channel('accent'), soft: 'var(--accent-soft)', dark: 'var(--accent-hi)', hi: 'var(--accent-hi)' },
        pass: channel('pass'),
        fail: channel('fail'),
        warn: channel('warn'),
        titanium: '#9aa3ad',
        blueprint: '#4a90e2',
      },
    },
  },
  plugins: [],
};
