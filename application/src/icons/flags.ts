import type { Locale } from '../stores/locale.store.ts';

// One flag per locale, hand-drawn as fill-only paths on a 24x16 canvas - no sprite sheet, no
// third-party request, and nothing the icon pipeline has to learn: flags are multicolour, so
// they bypass the stroked single-colour ICONS registry entirely and render through Flag.
//
// WHICH flag a language gets is not a judgement made here: it is the region already chosen in
// LOCALE_TAG (en-US, pt-BR, ar-EG...), so the flag and the number/date conventions always agree.
//
// Shapes are painted in ARRAY ORDER, which is what makes a crescent two overlapping circles and
// a chakra a ring of two. Detail that cannot survive 18px - the fifty stars, the shahada, the
// eagle's feathers - is simplified or dropped rather than smeared: a flag here is a recognition
// mark, not a rendering of the standard.

export interface FlagShape
{
    d: string;
    fill: string;
}

export const FLAG_VIEWBOX = '0 0 24 16';

export const FLAGS: Record<Locale, FlagShape[]> = {
    // United States - thirteen stripes and the canton; the stars become a grid of nine dots.
    en: [
        { d: 'M0 0h24v16H0Z', fill: '#FFFFFF' },
        { d: 'M0 0h24v1.23H0Z', fill: '#B22234' },
        { d: 'M0 2.46h24v1.23H0Z', fill: '#B22234' },
        { d: 'M0 4.92h24v1.23H0Z', fill: '#B22234' },
        { d: 'M0 7.38h24v1.23H0Z', fill: '#B22234' },
        { d: 'M0 9.85h24v1.23H0Z', fill: '#B22234' },
        { d: 'M0 12.31h24v1.23H0Z', fill: '#B22234' },
        { d: 'M0 14.77h24v1.23H0Z', fill: '#B22234' },
        { d: 'M0 0h9.6v8.62H0Z', fill: '#3C3B6E' },
        { d: 'M1.85 2.2a.55.55 0 1 0 1.1 0a.55.55 0 1 0 -1.1 0Z', fill: '#FFFFFF' },
        { d: 'M4.25 2.2a.55.55 0 1 0 1.1 0a.55.55 0 1 0 -1.1 0Z', fill: '#FFFFFF' },
        { d: 'M6.65 2.2a.55.55 0 1 0 1.1 0a.55.55 0 1 0 -1.1 0Z', fill: '#FFFFFF' },
        { d: 'M1.85 4.3a.55.55 0 1 0 1.1 0a.55.55 0 1 0 -1.1 0Z', fill: '#FFFFFF' },
        { d: 'M4.25 4.3a.55.55 0 1 0 1.1 0a.55.55 0 1 0 -1.1 0Z', fill: '#FFFFFF' },
        { d: 'M6.65 4.3a.55.55 0 1 0 1.1 0a.55.55 0 1 0 -1.1 0Z', fill: '#FFFFFF' },
        { d: 'M1.85 6.4a.55.55 0 1 0 1.1 0a.55.55 0 1 0 -1.1 0Z', fill: '#FFFFFF' },
        { d: 'M4.25 6.4a.55.55 0 1 0 1.1 0a.55.55 0 1 0 -1.1 0Z', fill: '#FFFFFF' },
        { d: 'M6.65 6.4a.55.55 0 1 0 1.1 0a.55.55 0 1 0 -1.1 0Z', fill: '#FFFFFF' }
    ],

    // Iran - green, white, red, and the emblem reduced to its tulip silhouette.
    fa: [
        { d: 'M0 0h24v5.33H0Z', fill: '#239F40' },
        { d: 'M0 5.33h24v5.34H0Z', fill: '#FFFFFF' },
        { d: 'M0 10.67h24v5.33H0Z', fill: '#DA0000' },
        { d: 'M12 5.9C10.9 6.5 10.6 7.7 11.3 8.7C11.6 9.1 11.9 9.4 12 10C12.1 9.4 12.4 9.1 12.7 8.7C13.4 7.7 13.1 6.5 12 5.9Z', fill: '#DA0000' }
    ],

    // Egypt - the tag is ar-EG, so the flag is Egypt's: red, white, black, a gold mark for the
    // eagle of Saladin.
    ar: [
        { d: 'M0 0h24v5.33H0Z', fill: '#CE1126' },
        { d: 'M0 5.33h24v5.34H0Z', fill: '#FFFFFF' },
        { d: 'M0 10.67h24v5.33H0Z', fill: '#000000' },
        { d: 'M12 5.9L13.2 6.9L12.9 9.5L12 10.2L11.1 9.5L10.8 6.9Z', fill: '#C09300' }
    ],

    // Spain - the civil tricolour; the coat of arms does not survive this size.
    es: [
        { d: 'M0 0h24v4H0Z', fill: '#AA151B' },
        { d: 'M0 4h24v8H0Z', fill: '#F1BF00' },
        { d: 'M0 12h24v4H0Z', fill: '#AA151B' }
    ],

    // Brazil - the tag is pt-BR: the rhombus and the globe, without the banner.
    pt: [
        { d: 'M0 0h24v16H0Z', fill: '#009B3A' },
        { d: 'M12 1.7L21.5 8L12 14.3L2.5 8Z', fill: '#FEDF00' },
        { d: 'M8.9 8a3.1 3.1 0 1 0 6.2 0a3.1 3.1 0 1 0 -6.2 0Z', fill: '#002776' }
    ],

    // India - saffron, white, green; the chakra is a ring and its hub.
    hi: [
        { d: 'M0 0h24v5.33H0Z', fill: '#FF9933' },
        { d: 'M0 5.33h24v5.34H0Z', fill: '#FFFFFF' },
        { d: 'M0 10.67h24v5.33H0Z', fill: '#138808' },
        { d: 'M9.7 8a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0 -4.6 0Z', fill: '#000080' },
        { d: 'M10.3 8a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0 -3.4 0Z', fill: '#FFFFFF' },
        { d: 'M11.5 8a.5.5 0 1 0 1 0a.5.5 0 1 0 -1 0Z', fill: '#000080' }
    ],

    // China - the large star keeps its points; the four small ones become star-dots.
    zh: [
        { d: 'M0 0h24v16H0Z', fill: '#DE2910' },
        { d: 'M4 1.6L4.54 3.26L6.28 3.26L4.87 4.28L5.41 5.94L4 4.92L2.59 5.94L3.13 4.28L1.72 3.26L3.46 3.26Z', fill: '#FFDE00' },
        { d: 'M8 0.85L8.62 1.7L8 2.55L7.38 1.7Z', fill: '#FFDE00' },
        { d: 'M9.7 2.55L10.32 3.4L9.7 4.25L9.08 3.4Z', fill: '#FFDE00' },
        { d: 'M9.7 4.95L10.32 5.8L9.7 6.65L9.08 5.8Z', fill: '#FFDE00' },
        { d: 'M8 6.65L8.62 7.5L8 8.35L7.38 7.5Z', fill: '#FFDE00' }
    ],

    // Russia - white, blue, red.
    ru: [
        { d: 'M0 0h24v5.33H0Z', fill: '#FFFFFF' },
        { d: 'M0 5.33h24v5.34H0Z', fill: '#0039A6' },
        { d: 'M0 10.67h24v5.33H0Z', fill: '#D52B1E' }
    ],

    // France - blue, white, red.
    fr: [
        { d: 'M0 0h8v16H0Z', fill: '#0055A4' },
        { d: 'M8 0h8v16H8Z', fill: '#FFFFFF' },
        { d: 'M16 0h8v16h-8Z', fill: '#EF4135' }
    ],

    // Turkey - the crescent is two circles painted in order; the star keeps its points.
    tr: [
        { d: 'M0 0h24v16H0Z', fill: '#E30A17' },
        { d: 'M5.6 8a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z', fill: '#FFFFFF' },
        { d: 'M7.8 8a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0Z', fill: '#E30A17' },
        { d: 'M15.8 6.3L16.18 7.47L17.42 7.47L16.42 8.2L16.8 9.38L15.8 8.65L14.8 9.38L15.18 8.2L14.18 7.47L15.42 7.47Z', fill: '#FFFFFF' }
    ]
};
