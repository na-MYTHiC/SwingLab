import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * Build stamp.
 *
 * The version has to be injected rather than typed into the UI, because a
 * hand-maintained version string is one someone forgets to bump — and the
 * whole point of showing it is being able to trust that what you are looking
 * at is the build you just deployed.
 */
function commitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'local';
  }
}

export default defineConfig({
  plugins: [react()],
  // Relative base so the same build works on GitHub Pages under a repo
  // subpath and inside the Tauri desktop shell, which loads from a file URL.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __COMMIT__: JSON.stringify(commitSha()),
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
