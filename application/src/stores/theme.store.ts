import { createStore, createSignal, type Getter } from 'azerothjs';

import type { MessageKey } from '../locales/en.ts';

// Dark and light. Dark is the field the explorer was designed in and the one a first visit gets.

export type Theme = 'dark' | 'light';
export const THEMES: Theme[] = ['dark', 'light'];

const STORAGE_KEY = 'nura.theme';

/** Message KEYS, not words: the control that renders these translates them. */
export const THEME_LABEL: Record<Theme, MessageKey> = {
    dark: 'theme.dark',
    light: 'theme.light'
};

function isTheme(value: string | null): value is Theme
{
    return value !== null && (THEMES as string[]).includes(value);
}

/**
 * The stored choice, or dark. Dark is the deliberate default rather than a reading of the system
 * preference: this is the palette the explorer's colour work was done against, and a first visit
 * should land in it.
 */
function initial(): Theme
{
    if (typeof document === 'undefined')
    {
        return 'dark';
    }
    try
    {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (isTheme(stored))
        {
            return stored;
        }
    }
    catch
    {
        // A blocked localStorage is not a reason to fail to render.
    }
    return 'dark';
}

export interface ThemeApi
{
    theme: Getter<Theme>;
    setTheme(next: Theme): void;
}

export const useTheme = createStore((): ThemeApi =>
{
    const [theme, setSignal] = createSignal<Theme>(initial());

    const apply = (next: Theme): void =>
    {
        if (typeof document === 'undefined')
        {
            return;
        }
        // The attribute the palette keys on. Set on the ROOT so it wins over anything scoped.
        document.documentElement.dataset.theme = next;
        try
        {
            localStorage.setItem(STORAGE_KEY, next);
        }
        catch
        {
            // Nothing to do: the theme still applies for this session.
        }
    };

    apply(theme());

    return {
        theme,
        setTheme: (next) =>
        {
            setSignal(next);
            apply(next);
        }
    };
});
