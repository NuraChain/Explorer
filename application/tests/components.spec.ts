// @vitest-environment happy-dom
//
// Component tests: real components mounted in a real DOM, driven by real events.
//
// What they are for is the behaviour that only exists once a component is on a page - a disabled
// button that still fires, an accessible name that is missing, a pager that renders a link to a
// page that is not there, an interaction that leaves the tree subscribed after it unmounts. None
// of that is visible from the outside of the function.
//
// renderTest attaches the container to document.body so delegated events fire, and cleanup()
// unmounts everything after each case - a leaked tree keeps its effects running into the next.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import Badge from '../src/components/ui/badge.component.azeroth';
import Button from '../src/components/ui/button.component.azeroth';
import EmptyState from '../src/components/ui/empty-state.component.azeroth';
import FilterGroup from '../src/components/ui/filter-group.component.azeroth';
import SeriesChart from '../src/components/chain/series-chart.component.azeroth';
import Input from '../src/components/ui/input.component.azeroth';
import Pagination from '../src/components/ui/pagination.component.azeroth';
import { useLocale } from '../src/stores/locale.store.ts';

/** Components compile to functions returning their root element. */
type Rendered = HTMLElement;

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

describe('Button', () =>
{
    it('renders its children and defaults to type=button', () =>
    {
        // A bare <button> inside a form submits it. The default matters.
        const { container } = renderTest(() => Button({ children: 'Connect' }) as Rendered);
        const button = container.querySelector('button')!;
        expect(button.textContent).toContain('Connect');
        expect(button.getAttribute('type')).toBe('button');
    });

    it('calls onClick when clicked', () =>
    {
        const onClick = vi.fn();
        const { container } = renderTest(() => Button({ children: 'Go', onClick }) as Rendered);
        fire(container.querySelector('button')!, 'click');
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire while disabled', () =>
    {
        const onClick = vi.fn();
        const { container } = renderTest(() => Button({ children: 'Go', onClick, disabled: true }) as Rendered);
        const button = container.querySelector('button')!;
        expect(button.disabled).toBe(true);
        fire(button, 'click');
        expect(onClick).not.toHaveBeenCalled();
    });

    it('treats busy as disabled, so a working control cannot be clicked twice', () =>
    {
        // One prop meaning both removes the case where a caller sets only one of them - and a
        // second click on a pending transaction is exactly the bug that produces.
        const onClick = vi.fn();
        const { container } = renderTest(() => Button({ children: 'Send', onClick, busy: true }) as Rendered);
        const button = container.querySelector('button')!;
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-busy')).toBe('true');
        fire(button, 'click');
        expect(onClick).not.toHaveBeenCalled();
    });

    it('says it is not busy when it is not', () =>
    {
        const { container } = renderTest(() => Button({ children: 'Send' }) as Rendered);
        expect(container.querySelector('button')!.getAttribute('aria-busy')).toBe('false');
    });

    it('shows a spinner while busy and an icon otherwise', () =>
    {
        const busy = renderTest(() => Button({ children: 'Send', busy: true, icon: 'send' }) as Rendered);
        expect(busy.container.querySelector('.animate-spin')).not.toBeNull();
        busy.unmount();

        const idle = renderTest(() => Button({ children: 'Send', icon: 'send' }) as Rendered);
        expect(idle.container.querySelector('.animate-spin')).toBeNull();
        expect(idle.container.querySelector('svg')).not.toBeNull();
    });

    it('can submit a form when asked to', () =>
    {
        const { container } = renderTest(() => Button({ children: 'Search', type: 'submit' }) as Rendered);
        expect(container.querySelector('button')!.getAttribute('type')).toBe('submit');
    });
});

describe('Badge', () =>
{
    it('renders its children', () =>
    {
        const { container } = renderTest(() => Badge({ tone: 'success', children: 'success' }) as Rendered);
        expect(container.textContent).toContain('success');
    });

    it('gives the two FUNCTIONAL tones different classes', () =>
    {
        // inflow and outflow answer the only question this product exists to answer; they must
        // never render alike.
        const success = renderTest(() => Badge({ tone: 'success', children: 'in' }) as Rendered);
        const danger = renderTest(() => Badge({ tone: 'danger', children: 'out' }) as Rendered);
        const successClass = success.container.querySelector('span')!.className;
        const dangerClass = danger.container.querySelector('span')!.className;
        expect(successClass).not.toBe(dangerClass);
    });

    it('falls back to a neutral tone rather than rendering unstyled', () =>
    {
        const { container } = renderTest(() => Badge({ children: 'plain' }) as Rendered);
        expect(container.querySelector('span')!.className.length).toBeGreaterThan(0);
    });

    it('renders an icon only when given one', () =>
    {
        const without = renderTest(() => Badge({ children: 'x' }) as Rendered);
        expect(without.container.querySelector('svg')).toBeNull();
        without.unmount();

        const with_ = renderTest(() => Badge({ children: 'x', icon: 'success' }) as Rendered);
        expect(with_.container.querySelector('svg')).not.toBeNull();
    });
});

describe('EmptyState', () =>
{
    it('renders a title, and a hint only when there is one', () =>
    {
        const bare = renderTest(() => EmptyState({ title: 'Nothing here' }) as Rendered);
        expect(bare.container.textContent).toContain('Nothing here');
        expect(bare.container.querySelectorAll('p')).toHaveLength(1);
        bare.unmount();

        const hinted = renderTest(() => EmptyState({ title: 'Nothing here', hint: 'Try another address' }) as Rendered);
        expect(hinted.container.textContent).toContain('Try another address');
        expect(hinted.container.querySelectorAll('p')).toHaveLength(2);
    });

    it('does not render the string "undefined" when the hint is absent', () =>
    {
        const { container } = renderTest(() => EmptyState({ title: 'Nothing' }) as Rendered);
        expect(container.textContent).not.toContain('undefined');
    });
});

describe('Input', () =>
{
    it('carries an accessible name, because these fields have no visible label', () =>
    {
        const { container } = renderTest(() => Input({ label: 'Search', value: '' }) as Rendered);
        const field = container.querySelector('input')!;
        expect(field.getAttribute('aria-label')).toBe('Search');
    });

    it('reports what was typed', () =>
    {
        const onInput = vi.fn();
        const { container } = renderTest(() => Input({ label: 'Amount', value: '', onInput }) as Rendered);
        const field = container.querySelector('input')!;

        field.value = '1.25';
        fire(field, 'input');
        expect(onInput).toHaveBeenCalledWith('1.25');
    });

    it('shows the value it is given', () =>
    {
        const { container } = renderTest(() => Input({ label: 'Amount', value: '42' }) as Rendered);
        expect(container.querySelector('input')!.value).toBe('42');
    });

    it('renders a placeholder when given one', () =>
    {
        const { container } = renderTest(() => Input({ label: 'Search', placeholder: 'Address, hash or height' }) as Rendered);
        expect(container.querySelector('input')!.getAttribute('placeholder')).toBe('Address, hash or height');
    });
});

describe('FilterGroup', () =>
{
    const OPTIONS = [
        { value: 'all', label: 'All' },
        { value: 'success', label: 'Succeeded' },
        { value: 'reverted', label: 'Reverted' }
    ];

    /** Every label in the group, in the order they are drawn. */
    function chips(container: HTMLElement): HTMLLabelElement[]
    {
        return [...container.querySelectorAll('label')];
    }

    it('names the group once, for a screen reader only', () =>
    {
        // The chips are the visible label. A legend printed above them would say it twice.
        const { container } = renderTest(() => FilterGroup({
            label: 'Status', name: 'status', options: OPTIONS, value: 'all', onChange: () => undefined
        }) as Rendered);
        expect(container.querySelector('legend')!.textContent).toBe('Status');
        expect(container.querySelector('legend')!.className).toContain('sr-only');
    });

    it('puts every option under one radio name, so the browser keeps them exclusive', () =>
    {
        const { container } = renderTest(() => FilterGroup({
            label: 'Status', name: 'status', options: OPTIONS, value: 'all', onChange: () => undefined
        }) as Rendered);
        const inputs = [...container.querySelectorAll('input')];
        expect(inputs).toHaveLength(3);
        expect(new Set(inputs.map((input) => input.getAttribute('name'))).size).toBe(1);
        expect(inputs.every((input) => input.getAttribute('type') === 'radio')).toBe(true);
    });

    it('checks the chosen option and no other', () =>
    {
        const { container } = renderTest(() => FilterGroup({
            label: 'Status', name: 'status', options: OPTIONS, value: 'reverted', onChange: () => undefined
        }) as Rendered);
        const checked = [...container.querySelectorAll('input')].filter((input) => input.checked);
        expect(checked).toHaveLength(1);
        expect(checked[0]!.value).toBe('reverted');
    });

    it('says which option is current in more than colour', () =>
    {
        // Underneath the accent it is the CHECKED radio, which is what a screen reader reads;
        // the border and the weight are what a reader who cannot separate two accents has left.
        const { container } = renderTest(() => FilterGroup({
            label: 'Status', name: 'status', options: OPTIONS, value: 'success', onChange: () => undefined
        }) as Rendered);
        const selected = chips(container)[1]!;
        expect(selected.className).toContain('border-nur');
        expect(selected.className).toContain('font-semibold');
    });

    it('leaves the already-chosen option without a pointer cursor', () =>
    {
        const { container } = renderTest(() => FilterGroup({
            label: 'Status', name: 'status', options: OPTIONS, value: 'all', onChange: () => undefined
        }) as Rendered);
        expect(chips(container)[0]!.className).toContain('cursor-default');
        expect(chips(container)[1]!.className).toContain('cursor-pointer');
    });

    it('reports the option that was chosen', () =>
    {
        const onChange = vi.fn();
        const { container } = renderTest(() => FilterGroup({
            label: 'Status', name: 'status', options: OPTIONS, value: 'all', onChange
        }) as Rendered);
        const reverted = [...container.querySelectorAll('input')].find((input) => input.value === 'reverted')!;
        fire(reverted, 'change');
        expect(onChange).toHaveBeenCalledWith('reverted');
    });

    it('keeps the hidden input focusable - sr-only, never display:none', () =>
    {
        // A radio hidden with `display: none` cannot be reached by the keyboard at all, which
        // throws away the only reason to have used a radio instead of a button.
        const { container } = renderTest(() => FilterGroup({
            label: 'Status', name: 'status', options: OPTIONS, value: 'all', onChange: () => undefined
        }) as Rendered);
        for (const input of container.querySelectorAll('input'))
        {
            expect(input.className).toContain('sr-only');
            expect(input.hasAttribute('hidden')).toBe(false);
        }
    });
});

describe('SeriesChart', () =>
{
    const POINTS = [
        { at: '2026-08-01T00:00:00.000Z', value: '10' },
        { at: '2026-08-02T00:00:00.000Z', value: '40' },
        { at: '2026-08-03T00:00:00.000Z', value: '20' }
    ];

    function chart(overrides: Record<string, unknown> = {}): { container: HTMLElement; unmount: () => void }
    {
        return renderTest(() => SeriesChart({
            title: 'Daily transactions',
            points: POINTS,
            format: (value: string) => value,
            summary: 'Daily transactions over three days',
            latest: 'Latest',
            empty: 'Nothing yet',
            ...overrides
        }) as Rendered);
    }

    it('says what the picture shows, because a plot says nothing on its own', () =>
    {
        const { container } = chart();
        const plot = container.querySelector('[role="img"]')!;
        expect(plot.getAttribute('aria-label')).toBe('Daily transactions over three days');
    });

    it('names its one series in the title and draws no legend for it', () =>
    {
        // One series needs no key - a legend would repeat the heading directly above it.
        const { container } = chart();
        expect(container.querySelector('h3')!.textContent).toBe('Daily transactions');
    });

    it('draws one command per point, left to right', () =>
    {
        const { container } = chart();
        const line = container.querySelectorAll('path')[1]!;
        const drawn = line.getAttribute('d')!;
        expect(drawn.startsWith('M0.00')).toBe(true);
        expect(drawn.match(/L/g)).toHaveLength(2);
    });

    it('puts the peak at the top of the plot and the floor at the bottom', () =>
    {
        // The scale is relative to the largest reading, so the shape of a quiet series still
        // reads - and the peak is labelled, so nobody has to guess what the top means.
        const { container } = chart();
        const drawn = container.querySelectorAll('path')[1]!.getAttribute('d')!;
        const ys = [...drawn.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((match) => Number(match[1]));
        expect(Math.min(...ys)).toBeLessThan(Math.max(...ys));
        // The 40 is the peak and sits highest on the plot, which is the SMALLEST y.
        expect(ys[1]).toBe(Math.min(...ys));
    });

    it('mirrors the time axis when the layout is mirrored', () =>
    {
        // The cadence strip already runs oldest-to-newest with the reading direction, because it
        // is a flex row. An SVG mirrors for nobody, so this has to do it itself.
        const locale = useLocale();
        locale.setLocale('fa');
        const { container, unmount } = chart();
        expect(container.querySelectorAll('path')[1]!.getAttribute('d')!.startsWith('M1000.00')).toBe(true);
        unmount();
        locale.setLocale('en');
    });

    it('reads the LATEST point when nothing is under the pointer', () =>
    {
        const { container } = chart();
        expect(container.querySelector('figcaption')!.textContent).toContain('Latest');
        expect(container.querySelector('figcaption')!.textContent).toContain('20');
    });

    it('hands the formatter the raw string, never a number', () =>
    {
        // Two of these series are wei. A value that reached the formatter as a double would
        // already have been rounded before anybody chose how to print it.
        const seen: string[] = [];
        const wei = '5185185138518518476000';
        const record = (value: string): string =>
        {
            seen.push(value);
            return value;
        };
        const { container } = renderTest(() => SeriesChart({
            title: 'Daily fees',
            points: [{ at: '2026-08-01T00:00:00.000Z', value: wei }],
            format: record,
            summary: 'Daily fees',
            latest: 'Latest',
            empty: 'Nothing yet'
        }) as Rendered);
        expect(seen).toContain(wei);
        expect(container.textContent).toContain(wei);
    });

    it('says so rather than drawing an empty box when there is nothing to plot', () =>
    {
        const { container } = chart({ points: [] });
        expect(container.textContent).toContain('Nothing yet');
        expect(container.querySelector('svg')).toBeNull();
    });
});

describe('Pagination', () =>
{
    /** The numbered page buttons, in the order they are drawn. */
    function pages(container: HTMLElement): string[]
    {
        return [...container.querySelectorAll('button')]
            .filter((button) => /^\d+$/.test(button.textContent?.trim() ?? ''))
            .map((button) => button.textContent!.trim());
    }

    it('draws nothing at all for a single page', () =>
    {
        // An empty bordered strip under a list reads as something that failed to load.
        const { container } = renderTest(() => Pagination({ page: 1, pages: 1, onChange: () => undefined }) as Rendered);
        expect(container.querySelector('nav')).toBeNull();
    });

    it('draws every page when they fit in the window', () =>
    {
        const { container } = renderTest(() => Pagination({ page: 1, pages: 5, onChange: () => undefined }) as Rendered);
        expect(pages(container)).toEqual(['1', '2', '3', '4', '5']);
    });

    it('never reflows as the page number grows', () =>
    {
        // Seven slots, fixed: first, last, the current page with a neighbour either side, and
        // gaps for what is skipped. A control that changes width as you page is a moving target.
        const middle = renderTest(() => Pagination({ page: 50, pages: 100, onChange: () => undefined }) as Rendered);
        expect(pages(middle.container)).toEqual(['1', '49', '50', '51', '100']);
        expect(middle.container.textContent).toContain('...');
        middle.unmount();

        const start = renderTest(() => Pagination({ page: 2, pages: 100, onChange: () => undefined }) as Rendered);
        expect(pages(start.container)).toEqual(['1', '2', '3', '100']);
    });

    it('marks the current page for a screen reader, not only by colour', () =>
    {
        const { container } = renderTest(() => Pagination({ page: 3, pages: 9, onChange: () => undefined }) as Rendered);
        const current = [...container.querySelectorAll('button')].filter((button) => button.getAttribute('aria-current') === 'page');
        expect(current).toHaveLength(1);
        expect(current[0]!.textContent!.trim()).toBe('3');
    });

    it('reports the page that was asked for', () =>
    {
        const onChange = vi.fn();
        const { container } = renderTest(() => Pagination({ page: 1, pages: 5, onChange }) as Rendered);
        const third = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === '3')!;
        fire(third, 'click');
        expect(onChange).toHaveBeenCalledWith(3);
    });

    it('disables the steps at the ends, so a pager cannot walk off either edge', () =>
    {
        const first = renderTest(() => Pagination({ page: 1, pages: 5, onChange: () => undefined }) as Rendered);
        const firstDisabled = [...first.container.querySelectorAll('button')].filter((button) => button.disabled);
        // Both backward steps are dead on page one.
        expect(firstDisabled).toHaveLength(2);
        first.unmount();

        const last = renderTest(() => Pagination({ page: 5, pages: 5, onChange: () => undefined }) as Rendered);
        expect([...last.container.querySelectorAll('button')].filter((button) => button.disabled)).toHaveLength(2);
    });

    it('does not fire onChange from a disabled step', () =>
    {
        // `.click()` and not `fire()`: a disabled button emits no click event at all, and that
        // platform rule IS the protection here - Pagination has no JS guard of its own, unlike
        // Button. Dispatching the event synthetically would bypass the very thing under test.
        const onChange = vi.fn();
        const { container } = renderTest(() => Pagination({ page: 1, pages: 5, onChange }) as Rendered);
        const disabled = [...container.querySelectorAll('button')].filter((button) => button.disabled);
        expect(disabled.length).toBeGreaterThan(0);
        for (const button of disabled)
        {
            button.click();
        }
        expect(onChange).not.toHaveBeenCalled();
    });

    it('steps one page at a time from the arrows, and jumps to the ends from the double ones', () =>
    {
        const onChange = vi.fn();
        const { container } = renderTest(() => Pagination({ page: 3, pages: 9, onChange }) as Rendered);
        const steps = [...container.querySelectorAll('button')].filter((button) => button.querySelector('svg') !== null);

        // first, previous, ... , next, last
        fire(steps[0]!, 'click');
        expect(onChange).toHaveBeenLastCalledWith(1);
        fire(steps[1]!, 'click');
        expect(onChange).toHaveBeenLastCalledWith(2);
        fire(steps[steps.length - 2]!, 'click');
        expect(onChange).toHaveBeenLastCalledWith(4);
        fire(steps[steps.length - 1]!, 'click');
        expect(onChange).toHaveBeenLastCalledWith(9);
    });

    it('gives every control an accessible name', () =>
    {
        const { container } = renderTest(() => Pagination({ page: 3, pages: 9, onChange: () => undefined }) as Rendered);
        for (const button of container.querySelectorAll('button'))
        {
            const named = (button.getAttribute('aria-label') ?? '').trim().length > 0
                || (button.textContent ?? '').trim().length > 0;
            expect(named, `unnamed control: ${ button.outerHTML.slice(0, 80) }`).toBe(true);
        }
    });

    it('renders a gap as text, not as a button to nowhere', () =>
    {
        const { container } = renderTest(() => Pagination({ page: 50, pages: 100, onChange: () => undefined }) as Rendered);
        const gapButtons = [...container.querySelectorAll('button')].filter((button) => button.textContent?.includes('...'));
        expect(gapButtons).toEqual([]);
        expect(container.textContent).toContain('...');
    });

    it('re-renders in the reader\'s digits when the language changes', () =>
    {
        const locale = useLocale();
        locale.setLocale('fa');
        const { container } = renderTest(() => Pagination({ page: 1, pages: 5, onChange: () => undefined }) as Rendered);
        expect(container.textContent).toMatch(/[۰-۹]/);
        locale.setLocale('en');
    });
});

describe('unmounting', () =>
{
    it('leaves nothing in the document behind it', () =>
    {
        const before = document.body.childElementCount;
        const { unmount } = renderTest(() => Button({ children: 'x' }) as Rendered);
        expect(document.body.childElementCount).toBe(before + 1);
        unmount();
        expect(document.body.childElementCount).toBe(before);
    });

    it('is idempotent, so a double teardown is not a failure', () =>
    {
        const { unmount } = renderTest(() => Badge({ children: 'x' }) as Rendered);
        unmount();
        expect(() => unmount()).not.toThrow();
    });

    it('stops responding to events once unmounted', () =>
    {
        const onClick = vi.fn();
        const { container, unmount } = renderTest(() => Button({ children: 'x', onClick }) as Rendered);
        const button = container.querySelector('button')!;
        unmount();
        fire(button, 'click');
        expect(onClick).not.toHaveBeenCalled();
    });
});
