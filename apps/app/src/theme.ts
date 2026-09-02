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
    // Private browsing or blocked storage. Fall through to the system.
  }
  /*
   * Follow the device on a first visit rather than insisting on dark.
   *
   * A choice the player has made is honoured above everything, which is why
   * the stored value is read first. But somebody who has never opened this
   * before has still expressed a preference — in their phone settings — and
   * handing them a dark app on a device set to light is the app telling them
   * their preference does not count.
   */
  try {
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  } catch {
    // No matchMedia (very old browsers, some embedded webviews).
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
