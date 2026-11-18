export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemeAccent = 'cyan' | 'forest' | 'purple' | 'blue' | 'teal' | 'orange' | 'rose';
export interface ThemeSettings { mode: ThemeMode; accent: ThemeAccent }
const key = 'firefly-assist-appearance';
const defaults: ThemeSettings = { mode: 'system', accent: 'cyan' };
const modes: ThemeMode[] = ['system', 'light', 'dark'];
const accents: ThemeAccent[] = ['cyan', 'forest', 'purple', 'blue', 'teal', 'orange', 'rose'];
const media = window.matchMedia('(prefers-color-scheme: dark)');
function read(): ThemeSettings {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return { mode: modes.includes(v.mode) ? v.mode : defaults.mode, accent: accents.includes(v.accent) ? v.accent : defaults.accent };
  } catch { return { ...defaults }; }
}
let current = read();
export function getThemeSettings(): ThemeSettings { return { ...current }; }
export function applyTheme(): void {
  const dark = current.mode === 'dark' || (current.mode === 'system' && media.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.accent = current.accent;
  root.style.colorScheme = dark ? 'dark' : 'light';
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0c171c' : '#f3fbfd';
}
export function updateTheme(settings: Partial<ThemeSettings>): void {
  current = { ...current, ...settings };
  applyTheme();
  try { localStorage.setItem(key, JSON.stringify(current)); } catch { /* private mode */ }
}
media.addEventListener('change', () => { if (current.mode === 'system') applyTheme(); });
applyTheme();
