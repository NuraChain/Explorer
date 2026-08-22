import type { Dictionary } from './en.ts';

// Persian (fa-IR). Typed against the English dictionary, so a key added there and forgotten here
// is a build error rather than an English string leaking into a Persian page.
//
// Untranslated on purpose: `gwei`, ERC standard numbers, token symbols, addresses and hashes.
// Those arrive as data and are shown as they are.
//
// The chain NAME is the exception, and it is not here either: it comes from the deployment's
// configuration, so `chainName` in ../stores/locale.store.ts localizes it by lookup - «زنجیره نورا»
// for Nura Chain, and anything else printed exactly as configured.
export const fa: Dictionary = {
    // --- Brand --------------------------------------------------------------------------------
    // «کاوشگر نورا». Persian puts the common noun first, so the accented word LEADS: `lead` is
    // empty and the proper noun moves to `trail`. Reversing the slots rather than the markup is
    // what lets the header and the footer keep one wordmark for both languages.
    'brand.name': 'کاوشگر نورا',
    'brand.lead': '',
    'brand.accent': 'کاوشگر',
    'brand.trail': 'نورا',

    // --- Chrome -------------------------------------------------------------------------------
    'nav.sections': 'بخش‌ها',
    'nav.home': 'خانه',
    'nav.blocks': 'بلاک‌ها',
    'nav.transactions': 'تراکنش‌ها',
    'nav.accounts': 'حساب‌ها',
    'nav.charts': 'نمودارها',
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
    'home.hero.accent': 'تراکنش ها',
    'home.hero.through': 'را در',
    'home.hero.fallback': 'زنجیره',
    'home.hero.trail': 'دنبال کنید',
    'home.tagline': 'هر بلاک، تراکنش و انتقال بصورت شفاف نمایش داده می‌شود.',
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
    'blocks.empty.filtered.title': 'هیچ بلاکی تراکنشی نداشت',
    'blocks.empty.filtered.hint': 'همهٔ بلاک‌های نمایه خالی‌اند. برای دیدنشان فیلتر را بردارید.',
    'blocks.total': '{count} بلاک نمایه شده است.',
    'blocks.total.filtered': 'بلاک‌های دارای تراکنش: {count}.',
    'blocks.gasTooltip': '{used} از {limit} گس مصرف شده',

    // --- Transactions list --------------------------------------------------------------------
    'txs.title': 'تراکنش‌ها',
    'txs.empty.title': 'هنوز تراکنشی نمایه نشده است',
    'txs.empty.hint': 'هر تراکنشی که زنجیره استخراج کند اینجا می‌آید.',
    'txs.empty.filtered.title': 'تراکنشی هم‌خوان نیست',
    'txs.empty.filtered.hint': 'هیچ چیزی در نمایه این وضعیت را ندارد. برای دیدن بقیه، فیلتر را بردارید.',
    'txs.total': '{count} تراکنش نمایه شده است.',
    'txs.total.filtered': 'تراکنش‌های هم‌خوان: {count}.',

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
    'tx.transfers': '{count} انتقال توکن',
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
    'address.tab.contract': 'قرارداد',
    'address.transfers.empty.title': 'انتقال توکنی وجود ندارد',
    'address.transfers.empty.hint': 'جابه‌جایی‌های ERC-20، 721 و 1155 این آدرس اینجا نمایش داده می‌شوند.',
    'address.transfers.token': 'توکن',

    // --- حساب‌ها (فهرست برتر) ---------------------------------
    'accounts.title': 'حساب‌های برتر',
    'accounts.hint': 'رتبه‌بندی بر اساس موجودی بومی، که زنده از نود برای هر نشانی که کاوشگر دیده خوانده می‌شود.',
    'accounts.empty.title': 'هنوز حسابی نمایه نشده است',
    'accounts.empty.hint': 'وقتی زنجیره نخستین تراکنشش را ببیند، حساب‌ها اینجا ظاهر می‌شوند.',
    'accounts.search.label': 'جست‌وجوی رتبه‌بندی بر پایهٔ نشانی',
    'accounts.search.placeholder': 'نشانی',
    'accounts.search.empty.title': 'حسابی هم‌خوان نیست',
    'accounts.search.empty.hint': 'هیچ نشانی رتبه‌بندی‌شده‌ای این را ندارد. تنها نشانی‌هایی اینجا می‌آیند که کاوشگر آن‌ها را با موجودی دیده باشد.',
    'accounts.total': '{count} حساب رتبه‌بندی شده است.',
    'accounts.total.filtered': 'حساب‌های هم‌خوان: {count}.',

    // --- قرارداد -----------------------------------------
    'contract.compiler': 'کامپایلر',
    'contract.size': 'اندازه کد',
    'contract.deployer': 'مستقرکننده',
    'contract.deployedAt': 'استقرار در',
    'contract.metadata': 'فراداده منبع',
    'contract.standards': 'رابط‌ها',
    'contract.proxy': 'پروکسی',
    'contract.viaImplementation': 'این‌ها توابع پیاده‌سازی‌ای است که این نشانی به آن ارجاع می‌دهد، نه کد خودش.',
    'contract.reads': 'مقادیر کنونی',
    'contract.functions': 'توابع',
    'contract.functions.named': '{named} از {total} نام‌گذاری‌شده',
    'contract.functions.empty.title': 'نقطه ورودی‌ای پیدا نشد',
    'contract.functions.empty.hint': 'در این بایت‌کد چیزی با شناسه تابع مقایسه نمی‌شود. ممکن است پروکسی، کلون یا اسمبلی دست‌نویس باشد.',
    'contract.events': 'رویدادها',
    'contract.bytecode': 'بایت‌کد',
    'contract.bytecode.show': 'نمایش',
    'contract.bytecode.hide': 'پنهان',
    'contract.unnamed': 'تابع بی‌نام',
    'contract.mutability.view': 'خواندن',
    'contract.mutability.pure': 'خالص',
    'contract.mutability.nonpayable': 'نوشتن',
    'contract.mutability.payable': 'قابل پرداخت',
    'contract.mutability.library': 'کتابخانه',
    'contract.mutability.unknown': 'نامشخص',

    'contract.read': 'خواندن',
    'contract.read.hint': 'پاسخ از همین کاوشگر. بدون کیف پول، بدون کارمزد.',
    'contract.write': 'نوشتن',
    'contract.write.hint': 'این‌ها از کیف پول خودتان و روی همین شبکه تراکنش می‌فرستند. کیف پول پیش از امضا می‌پرسد و کارمزد را شما می‌پردازید.',
    'contract.unnamedGroup': 'شناسه‌های بی‌نام',
    'contract.libraryGroup': 'توابع کتابخانه',
    'contract.library.hint': 'با delegatecall از قراردادی که آن‌ها را پیوند داده اجرا می‌شوند، پس اینجا قابل فراخوانی نیستند.',
    'contract.call.query': 'پرس‌وجو',
    'contract.call.write': 'نوشتن',
    'contract.call.value': 'مقدار ارسالی ({symbol})',
    'contract.call.badAmount': 'این مقدار برای ارسال روی این زنجیره معتبر نیست.',
    'contract.call.sent': 'تراکنش فرستاده شد',
    'contract.call.noReturn': 'این فراخوانی چیزی برنگرداند.',

    // --- Flow ledger --------------------------------------------------------------------------
    'flow.title': 'جریان',
    'flow.in': 'ورودی',
    'flow.out': 'خروجی',
    'flow.empty': 'هنوز تراکنشی اینجا نیست. وقتی این آدرس ارسال یا دریافت کند، جابه‌جایی اینجا ظاهر می‌شود.',
    'flow.empty.filtered': 'چیزی از این سو جابه‌جا نشده است. برای دیدن بقیهٔ دفتر، فیلتر را بردارید.',
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
    'wallet.get': 'دریافت',
    'wallet.detected': 'شناسایی شد',
    'wallet.connected': 'متصل',
    'wallet.added': '{chain} به کیف پول شما افزوده شد',
    'wallet.dismissed': 'درخواست رد شد',
    'wallet.refused': 'کیف پول شما از افزودن شبکه خودداری کرد',
    'wallet.mismatch': 'کیف پول شما این شبکه را با نماد ارز دیگری ذخیره کرده است. آن را از کیف پول حذف کنید و دوباره تلاش کنید.',
    'wallet.connect': 'اتصال کیف پول',
    'wallet.switch': 'تغییر به {chain}',
    'wallet.switchFailed': 'کیف پول شما به {chain} تغییر نکرد. اول شبکه را اضافه کنید، بعد دوباره تلاش کنید.',

    // --- Charts -------------------------------------------------------------------------------
    'charts.title': 'نمودارها و آمار',
    'charts.hint': 'هر چه پایین‌تر می‌بینید از نمایهٔ خودِ این کاوشگر شمرده شده و همراه با خواندن زنجیره تازه می‌شود.',
    'charts.range': 'بازه',
    'charts.range.days': '{count} روز گذشته',
    'charts.section.totals': 'مجموع‌ها',
    'charts.section.day': '۲۴ ساعت گذشته',
    'charts.section.blockchain': 'داده‌های زنجیره',
    'charts.section.network': 'داده‌های شبکه',
    'charts.section.contracts': 'توکن‌ها و قراردادها',
    'charts.change.total': 'افزودهٔ ۲۴ ساعت گذشته',
    'charts.change.day': 'در برابر ۲۴ ساعت پیش از آن',
    'charts.chart.latest': 'آخرین',
    'charts.chart.peak': 'اوج',
    'charts.chart.empty': 'هنوز روزی در این بازه نمایه نشده است.',
    'charts.chart.summary': '{title} در {count} روز. اوج {peak}، آخرین {latest}.',
    'charts.footnote': 'هر عدد اینجا از نمایهٔ خودِ این کاوشگر شمرده شده است. این کاوشگر نه خوراک قیمت دارد، نه اشتراک استخر تراکنش و نه سرویس تأیید قرارداد؛ پس نمودار بازار، شمار تراکنش‌های در انتظار و شمار قراردادهای تأییدشده اینجا نیست - نمودارِ عددی که کسی نسنجیده، از نبودش بدتر است.',
    'charts.metric.blocks': 'بلاک‌ها',
    'charts.metric.transactions': 'تراکنش‌ها',
    'charts.metric.transfers': 'انتقال‌های توکن',
    'charts.metric.addresses': 'نشانی‌ها',
    'charts.metric.activeAddresses': 'نشانی‌های فعال',
    'charts.metric.newAddresses': 'نشانی‌های نو',
    'charts.metric.tokens': 'توکن‌ها',
    'charts.metric.contracts': 'قراردادهای مستقرشده',
    'charts.metric.fees': 'کارمزد تراکنش‌ها',
    'charts.metric.averageFee': 'میانگین کارمزد تراکنش',
    'charts.metric.gasUsed': 'گس مصرف‌شده',
    'charts.metric.gasPrice': 'میانگین قیمت گس',
    'charts.metric.utilization': 'بهره‌وری شبکه',
    'charts.metric.blockTime': 'میانگین زمان بلاک',
    'charts.metric.blockSize': 'میانگین اندازهٔ بلاک',

    // --- Filters ------------------------------------------------------------------------------
    'filter.all': 'همه',
    'filter.status': 'وضعیت',
    'filter.status.success': 'موفق',
    'filter.status.reverted': 'برگشت‌خورده',
    'filter.content': 'محتوای بلاک',
    'filter.content.filled': 'دارای تراکنش',
    'filter.direction': 'جهت',
    'filter.direction.in': 'دریافتی',
    'filter.direction.out': 'ارسالی',
    // --- Pagination ---------------------------------------------------------------------------
    'pagination.label': 'صفحه‌بندی',
    'pagination.first': 'صفحهٔ نخست',
    'pagination.newer': 'جدیدتر',
    'pagination.older': 'قدیمی‌تر',
    'pagination.last': 'صفحهٔ آخر',
    'pagination.page': 'صفحهٔ {number}',

    // --- Advertising --------------------------------------------------------------------------
    'ad.label': 'تبلیغ',

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
    'footer.community': 'شبکه‌های اجتماعی',
    'footer.note': 'خواندن‌ها از یک نمایهٔ محلی زنجیره انجام می‌شود. موجودی‌ها زنده از نود خوانده می‌شوند.',
    'footer.builtWith': 'ساخته‌شده با',
    'footer.version': 'نسخه',

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
    'unit.seconds': '{count} ثانیه',
    'unit.percent': '{count}٪',

    // --- Page titles --------------------------------------------------------------------------
    'title.chainExplorer': 'کاوشگر {chain}',
    'title.chainFallback': 'زنجیره'
};
