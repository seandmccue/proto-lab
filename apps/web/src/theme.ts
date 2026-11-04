import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'protolab-theme';
const listeners = new Set<() => void>();

export const DEFAULT_THEME: Theme = 'light';

function read(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  for (const l of listeners) l();
}

export function useTheme(): Theme {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, read, () => DEFAULT_THEME);
}
