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
    'address.tab.contract': 'قرارداد',
    'address.transfers.empty.title': 'انتقال توکنی وجود ندارد',
    'address.transfers.empty.hint': 'جابه‌جایی‌های ERC-20، 721 و 1155 این آدرس اینجا نمایش داده می‌شوند.',
    'address.transfers.token': 'توکن',

    // --- قرارداد -----------------------------------------
    'contract.notice': 'کد منبع این قرارداد منتشر نشده است. هرچه در ادامه می‌آید از روی بایت‌کد مستقر روی زنجیره خوانده شده است.',
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
    'contract.mutability.unknown': 'نامشخص',

    'contract.read': 'خواندن',
    'contract.read.hint': 'پاسخ از همین کاوشگر. بدون کیف پول، بدون کارمزد.',
    'contract.write': 'نوشتن',
    'contract.write.hint': 'این‌ها از کیف پول خودتان و روی همین شبکه تراکنش می‌فرستند. کیف پول پیش از امضا می‌پرسد و کارمزد را شما می‌پردازید.',
    'contract.unnamedGroup': 'شناسه‌های بی‌نام',
    'contract.call.query': 'پرس‌وجو',
    'contract.call.write': 'نوشتن',
    'contract.call.value': 'مقدار ارسالی ({symbol})',
    'contract.call.badAmount': 'این مقدار برای ارسال روی این زنجیره معتبر نیست.',
    'contract.call.sent': 'تراکنش فرستاده شد',
    'contract.call.noReturn': 'این فراخوانی چیزی برنگرداند.',

    // --- Verified source ----------------------------------------------------------------------
    'contract.verified.full': 'کد منبع تأییدشده',
    'contract.verified.partial': 'کد منبع تأییدشده - تطبیق جزئی',
    'contract.verified.detail': '{name}، کامپایل‌شده با solc {compiler}',
    'contract.verified.partial.hint': 'کد مستقرشده مطابقت دارد؛ تنها دنباله فراداده تفاوت دارد، و جابه‌جایی یک توضیح یا مسیر فایلی دیگر برای این تفاوت کافی است. دستورها اثبات شده‌اند، توضیح‌های پیرامونشان نه.',
    'contract.verified.viaImplementation': 'کد منبع منتشرشده به پیاده‌سازی‌ای تعلق دارد که این نشانی به آن ارجاع می‌دهد.',
    'contract.source': 'کد منبع',
    'contract.source.optimized': 'بهینه‌ساز روشن، {runs} اجرا',
    'contract.source.unoptimized': 'بهینه‌ساز خاموش',
    'contract.source.copyAbi': 'رونوشت ABI',

    // --- Publishing source --------------------------------------------------------------------
    'verify.cta': 'انتشار کد منبع',
    'verify.title': 'تأیید {short}',
    'verify.heading': 'انتشار و تأیید کد منبع',
    'verify.intro': 'هیچ‌چیز اینجا بر پایه اعتماد پذیرفته نمی‌شود. این کاوشگر آنچه می‌فرستید را کامپایل می‌کند و تنها وقتی می‌پذیرد که نتیجه، همان بایت‌کد مستقرشده روی این نشانی باشد - پس نه حسابی باید ساخت و نه منتظر کسی ماند.',
    'verify.offline': 'فهرست کامپایلرها دریافت نشد، پس تنها بیلدهای موجود روی این سرور به کار می‌آیند. از گرداننده بخواهید نسخه مورد نیازتان را بیفزاید.',
    'verify.kind': 'قالب ارسال',
    'verify.kind.single': 'تک‌فایل',
    'verify.kind.json': 'JSON استاندارد',
    'verify.compiler': 'بیلد کامپایلر',
    'verify.compiler.hint': 'دقیقاً همان بیلد، نه فقط نسخه - خروجی solc میان نسخه‌های اصلاحی تغییر می‌کند. نقطه، بیلدهای موجود روی این سرور را نشان می‌دهد.',
    'verify.evmVersion': 'نسخه EVM',
    'verify.evmVersion.default': 'پیش‌فرض کامپایلر',
    'verify.evmVersion.hint': 'جز وقتی قرارداد با مقدار مشخصی ساخته شده، روی پیش‌فرض بگذارید. نام‌بردن نسخه نادرست، کدهای عملیاتی را عوض می‌کند.',
    'verify.name': 'نام قرارداد',
    'verify.name.hint': 'اختیاری. اگر خالی بماند، همه قراردادهای موجود در منبع آزموده می‌شوند.',
    'verify.fileName': 'نام فایل',
    'verify.fileName.hint': 'مسیری که فایل با آن کامپایل شده است. این مسیر در فراداده درهم‌سازی می‌شود، پس مسیر نادرست تطبیق کامل را به جزئی بدل می‌کند.',
    'verify.optimizer': 'بهینه‌ساز',
    'verify.optimizer.enabled': 'فعال',
    'verify.optimizer.hint': 'این‌ها باید با تنظیمات زمان استقرار یکی باشند، وگرنه بایت‌کد یکی نخواهد بود.',
    'verify.runs': 'اجراهای بهینه‌ساز',
    'verify.license': 'پروانه',
    'verify.source': 'کد منبع سالیدیتی',
    'verify.source.placeholder': 'کل قرارداد را همراه با ایمپورت‌ها بچسبانید.',
    'verify.json': 'ورودی JSON استاندارد',
    'verify.json.placeholder': 'ورودی standard-json که فرآیند ساخت شما تولید کرده است را بچسبانید.',
    'verify.json.hint': 'تنظیماتش دقیقاً همان‌طور که نوشته شده به کار می‌رود - شامل remapping‌ها، نشانی کتابخانه‌ها و viaIR. تنها فهرست خروجی گسترده‌تر می‌شود.',
    'verify.submit': 'تأیید و انتشار',
    'verify.submit.hint': 'کامپایل چند ثانیه طول می‌کشد و هر بار یک ارسال اجرا می‌شود.',
    'verify.failed.hint': 'ناهمخوانی تقریباً همیشه به بیلد کامپایلر، تنظیم بهینه‌ساز یا شمار اجراها برمی‌گردد. هرکدام را با تنظیمات زمان استقرار بسنجید.',
    'verify.done.detail': 'کد منبع {name} اکنون روی این قرارداد منتشر شده است و توابعش نام دارند و قابل فراخوانی‌اند.',
    'verify.done.open': 'گشودن قرارداد',

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
    'wallet.mismatch': 'کیف پول شما این شبکه را با نماد ارز دیگری ذخیره کرده است. آن را از کیف پول حذف کنید و دوباره تلاش کنید.',
    'wallet.connect': 'اتصال کیف پول',
    'wallet.switch': 'تغییر به {chain}',
    'wallet.switchFailed': 'کیف پول شما به {chain} تغییر نکرد. اول شبکه را اضافه کنید، بعد دوباره تلاش کنید.',

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
    'footer.community': 'شبکه‌های اجتماعی',
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
