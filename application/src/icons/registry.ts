import {
    Activity,
    ArrowDownLeft,
    ArrowLeft,
    ArrowRight,
    ArrowUpRight,
    Blocks,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronsLeft,
    ChevronRight,
    ChevronsRight,
    CircleAlert,
    CircleCheck,
    CircleHelp,
    Coins,
    Copy,
    FileCode2,
    Fuel,
    Hash,
    Layers,
    Menu,
    Moon,
    Play,
    Search,
    Send,
    Sun,
    Wallet,
    X,
    type IconNode
} from 'lucide';

import { DISCORD, GITHUB, INSTAGRAM, TELEGRAM, X_COM } from './brands.ts';

// One name per icon, resolved once. A component asks for `name="inflow"` and gets the same mark
// everywhere - so the arrow that means "value arrived" cannot quietly differ between two pages.
export const ICONS = {
    'activity': Activity,
    'alert': CircleAlert,
    'arrow-left': ArrowLeft,
    'arrow-right': ArrowRight,
    'block': Blocks,
    'check': Check,
    'chevron-down': ChevronDown,
    'chevron-left': ChevronLeft,
    'chevrons-left': ChevronsLeft,
    'chevron-right': ChevronRight,
    'chevrons-right': ChevronsRight,
    'contract': FileCode2,
    'copy': Copy,
    'gas': Fuel,
    'hash': Hash,
    'help': CircleHelp,
    'inflow': ArrowDownLeft,
    'layers': Layers,
    'menu': Menu,
    'outflow': ArrowUpRight,
    'run': Play,
    'search': Search,
    'send': Send,
    // The community marks - real logos, from ./brands.ts. Filled rather than stroked, which is
    // what makes them recognisable at a glance next to the outline set.
    'social-github': GITHUB,
    'social-discord': DISCORD,
    'social-instagram': INSTAGRAM,
    'social-telegram': TELEGRAM,
    'social-x': X_COM,
    'success': CircleCheck,
    'theme-dark': Moon,
    'theme-light': Sun,
    'token': Coins,
    'wallet': Wallet,
    'x': X
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;
