import type { Dictionary } from './en.ts';

// Hindi (hi-IN). Typed against the English dictionary, so a key added there and forgotten here
// is a build error rather than an English string leaking into a Hindi page.
//
// Untranslated on purpose: `gwei`, ERC standard numbers, token symbols, addresses and hashes.
// Chain vocabulary follows what Hindi crypto readers actually use - ब्लॉक, हैश, गैस, टोकन are
// transliterations, not coinages; only everyday words are translated outright.
export const hi: Dictionary = {
    // --- Brand --------------------------------------------------------------------------------
    // «नूरा एक्सप्लोरर». Hindi keeps the English order - proper noun first, accent on the second
    // word - so the slots fill exactly like English, in Devanagari.
    'brand.name': 'नूरा एक्सप्लोरर',
    'brand.lead': 'नूरा',
    'brand.accent': 'एक्सप्लोरर',
    'brand.trail': '',

    // --- Chrome -------------------------------------------------------------------------------
    'nav.sections': 'अनुभाग',
    'nav.home': 'होम',
    'nav.blocks': 'ब्लॉक',
    'nav.transactions': 'लेनदेन',
    'nav.accounts': 'खाते',
    'nav.overview': 'अवलोकन',
    'nav.menu': 'मेनू',
    'nav.open': 'नेविगेशन खोलें',
    'nav.close': 'नेविगेशन बंद करें',
    'nav.elsewhere': 'अन्य जगहें',

    'theme.label': 'थीम',
    'theme.dark': 'डार्क',
    'theme.light': 'लाइट',

    'language.label': 'भाषा',

    // --- Search -------------------------------------------------------------------------------
    'search.label': 'पता, लेनदेन हैश या ब्लॉक नंबर से खोजें',
    'search.placeholder': 'पता, लेनदेन हैश या ब्लॉक नंबर',
    'search.placeholder.compact': 'खोजें',
    'search.go': 'जाएँ',
    'search.missing': 'इस मान से कुछ भी इंडेक्स नहीं हुआ है। इसे जाँचें, या ब्लॉक बहुत नया है तो थोड़ा इंतज़ार करें।',
    'search.failed': 'खोज विफल रही - एक्सप्लोरर अपने इंडेक्स तक नहीं पहुँच सका।',

    // --- Home ---------------------------------------------------------------------------------
    // Verb-final: the verb sits in `trail`, where Hindi word order needs it.
    'home.hero.lead': '',
    'home.hero.accent': 'रोशनी',
    'home.hero.through': 'को',
    'home.hero.fallback': 'चेन',
    'home.hero.trail': 'के ज़रिए फ़ॉलो करें',
    'home.tagline': 'हर ब्लॉक, लेनदेन और ट्रांसफ़र, इंडेक्स किया हुआ - ताकि आप ठीक-ठीक देख सकें कि मूल्य कहाँ गया।',
    'home.behind': 'इंडेक्सिंग जारी - नोड से {count} ब्लॉक पीछे।',
    'home.stat.height': 'ऊँचाई',
    'home.stat.transactions': 'लेनदेन',
    'home.stat.blockTime': 'ब्लॉक समय',
    'home.stat.baseFee': 'बेस फ़ीस',
    'home.latestBlocks': 'नवीनतम ब्लॉक',
    'home.latestTransactions': 'नवीनतम लेनदेन',
    'home.all': 'सभी',
    'home.empty.blocks': 'पहले ब्लॉक की प्रतीक्षा',
    'home.empty.transactions': 'अभी कोई लेनदेन नहीं',

    // --- Blocks list --------------------------------------------------------------------------
    'blocks.title': 'ब्लॉक',
    'blocks.empty.title': 'अभी कोई ब्लॉक इंडेक्स नहीं हुआ',
    'blocks.empty.hint': 'इंडेक्सर जैसे-जैसे चेन से ब्लॉक पढ़ता है, वे यहाँ दिखते हैं।',
    'blocks.empty.filtered.title': 'किसी ब्लॉक में कुछ नहीं था',
    'blocks.empty.filtered.hint': 'सूचकांक का हर ब्लॉक खाली है। उन्हें देखने के लिए फ़िल्टर हटाएँ।',
    'blocks.total': '{count} ब्लॉक इंडेक्स हुए।',
    'blocks.total.filtered': '{count} ब्लॉक में लेनदेन हैं।',
    'blocks.gasTooltip': '{limit} में से {used} गैस खर्च',

    // --- Transactions list --------------------------------------------------------------------
    'txs.title': 'लेनदेन',
    'txs.empty.title': 'अभी कोई लेनदेन इंडेक्स नहीं हुआ',
    'txs.empty.hint': 'चेन जो भी लेनदेन माइन करती है, वह यहाँ आता है।',
    'txs.empty.filtered.title': 'कोई लेनदेन मेल नहीं खाता',
    'txs.empty.filtered.hint': 'सूचकांक में इस स्थिति वाला कुछ नहीं है। बाकी देखने के लिए फ़िल्टर हटाएँ।',
    'txs.total': '{count} लेनदेन इंडेक्स हुए।',
    'txs.total.filtered': '{count} लेनदेन मेल खाते हैं।',

    // --- Block detail -------------------------------------------------------------------------
    'block.title': 'ब्लॉक #{number}',
    'block.missing.title': 'ब्लॉक इंडेक्स में नहीं है',
    'block.missing.hint': 'यह इंडेक्सर की पहुँच से नया हो सकता है, या शुरुआती ब्लॉक से पहले का।',
    'block.previous': 'पिछला ब्लॉक',
    'block.next': 'अगला ब्लॉक',
    'block.hash': 'हैश',
    'block.parent': 'पैरेंट',
    'block.validator': 'वैलिडेटर',
    'block.size': 'आकार',
    'block.gasUsed': 'गैस खर्च',
    'block.gasOf': '{limit} में से',
    'block.baseFee': 'बेस फ़ीस',
    'block.transactions': '{count} लेनदेन',
    'block.empty.title': 'यह ब्लॉक खाली है',
    'block.empty.hint': 'इसमें कोई लेनदेन शामिल नहीं था।',

    // --- Transaction detail -------------------------------------------------------------------
    'tx.title': 'लेनदेन',
    'tx.missing.title': 'लेनदेन इंडेक्स में नहीं है',
    'tx.missing.hint': 'यह अभी लंबित हो सकता है, या इंडेक्सर की पहुँच से नया।',
    'tx.reverted.notice': 'यह लेनदेन रिवर्ट हो गया। कोई मूल्य नहीं गया, लेकिन भेजने वाले ने फिर भी नीचे दी गई गैस चुकाई।',
    'tx.hash': 'हैश',
    'tx.block': 'ब्लॉक',
    'tx.position': 'स्थान {index}',
    'tx.from': 'प्रेषक',
    'tx.to': 'प्राप्तकर्ता',
    'tx.value': 'मूल्य',
    'tx.fee': 'शुल्क',
    'tx.feeDetail': '{price} की दर से {gas} गैस',
    'tx.nonce': 'नॉन्स',
    'tx.calldata': 'कॉलडेटा {size}',
    'tx.created': 'बनाया गया',
    'tx.transfers': 'टोकन ट्रांसफ़र',
    'tx.token': 'टोकन',

    // --- Address ------------------------------------------------------------------------------
    'address.title': 'पता {short}',
    'address.kind.address': 'पता',
    'address.kind.contract': 'कॉन्ट्रैक्ट',
    'address.kind.token': 'टोकन',
    'address.activity': 'गतिविधि',
    'address.balance': 'बैलेंस',
    'address.received': 'प्राप्त',
    'address.sent': 'भेजा गया',
    'address.fees': 'चुकाया गया शुल्क',
    'address.tab.transactions': 'लेनदेन',
    'address.tab.transfers': 'टोकन ट्रांसफ़र',
    'address.tab.contract': 'कॉन्ट्रैक्ट',
    'address.transfers.empty.title': 'कोई टोकन ट्रांसफ़र नहीं',
    'address.transfers.empty.hint': 'इस पते के ERC-20, 721 और 1155 मूवमेंट यहाँ दिखते हैं।',
    'address.transfers.token': 'टोकन',

    // --- खाते (शीर्ष सूची) -----------------------------------
    'accounts.title': 'शीर्ष खाते',
    'accounts.hint': 'मूल शेष के अनुसार क्रमबद्ध, एक्सप्लोरर द्वारा देखे गए हर पते के लिए नोड से लाइव पढ़ा गया।',
    'accounts.empty.title': 'अभी कोई खाता अनुक्रमित नहीं',
    'accounts.empty.hint': 'चेन का पहला लेनदेन होने के बाद खाते यहाँ दिखेंगे।',
    'accounts.search.label': 'पते से रैंकिंग खोजें',
    'accounts.search.placeholder': 'पता',
    'accounts.search.empty.title': 'कोई खाता मेल नहीं खाता',
    'accounts.search.empty.hint': 'किसी रैंक किए गए पते में वह नहीं है। यहाँ केवल वे पते आते हैं जिन्हें एक्सप्लोरर ने शेष के साथ देखा है।',
    'accounts.total': '{count} खाते रैंक किए गए।',
    'accounts.total.filtered': '{count} खाते मेल खाते हैं।',

    // --- कॉन्ट्रैक्ट -----------------------------------------
    'contract.compiler': 'कंपाइलर',
    'contract.size': 'कोड आकार',
    'contract.deployer': 'तैनात करने वाला',
    'contract.deployedAt': 'तैनाती',
    'contract.metadata': 'सोर्स मेटाडेटा',
    'contract.standards': 'इंटरफ़ेस',
    'contract.proxy': 'प्रॉक्सी',
    'contract.viaImplementation': 'ये उस इम्प्लीमेंटेशन के फ़ंक्शन हैं जिसे यह पता आगे भेजता है, इसके अपने कोड के नहीं।',
    'contract.reads': 'वर्तमान मान',
    'contract.functions': 'फ़ंक्शन',
    'contract.functions.named': '{total} में से {named} नामित',
    'contract.functions.empty.title': 'कोई एंट्री पॉइंट नहीं मिला',
    'contract.functions.empty.hint': 'इस बाइटकोड में कुछ भी फ़ंक्शन सेलेक्टर से तुलना नहीं करता। यह प्रॉक्सी, क्लोन या हाथ से लिखी असेंबली हो सकती है।',
    'contract.events': 'इवेंट',
    'contract.bytecode': 'बाइटकोड',
    'contract.bytecode.show': 'दिखाएँ',
    'contract.bytecode.hide': 'छिपाएँ',
    'contract.unnamed': 'बिना नाम का फ़ंक्शन',
    'contract.mutability.view': 'पढ़ना',
    'contract.mutability.pure': 'शुद्ध',
    'contract.mutability.nonpayable': 'लिखना',
    'contract.mutability.payable': 'भुगतान योग्य',
    'contract.mutability.library': 'लाइब्रेरी',
    'contract.mutability.unknown': 'अज्ञात',

    'contract.read': 'पढ़ना',
    'contract.read.hint': 'इसका उत्तर यही एक्सप्लोरर देता है। न वॉलेट, न शुल्क।',
    'contract.write': 'लिखना',
    'contract.write.hint': 'ये आपके अपने वॉलेट से, इसी नेटवर्क पर लेनदेन भेजते हैं। हस्ताक्षर से पहले वॉलेट पूछता है, और गैस आप चुकाते हैं।',
    'contract.unnamedGroup': 'बिना नाम के सेलेक्टर',
    'contract.libraryGroup': 'लाइब्रेरी फ़ंक्शन',
    'contract.library.hint': 'इन्हें लिंक करने वाले कॉन्ट्रैक्ट से delegatecall द्वारा चलाया जाता है, इसलिए यहाँ इन्हें कॉल नहीं किया जा सकता।',
    'contract.call.query': 'क्वेरी',
    'contract.call.write': 'लिखें',
    'contract.call.value': 'भेजी जाने वाली राशि ({symbol})',
    'contract.call.badAmount': 'यह ऐसी राशि नहीं है जिसे यह चेन भेज सके।',
    'contract.call.sent': 'लेनदेन भेजा गया',
    'contract.call.noReturn': 'इस कॉल ने कुछ नहीं लौटाया।',

    // --- Flow ledger --------------------------------------------------------------------------
    'flow.title': 'प्रवाह',
    'flow.in': 'आवक',
    'flow.out': 'जावक',
    'flow.empty': 'यहाँ अभी कोई लेनदेन नहीं। जब यह पता भेजेगा या पाएगा, हलचल यहाँ दिखेगी।',
    'flow.legend': 'बार सबसे बड़ी दिखाई गई हलचल के सापेक्ष हैं। राशियाँ {symbol} में।',
    'flow.call': 'कॉल',
    'flow.contractCreated': 'कॉन्ट्रैक्ट बना',

    // --- Cadence ------------------------------------------------------------------------------
    'cadence.title': 'लय',
    'cadence.caption': 'पिछले {count} ब्लॉक - ऊँचाई यानी गैस खर्च',
    'cadence.chart': 'पिछले {count} ब्लॉक में गैस खर्च',
    'cadence.bar': 'ब्लॉक {number}, {count} लेनदेन',
    'cadence.now': 'अभी',

    // --- Shared chain wording -----------------------------------------------------------------
    'chain.contractCreation': 'कॉन्ट्रैक्ट निर्माण',
    'chain.to': '{address} को',
    'chain.txCount': '{count} लेनदेन',
    'chain.gasShare': '{percent}% गैस',
    'chain.notAvailable': 'उपलब्ध नहीं',
    'chain.status.success': 'सफल',
    'chain.status.reverted': 'रिवर्ट',
    'chain.status.unknown': 'अज्ञात',

    // --- Copy / wallet ------------------------------------------------------------------------
    'copy.action': '{value} कॉपी करें',
    'copy.done': 'क्लिपबोर्ड पर कॉपी हुआ',
    'copy.blocked': 'आपके ब्राउज़र ने क्लिपबोर्ड की अनुमति नहीं दी',

    'wallet.add': '{chain} जोड़ें',
    'wallet.missing': 'कोई वॉलेट नहीं मिला - MetaMask इंस्टॉल करें, फिर दोबारा कोशिश करें',
    'wallet.added': '{chain} आपके वॉलेट में जुड़ गई',
    'wallet.dismissed': 'अनुरोध खारिज हुआ',
    'wallet.refused': 'आपके वॉलेट ने नेटवर्क जोड़ने से मना कर दिया',
    'wallet.mismatch': 'आपके वॉलेट में यह नेटवर्क किसी और मुद्रा चिह्न के साथ सहेजा है। उसे वहाँ से हटाएँ, फिर दोबारा कोशिश करें।',
    'wallet.connect': 'वॉलेट जोड़ें',
    'wallet.switch': '{chain} पर जाएँ',
    'wallet.switchFailed': 'आपका वॉलेट {chain} पर नहीं गया। पहले नेटवर्क जोड़ें, फिर दोबारा कोशिश करें।',

    // --- Filters ------------------------------------------------------------------------------
    'filter.all': 'सभी',
    'filter.status': 'स्थिति',
    'filter.status.success': 'सफल',
    'filter.status.reverted': 'रिवर्ट',
    'filter.content': 'ब्लॉक सामग्री',
    'filter.content.filled': 'लेनदेन वाले',
    // --- Pagination ---------------------------------------------------------------------------
    'pagination.label': 'पृष्ठांकन',
    'pagination.first': 'पहला पृष्ठ',
    'pagination.newer': 'नए',
    'pagination.older': 'पुराने',
    'pagination.last': 'अंतिम पृष्ठ',
    'pagination.page': 'पृष्ठ {number}',

    // --- Toasts -------------------------------------------------------------------------------
    'toast.dismiss': 'बंद करें',

    // --- Error and not-found ------------------------------------------------------------------
    'error.title': 'यह पेज काम करना बंद कर गया',
    'error.hint': 'रेंडर करते समय कुछ विफल हुआ। चेन और इंडेक्स सुरक्षित हैं - दोबारा कोशिश करने से अक्सर ठीक हो जाता है।',
    'error.retry': 'दोबारा कोशिश करें',
    'error.home': 'अवलोकन पर वापस',

    'notFound.title': 'नहीं मिला',
    'notFound.heading': 'इस पते पर कुछ नहीं',
    'notFound.hint': 'यह पेज मौजूद नहीं है। अगर आप किसी ब्लॉक, लेनदेन या खाते तक जा रहे थे, तो नीचे मान जाँचें - या थोड़ी देर बाद फिर कोशिश करें, अगर इंडेक्सर वहाँ अभी नहीं पहुँचा।',

    // --- Footer -------------------------------------------------------------------------------
    'footer.tagline': 'एक खुला ब्लॉक एक्सप्लोरर। हर ब्लॉक, लेनदेन और ट्रांसफ़र स्थानीय रूप से इंडेक्स होता है, ताकि आप चेन पर मूल्य का पीछा कर सकें।',
    'footer.explore': 'एक्सप्लोर',
    'footer.community': 'समुदाय',
    'footer.note': 'रीड चेन के स्थानीय इंडेक्स से आते हैं। बैलेंस नोड से लाइव पढ़े जाते हैं।',
    'footer.builtWith': 'इससे बना:',
    'footer.version': 'संस्करण',

    // --- Time and units -----------------------------------------------------------------------
    // Hindi does not inflect these nouns after a numeral, so both forms are the same string.
    'time.justNow': 'अभी-अभी',
    'time.second': '{count} सेकंड पहले',
    'time.seconds': '{count} सेकंड पहले',
    'time.minute': '{count} मिनट पहले',
    'time.minutes': '{count} मिनट पहले',
    'time.hour': '{count} घंटे पहले',
    'time.hours': '{count} घंटे पहले',
    'time.day': '{count} दिन पहले',
    'time.days': '{count} दिन पहले',

    'unit.bytes': '{count} बाइट',
    'unit.kilobytes': '{count} KB',
    'unit.gwei': '{amount} gwei',

    // --- Page titles --------------------------------------------------------------------------
    'title.chainExplorer': '{chain} एक्सप्लोरर',
    'title.chainFallback': 'चेन'
};
