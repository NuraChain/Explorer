// The two lists of languages, pinned equal.
//
// One lives in the browser (`stores/locale.store.ts`), because that half owns the dictionaries
// and the switcher; the other lives on the server (`app.ts`), because that half is what
// negotiates a request and stamps `<html lang>` before a byte leaves. Nothing else holds them
// together, and the failure when they drift is silent in both directions: a language the server
// negotiates but the browser has no dictionary for renders in English under a Persian label,
// and a language the browser offers but the server never negotiates is a switch that writes a
// cookie nobody reads.
//
// Adding a language is one row in each list plus one file under src/locales/.
import { describe, it, expect } from 'vitest';

import { LOCALES } from '../src/stores/locale.store.ts';
import { LOCALES as SERVER_LOCALES } from '../../server/src/app.ts';

describe('the languages both halves speak', () =>
{
    it('are the same ten, in the same order', () =>
    {
        expect([...SERVER_LOCALES.supported]).toEqual([...LOCALES]);
    });

    it('negotiate to the language the dictionary treats as the reference', () =>
    {
        // `en.ts` is the dictionary every other one is typed against, so it is the only fallback
        // that cannot be missing a key.
        expect(SERVER_LOCALES.default).toBe('en');
        expect(LOCALES[0]).toBe('en');
    });
});
