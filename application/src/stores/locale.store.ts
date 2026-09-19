import { createStore, localeDirection, setLocale as setDocumentLocale, useLocale as useDocumentLocale, type Getter } from 'azerothjs';

import { elapsed, formatChange, formatCompact, formatCount, formatDate, formatDateTime, scaleBytes, scaleDuration } from '../lib/format.ts';
import { en, type MessageKey } from '../locales/en.ts';
import { fa } from '../locales/fa.ts';
import { ar } from '../locales/ar.ts';
import { es } from '../locales/es.ts';
import { pt } from '../locales/pt.ts';
import { hi } from '../locales/hi.ts';
import { zh } from '../locales/zh.ts';
import { ru } from '../locales/ru.ts';
import { fr } from '../locales/fr.ts';
import { tr } from '../locales/tr.ts';
import type { Dictionary } from '../locales/en.ts';

// The reader's language, and everything that follows from it: the dictionary, the writing
// direction, and the digits numbers and dates are printed in.
//
// Formatting lives HERE rather than in the components because a locale change has to redraw a
// date without the page knowing it is a date - `t`, `n`, `dateTime` and `ago` all read the locale
// signal, so anything that calls one re-runs when the language changes.

export type Locale = 'en' | 'fa' | 'ar' | 'es' | 'pt' | 'hi' | 'zh' | 'ru' | 'fr' | 'tr';

export const LOCALES: Locale[] = ['en', 'fa', 'ar', 'es', 'pt', 'hi', 'zh', 'ru', 'fr', 'tr'];

/** Each language named in ITSELF - a reader looking for Persian is not looking for "Persian". */
export const LOCALE_LABEL: Record<Locale, string> = {
    en: 'English',
    fa: 'فارسی',
    ar: 'العربية',
    es: 'Español',
    pt: 'Português',
    hi: 'हिन्दी',
    zh: '中文',
    ru: 'Русский',
    fr: 'Français',
    tr: 'Türkçe'
};

/**
 * The direction a given language reads in.
 *
 * `Intl` decides, through the same function the framework uses to stamp `<html dir>`, so the
 * document and anything inside it can never disagree about a language - which a hand-kept table
 * beside the framework's own could, and would, the first time one of them gained a language.
 */
export const directionOf = (locale: Locale): 'ltr' | 'rtl' => localeDirection(locale);

/**
 * The BCP 47 tag handed to Intl. `fa-IR` gives Persian digits and the Jalali calendar; `ar-EG`
 * gives Eastern Arabic digits WITHOUT the Hijri calendar an `ar-SA` would spring on dates.
 */
export const LOCALE_TAG: Record<Locale, string> = {
    en: 'en-US',
    fa: 'fa-IR',
    ar: 'ar-EG',
    es: 'es-ES',
    pt: 'pt-BR',
    hi: 'hi-IN',
    zh: 'zh-CN',
    ru: 'ru-RU',
    fr: 'fr-FR',
    tr: 'tr-TR'
};

const CATALOG: Record<Locale, Dictionary> = { en, fa, ar, es, pt, hi, zh, ru, fr, tr };

/**
 * Chain names cannot live in the dictionary: they arrive from the deployment's own configuration,
 * and this explorer runs against NuraChain, a local Anvil, or any other EVM node.
 *
 * So this is a lookup with PASSTHROUGH rather than a translation table. A name we ship a reading
 * for is localized; every other name is printed exactly as configured, which is the only safe
 * answer for a chain nobody here has heard of. Display ONLY - the wallet, the API and the chain
 * keep the configured name, see AddChainButton.
 */
const CHAIN_NAMES: Record<Locale, Record<string, string>> = {
    en: {},
    fa: { 'Nura Chain': 'زنجیره نورا' },
    // Readings only where the SCRIPT demands one - a Latin name mid-sentence reads as a foreign
    // body in Arabic and Devanagari. The Latin and Cyrillic languages keep the configured name.
    ar: { 'Nura Chain': 'سلسلة نورا' },
    es: {},
    pt: {},
    hi: { 'Nura Chain': 'नूरा चेन' },
    zh: {},
    ru: {},
    fr: {},
    tr: {}
};

/** The key a reader's choice lived under before the server could read it. See {@link adoptStoredChoice}. */
const LEGACY_KEY = 'nura.locale';

function isLocale(value: string | null): value is Locale
{
    return value !== null && (LOCALES as string[]).includes(value);
}

/** Fills `{name}` placeholders. An unknown name is left alone rather than printed as blank. */
function interpolate(template: string, vars?: Record<string, string | number>): string
{
    if (vars === undefined)
    {
        return template;
    }
    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    {
        const value = vars[name];
        return value === undefined ? whole : String(value);
    });
}

export interface LocaleApi
{
    locale: Getter<Locale>;
    setLocale(next: Locale): void;

    /** 'ltr' or 'rtl' for the current language, for the rare component that must branch on it. */
    dir: Getter<'ltr' | 'rtl'>;

    /** A translated string, with `{name}` placeholders filled from `vars`. */
    t(key: MessageKey, vars?: Record<string, string | number>): string;

    /**
     * A count in the reader's digits. NOT for chain amounts - those stay Latin, see format.ts.
     *
     * `fractionDigits` is for the measured counts that are not whole: a mean block time of 2.98
     * seconds is the reading, and rounding it to 3 flattens the one figure that moves.
     */
    n(value: number, fractionDigits?: number): string;

