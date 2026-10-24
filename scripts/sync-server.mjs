// Copies the world-readable server files into public/server/
// so the viewer can download them as a zip. Only the explicit allowlist below
// is copied — tokens.json, .env, node_modules never leave server/.
// Run automatically by the build script.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'server');
const dest = join(root, 'public', 'server');

const FILES = [
  'package.json',
  'server.js',
  'Dockerfile',
  'fly.toml',
  'env.example',
  'tokens.example.json',
  'README.md',
  'api.http',
  'lib/broker.js',
  'lib/guard.js',
];

for (const file of FILES) {
  mkdirSync(join(dest, dirname(file)), { recursive: true });
  copyFileSync(join(src, file), join(dest, file));
}

console.log(`[sync-server] copied ${FILES.length} files to public/server/`);
