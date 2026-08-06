import type { Dictionary } from './en.ts';

// Persian (fa-IR). Typed against the English dictionary, so a key added there and forgotten here
// is a build error rather than an English string leaking into a Persian page.
//
// Untranslated on purpose: `gwei`, ERC standard numbers, and everything the chain itself names -
// token symbols, the chain name, addresses and hashes arrive as data and are shown as they are.
export const fa: Dictionary = {
    // --- Chrome -------------------------------------------------------------------------------
    'nav.sections': 'بخش‌ها',
    'nav.home': 'خانه',
    'nav.blocks': 'بلاک‌ها',
    'nav.transactions': 'تراکنش‌ها',
    'nav.overview': 'نمای کلی',
    'nav.menu': 'منو',
    'nav.open': 'باز کردن منو',
    'nav.close': 'بستن منو',
    'nav.elsewhere': 'جاهای دیگر',

    'theme.label': 'پوسته',
    'theme.dark': 'تیره',
    'theme.light': 'روشن',

    'language.label': 'زبان',

    // --- Search -------------------------------------------------------------------------------
    'search.label': 'جست‌وجو بر اساس آدرس، هش تراکنش یا شمارهٔ بلاک',
    'search.placeholder': 'آدرس، هش تراکنش یا شمارهٔ بلاک',
    'search.placeholder.compact': 'جست‌وجو',
    'search.go': 'برو',
    'search.missing': 'چیزی با این مقدار نمایه نشده است. آن را بررسی کنید، یا اگر بلاک بسیار تازه است کمی صبر کنید.',
    'search.failed': 'جست‌وجو ناموفق بود - کاوشگر نتوانست به نمایه‌اش برسد.',

    // --- Home ---------------------------------------------------------------------------------
    // The verb sits in `trail`, where Persian word order needs it.
    'home.hero.lead': '',
    'home.hero.accent': 'نور',
    'home.hero.through': 'را در',
    'home.hero.fallback': 'زنجیره',
    'home.hero.trail': 'دنبال کنید',
    'home.tagline': 'هر بلاک، تراکنش و انتقال نمایه می‌شود تا دقیقاً ببینید ارزش کجا جابه‌جا شده است.',
    'home.behind': 'در حال نمایه‌سازی - {count} بلاک عقب‌تر از نود.',
    'home.stat.height': 'ارتفاع',
    'home.stat.transactions': 'تراکنش‌ها',
    'home.stat.blockTime': 'زمان بلاک',
    'home.stat.baseFee': 'کارمزد پایه',
    'home.latestBlocks': 'آخرین بلاک‌ها',
    'home.latestTransactions': 'آخرین تراکنش‌ها',
    'home.all': 'همه',
    'home.empty.blocks': 'در انتظار نخستین بلاک',
    'home.empty.transactions': 'هنوز تراکنشی نیست',

    // --- Blocks list --------------------------------------------------------------------------
    'blocks.title': 'بلاک‌ها',
    'blocks.empty.title': 'هنوز بلاکی نمایه نشده است',
    'blocks.empty.hint': 'بلاک‌ها به‌محض خوانده‌شدن از زنجیره اینجا ظاهر می‌شوند.',
    'blocks.total': '{count} بلاک نمایه شده است.',
    'blocks.gasTooltip': '{used} از {limit} گس مصرف شده',

    // --- Transactions list --------------------------------------------------------------------
    'txs.title': 'تراکنش‌ها',
    'txs.empty.title': 'هنوز تراکنشی نمایه نشده است',
    'txs.empty.hint': 'هر تراکنشی که زنجیره استخراج کند اینجا می‌آید.',
    'txs.total': '{count} تراکنش نمایه شده است.',

    // --- Block detail -------------------------------------------------------------------------
    'block.title': 'بلاک #{number}',
    'block.missing.title': 'بلاک در نمایه نیست',
    'block.missing.hint': 'ممکن است تازه‌تر از جایی باشد که نمایه‌ساز به آن رسیده، یا پیش از بلاک شروع باشد.',
    'block.previous': 'بلاک قبلی',
    'block.next': 'بلاک بعدی',
    'block.hash': 'هش',
    'block.parent': 'والد',
    'block.validator': 'تأییدکننده',
    'block.size': 'اندازه',
    'block.gasUsed': 'گس مصرف‌شده',
    'block.gasOf': 'از {limit}',
    'block.baseFee': 'کارمزد پایه',
    'block.transactions': '{count} تراکنش',
    'block.empty.title': 'این بلاک خالی است',
    'block.empty.hint': 'هیچ تراکنشی در آن گنجانده نشده است.',

    // --- Transaction detail -------------------------------------------------------------------
    'tx.title': 'تراکنش',
    'tx.missing.title': 'تراکنش در نمایه نیست',
    'tx.missing.hint': 'ممکن است هنوز در انتظار باشد، یا تازه‌تر از جایی که نمایه‌ساز به آن رسیده است.',
    'tx.reverted.notice': 'این تراکنش برگشت خورد. هیچ ارزشی جابه‌جا نشد، اما فرستنده همچنان گس زیر را پرداخت کرد.',
    'tx.hash': 'هش',
    'tx.block': 'بلاک',
    'tx.position': 'جایگاه {index}',
    'tx.from': 'از',
    'tx.to': 'به',
    'tx.value': 'مقدار',
    'tx.fee': 'کارمزد',
    'tx.feeDetail': '{gas} گس با نرخ {price}',
    'tx.nonce': 'نانس',
    'tx.calldata': 'دادهٔ فراخوانی {size}',
    'tx.created': 'ایجادشده',
    'tx.transfers': 'انتقال‌های توکن',
    'tx.token': 'توکن',

    // --- Address ------------------------------------------------------------------------------
    'address.title': 'آدرس {short}',
    'address.kind.address': 'آدرس',
    'address.kind.contract': 'قرارداد',
    'address.kind.token': 'توکن',
    'address.activity': 'فعالیت',
    'address.balance': 'موجودی',
    'address.received': 'دریافتی',
    'address.sent': 'ارسالی',
    'address.fees': 'کارمزد پرداختی',
    'address.tab.transactions': 'تراکنش‌ها',
    'address.tab.transfers': 'انتقال‌های توکن',
    'address.transfers.empty.title': 'انتقال توکنی وجود ندارد',
    'address.transfers.empty.hint': 'جابه‌جایی‌های ERC-20، 721 و 1155 این آدرس اینجا نمایش داده می‌شوند.',
    'address.transfers.token': 'توکن',

    // --- Flow ledger --------------------------------------------------------------------------
    'flow.title': 'جریان',
    'flow.in': 'ورودی',
    'flow.out': 'خروجی',
    'flow.empty': 'هنوز تراکنشی اینجا نیست. وقتی این آدرس ارسال یا دریافت کند، جابه‌جایی اینجا ظاهر می‌شود.',
    'flow.legend': 'میله‌ها نسبت به بزرگ‌ترین جابه‌جایی نمایش‌داده‌شده رسم شده‌اند. مقادیر به {symbol}.',
    'flow.call': 'فراخوانی',
    'flow.contractCreated': 'قرارداد ایجاد شد',

    // --- Cadence ------------------------------------------------------------------------------
    'cadence.title': 'ضرب‌آهنگ',
    'cadence.caption': '{count} بلاک اخیر - ارتفاع یعنی گس مصرف‌شده',
    'cadence.chart': 'گس مصرف‌شده در {count} بلاک اخیر',
    'cadence.bar': 'بلاک {number}، {count} تراکنش',
    'cadence.now': 'اکنون',

    // --- Shared chain wording -----------------------------------------------------------------
    'chain.contractCreation': 'ایجاد قرارداد',
    'chain.to': 'به {address}',
    'chain.txCount': '{count} تراکنش',
    'chain.gasShare': '{percent}٪ گس',
    'chain.notAvailable': 'ندارد',
    'chain.status.success': 'موفق',
    'chain.status.reverted': 'برگشت‌خورده',
    'chain.status.unknown': 'نامشخص',

    // --- Copy / wallet ------------------------------------------------------------------------
    'copy.action': 'کپی {value}',
    'copy.done': 'در حافظه کپی شد',
    'copy.blocked': 'مرورگر شما دسترسی به حافظه را مسدود کرد',

    'wallet.add': 'افزودن {chain}',
    'wallet.missing': 'کیف پولی پیدا نشد - متامسک را نصب کنید و دوباره تلاش کنید',
    'wallet.added': '{chain} به کیف پول شما افزوده شد',
    'wallet.dismissed': 'درخواست رد شد',
    'wallet.refused': 'کیف پول شما از افزودن شبکه خودداری کرد',

    // --- Pagination ---------------------------------------------------------------------------
    'pagination.label': 'صفحه‌بندی',
    'pagination.first': 'صفحهٔ نخست',
    'pagination.newer': 'جدیدتر',
    'pagination.older': 'قدیمی‌تر',
    'pagination.last': 'صفحهٔ آخر',
    'pagination.page': 'صفحهٔ {number}',

    // --- Toasts -------------------------------------------------------------------------------
    'toast.dismiss': 'بستن',

    // --- Error and not-found ------------------------------------------------------------------
    'error.title': 'این صفحه از کار افتاد',
    'error.hint': 'هنگام رسم صفحه خطایی رخ داد. زنجیره و نمایه آسیبی ندیده‌اند - معمولاً تلاش دوباره آن را برطرف می‌کند.',
    'error.retry': 'تلاش دوباره',
    'error.home': 'بازگشت به نمای کلی',

    'notFound.title': 'پیدا نشد',
    'notFound.heading': 'چیزی در این نشانی نیست',
    'notFound.hint': 'این صفحه وجود ندارد. اگر دنبال یک بلاک، تراکنش یا حساب بودید، مقدار را در کادر زیر بررسی کنید - یا اگر نمایه‌ساز هنوز به آن نرسیده، کمی بعد دوباره تلاش کنید.',

    // --- Footer -------------------------------------------------------------------------------
    'footer.tagline': 'یک کاوشگر بلاک آزاد. هر بلاک، تراکنش و انتقال به‌صورت محلی نمایه می‌شود تا بتوانید مسیر ارزش را در زنجیره دنبال کنید.',
    'footer.explore': 'کاوش',
    'footer.community': 'انجمن',
    'footer.note': 'خواندن‌ها از یک نمایهٔ محلی زنجیره انجام می‌شود. موجودی‌ها زنده از نود خوانده می‌شوند.',
    'footer.builtWith': 'ساخته‌شده با',

    // --- Time and units -----------------------------------------------------------------------
    // Persian does not inflect a noun after a number, so both forms are the same string. They stay
    // as separate keys because the shared `timeAgo` picks one by count.
    'time.justNow': 'همین حالا',
    'time.second': '{count} ثانیه پیش',
    'time.seconds': '{count} ثانیه پیش',
    'time.minute': '{count} دقیقه پیش',
    'time.minutes': '{count} دقیقه پیش',
    'time.hour': '{count} ساعت پیش',
    'time.hours': '{count} ساعت پیش',
    'time.day': '{count} روز پیش',
    'time.days': '{count} روز پیش',

    'unit.bytes': '{count} بایت',
    'unit.kilobytes': '{count} کیلوبایت',
    'unit.gwei': '{amount} gwei',

    // --- Page titles --------------------------------------------------------------------------
    'title.chainExplorer': 'کاوشگر {chain}',
    'title.chainFallback': 'زنجیره'
};
