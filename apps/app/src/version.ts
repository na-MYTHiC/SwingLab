/**
 * Build identity, injected by Vite at build time.
 *
 * Shown in the header so you can confirm at a glance that the tab you are
 * looking at is the build you just deployed — a stale service-worker cache
 * is otherwise invisible and extremely confusing to debug.
 */
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
declare const __COMMIT__: string;

export const VERSION = __APP_VERSION__;
export const COMMIT = __COMMIT__;
export const BUILD_TIME = __BUILD_TIME__;

export function buildStamp(): string {
  const built = new Date(BUILD_TIME);
  const date = Number.isNaN(built.getTime())
    ? 'unknown'
    : built.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
  return `v${VERSION} · ${COMMIT} · built ${date}`;
}