    /** A movement against an earlier reading, as the reader's own signed percentage. */
    change(ratio: number): string;

    /** The same count shortened - for a chart caption, never for a figure that has to be exact. */
    compact(value: number): string;

    /**
     * A chain name as the reader should SEE it, which is not always how it is configured. An
     * untranslated name comes back unchanged. Never use this for a value leaving the page.
     */
    chainName(name: string): string;

    /** An absolute timestamp; Persian gets the Jalali calendar from Intl. */
    dateTime(iso: string): string;

    /** The same instant as a calendar date alone - for a series whose points are days. */
    date(iso: string): string;

    /** How long ago, in words. */
    ago(iso: string, now?: number): string;

    /**
     * A configured LENGTH of time, in the unit that states it best - `2 days`, `36 hours`,
     * `5 minutes`. For a parameter a chain was set up with, never for a span between two dates.
     */
    duration(seconds: number): string;

    /** A byte size with its unit spelled in the reader's language. */
    bytes(value: number): string;
}

/**
 * The reader's language, as the FRAMEWORK holds it.
 *
 * There is no detection here any more, and that is the point. The server negotiates every
 * request - the reader's `locale` cookie first, then `Accept-Language` in preference order, then
 * English - and stamps the answer on `<html lang>` and `<html dir>` before the first byte leaves.
 * This store reads that stamp, so the hydrating page agrees with the served markup by
 * construction rather than by correcting it a frame later, and a crawler or a reader with no
 * JavaScript gets a correctly labelled, correctly mirrored document.
 *
 * `setLocale` writes the cookie the NEXT request is negotiated from, which is what makes a
 * language switch survive a reload as a server render rather than as a repair.
 */
export const useLocale = createStore((): LocaleApi =>
{
    const stamped = useDocumentLocale();

    // The document can only hold a tag the server negotiated, which is one of ours - but this
    // file owns the dictionary, so an unknown tag falls back rather than indexing it.
    const locale = (): Locale =>
    {
        const tag = stamped();

        return isLocale(tag) ? tag : 'en';
    };

    const t = (key: MessageKey, vars?: Record<string, string | number>): string =>
        interpolate(CATALOG[locale()][key], vars);

    return {
        locale,
        dir: () => localeDirection(locale()),
        setLocale: (next) => setDocumentLocale(next),
        t,
        n: (value, fractionDigits) => formatCount(value, LOCALE_TAG[locale()], fractionDigits),
        change: (ratio) => formatChange(ratio, LOCALE_TAG[locale()]),
        compact: (value) => formatCompact(value, LOCALE_TAG[locale()]),
        chainName: (name) => CHAIN_NAMES[locale()][name] ?? name,
        dateTime: (iso) => formatDateTime(iso, LOCALE_TAG[locale()]),
        date: (iso) => formatDate(iso, LOCALE_TAG[locale()]),
        ago: (iso, now) =>
        {
            const { unit, count } = elapsed(iso, now);
            if (unit === 'justNow')
            {
                return t('time.justNow');
            }
            // The plural key is the singular one with an 's'; a language that does not inflect
            // after a numeral (Persian, Turkish, Chinese, Hindi) defines both as the same string,
            // so this picks a form where it matters without the caller knowing about plurals.
            const key = (count === 1 ? `time.${ unit }` : `time.${ unit }s`) as MessageKey;
            return t(key, { count: formatCount(count, LOCALE_TAG[locale()]) });
        },
        duration: (seconds) =>
        {
            const { unit, count } = scaleDuration(seconds);
            // Singular and plural picked by count, exactly as `ago` above does it.
            const key = (count === 1 ? `duration.${ unit }` : `duration.${ unit }s`) as MessageKey;
            // The decimal appears only where the span did not divide evenly: a voting period of
            // two days is `2 days`, not `2.0 days`.
            return t(key, { count: formatCount(count, LOCALE_TAG[locale()], Number.isInteger(count) ? 0 : 1) });
        },
        bytes: (value) =>
        {
            const { unit, count } = scaleBytes(value);
            return t(unit === 'bytes' ? 'unit.bytes' : 'unit.kilobytes', {
                count: unit === 'bytes'
                    ? formatCount(count, LOCALE_TAG[locale()])
                    : count.toLocaleString(LOCALE_TAG[locale()], { minimumFractionDigits: 1, maximumFractionDigits: 1 })
            });
        }
    };
});

/**
 * A choice remembered before the cookie existed still counts, once.
 *
 * Readers who picked a language under the old store have it in `localStorage`, where no server
 * can see it - so on their next visit the page would arrive in whatever their browser asks for
 * and silently forget what they chose. This reads that key one last time, replays it through
 * `setLocale` (which writes the cookie), and removes it.
 *
 * Called from `main.azeroth` AFTER the app boots, never during it: switching mid-mount would
 * fight the markup the server just sent.
 */
export function adoptStoredChoice(): void
{
    try
    {
        const saved = localStorage.getItem(LEGACY_KEY);

        if (saved === null)
        {
            return;
        }

        localStorage.removeItem(LEGACY_KEY);

        if (isLocale(saved) && saved !== useLocale().locale())
        {
            setDocumentLocale(saved);
        }
    }
    catch
    {
        // A blocked store costs the remembered choice, never the page.
    }
}
