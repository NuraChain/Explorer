// The deployed version, inlined from package.json at build time. Vite folds the JSON import
// into a compile-time constant, so the footer shows the version that was actually built rather
// than reading the filesystem at runtime (which would be empty in a browser).
import { version } from '../package.json';

export const APP_VERSION = version;
