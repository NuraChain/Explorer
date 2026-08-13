import type { Dictionary } from './en.ts';

// Chinese (zh-CN, Simplified). Typed against the English dictionary, so a key added there and
// forgotten here is a build error rather than an English string leaking into a Chinese page.
//
// Untranslated on purpose: `gwei`, `Gas`, `Nonce`, ERC standard numbers, token symbols, addresses
// and hashes - all read as-is in Chinese crypto writing. Chinese has no plural inflection, so the
// paired time keys are the same string, exactly like Persian.
export const zh: Dictionary = {
    // --- Brand --------------------------------------------------------------------------------
    // «Nura 区块浏览器». The proper noun stays Latin - that is how Chinese product names carry
    // foreign marks - and the accent falls on the descriptive tail.
    'brand.name': 'Nura 区块浏览器',
    'brand.lead': 'Nura',
    'brand.accent': '区块浏览器',
    'brand.trail': '',

    // --- Chrome -------------------------------------------------------------------------------
    'nav.sections': '栏目',
    'nav.home': '首页',
    'nav.blocks': '区块',
    'nav.transactions': '交易',
    'nav.overview': '总览',
    'nav.menu': '菜单',
    'nav.open': '打开导航',
    'nav.close': '关闭导航',
    'nav.elsewhere': '其他链接',

    'theme.label': '主题',
    'theme.dark': '深色',
    'theme.light': '浅色',

    'language.label': '语言',

    // --- Search -------------------------------------------------------------------------------
    'search.label': '按地址、交易哈希或区块号搜索',
    'search.placeholder': '地址、交易哈希或区块号',
    'search.placeholder.compact': '搜索',
    'search.go': '前往',
    'search.missing': '没有索引到该值。请检查一下；如果区块很新，稍等片刻。',
    'search.failed': '搜索失败 - 浏览器无法访问其索引。',

    // --- Home ---------------------------------------------------------------------------------
    'home.hero.lead': '追随',
    'home.hero.accent': '光',
    'home.hero.through': '穿过',
    'home.hero.fallback': '这条链',
    'home.hero.trail': '',
    'home.tagline': '每个区块、每笔交易和每次转账都被索引，让你清楚看到价值流向了哪里。',
    'home.behind': '正在索引 - 落后节点 {count} 个区块。',
    'home.stat.height': '高度',
    'home.stat.transactions': '交易数',
    'home.stat.blockTime': '出块时间',
    'home.stat.baseFee': '基础费',
    'home.latestBlocks': '最新区块',
    'home.latestTransactions': '最新交易',
    'home.all': '全部',
    'home.empty.blocks': '等待第一个区块',
    'home.empty.transactions': '暂无交易',

    // --- Blocks list --------------------------------------------------------------------------
    'blocks.title': '区块',
    'blocks.empty.title': '尚未索引任何区块',
    'blocks.empty.hint': '索引器从链上读到区块后，就会显示在这里。',
    'blocks.total': '已索引 {count} 个区块。',
    'blocks.gasTooltip': '已用 {used} / {limit} Gas',

    // --- Transactions list --------------------------------------------------------------------
    'txs.title': '交易',
    'txs.empty.title': '尚未索引任何交易',
    'txs.empty.hint': '链上打包的每笔交易都会来到这里。',
    'txs.total': '已索引 {count} 笔交易。',

    // --- Block detail -------------------------------------------------------------------------
    'block.title': '区块 #{number}',
    'block.missing.title': '该区块不在索引中',
    'block.missing.hint': '它可能比索引器已到达的位置更新，或早于起始区块。',
    'block.previous': '上一个区块',
    'block.next': '下一个区块',
    'block.hash': '哈希',
    'block.parent': '父区块',
    'block.validator': '验证者',
    'block.size': '大小',
    'block.gasUsed': '已用 Gas',
    'block.gasOf': '/ {limit}',
    'block.baseFee': '基础费',
    'block.transactions': '{count} 笔交易',
    'block.empty.title': '这个区块是空的',
    'block.empty.hint': '其中未包含任何交易。',

    // --- Transaction detail -------------------------------------------------------------------
    'tx.title': '交易',
    'tx.missing.title': '该交易不在索引中',
    'tx.missing.hint': '它可能仍在等待打包，或比索引器已到达的位置更新。',
    'tx.reverted.notice': '这笔交易已回滚。没有价值转移，但发送方仍支付了下方的 Gas。',
    'tx.hash': '哈希',
    'tx.block': '区块',
    'tx.position': '第 {index} 位',
    'tx.from': '发送方',
    'tx.to': '接收方',
    'tx.value': '金额',
    'tx.fee': '手续费',
    'tx.feeDetail': '{gas} Gas，单价 {price}',
    'tx.nonce': 'Nonce',
    'tx.calldata': '调用数据 {size}',
    'tx.created': '已创建',
    'tx.transfers': '代币转账',
    'tx.token': '代币',

    // --- Address ------------------------------------------------------------------------------
    'address.title': '地址 {short}',
    'address.kind.address': '地址',
    'address.kind.contract': '合约',
    'address.kind.token': '代币',
    'address.activity': '活动',
    'address.balance': '余额',
    'address.received': '收到',
    'address.sent': '发出',
    'address.fees': '已付手续费',
    'address.tab.transactions': '交易',
    'address.tab.transfers': '代币转账',
    'address.transfers.empty.title': '没有代币转账',
    'address.transfers.empty.hint': '该地址的 ERC-20、721 和 1155 转移会显示在这里。',
    'address.transfers.token': '代币',

    // --- Flow ledger --------------------------------------------------------------------------
    'flow.title': '流向',
    'flow.in': '流入',
    'flow.out': '流出',
    'flow.empty': '这里还没有交易。当该地址发送或接收时，动向会显示在这里。',
    'flow.legend': '柱形相对于所示最大动向绘制。金额以 {symbol} 计。',
    'flow.call': '调用',
    'flow.contractCreated': '已创建合约',

    // --- Cadence ------------------------------------------------------------------------------
    'cadence.title': '节奏',
    'cadence.caption': '最近 {count} 个区块 - 高度为已用 Gas',
    'cadence.chart': '最近 {count} 个区块的 Gas 用量',
    'cadence.bar': '区块 {number}，{count} 笔交易',
    'cadence.now': '现在',

    // --- Shared chain wording -----------------------------------------------------------------
    'chain.contractCreation': '合约创建',
    'chain.to': '至 {address}',
    'chain.txCount': '{count} 笔',
    'chain.gasShare': '{percent}% Gas',
    'chain.notAvailable': '无',
    'chain.status.success': '成功',
    'chain.status.reverted': '已回滚',
    'chain.status.unknown': '未知',

    // --- Copy / wallet ------------------------------------------------------------------------
    'copy.action': '复制 {value}',
    'copy.done': '已复制到剪贴板',
    'copy.blocked': '浏览器阻止了剪贴板访问',

    'wallet.add': '添加 {chain}',
    'wallet.missing': '未找到钱包 - 请安装 MetaMask 后重试',
    'wallet.added': '{chain} 已添加到你的钱包',
    'wallet.dismissed': '请求已取消',
    'wallet.refused': '钱包拒绝添加该网络',
    'wallet.mismatch': '钱包中已用不同的货币符号保存了该网络。请先在钱包中删除，再重试。',

    // --- Pagination ---------------------------------------------------------------------------
    'pagination.label': '分页',
    'pagination.first': '第一页',
    'pagination.newer': '较新',
    'pagination.older': '较早',
    'pagination.last': '最后一页',
    'pagination.page': '第 {number} 页',

    // --- Toasts -------------------------------------------------------------------------------
    'toast.dismiss': '关闭',

    // --- Error and not-found ------------------------------------------------------------------
    'error.title': '页面出错了',
    'error.hint': '渲染时出现问题。链和索引没有受影响 - 重试通常即可恢复。',
    'error.retry': '重试',
    'error.home': '返回总览',

    'notFound.title': '未找到',
    'notFound.heading': '此地址下没有内容',
    'notFound.hint': '该页面不存在。如果你在查看某个区块、交易或账户，请核对下方的值 - 或者稍后再试，索引器可能还没到达。',

    // --- Footer -------------------------------------------------------------------------------
    'footer.tagline': '一个开放的区块浏览器。每个区块、交易和转账都在本地索引，让你能沿着链追踪价值。',
    'footer.explore': '浏览',
    'footer.community': '社区',
    'footer.note': '数据来自链的本地索引。余额从节点实时读取。',
    'footer.builtWith': '基于',

    // --- Time and units -----------------------------------------------------------------------
    // Chinese does not inflect for number, so both forms are the same string.
    'time.justNow': '刚刚',
    'time.second': '{count} 秒前',
    'time.seconds': '{count} 秒前',
    'time.minute': '{count} 分钟前',
    'time.minutes': '{count} 分钟前',
    'time.hour': '{count} 小时前',
    'time.hours': '{count} 小时前',
    'time.day': '{count} 天前',
    'time.days': '{count} 天前',

    'unit.bytes': '{count} B',
    'unit.kilobytes': '{count} KB',
    'unit.gwei': '{amount} gwei',

    // --- Page titles --------------------------------------------------------------------------
    'title.chainExplorer': '{chain} 区块浏览器',
    'title.chainFallback': '链'
};
