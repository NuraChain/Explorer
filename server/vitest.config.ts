import { defineConfig } from 'vitest/config';

// The server's test configuration. The suite needs no environment beyond node - every spec runs
// against an in-memory sqlite index and a stubbed chain gateway, so there is no server to start,
// no port to bind and no network to reach.
export default defineConfig({
    test:
    {
        environment: 'node',
        // Fixtures live under tests/support and are not themselves tests.
        include: ['tests/**/*.spec.ts'],
        coverage:
        {
            provider: 'v8',
            // `all` so a file with NO tests still appears at 0% rather than being invisible -
            // an untested module missing from the report is the one worth knowing about.
            all: true,
            include: ['src/**/*.ts'],
            exclude: [
                // The composition root: it binds a port, opens a real database and starts the
                // follower. Covering it would mean starting the server, which the rest of the
                // suite exists to avoid - its parts are tested individually instead.
                'src/main.ts'
            ],
            reporter: ['text', 'text-summary', 'html', 'lcov'],
            reportsDirectory: 'coverage'
        }
    }
});
