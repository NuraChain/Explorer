import { afterEach } from 'vitest';

import { releaseTestStores } from './database.ts';

// Runs after every test in every file: whatever indexes and followers the test opened are closed
// here rather than by each spec remembering to.
afterEach(releaseTestStores);
