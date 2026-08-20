// @vitest-environment happy-dom
//
// The dictionary and everything that reads it. Ten languages, and the typechecker only guarantees
// that the KEYS line up - it cannot notice a Persian entry left in English, a placeholder that
// was dropped in translation, or a direction that disagrees with the script.
//
// Those are the failures this file is for: they render perfectly, and they are wrong.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { LOCALES, LOCALE_DIR, LOCALE_LABEL, LOCALE_TAG, useLocale, type Locale } from '../src/stores/locale.store.ts';
import { en, type Dictionary, type MessageKey } from '../src/locales/en.ts';
import { fa } from '../src/locales/fa.ts';
import { ar } from '../src/locales/ar.ts';
import { es } from '../src/locales/es.ts';
import { pt } from '../src/locales/pt.ts';
import { hi } from '../src/locales/hi.ts';
import { zh } from '../src/locales/zh.ts';
import { ru } from '../src/locales/ru.ts';
import { fr } from '../src/locales/fr.ts';
import { tr } from '../src/locales/tr.ts';

const CATALOG: Record<Locale, Dictionary> = { en, fa, ar, es, pt, hi, zh, ru, fr, tr };
const KEYS = Object.keys(en) as MessageKey[];

// Every spy this file installs is undone here, whatever the test did with it.
afterEach(() =>
{
    vi.restoreAllMocks();
});

