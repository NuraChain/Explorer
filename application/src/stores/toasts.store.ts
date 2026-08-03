// The app's one notification channel. Components push; the <Toasts /> host renders and times
// out. A store rather than threaded callbacks, so a copy button buried in a table row can report
// without every component between it and the page knowing about notifications.

import { createStore, createSignal, type Getter } from 'azerothjs';

import type { IconName } from '../icons/registry.ts';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastEntry
{
    id: number;
    tone: ToastTone;
    message: string;
    icon?: IconName;
}

export interface ToastsApi
{
    items: Getter<ToastEntry[]>;
    push(tone: ToastTone, message: string, icon?: IconName): number;
    dismiss(id: number): void;
}

export const useToasts = createStore((): ToastsApi =>
{
    const [items, setItems] = createSignal<ToastEntry[]>([]);
    let nextId = 1;

    return {
        items,
        push: (tone, message, icon) =>
        {
            const id = nextId++;
            // Three at a time: a stack that grows without bound covers the page it is
            // reporting about.
            setItems([...items().slice(-2), { id, tone, message, icon }]);
            // Self-dismissing is part of what a toast IS, so the lifetime lives with the data
            // rather than in whichever host happens to render it.
            setTimeout(() => setItems(items().filter((entry) => entry.id !== id)), 4000);
            return id;
        },
        dismiss: (id) => setItems(items().filter((entry) => entry.id !== id))
    };
});
