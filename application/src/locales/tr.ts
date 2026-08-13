import type { Dictionary } from './en.ts';

// Turkish (tr-TR). Typed against the English dictionary, so a key added there and forgotten here
// is a build error rather than an English string leaking into a Turkish page.
//
// Untranslated on purpose: `gwei`, `hash`, `calldata`, ERC standard numbers, token symbols,
// addresses and hashes. Turkish nouns do not pluralize after a numeral, so the paired time keys
// are the same string, exactly like Persian.
export const tr: Dictionary = {
    // --- Brand --------------------------------------------------------------------------------
    // «Nura Gezgini» - «blok gezgini» is what Turkish calls a block explorer. The proper noun
    // leads, so the slots fill exactly like English with the accent on the second word.
    'brand.name': 'Nura Gezgini',
    'brand.lead': 'Nura',
    'brand.accent': 'Gezgini',
    'brand.trail': '',

    // --- Chrome -------------------------------------------------------------------------------
    'nav.sections': 'Bölümler',
    'nav.home': 'Ana sayfa',
    'nav.blocks': 'Bloklar',
    'nav.transactions': 'İşlemler',
    'nav.overview': 'Genel bakış',
    'nav.menu': 'Menü',
    'nav.open': 'Menüyü aç',
    'nav.close': 'Menüyü kapat',
    'nav.elsewhere': 'Diğer bağlantılar',

    'theme.label': 'Tema',
    'theme.dark': 'Koyu',
    'theme.light': 'Açık',

    'language.label': 'Dil',

    // --- Search -------------------------------------------------------------------------------
    'search.label': 'Adres, işlem hash’i veya blok numarasıyla ara',
    'search.placeholder': 'Adres, işlem hash’i veya blok numarası',
    'search.placeholder.compact': 'Ara',
    'search.go': 'Git',
    'search.missing': 'Bu değerle dizinlenmiş bir şey yok. Değeri kontrol edin ya da blok çok yeniyse biraz bekleyin.',
    'search.failed': 'Arama başarısız oldu - gezgin kendi dizinine ulaşamadı.',

    // --- Home ---------------------------------------------------------------------------------
    // Verb-final: the postposition and the verb both sit in `trail`, after the chain's name.
    'home.hero.lead': '',
    'home.hero.accent': 'Işığı',
    'home.hero.through': '',
    'home.hero.fallback': 'zincir',
    'home.hero.trail': 'boyunca takip edin',
    'home.tagline': 'Her blok, işlem ve transfer dizinlenir; değerin tam olarak nereye gittiğini görürsünüz.',
    'home.behind': 'Dizinleniyor - düğümün {count} blok gerisinde.',
    'home.stat.height': 'Yükseklik',
    'home.stat.transactions': 'İşlemler',
    'home.stat.blockTime': 'Blok süresi',
    'home.stat.baseFee': 'Taban ücret',
    'home.latestBlocks': 'Son bloklar',
    'home.latestTransactions': 'Son işlemler',
    'home.all': 'Tümü',
    'home.empty.blocks': 'İlk blok bekleniyor',
    'home.empty.transactions': 'Henüz işlem yok',

    // --- Blocks list --------------------------------------------------------------------------
    'blocks.title': 'Bloklar',
    'blocks.empty.title': 'Henüz dizinlenmiş blok yok',
    'blocks.empty.hint': 'Dizinleyici zincirden okudukça bloklar burada görünür.',
    'blocks.total': '{count} blok dizinlendi.',
    'blocks.gasTooltip': '{limit} gazın {used} kadarı kullanıldı',

    // --- Transactions list --------------------------------------------------------------------
    'txs.title': 'İşlemler',
    'txs.empty.title': 'Henüz dizinlenmiş işlem yok',
    'txs.empty.hint': 'Zincirin kazdığı her işlem buraya düşer.',
    'txs.total': '{count} işlem dizinlendi.',

    // --- Block detail -------------------------------------------------------------------------
    'block.title': 'Blok #{number}',
    'block.missing.title': 'Blok dizinde değil',
    'block.missing.hint': 'Dizinleyicinin ulaştığı yerden daha yeni ya da başlangıç bloğundan önce olabilir.',
    'block.previous': 'Önceki blok',
    'block.next': 'Sonraki blok',
    'block.hash': 'Hash',
    'block.parent': 'Üst blok',
    'block.validator': 'Doğrulayıcı',
    'block.size': 'Boyut',
    'block.gasUsed': 'Kullanılan gaz',
    'block.gasOf': '/ {limit}',
    'block.baseFee': 'Taban ücret',
    'block.transactions': '{count} işlem',
    'block.empty.title': 'Bu blok boş',
    'block.empty.hint': 'İçinde hiçbir işlem yok.',

    // --- Transaction detail -------------------------------------------------------------------
    'tx.title': 'İşlem',
    'tx.missing.title': 'İşlem dizinde değil',
    'tx.missing.hint': 'Hâlâ beklemede olabilir ya da dizinleyicinin ulaştığı yerden daha yeni.',
    'tx.reverted.notice': 'Bu işlem geri alındı. Değer taşınmadı, ancak gönderen aşağıdaki gazı yine de ödedi.',
    'tx.hash': 'Hash',
    'tx.block': 'Blok',
    'tx.position': 'konum {index}',
    'tx.from': 'Gönderen',
    'tx.to': 'Alıcı',
    'tx.value': 'Değer',
    'tx.fee': 'Ücret',
    'tx.feeDetail': '{price} fiyatla {gas} gaz',
    'tx.nonce': 'Nonce',
    'tx.calldata': 'calldata {size}',
    'tx.created': 'oluşturuldu',
    'tx.transfers': 'Token transferleri',
    'tx.token': 'token',

    // --- Address ------------------------------------------------------------------------------
    'address.title': 'Adres {short}',
    'address.kind.address': 'Adres',
    'address.kind.contract': 'Kontrat',
    'address.kind.token': 'Token',
    'address.activity': 'Etkinlik',
    'address.balance': 'Bakiye',
    'address.received': 'Alınan',
    'address.sent': 'Gönderilen',
    'address.fees': 'Ödenen ücretler',
    'address.tab.transactions': 'İşlemler',
    'address.tab.transfers': 'Token transferleri',
    'address.transfers.empty.title': 'Token transferi yok',
    'address.transfers.empty.hint': 'Bu adresin ERC-20, 721 ve 1155 hareketleri burada görünür.',
    'address.transfers.token': 'Token',

    // --- Flow ledger --------------------------------------------------------------------------
    'flow.title': 'Akış',
    'flow.in': 'giriş',
    'flow.out': 'çıkış',
    'flow.empty': 'Burada henüz işlem yok. Bu adres gönderdiğinde ya da aldığında hareket burada görünür.',
    'flow.legend': 'Çubuklar gösterilen en büyük harekete görelidir. Tutarlar {symbol} cinsinden.',
    'flow.call': 'çağrı',
    'flow.contractCreated': 'kontrat oluşturuldu',

    // --- Cadence ------------------------------------------------------------------------------
    'cadence.title': 'Tempo',
    'cadence.caption': 'son {count} blok - yükseklik kullanılan gaz',
    'cadence.chart': 'Son {count} bloktaki gaz kullanımı',
    'cadence.bar': 'Blok {number}, {count} işlem',
    'cadence.now': 'şimdi',

    // --- Shared chain wording -----------------------------------------------------------------
    'chain.contractCreation': 'kontrat oluşturma',
    'chain.to': '{address} adresine',
    'chain.txCount': '{count} işlem',
    'chain.gasShare': '%{percent} gaz',
    'chain.notAvailable': 'yok',
    'chain.status.success': 'başarılı',
    'chain.status.reverted': 'geri alındı',
    'chain.status.unknown': 'bilinmiyor',

    // --- Copy / wallet ------------------------------------------------------------------------
    'copy.action': '{value} kopyala',
    'copy.done': 'Panoya kopyalandı',
    'copy.blocked': 'Tarayıcınız pano erişimini engelledi',

    'wallet.add': '{chain} ekle',
    'wallet.missing': 'Cüzdan bulunamadı - MetaMask kurup yeniden deneyin',
    'wallet.added': '{chain} cüzdanınıza eklendi',
    'wallet.dismissed': 'İstek kapatıldı',
    'wallet.refused': 'Cüzdanınız ağı eklemeyi reddetti',
    'wallet.mismatch': 'Cüzdanınızda bu ağ farklı bir para birimi simgesiyle kayıtlı. Orada silin, sonra yeniden deneyin.',

    // --- Pagination ---------------------------------------------------------------------------
    'pagination.label': 'Sayfalama',
    'pagination.first': 'İlk sayfa',
    'pagination.newer': 'Daha yeni',
    'pagination.older': 'Daha eski',
    'pagination.last': 'Son sayfa',
    'pagination.page': 'Sayfa {number}',

    // --- Toasts -------------------------------------------------------------------------------
    'toast.dismiss': 'Kapat',

    // --- Error and not-found ------------------------------------------------------------------
    'error.title': 'Bu sayfa çalışmayı durdurdu',
    'error.hint': 'Çizim sırasında bir şey ters gitti. Zincir ve dizin etkilenmedi - yeniden denemek genellikle düzeltir.',
    'error.retry': 'Yeniden dene',
    'error.home': 'Genel bakışa dön',

    'notFound.title': 'Bulunamadı',
    'notFound.heading': 'Bu adreste bir şey yok',
    'notFound.hint': 'Bu sayfa yok. Bir bloğu, işlemi ya da hesabı izliyorduysanız aşağıdaki değeri kontrol edin - ya da dizinleyici oraya henüz ulaşmadıysa birazdan yeniden deneyin.',

    // --- Footer -------------------------------------------------------------------------------
    'footer.tagline': 'Açık bir blok gezgini. Her blok, işlem ve transfer yerelde dizinlenir; değeri zincir boyunca izleyebilirsiniz.',
    'footer.explore': 'Keşfet',
    'footer.community': 'Topluluk',
    'footer.note': 'Okumalar zincirin yerel dizininden gelir. Bakiyeler düğümden canlı okunur.',
    'footer.builtWith': 'Şununla yapıldı:',

    // --- Time and units -----------------------------------------------------------------------
    // Turkish does not pluralize a noun after a numeral, so both forms are the same string.
    'time.justNow': 'az önce',
    'time.second': '{count} saniye önce',
    'time.seconds': '{count} saniye önce',
    'time.minute': '{count} dakika önce',
    'time.minutes': '{count} dakika önce',
    'time.hour': '{count} saat önce',
    'time.hours': '{count} saat önce',
    'time.day': '{count} gün önce',
    'time.days': '{count} gün önce',

    'unit.bytes': '{count} B',
    'unit.kilobytes': '{count} KB',
    'unit.gwei': '{amount} gwei',

    // --- Page titles --------------------------------------------------------------------------
    'title.chainExplorer': '{chain} gezgini',
    'title.chainFallback': 'Zincir'
};
