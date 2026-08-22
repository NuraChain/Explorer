import type { Dictionary } from './en.ts';

// Arabic (ar-EG). Right-to-left, like Persian, and set in the same shipped Vazirmatn face - the
// Arabic script it was drawn for covers both languages, see `html:lang(ar)` in ../styles/base.css.
//
// Untranslated on purpose: `gwei`, ERC standard numbers, token symbols, addresses and hashes.
// Arabic needs more plural forms than the catalog's two (a dual, and a 3-10 form); with the
// numeral always printed beside the noun, the singular for one and the broken plural for the
// rest is the reading Arabic interfaces settle on.
export const ar: Dictionary = {
    // --- Brand --------------------------------------------------------------------------------
    // «مستكشف نورا». Like Persian, the common noun leads and carries the accent, and the proper
    // noun moves to `trail` - the same slot reversal, for the same word order.
    'brand.name': 'مستكشف نورا',
    'brand.lead': '',
    'brand.accent': 'مستكشف',
    'brand.trail': 'نورا',

    // --- Chrome -------------------------------------------------------------------------------
    'nav.sections': 'الأقسام',
    'nav.home': 'الرئيسية',
    'nav.blocks': 'الكتل',
    'nav.transactions': 'المعاملات',
    'nav.accounts': 'الحسابات',
    'nav.charts': 'الرسوم البيانية',
    'nav.overview': 'نظرة عامة',
    'nav.menu': 'القائمة',
    'nav.open': 'فتح القائمة',
    'nav.close': 'إغلاق القائمة',
    'nav.elsewhere': 'روابط أخرى',

    'theme.label': 'المظهر',
    'theme.dark': 'داكن',
    'theme.light': 'فاتح',

    'language.label': 'اللغة',

    // --- Search -------------------------------------------------------------------------------
    'search.label': 'البحث بالعنوان أو هاش المعاملة أو رقم الكتلة',
    'search.placeholder': 'عنوان أو هاش معاملة أو رقم كتلة',
    'search.placeholder.compact': 'بحث',
    'search.go': 'اذهب',
    'search.missing': 'لا شيء مفهرس بهذه القيمة. تحقق منها، أو انتظر قليلاً إذا كانت الكتلة حديثة جداً.',
    'search.failed': 'فشل البحث - تعذر على المستكشف الوصول إلى فهرسه.',

    // --- Home ---------------------------------------------------------------------------------
    'home.hero.lead': 'تتبّع',
    'home.hero.accent': 'الضوء',
    'home.hero.through': 'عبر',
    'home.hero.fallback': 'السلسلة',
    'home.hero.trail': '',
    'home.tagline': 'كل كتلة ومعاملة وتحويل، مفهرسة لترى بالضبط أين انتقلت القيمة.',
    'home.behind': 'جارٍ الفهرسة - متأخر {count} كتلة عن العقدة.',
    'home.stat.height': 'الارتفاع',
    'home.stat.transactions': 'المعاملات',
    'home.stat.blockTime': 'زمن الكتلة',
    'home.stat.baseFee': 'الرسوم الأساسية',
    'home.latestBlocks': 'أحدث الكتل',
    'home.latestTransactions': 'أحدث المعاملات',
    'home.all': 'الكل',
    'home.empty.blocks': 'في انتظار الكتلة الأولى',
    'home.empty.transactions': 'لا معاملات بعد',

    // --- Blocks list --------------------------------------------------------------------------
    'blocks.title': 'الكتل',
    'blocks.empty.title': 'لا كتل مفهرسة بعد',
    'blocks.empty.hint': 'تظهر الكتل هنا فور قراءتها من السلسلة.',
    'blocks.empty.filtered.title': 'لا كتلة حملت شيئًا',
    'blocks.empty.filtered.hint': 'كل كتلة في الفهرس فارغة. أزِل المرشّح لرؤيتها.',
    'blocks.total': '{count} كتلة مفهرسة.',
    'blocks.total.filtered': 'الكتل ذات المعاملات: {count}.',
    'blocks.gasTooltip': 'استُهلك {used} من {limit} غاز',

    // --- Transactions list --------------------------------------------------------------------
    'txs.title': 'المعاملات',
    'txs.empty.title': 'لا معاملات مفهرسة بعد',
    'txs.empty.hint': 'كل معاملة تعدّنها السلسلة تصل إلى هنا.',
    'txs.empty.filtered.title': 'لا معاملات مطابقة',
    'txs.empty.filtered.hint': 'لا شيء في الفهرس يحمل هذه الحالة. أزِل المرشّح لرؤية الباقي.',
    'txs.total': '{count} معاملة مفهرسة.',
    'txs.total.filtered': 'المعاملات المطابقة: {count}.',

    // --- Block detail -------------------------------------------------------------------------
    'block.title': 'الكتلة #{number}',
    'block.missing.title': 'الكتلة ليست في الفهرس',
    'block.missing.hint': 'قد تكون أحدث مما وصل إليه المفهرس، أو قبل كتلة البداية.',
    'block.previous': 'الكتلة السابقة',
    'block.next': 'الكتلة التالية',
    'block.hash': 'الهاش',
    'block.parent': 'الأصل',
    'block.validator': 'المدقّق',
    'block.size': 'الحجم',
    'block.gasUsed': 'الغاز المستهلك',
    'block.gasOf': 'من {limit}',
    'block.baseFee': 'الرسوم الأساسية',
    'block.transactions': '{count} معاملة',
    'block.empty.title': 'هذه الكتلة فارغة',
    'block.empty.hint': 'لم تُضمَّن فيها أي معاملة.',

    // --- Transaction detail -------------------------------------------------------------------
    'tx.title': 'المعاملة',
    'tx.missing.title': 'المعاملة ليست في الفهرس',
    'tx.missing.hint': 'قد تكون ما تزال معلّقة، أو أحدث مما وصل إليه المفهرس.',
    'tx.reverted.notice': 'ارتدت هذه المعاملة. لم تنتقل أي قيمة، لكن المرسل دفع الغاز أدناه رغم ذلك.',
    'tx.hash': 'الهاش',
    'tx.block': 'الكتلة',
    'tx.position': 'الموضع {index}',
    'tx.from': 'من',
    'tx.to': 'إلى',
    'tx.value': 'القيمة',
    'tx.fee': 'الرسوم',
    'tx.feeDetail': '{gas} غاز بسعر {price}',
    'tx.nonce': 'نونس',
    'tx.calldata': 'بيانات الاستدعاء {size}',
    'tx.created': 'أُنشئ',
    'tx.transfers': '{count} تحويل توكن',
    'tx.token': 'توكن',

    // --- Address ------------------------------------------------------------------------------
    'address.title': 'العنوان {short}',
    'address.kind.address': 'عنوان',
    'address.kind.contract': 'عقد',
    'address.kind.token': 'توكن',
    'address.activity': 'النشاط',
    'address.balance': 'الرصيد',
    'address.received': 'الوارد',
    'address.sent': 'الصادر',
    'address.fees': 'الرسوم المدفوعة',
    'address.tab.transactions': 'المعاملات',
    'address.tab.transfers': 'تحويلات التوكن',
    'address.tab.contract': 'العقد',
    'address.transfers.empty.title': 'لا تحويلات توكن',
    'address.transfers.empty.hint': 'تظهر هنا حركات ERC-20 و721 و1155 لهذا العنوان.',
    'address.transfers.token': 'التوكن',

    // --- الحسابات (قائمة الأغنياء) --------------------------
    'accounts.title': 'أعلى الحسابات',
    'accounts.hint': 'مرتّبة حسب الرصيد الأصلي، يُقرأ مباشرة من العقدة لكل عنوان رآه المستكشف.',
    'accounts.empty.title': 'لا حسابات مفهرسة بعد',
    'accounts.empty.hint': 'تظهر الحسابات هنا بعد أول معاملة على السلسلة.',
    'accounts.search.label': 'ابحث في الترتيب بالعنوان',
    'accounts.search.placeholder': 'العنوان',
    'accounts.search.empty.title': 'لا حساب مطابق',
    'accounts.search.empty.hint': 'لا عنوان مرتّب يحتوي على ذلك. تظهر هنا العناوين التي رآها المستكشف تحمل رصيدًا فقط.',
    'accounts.total': '{count} حساب مرتّب.',
    'accounts.total.filtered': 'الحسابات المطابقة: {count}.',

    // --- العقد -----------------------------------------
    'contract.compiler': 'المُصرِّف',
    'contract.size': 'حجم الكود',
    'contract.deployer': 'الناشر',
    'contract.deployedAt': 'نُشر في',
    'contract.metadata': 'بيانات المصدر',
    'contract.standards': 'الواجهات',
    'contract.proxy': 'وكيل',
    'contract.viaImplementation': 'هذه دوال التنفيذ الذي يحيل إليه هذا العنوان، لا دوال كوده الخاص.',
    'contract.reads': 'القيم الحالية',
    'contract.functions': 'الدوال',
    'contract.functions.named': '{named} من {total} مُسمّاة',
    'contract.functions.empty.title': 'لم يُعثر على نقاط دخول',
    'contract.functions.empty.hint': 'لا شيء في هذا البايت كود يُقارن بمُعرِّف دالة. قد يكون وكيلاً أو نسخة أو أسمبلي مكتوبًا يدويًا.',
    'contract.events': 'الأحداث',
    'contract.bytecode': 'البايت كود',
    'contract.bytecode.show': 'إظهار',
    'contract.bytecode.hide': 'إخفاء',
    'contract.unnamed': 'دالة بلا اسم',
    'contract.mutability.view': 'قراءة',
    'contract.mutability.pure': 'خالصة',
    'contract.mutability.nonpayable': 'كتابة',
    'contract.mutability.payable': 'قابلة للدفع',
    'contract.mutability.library': 'مكتبة',
    'contract.mutability.unknown': 'غير معروف',

    'contract.read': 'قراءة',
    'contract.read.hint': 'يجيب عنها هذا المستكشف. بلا محفظة وبلا رسوم.',
    'contract.write': 'كتابة',
    'contract.write.hint': 'هذه ترسل معاملة من محفظتك أنت، على هذه الشبكة. محفظتك تسأل قبل أي توقيع، وأنت من يدفع الغاز.',
    'contract.unnamedGroup': 'مُعرِّفات بلا اسم',
    'contract.libraryGroup': 'دوال المكتبة',
    'contract.library.hint': 'تُنفَّذ عبر delegatecall من العقد الذي ربطها، لذا لا يمكن استدعاؤها هنا.',
    'contract.call.query': 'استعلام',
    'contract.call.write': 'كتابة',
    'contract.call.value': 'القيمة المُرسَلة ({symbol})',
    'contract.call.badAmount': 'هذا ليس مبلغًا يمكن إرساله على هذه السلسلة.',
    'contract.call.sent': 'أُرسلت المعاملة',
    'contract.call.noReturn': 'لم يُرجع هذا النداء شيئًا.',

    // --- Flow ledger --------------------------------------------------------------------------
    'flow.title': 'التدفق',
    'flow.in': 'وارد',
    'flow.out': 'صادر',
    'flow.empty': 'لا معاملات هنا بعد. عندما يرسل هذا العنوان أو يستقبل، تظهر الحركة هنا.',
    'flow.empty.filtered': 'لم يتحرك شيء في هذا الاتجاه. أزِل المرشّح لرؤية بقية السجل.',
    'flow.legend': 'الأعمدة نسبية إلى أكبر حركة معروضة. المقادير بـ{symbol}.',
    'flow.call': 'استدعاء',
    'flow.contractCreated': 'أُنشئ عقد',

    // --- Cadence ------------------------------------------------------------------------------
    'cadence.title': 'الإيقاع',
    'cadence.caption': 'آخر {count} كتلة - الارتفاع هو الغاز المستهلك',
    'cadence.chart': 'الغاز المستهلك عبر آخر {count} كتلة',
    'cadence.bar': 'الكتلة {number}، {count} معاملة',
    'cadence.now': 'الآن',

    // --- Price --------------------------------------------------------------------------------
    'price.source': 'السعر من {host}، {ago}',

    // --- Shared chain wording -----------------------------------------------------------------
    'chain.contractCreation': 'إنشاء عقد',
    'chain.to': 'إلى {address}',
    'chain.txCount': '{count} معاملة',
    'chain.gasShare': '{percent}٪ غاز',
    'chain.notAvailable': 'غير متاح',
    'chain.status.success': 'ناجحة',
    'chain.status.reverted': 'مرتدة',
    'chain.status.unknown': 'غير معروفة',

    // --- Copy / wallet ------------------------------------------------------------------------
    'copy.action': 'نسخ {value}',
    'copy.done': 'نُسخ إلى الحافظة',
    'copy.blocked': 'منع متصفحك الوصول إلى الحافظة',

    'wallet.add': 'إضافة {chain}',
    'wallet.get': 'احصل عليها',
    'wallet.detected': 'تم العثور عليها',
    'wallet.connected': 'متصلة',
    'wallet.added': 'أُضيفت {chain} إلى محفظتك',
    'wallet.dismissed': 'رُفض الطلب',
    'wallet.refused': 'رفضت محفظتك إضافة الشبكة',
    'wallet.mismatch': 'محفظتك تحفظ هذه الشبكة برمز عملة مختلف. احذفها من هناك ثم حاول مجدداً.',
    'wallet.connect': 'وصل المحفظة',
    'wallet.switch': 'التبديل إلى {chain}',
    'wallet.switchFailed': 'لم تنتقل محفظتك إلى {chain}. أضف الشبكة أولًا ثم أعد المحاولة.',

    // --- Charts -------------------------------------------------------------------------------
    'charts.title': 'الرسوم البيانية والإحصاءات',
    'charts.hint': 'كل رقم في الأسفل محسوب من فهرس هذا المستكشف نفسه، ويتجدّد كلما قرأ المفهرس السلسلة.',
    'charts.range': 'المدى',
    'charts.range.days': 'آخر {count} يوم',
    'charts.section.totals': 'الإجماليات',
    'charts.section.day': 'آخر ٢٤ ساعة',
    'charts.section.blockchain': 'بيانات السلسلة',
    'charts.section.network': 'بيانات الشبكة',
    'charts.section.contracts': 'التوكنات والعقود',
    'charts.change.total': 'المضاف في آخر ٢٤ ساعة',
    'charts.change.day': 'مقابل الـ٢٤ ساعة التي سبقتها',
    'charts.chart.latest': 'الأحدث',
    'charts.chart.peak': 'الذروة',
    'charts.chart.empty': 'لا أيام مفهرسة في هذا المدى بعد.',
    'charts.chart.summary': '{title} على مدى {count} يوم. الذروة {peak}، والأحدث {latest}.',
    'charts.footnote': 'كل رقم هنا محسوب من فهرس هذا المستكشف نفسه. لا تغذية أسعار لديه ولا اشتراك في مجمّع المعاملات ولا خدمة توثيق، فلا رسم للسوق ولا عدّ للمعاملات المعلّقة ولا رقم للعقود الموثّقة - ورسمٌ لرقم لم يقسه أحد أسوأ من غيابه.',
    'charts.metric.blocks': 'الكتل',
    'charts.metric.transactions': 'المعاملات',
    'charts.metric.transfers': 'تحويلات التوكن',
    'charts.metric.addresses': 'العناوين',
    'charts.metric.activeAddresses': 'العناوين النشطة',
    'charts.metric.newAddresses': 'العناوين الجديدة',
    'charts.metric.tokens': 'التوكنات',
    'charts.metric.contracts': 'العقود المنشورة',
    'charts.metric.fees': 'رسوم المعاملات',
    'charts.metric.averageFee': 'متوسط رسم المعاملة',
    'charts.metric.gasUsed': 'الغاز المستهلك',
    'charts.metric.gasPrice': 'متوسط سعر الغاز',
    'charts.metric.utilization': 'استغلال الشبكة',
    'charts.metric.blockTime': 'متوسط زمن الكتلة',
    'charts.metric.blockSize': 'متوسط حجم الكتلة',

    // --- Filters ------------------------------------------------------------------------------
    'filter.all': 'الكل',
    'filter.status': 'الحالة',
    'filter.status.success': 'ناجحة',
    'filter.status.reverted': 'مرتدة',
    'filter.content': 'محتوى الكتلة',
    'filter.content.filled': 'ذات معاملات',
    'filter.direction': 'الاتجاه',
    'filter.direction.in': 'الوارد',
    'filter.direction.out': 'الصادر',
    // --- Pagination ---------------------------------------------------------------------------
    'pagination.label': 'التصفح',
    'pagination.first': 'الصفحة الأولى',
    'pagination.newer': 'الأحدث',
    'pagination.older': 'الأقدم',
    'pagination.last': 'الصفحة الأخيرة',
    'pagination.page': 'الصفحة {number}',

    // --- Advertising --------------------------------------------------------------------------
    'ad.label': 'إعلان',

    // --- Toasts -------------------------------------------------------------------------------
    'toast.dismiss': 'إغلاق',

    // --- Error and not-found ------------------------------------------------------------------
    'error.title': 'توقفت هذه الصفحة عن العمل',
    'error.hint': 'حدث خطأ أثناء الرسم. السلسلة والفهرس سليمان - إعادة المحاولة عادةً ما تحل الأمر.',
    'error.retry': 'حاول مجدداً',
    'error.home': 'العودة إلى النظرة العامة',

    'notFound.title': 'غير موجود',
    'notFound.heading': 'لا شيء في هذا المسار',
    'notFound.hint': 'هذه الصفحة غير موجودة. إذا كنت تتبع كتلة أو معاملة أو حساباً، تحقق من القيمة أدناه - أو حاول بعد قليل إن لم يصل المفهرس إليها بعد.',

    // --- Footer -------------------------------------------------------------------------------
    'footer.tagline': 'مستكشف كتل مفتوح. كل كتلة ومعاملة وتحويل يُفهرس محلياً لتتمكن من تتبع القيمة عبر السلسلة.',
    'footer.explore': 'استكشف',
    'footer.community': 'المجتمع',
    'footer.note': 'تُقرأ البيانات من فهرس محلي للسلسلة. الأرصدة تُقرأ مباشرة من العقدة.',
    'footer.builtWith': 'بُني باستخدام',
    'footer.version': 'الإصدار',

    // --- Time and units -----------------------------------------------------------------------
    'time.justNow': 'الآن',
    'time.second': 'قبل {count} ثانية',
    'time.seconds': 'قبل {count} ثوانٍ',
    'time.minute': 'قبل {count} دقيقة',
    'time.minutes': 'قبل {count} دقائق',
    'time.hour': 'قبل {count} ساعة',
    'time.hours': 'قبل {count} ساعات',
    'time.day': 'قبل {count} يوم',
    'time.days': 'قبل {count} أيام',

    'unit.bytes': '{count} بايت',
    'unit.kilobytes': '{count} كيلوبايت',
    'unit.gwei': '{amount} gwei',
    'unit.seconds': '{count} ثانية',
    'unit.percent': '{count}٪',

    // --- Page titles --------------------------------------------------------------------------
    'title.chainExplorer': 'مستكشف {chain}',
    'title.chainFallback': 'السلسلة'
};
