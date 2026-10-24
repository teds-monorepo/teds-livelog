
import { SERVER_DIR, SERVER_FILES, SERVER_FOLDER } from '../lib/livelog.js';
import { createZip, downloadBlob } from '../lib/zip.js';

/**
 * Fetches the realtime server's files from `public/server/` and hands
 * the browser a zip, so anyone can run the server themselves.
 *
 * Only `SERVER_FILES` is included — an explicit allowlist, never a directory
 * listing — so a real `tokens.json` and an installed `node_modules` stay out of
 * the download. Throws with a readable message on any HTTP failure.
 */
export async function downloadServerZip() {
  const entries = await Promise.all(
    SERVER_FILES.map(async (name) => {
      const response = await fetch(`${SERVER_DIR}/${name}`);
      if (!response.ok) throw new Error(`${name} — HTTP ${response.status}`);
      return { name: `${SERVER_FOLDER}/${name}`, data: await response.text() };
    })
  );

  const filename = `${SERVER_FOLDER}.zip`;
  downloadBlob(await createZip(entries), filename);
  return filename;
}