describe('the catalog', () =>
{
    it('has a dictionary for every locale the switcher offers', () =>
    {
        expect(Object.keys(CATALOG).sort()).toEqual([...LOCALES].sort());
        expect(LOCALES).toHaveLength(10);
    });

    it.each(LOCALES)('%s defines exactly the keys English does - no more, no fewer', (locale) =>
    {
        // A missing key renders `undefined` in the UI; an extra one is a string nobody will ever
        // see and a translator's wasted effort.
        expect(Object.keys(CATALOG[locale]).sort()).toEqual([...KEYS].sort());
    });

    /**
     * The keys that are word-order SLOTS rather than sentences.
     *
     * `brand.lead` / `accent` / `trail` build one name around a highlighted word, and which slots
     * a language uses depends on where that word falls in it: English is "Nura *Explorer*" with
     * an empty trail, Persian is "*کاوشگر* نورا" with an empty lead. The headline works the same
     * way around the chain's name, and `home.hero.through` is the connective before it - Turkish
     * is verb-final ("Işığı zincir boyunca takip edin") and needs none at all. Blank is the
     * correct value for a slot a language does not use, so these are exempt from the blank check
     * below and get their own assertion instead.
     */
    const SLOTS: MessageKey[] = [
        'brand.lead', 'brand.trail',
        'home.hero.lead', 'home.hero.trail', 'home.hero.through'
    ];

    it.each(LOCALES)('%s leaves no entry blank', (locale) =>
    {
        const blank = KEYS
            .filter((key) => !SLOTS.includes(key))
            .filter((key) => String(CATALOG[locale][key]).trim() === '');
        expect(blank).toEqual([]);
    });

    it.each(LOCALES)('%s still spells out a whole brand and a whole headline', (locale) =>
    {
        // Whichever slots a language uses, the highlighted word is never the empty one and the
        // name never collapses to nothing.
        const dictionary = CATALOG[locale];
        expect(String(dictionary['brand.accent']).trim().length, `${ locale } brand.accent`).toBeGreaterThan(0);
        expect(
            `${ dictionary['brand.lead'] }${ dictionary['brand.trail'] }`.trim().length,
            `${ locale } has neither a brand lead nor a trail`
        ).toBeGreaterThan(0);

        expect(String(dictionary['home.hero.accent']).trim().length, `${ locale } hero accent`).toBeGreaterThan(0);
        expect(
            `${ dictionary['home.hero.lead'] }${ dictionary['home.hero.trail'] }`.trim().length,
            `${ locale } has neither a hero lead nor a trail`
        ).toBeGreaterThan(0);
    });

    it.each(LOCALES)('%s keeps every placeholder its English original declares', (locale) =>
    {
        // `{count}` dropped in translation prints nothing where a number belongs; `{cuont}`
        // prints the brace literally. Both survive a typecheck.
        const placeholders = (text: string): string[] => (text.match(/\{(\w+)\}/g) ?? []).sort();

        const wrong: string[] = [];
        for (const key of KEYS)
        {
            const expected = placeholders(String(en[key]));
            const actual = placeholders(String(CATALOG[locale][key]));
            if (JSON.stringify(expected) !== JSON.stringify(actual))
            {
                wrong.push(`${ key }: expected ${ expected.join(',') || 'none' }, got ${ actual.join(',') || 'none' }`);
            }
        }
        expect(wrong).toEqual([]);
    });

    it('gives every locale a direction and a BCP-47 tag', () =>
    {
        for (const locale of LOCALES)
        {
            expect(['ltr', 'rtl']).toContain(LOCALE_DIR[locale]);
            expect(LOCALE_TAG[locale]).toMatch(/^[a-z]{2}(-[A-Za-z]+)*$/);
            expect(LOCALE_LABEL[locale].trim().length).toBeGreaterThan(0);
        }
    });

    it('marks exactly the right-to-left scripts as rtl', () =>
    {
        const rtl = LOCALES.filter((locale) => LOCALE_DIR[locale] === 'rtl');
        expect(rtl.sort()).toEqual(['ar', 'fa']);
    });

    it('names each language in its OWN language, not in English', () =>
    {
        // The switcher exists to be usable by somebody who cannot read the current language.
        expect(LOCALE_LABEL.fa).toBe('فارسی');
        expect(LOCALE_LABEL.ar).toBe('العربية');
        expect(LOCALE_LABEL.zh).toBe('中文');
        expect(LOCALE_LABEL.ru).toBe('Русский');
        expect(LOCALE_LABEL.hi).toBe('हिन्दी');
    });

    it('actually translates - a non-English dictionary is not a copy of the English one', () =>
    {
        // Identifiers legitimately stay put (chain names, EIP numbers), so this asserts that the
        // overwhelming majority differs rather than that every entry does.
        for (const locale of LOCALES.filter((entry) => entry !== 'en'))
        {
            const same = KEYS.filter((key) => CATALOG[locale][key] === en[key]);
            expect(same.length / KEYS.length, `${ locale } is ${ Math.round(100 * same.length / KEYS.length) }% English`)
                .toBeLessThan(0.25);
        }
    });

    it.each(LOCALES.filter((locale) => LOCALE_DIR[locale] === 'rtl'))(
        '%s is written in its own script rather than transliterated', (locale) =>
        {
            const arabicScript = /[؀-ۿ]/;
            const written = KEYS.filter((key) => arabicScript.test(String(CATALOG[locale][key])));
            expect(written.length / KEYS.length).toBeGreaterThan(0.7);
        });

    it('keeps the plural partner of every "time" key that takes a count', () =>
    {
        // `ago()` picks `time.hour` or `time.hours` by count without asking the caller. A missing
        // plural key renders undefined for every value except one. Four units and no more:
        // `elapsed` rolls everything past a month up into days rather than inventing a "months"
        // wording that would have to be pluralised in ten languages.
        for (const unit of ['second', 'minute', 'hour', 'day'])
        {
            for (const locale of LOCALES)
            {
                expect(CATALOG[locale], `${ locale } time.${ unit }`).toHaveProperty(`time.${ unit }`);
                expect(CATALOG[locale], `${ locale } time.${ unit }s`).toHaveProperty(`time.${ unit }s`);
            }
        }
    });
});

