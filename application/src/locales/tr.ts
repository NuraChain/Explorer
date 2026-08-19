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
    'address.tab.contract': 'Sözleşme',
    'address.transfers.empty.title': 'Token transferi yok',
    'address.transfers.empty.hint': 'Bu adresin ERC-20, 721 ve 1155 hareketleri burada görünür.',
    'address.transfers.token': 'Token',

    // --- Sözleşme -----------------------------------------
    'contract.notice': 'Bu sözleşmenin kaynak kodu yayımlanmamış. Aşağıdaki her şey zincire dağıtılmış bayt kodundan okundu.',
    'contract.compiler': 'Derleyici',
    'contract.size': 'Kod boyutu',
    'contract.deployer': 'Dağıtan',
    'contract.deployedAt': 'Dağıtıldığı blok',
    'contract.metadata': 'Kaynak meta verisi',
    'contract.standards': 'Arayüzler',
    'contract.proxy': 'Proxy',
    'contract.viaImplementation': 'Bunlar bu adresin yönlendirdiği uygulamanın fonksiyonları, kendi kodunun değil.',
    'contract.reads': 'Güncel değerler',
    'contract.functions': 'Fonksiyonlar',
    'contract.functions.named': '{total} fonksiyondan {named} tanesi adlandırıldı',
    'contract.functions.empty.title': 'Giriş noktası bulunamadı',
    'contract.functions.empty.hint': 'Bu bayt kodunda bir fonksiyon seçicisiyle karşılaştırma yok. Proxy, klon ya da elle yazılmış assembly olabilir.',
    'contract.events': 'Olaylar',
    'contract.bytecode': 'Bayt kodu',
    'contract.bytecode.show': 'Göster',
    'contract.bytecode.hide': 'Gizle',
    'contract.unnamed': 'adsız fonksiyon',
    'contract.mutability.view': 'okuma',
    'contract.mutability.pure': 'saf',
    'contract.mutability.nonpayable': 'yazma',
    'contract.mutability.payable': 'ödeme alan',
    'contract.mutability.unknown': 'bilinmiyor',

    'contract.read': 'Okuma',
    'contract.read.hint': 'Bu gezginin kendisi yanıtlar. Cüzdan da yok, ücret de.',
    'contract.write': 'Yazma',
    'contract.write.hint': 'Bunlar kendi cüzdanınızdan, bu ağ üzerinde işlem gönderir. Cüzdanınız imzalamadan önce sorar, gaz ücretini siz ödersiniz.',
    'contract.unnamedGroup': 'Adsız seçiciler',
    'contract.call.query': 'Sorgula',
    'contract.call.write': 'Yaz',
    'contract.call.value': 'Gönderilecek tutar ({symbol})',
    'contract.call.badAmount': 'Bu, bu zincirin gönderebileceği bir tutar değil.',
    'contract.call.sent': 'İşlem gönderildi',
    'contract.call.noReturn': 'Bu çağrı hiçbir şey döndürmedi.',

    // --- Verified source ----------------------------------------------------------------------
    'contract.verified.full': 'Kaynak kod doğrulandı',
    'contract.verified.partial': 'Kaynak kod doğrulandı - kısmi eşleşme',
    'contract.verified.detail': '{name}, solc {compiler} ile derlendi',
    'contract.verified.partial.hint': 'Dağıtılan kod eşleşiyor; yalnızca meta veri kuyruğu farklı ve bunun için yeri değişmiş bir yorum ya da farklı bir dosya yolu yeterlidir. Komutlar kanıtlanmıştır, çevresindeki yorumlar değil.',
    'contract.verified.viaImplementation': 'Yayımlanan kaynak, bu adresin yönlendirdiği uygulamaya aittir.',
    'contract.source': 'Kaynak kod',
    'contract.source.optimized': 'iyileştirici açık, {runs} tur',
    'contract.source.unoptimized': 'iyileştirici kapalı',
    'contract.source.copyAbi': 'ABI kopyala',

    // --- Publishing source --------------------------------------------------------------------
    'verify.cta': 'Kaynağı yayımla',
    'verify.title': '{short} doğrulama',
    'verify.heading': 'Kaynak kodu yayımla ve doğrula',
    'verify.intro': 'Burada hiçbir şey güvene dayanmaz. Bu gezgin gönderdiğinizi derler ve yalnızca sonuç bu adreste zaten dağıtılmış bayt koduysa kabul eder - yani ne hesap açmak ne de birini beklemek gerekir.',
    'verify.offline': 'Derleyici listesi alınamadı, bu yüzden yalnızca sunucuda hazır bulunan sürümler kullanılabilir. İhtiyacınız olan sürümü eklemesi için sunucuyu işleteni arayın.',
    'verify.kind': 'Gönderim biçimi',
    'verify.kind.single': 'Tek dosya',
    'verify.kind.json': 'Standard JSON',
    'verify.compiler': 'Derleyici yapısı',
    'verify.compiler.hint': 'Yalnızca sürüm değil, tam yapı - solc çıktısı yama sürümleri arasında değişir. Nokta, sunucuda hazır olan yapıları gösterir.',
    'verify.evmVersion': 'EVM sürümü',
    'verify.evmVersion.default': 'Derleyicinin varsayılanı',
    'verify.evmVersion.hint': 'Sözleşme açıkça belirtilerek derlenmediyse varsayılanda bırakın. Yanlışını adlandırmak üretilen işlem kodlarını değiştirir.',
    'verify.name': 'Sözleşme adı',
    'verify.name.hint': 'İsteğe bağlı. Boş bırakılırsa kaynaktaki her sözleşme denenir.',
    'verify.fileName': 'Dosya adı',
    'verify.fileName.hint': 'Dosyanın derlendiği yol. Meta veriye karıştırıldığı için yanlışı tam eşleşmeyi kısmiye çevirir.',
    'verify.optimizer': 'İyileştirici',
    'verify.optimizer.enabled': 'Açık',
    'verify.optimizer.hint': 'Bunlar sözleşmenin dağıtıldığı ayarlarla aynı olmalı, yoksa bayt kod da aynı olmaz.',
    'verify.runs': 'İyileştirici turu',
    'verify.license': 'Lisans',
    'verify.source': 'Solidity kaynağı',
    'verify.source.placeholder': 'Sözleşmenin tamamını, içe aktarmalarıyla birlikte yapıştırın.',
    'verify.json': 'Standard JSON girdisi',
    'verify.json.placeholder': 'Derlemenizin ürettiği solc standard-json girdisini yapıştırın.',
    'verify.json.hint': 'Ayarları yazıldığı gibi kullanılır - remapping, kitaplık adresleri ve viaIR dâhil. Yalnızca çıktı seçimi genişletilir.',
    'verify.submit': 'Doğrula ve yayımla',
    'verify.submit.hint': 'Derleme birkaç saniye sürer ve aynı anda tek gönderim çalışır.',
    'verify.failed.hint': 'Eşleşmeme neredeyse her zaman derleyici yapısı, iyileştirici ayarı ya da tur sayısıdır. Her birini sözleşmenin dağıtıldığı değerlerle karşılaştırın.',
    'verify.done.detail': '{name} kaynağı artık bu sözleşmede yayımlandı; işlevleri adlandırıldı ve çağrılabilir.',
    'verify.done.open': 'Sözleşmeyi aç',

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
    'wallet.connect': 'Cüzdan bağla',
    'wallet.switch': '{chain} ağına geç',
    'wallet.switchFailed': 'Cüzdanınız {chain} ağına geçmedi. Önce ağı ekleyin, sonra yeniden deneyin.',

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
