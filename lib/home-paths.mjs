import { homedir, platform } from 'node:os';
import path from 'node:path';

export const MODEL_CATALOG_PARTS = ['data', 'user', 'settings', 'model_catalog.json'];

export function catalogOf(home) {
  return path.join(home, ...MODEL_CATALOG_PARTS);
}

// Open DeepTutor's desktop shell owns these locations. The application install
// directory is deliberately not consulted: portable and per-user installs all
// keep their writable workspace here.
export function desktopWorkspace(platformName = platform(), env = process.env, home = homedir()) {
  if (platformName === 'win32') {
    return env.LOCALAPPDATA
      ? path.join(env.LOCALAPPDATA, 'Open DeepTutor', 'workspace')
      : null;
  }
  if (platformName === 'darwin') {
    return home
      ? path.join(home, 'Library', 'Application Support', 'Open DeepTutor', 'workspace')
      : null;
  }
  return null;
}
