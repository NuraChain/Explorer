// @vitest-environment happy-dom
//
// The browser-side stores that hold UI state: the scroll lock behind an overlay, the theme, and
// the toast channel. The wallet store has its own file - it is a singleton built from an ambient
// browser global, and it needs an environment nothing else is touching.
//
// All three are singletons shared by every case here, so each one sets the state it is about to
// assert rather than inheriting whatever ran before it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { lockBodyScroll, unlockBodyScroll } from '../src/lib/body-lock.ts';
import { useTheme } from '../src/stores/theme.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';

// Every spy this file installs is undone here, whatever the test did with it.
afterEach(() =>
{
    vi.restoreAllMocks();
});

describe('body-lock', () =>
{
    beforeEach(() =>
    {
        document.body.style.overflow = '';
    });

    it('locks the page and unlocks it again', () =>
    {
        lockBodyScroll();
        expect(document.body.style.overflow).toBe('hidden');
        unlockBodyScroll();
        expect(document.body.style.overflow).toBe('');
    });

    it('stays locked while an overlay is still open beneath another', () =>
    {
        // The language dialog opens ON TOP of the drawer. Closing it must not unlock a page the
        // drawer is still covering.
        lockBodyScroll();
        lockBodyScroll();
        unlockBodyScroll();
        expect(document.body.style.overflow).toBe('hidden');
        unlockBodyScroll();
        expect(document.body.style.overflow).toBe('');
    });

    it('never goes negative, so an extra unlock cannot leave the next lock broken', () =>
    {
        unlockBodyScroll();
        unlockBodyScroll();
        lockBodyScroll();
        expect(document.body.style.overflow).toBe('hidden');
        unlockBodyScroll();
        expect(document.body.style.overflow).toBe('');
    });
});

describe('the theme store', () =>
{
    beforeEach(() =>
    {
        localStorage.clear();
    });

    it('applies the theme to the root element, where the palette keys on it', () =>
    {
        const theme = useTheme();
        theme.setTheme('light');
        expect(document.documentElement.dataset.theme).toBe('light');
        theme.setTheme('dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('persists the choice, so a reload keeps it', async () =>
    {
        // The whole round trip - write, then read it back the way a reload does - rather than a
        // spy on setItem. Both halves happen inside this test with nothing in between, so it
        // cannot be perturbed by another case's storage or by whether a spy was restored yet.
        // It also asserts the thing a reader would actually notice.
        useTheme().setTheme('light');

        vi.resetModules();
        const reloaded = await import('../src/stores/theme.store.ts');
        expect(reloaded.useTheme().theme()).toBe('light');
    });

    it('survives a blocked localStorage rather than failing to render', () =>
    {
        // Safari in private mode throws on setItem. A theme switch is not worth a blank page.
        //
        // A SPY, not an assignment to Storage.prototype: vitest restores a spy even when the test
        // throws part-way, and it never leaves a mutated prototype behind for whichever file the
        // worker runs next. Patching it by hand is what made this suite flake under shuffling.
        const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() =>
        {
            throw new Error('QuotaExceededError');
        });

        try
        {
            expect(() => useTheme().setTheme('light')).not.toThrow();
            expect(useTheme().theme()).toBe('light');
        }
        finally
        {
            // Restored HERE rather than left to the shared afterEach. A throwing setItem that
            // outlives this test silently stops the next one from persisting anything, which is
            // a failure in a test that has nothing to do with storage being blocked.
            blocked.mockRestore();
        }
    });
});

describe('the toasts store', () =>
{
    beforeEach(() =>
    {
        vi.useFakeTimers();
        // The store is a singleton shared by every case in this file, and fake timers stop the
        // self-dismissal that would otherwise clear it - so each case starts from empty
        // explicitly rather than inheriting the previous one's stack.
        const toasts = useToasts();
        for (const entry of [...toasts.items()])
        {
            toasts.dismiss(entry.id);
        }
    });

    afterEach(() =>
    {
        vi.useRealTimers();
    });

    it('pushes a message and hands back its id', () =>
    {
        const toasts = useToasts();
        const id = toasts.push('success', 'copied', 'check');
        expect(toasts.items().some((entry) => entry.id === id && entry.message === 'copied')).toBe(true);
        toasts.dismiss(id);
    });

    it('keeps at most three, so a stack cannot cover the page it reports about', () =>
    {
        const toasts = useToasts();
        for (let at = 0; at < 8; at++)
        {
            toasts.push('info', `message ${ at }`);
        }
        expect(toasts.items()).toHaveLength(3);
        // The NEWEST three, not the oldest.
        expect(toasts.items().map((entry) => entry.message)).toEqual(['message 5', 'message 6', 'message 7']);
    });

    it('dismisses itself after its lifetime', () =>
    {
        const toasts = useToasts();
        const id = toasts.push('info', 'temporary');
        expect(toasts.items().some((entry) => entry.id === id)).toBe(true);

        vi.advanceTimersByTime(4000);
        expect(toasts.items().some((entry) => entry.id === id)).toBe(false);
    });

    it('dismisses one by id without touching the others', () =>
    {
        const toasts = useToasts();
        const first = toasts.push('info', 'first');
        const second = toasts.push('info', 'second');

        toasts.dismiss(first);
        expect(toasts.items().map((entry) => entry.id)).toEqual([second]);
        toasts.dismiss(second);
    });

    it('ignores a dismissal of something already gone', () =>
    {
        const toasts = useToasts();
        expect(() => toasts.dismiss(999_999)).not.toThrow();
    });

    it('gives every toast a distinct id', () =>
    {
        const toasts = useToasts();
        const ids = [toasts.push('info', 'a'), toasts.push('info', 'b'), toasts.push('info', 'c')];
        expect(new Set(ids).size).toBe(3);
    });
});
