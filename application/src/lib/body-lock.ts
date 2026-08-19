// The page behind an overlay must not scroll. A depth counter keeps the lock honest when
// overlays nest - the language dialog opens on top of the drawer, so closing it must not
// unlock a page the drawer is still covering. Every overlay pairs lock with unlock.
let depth = 0;

export function lockBodyScroll(): void
{
    if (typeof document === 'undefined')
    {
        return;
    }
    depth += 1;
    document.body.style.overflow = 'hidden';
}

export function unlockBodyScroll(): void
{
    if (typeof document === 'undefined')
    {
        return;
    }
    depth = Math.max(0, depth - 1);
    if (depth === 0)
    {
        document.body.style.overflow = '';
    }
}