describe('the locale store', () =>
{
    let locale: ReturnType<typeof useLocale>;

    beforeEach(() =>
    {
        localStorage.clear();
        locale = useLocale();
        locale.setLocale('en');
    });

    it('translates a key', () =>
    {
        expect(locale.t('nav.blocks')).toBe(en['nav.blocks']);
    });

    it('fills a placeholder from the variables given', () =>
    {
        const filled = locale.t('pagination.page', { number: '7' });
        expect(filled).toContain('7');
        expect(filled).not.toContain('{number}');
    });

    it('leaves an unknown placeholder ALONE rather than printing a blank', () =>
    {
        // A blank where a value belongs is a sentence that reads as finished and is not.
        expect(locale.t('pagination.page', {})).toContain('{number}');
    });

    it('switches language, direction and the document attributes together', () =>
    {
        locale.setLocale('fa');
        expect(locale.locale()).toBe('fa');
        expect(locale.dir()).toBe('rtl');
        expect(document.documentElement.lang).toBe('fa');
        expect(document.documentElement.dir).toBe('rtl');

        locale.setLocale('en');
        expect(locale.dir()).toBe('ltr');
        expect(document.documentElement.dir).toBe('ltr');
    });

    it('persists the choice, so a reload keeps the reader\'s language', () =>
    {
        locale.setLocale('tr');
        expect(localStorage.getItem('nura.locale')).toBe('tr');
    });

    it('prints counts in the reader\'s own digits', () =>
    {
        locale.setLocale('en');
        expect(locale.n(1234)).toBe('1,234');
        locale.setLocale('fa');
        // Persian digits, not Latin ones with a Persian separator.
        expect(locale.n(1234)).toMatch(/[۰-۹]/);
    });

    it('gives Persian the Jalali calendar rather than a transliterated Gregorian one', () =>
    {
        locale.setLocale('fa');
        const written = locale.dateTime('2024-03-20T12:00:00.000Z');
        // 2024 in Gregorian is 1402/1403 in Jalali; the year must NOT read 2024.
        expect(written).not.toContain('2024');
    });

    it('picks the singular or plural wording by count', () =>
    {
        locale.setLocale('en');
        const now = Date.parse('2024-01-01T12:00:00.000Z');
        const oneHour = locale.ago('2024-01-01T11:00:00.000Z', now);
        const threeHours = locale.ago('2024-01-01T09:00:00.000Z', now);
        expect(oneHour).not.toBe(threeHours);
        expect(threeHours).toContain('3');
    });

    it('says "just now" instead of "0 seconds ago"', () =>
    {
        locale.setLocale('en');
        const now = Date.parse('2024-01-01T12:00:00.000Z');
        expect(locale.ago('2024-01-01T12:00:00.000Z', now)).toBe(en['time.justNow']);
    });

    it('never reports the future as elapsed', () =>
    {
        locale.setLocale('en');
        const now = Date.parse('2024-01-01T12:00:00.000Z');
        expect(locale.ago('2025-01-01T12:00:00.000Z', now)).toBe(en['time.justNow']);
    });

    it('spells a byte size in the reader\'s language', () =>
    {
        locale.setLocale('en');
        expect(locale.bytes(512)).toContain('512');
        // Above a kilobyte it scales and keeps one decimal.
        expect(locale.bytes(2048)).toMatch(/2\.0/);

        locale.setLocale('fa');
        expect(locale.bytes(512)).toMatch(/[۰-۹]/);
    });

    it('translates a chain name where it has one, and passes anything else through', () =>
    {
        locale.setLocale('fa');
        // An unknown name must come back UNCHANGED - never blank, and never guessed at.
        expect(locale.chainName('Some Unknown Chain')).toBe('Some Unknown Chain');
        expect(locale.chainName('')).toBe('');
    });

    it('is one shared store, so two callers see the same language', () =>
    {
        const other = useLocale();
        locale.setLocale('ru');
        expect(other.locale()).toBe('ru');
    });

    it('survives a blocked localStorage rather than failing to render', () =>
    {
        // Safari in private mode throws on setItem. A language switch is not worth a blank page.
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
            expect(() => locale.setLocale('es')).not.toThrow();
            expect(locale.locale()).toBe('es');
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
