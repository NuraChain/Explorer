import { afterAll, afterEach } from 'vitest';

import { closeTestDatabase, releaseTestStores } from './database.ts';

// Runs around every test in every file: whatever indexes and followers a test opened are closed
// here rather than by each spec remembering to, and the worker lets go of the database at the end.
afterEach(releaseTestStores);
afterAll(closeTestDatabase);
