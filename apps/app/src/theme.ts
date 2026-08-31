/**
 * Theme handling.
 *
 * Dark is the default and the design's native state: simulator bays are dim
 * rooms and this gets read on a phone standing next to a hitting mat. Light
 * is available for anyone who wants it, and the choice persists.
 */

export type Theme = 'dark' | 'light';

const KEY = 'swinglab.theme';

export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Private browsing or blocked storage — dark is still the right default.
  }
  return 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Not being able to remember the choice is not a reason to ignore it now.
  }
}
