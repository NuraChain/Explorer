import { azeroth } from '@azerothjs/compiler';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [azeroth(), tailwindcss()],
    // The SSR bundle (src/entry.server.ts) inlines its dependencies, so dist-server is ONE
    // self-contained file - production imports it with no client node_modules.
    //
    // The `azerothjs` runtime is deliberately NOT inlined. The server process must hold exactly
    // one instance of it: @azerothjs/http installs the per-request scope on the copy IT resolves,
    // and a render running against a second, inlined copy sees no ambient request at all - so a
    // route loader calling this app's own api cannot find the in-process bridge and fails with
    // "no ambient request carries an in-process api bridge". server/package.json already declares
    // the dependency, so the external import resolves in production as it does in dev.
    ssr:
    {
        noExternal: true,
        external: ['azerothjs']
    },
    // Nothing declares a dev server here, and nothing may: `azeroth dev` runs vite INSIDE the
    // server process through @azerothjs/kit, which owns the port and the HMR socket and refuses
    // a `server.proxy`, a `base` other than `/`, or a `server.ws` port at startup. One origin
    // serves the pages, the api and HMR. Plugins, `ssr`, `resolve`, `css` and the rest of this
    // file are read by that session as they are.

    test:
    {
        environment: 'happy-dom'
    }
});
