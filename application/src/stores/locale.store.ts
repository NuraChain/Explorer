import { createStore, createSignal, type Getter } from 'azerothjs';

import { elapsed, formatCount, formatDateTime, scaleBytes } from '../lib/format.ts';
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

export const LOCALE_DIR: Record<Locale, 'ltr' | 'rtl'> = {
    en: 'ltr',
    fa: 'rtl',
    ar: 'rtl',
    es: 'ltr',
    pt: 'ltr',
    hi: 'ltr',
    zh: 'ltr',
    ru: 'ltr',
    fr: 'ltr',
    tr: 'ltr'
};

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

const STORAGE_KEY = 'nura.locale';

function isLocale(value: string | null): value is Locale
{
    return value !== null && (LOCALES as string[]).includes(value);
}

/**
 * The stored choice, then the browser's preference, then English. The navigator check means a
 * Persian-speaking first visit lands in Persian without having to find the switch.
 */
function initial(): Locale
{
    if (typeof document === 'undefined')
    {
        return 'en';
    }
    try
    {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (isLocale(stored))
        {
            return stored;
        }
    }
    catch
    {
        // A blocked localStorage is not a reason to fail to render.
    }
    // In PREFERENCE ORDER, not "is it anywhere in the list": a reader whose languages are
    // ['en-US', 'fa'] has asked for English first, and answering in Persian because Persian
    // appears at all gets that exactly backwards. Matches on the language subtag, so fa-IR,
    // fa-AF and bare fa all resolve.
    for (const tag of navigator.languages ?? [])
    {
        const language = tag.toLowerCase().split('-')[0];
        if (isLocale(language ?? null))
        {
            return language as Locale;
        }
    }
    return 'en';
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

    /** A count in the reader's digits. NOT for chain amounts - those stay Latin, see format.ts. */
    n(value: number): string;

    /**
     * A chain name as the reader should SEE it, which is not always how it is configured. An
     * untranslated name comes back unchanged. Never use this for a value leaving the page.
     */
    chainName(name: string): string;

    /** An absolute timestamp; Persian gets the Jalali calendar from Intl. */
    dateTime(iso: string): string;

    /** How long ago, in words. */
    ago(iso: string, now?: number): string;

    /** A byte size with its unit spelled in the reader's language. */
    bytes(value: number): string;
}

export const useLocale = createStore((): LocaleApi =>
{
    const [locale, setSignal] = createSignal<Locale>(initial());

    const apply = (next: Locale): void =>
    {
        if (typeof document === 'undefined')
        {
            return;
        }
        // Both on the ROOT: `dir` drives every logical property in the stylesheet, and `lang`
        // picks the font stack and tells a screen reader which language it is reading.
        document.documentElement.lang = next;
        document.documentElement.dir = LOCALE_DIR[next];
        try
        {
            localStorage.setItem(STORAGE_KEY, next);
        }
        catch
        {
            // Nothing to do: the language still applies for this session.
        }
    };

    apply(locale());

    const t = (key: MessageKey, vars?: Record<string, string | number>): string =>
        interpolate(CATALOG[locale()][key], vars);

    return {
        locale,
        dir: () => LOCALE_DIR[locale()],
        setLocale: (next) =>
        {
            setSignal(next);
            apply(next);
        },
        t,
        n: (value) => formatCount(value, LOCALE_TAG[locale()]),
        chainName: (name) => CHAIN_NAMES[locale()][name] ?? name,
        dateTime: (iso) => formatDateTime(iso, LOCALE_TAG[locale()]),
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
