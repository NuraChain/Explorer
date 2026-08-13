import type { Dictionary } from './en.ts';

// Russian (ru-RU). Typed against the English dictionary, so a key added there and forgotten here
// is a build error rather than an English string leaking into a Russian page.
//
// Untranslated on purpose: `gwei`, `Nonce`, `calldata`, ERC standard numbers, token symbols,
// addresses and hashes. Russian needs three plural forms and the catalog carries two, so the time
// strings use unit abbreviations - «5 сек. назад» - which do not inflect and are what Russian
// interfaces print anyway.
export const ru: Dictionary = {
    // --- Brand --------------------------------------------------------------------------------
    // «Обозреватель Nura». The common noun leads and carries the accent; the proper noun stays
    // Latin, as Russian keeps foreign marks, and moves to `trail`.
    'brand.name': 'Обозреватель Nura',
    'brand.lead': '',
    'brand.accent': 'Обозреватель',
    'brand.trail': 'Nura',

    // --- Chrome -------------------------------------------------------------------------------
    'nav.sections': 'Разделы',
    'nav.home': 'Главная',
    'nav.blocks': 'Блоки',
    'nav.transactions': 'Транзакции',
    'nav.overview': 'Обзор',
    'nav.menu': 'Меню',
    'nav.open': 'Открыть меню',
    'nav.close': 'Закрыть меню',
    'nav.elsewhere': 'Другие ссылки',

    'theme.label': 'Тема',
    'theme.dark': 'Тёмная',
    'theme.light': 'Светлая',

    'language.label': 'Язык',

    // --- Search -------------------------------------------------------------------------------
    'search.label': 'Поиск по адресу, хешу транзакции или номеру блока',
    'search.placeholder': 'Адрес, хеш транзакции или номер блока',
    'search.placeholder.compact': 'Поиск',
    'search.go': 'Найти',
    'search.missing': 'По этому значению ничего не проиндексировано. Проверьте его или подождите, если блок совсем свежий.',
    'search.failed': 'Поиск не удался - обозреватель не смог обратиться к своему индексу.',

    // --- Home ---------------------------------------------------------------------------------
    'home.hero.lead': 'Следуйте за',
    'home.hero.accent': 'светом',
    'home.hero.through': 'сквозь',
    'home.hero.fallback': 'цепочку',
    'home.hero.trail': '',
    'home.tagline': 'Каждый блок, транзакция и перевод проиндексированы, чтобы вы точно видели, куда ушла ценность.',
    'home.behind': 'Идёт индексация - отстаём от узла на {count} блоков.',
    'home.stat.height': 'Высота',
    'home.stat.transactions': 'Транзакции',
    'home.stat.blockTime': 'Время блока',
    'home.stat.baseFee': 'Базовая комиссия',
    'home.latestBlocks': 'Последние блоки',
    'home.latestTransactions': 'Последние транзакции',
    'home.all': 'Все',
    'home.empty.blocks': 'Ожидаем первый блок',
    'home.empty.transactions': 'Транзакций пока нет',

    // --- Blocks list --------------------------------------------------------------------------
    'blocks.title': 'Блоки',
    'blocks.empty.title': 'Блоки ещё не проиндексированы',
    'blocks.empty.hint': 'Блоки появляются здесь по мере того, как индексатор читает их из цепочки.',
    'blocks.total': 'Проиндексировано блоков: {count}.',
    'blocks.gasTooltip': 'Использовано {used} из {limit} газа',

    // --- Transactions list --------------------------------------------------------------------
    'txs.title': 'Транзакции',
    'txs.empty.title': 'Транзакции ещё не проиндексированы',
    'txs.empty.hint': 'Каждая транзакция, добытая цепочкой, попадает сюда.',
    'txs.total': 'Проиндексировано транзакций: {count}.',

    // --- Block detail -------------------------------------------------------------------------
    'block.title': 'Блок #{number}',
    'block.missing.title': 'Блока нет в индексе',
    'block.missing.hint': 'Он может быть новее, чем дошёл индексатор, или раньше стартового блока.',
    'block.previous': 'Предыдущий блок',
    'block.next': 'Следующий блок',
    'block.hash': 'Хеш',
    'block.parent': 'Родитель',
    'block.validator': 'Валидатор',
    'block.size': 'Размер',
    'block.gasUsed': 'Использовано газа',
    'block.gasOf': 'из {limit}',
    'block.baseFee': 'Базовая комиссия',
    'block.transactions': 'Транзакций: {count}',
    'block.empty.title': 'Этот блок пуст',
    'block.empty.hint': 'В него не вошло ни одной транзакции.',

    // --- Transaction detail -------------------------------------------------------------------
    'tx.title': 'Транзакция',
    'tx.missing.title': 'Транзакции нет в индексе',
    'tx.missing.hint': 'Она может быть ещё в ожидании или новее, чем дошёл индексатор.',
    'tx.reverted.notice': 'Транзакция откатилась. Ценность не переместилась, но отправитель всё равно оплатил газ ниже.',
    'tx.hash': 'Хеш',
    'tx.block': 'Блок',
    'tx.position': 'позиция {index}',
    'tx.from': 'Отправитель',
    'tx.to': 'Получатель',
    'tx.value': 'Сумма',
    'tx.fee': 'Комиссия',
    'tx.feeDetail': '{gas} газа по {price}',
    'tx.nonce': 'Nonce',
    'tx.calldata': 'calldata {size}',
    'tx.created': 'создан',
    'tx.transfers': 'Переводы токенов',
    'tx.token': 'токен',

    // --- Address ------------------------------------------------------------------------------
    'address.title': 'Адрес {short}',
    'address.kind.address': 'Адрес',
    'address.kind.contract': 'Контракт',
    'address.kind.token': 'Токен',
    'address.activity': 'Активность',
    'address.balance': 'Баланс',
    'address.received': 'Получено',
    'address.sent': 'Отправлено',
    'address.fees': 'Уплачено комиссий',
    'address.tab.transactions': 'Транзакции',
    'address.tab.transfers': 'Переводы токенов',
    'address.transfers.empty.title': 'Переводов токенов нет',
    'address.transfers.empty.hint': 'Движения ERC-20, 721 и 1155 этого адреса появляются здесь.',
    'address.transfers.token': 'Токен',

    // --- Flow ledger --------------------------------------------------------------------------
    'flow.title': 'Поток',
    'flow.in': 'вход',
    'flow.out': 'выход',
    'flow.empty': 'Транзакций здесь пока нет. Когда адрес отправит или получит, движение появится здесь.',
    'flow.legend': 'Столбцы относительны крупнейшего показанного движения. Суммы в {symbol}.',
    'flow.call': 'вызов',
    'flow.contractCreated': 'создан контракт',

    // --- Cadence ------------------------------------------------------------------------------
    'cadence.title': 'Ритм',
    'cadence.caption': 'последние {count} блоков - высота означает использованный газ',
    'cadence.chart': 'Газ за последние {count} блоков',
    'cadence.bar': 'Блок {number}, транзакций: {count}',
    'cadence.now': 'сейчас',

    // --- Shared chain wording -----------------------------------------------------------------
    'chain.contractCreation': 'создание контракта',
    'chain.to': 'к {address}',
    'chain.txCount': '{count} тр.',
    'chain.gasShare': '{percent}% газа',
    'chain.notAvailable': 'н/д',
    'chain.status.success': 'успешно',
    'chain.status.reverted': 'откат',
    'chain.status.unknown': 'неизвестно',

    // --- Copy / wallet ------------------------------------------------------------------------
    'copy.action': 'Копировать {value}',
    'copy.done': 'Скопировано в буфер обмена',
    'copy.blocked': 'Браузер запретил доступ к буферу обмена',

    'wallet.add': 'Добавить {chain}',
    'wallet.missing': 'Кошелёк не найден - установите MetaMask и попробуйте снова',
    'wallet.added': '{chain} добавлена в ваш кошелёк',
    'wallet.dismissed': 'Запрос отклонён',
    'wallet.refused': 'Кошелёк отказался добавить сеть',
    'wallet.mismatch': 'В кошельке эта сеть уже сохранена с другим символом валюты. Удалите её там и попробуйте снова.',

    // --- Pagination ---------------------------------------------------------------------------
    'pagination.label': 'Пагинация',
    'pagination.first': 'Первая страница',
    'pagination.newer': 'Новее',
    'pagination.older': 'Старее',
    'pagination.last': 'Последняя страница',
    'pagination.page': 'Страница {number}',

    // --- Toasts -------------------------------------------------------------------------------
    'toast.dismiss': 'Закрыть',

    // --- Error and not-found ------------------------------------------------------------------
    'error.title': 'Страница перестала работать',
    'error.hint': 'Что-то сломалось при отрисовке. Цепочка и индекс не пострадали - повтор обычно помогает.',
    'error.retry': 'Повторить',
    'error.home': 'Назад к обзору',

    'notFound.title': 'Не найдено',
    'notFound.heading': 'По этому пути ничего нет',
    'notFound.hint': 'Такой страницы нет. Если вы шли к блоку, транзакции или счёту, проверьте значение ниже - или попробуйте чуть позже, если индексатор ещё не дошёл.',

    // --- Footer -------------------------------------------------------------------------------
    'footer.tagline': 'Открытый обозреватель блоков. Каждый блок, транзакция и перевод индексируются локально, чтобы можно было проследить путь ценности по цепочке.',
    'footer.explore': 'Навигация',
    'footer.community': 'Сообщество',
    'footer.note': 'Чтение идёт из локального индекса цепочки. Балансы читаются с узла вживую.',
    'footer.builtWith': 'Сделано на',

    // --- Time and units -----------------------------------------------------------------------
    // Abbreviated units on purpose: they do not inflect, so one form serves every count where the
    // full nouns would need three.
    'time.justNow': 'только что',
    'time.second': '{count} сек. назад',
    'time.seconds': '{count} сек. назад',
    'time.minute': '{count} мин. назад',
    'time.minutes': '{count} мин. назад',
    'time.hour': '{count} ч. назад',
    'time.hours': '{count} ч. назад',
    'time.day': '{count} дн. назад',
    'time.days': '{count} дн. назад',

    'unit.bytes': '{count} Б',
    'unit.kilobytes': '{count} КБ',
    'unit.gwei': '{amount} gwei',

    // --- Page titles --------------------------------------------------------------------------
    'title.chainExplorer': 'Обозреватель {chain}',
    'title.chainFallback': 'Цепочка'
};
