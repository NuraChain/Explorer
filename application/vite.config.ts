import { azeroth } from '@azerothjs/compiler';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [azeroth(), tailwindcss()],
    // The SSR bundle (src/entry.server.ts) inlines its dependencies, so dist-server
    // is ONE self-contained file - production imports it with no client node_modules.
    ssr:
    {
        noExternal: true
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
