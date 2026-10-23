import { sweepTestSchemas } from './database.ts';

// Once per run, before any worker starts and after the last one ends: clears out the schemas a run
// that died mid-way left behind. One suite run per test database at a time - a second run started
// alongside would have its live schemas swept from under it.
export default async function setup(): Promise<() => Promise<void>>
{
    const url = process.env.TEST_DATABASE_URL;
    if (url === undefined || url === '')
    {
        // Every test that needs the database says so itself, with the reason.
        return async () => undefined;
    }
    await sweepTestSchemas(url);
    return () => sweepTestSchemas(url);
}
