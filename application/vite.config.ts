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

    build:
    {
        /*
         * The client bundle is about 970 kB raw and 210 kB over the wire, and vite warns above
         * 500. The number is measured rather than shrugged at: HALF of it is the ten locale
         * catalogues, which are ~500 kB of source between them and are all imported statically
         * because `createMessages` needs every one of them in hand, synchronously, before the
         * first render can hydrate.
         *
         * So the warning has nothing left to tell us, and a build that prints one every time is a
         * build nobody reads. A megabyte is the ratchet instead: it passes today and the next
         * thing that does not fit has to justify itself.
         *
         * The real reduction, when it is worth doing, is loading the nine catalogues a reader is
         * not using on demand - the active language is known from `<html lang>` before the bundle
         * runs, so it can be awaited in `main.azeroth` ahead of `bootClient`. That is a change to
         * the hydration path in ten languages, which is its own piece of work and not this one.
         */
        chunkSizeWarningLimit: 1024
    },

    test:
    {
        environment: 'happy-dom'
    }
});
