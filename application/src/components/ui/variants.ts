// The class recipes shared by the primitives. Kept as data so a tone or a size is named once
// and every control that uses it stays in step - a component never hand-writes a colour.

export type Tone = 'success' | 'danger' | 'neutral' | 'accent';
export type ButtonVariant = 'primary' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md';

/** Tone -> the text and background pair every badge and status mark reads from. */
export const TONE_CLASS: Record<Tone, string> = {
    success: 'bg-raised text-inflow',
    danger: 'bg-raised text-outflow',
    neutral: 'bg-raised text-muted',
    accent: 'bg-raised text-nur'
};

export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
    primary: 'bg-nur text-void hover:opacity-90',
    outline: 'border border-line text-text hover:border-nur',
    ghost: 'text-muted hover:text-text'
};

export const BUTTON_SIZE: Record<ButtonSize, string> = {
    sm: 'h-8 gap-1.5 px-3 text-[13px]',
    md: 'h-10 gap-2 px-4 text-[14px]'
};
