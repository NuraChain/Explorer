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
    'nav.accounts': '账户',
    'nav.charts': '图表',
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
    'blocks.empty.filtered.title': '没有含交易的区块',
    'blocks.empty.filtered.hint': '索引中的每个区块都是空的。清除筛选即可看到它们。',
    'blocks.total': '已索引 {count} 个区块。',
    'blocks.total.filtered': '{count} 个区块含有交易。',
    'blocks.gasTooltip': '已用 {used} / {limit} Gas',

    // --- Transactions list --------------------------------------------------------------------
    'txs.title': '交易',
    'txs.empty.title': '尚未索引任何交易',
    'txs.empty.hint': '链上打包的每笔交易都会来到这里。',
    'txs.empty.filtered.title': '没有匹配的交易',
    'txs.empty.filtered.hint': '索引中没有该状态的交易。清除筛选即可看到其余交易。',
    'txs.total': '已索引 {count} 笔交易。',
    'txs.total.filtered': '{count} 笔交易匹配。',

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
    'tx.transfers': '{count} 笔代币转账',
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
    'address.tab.contract': '合约',
    'address.transfers.empty.title': '没有代币转账',
    'address.transfers.empty.hint': '该地址的 ERC-20、721 和 1155 转移会显示在这里。',
    'address.transfers.token': '代币',

    // --- 账户（排行） ---------------------------------------
    'accounts.title': '账户排行',
    'accounts.hint': '按原生余额排序，余额从节点实时读取（针对浏览器所见过的每个地址）。',
    'accounts.empty.title': '暂无已索引账户',
    'accounts.empty.hint': '链上出现第一笔交易后，账户将显示在这里。',
    'accounts.search.label': '按地址搜索排行',
    'accounts.search.placeholder': '地址',
    'accounts.search.empty.title': '没有匹配的账户',
    'accounts.search.empty.hint': '排行中没有包含该内容的地址。这里只列出浏览器见过且持有余额的地址。',
    'accounts.total': '已排行 {count} 个账户。',
    'accounts.total.filtered': '{count} 个账户匹配。',

    // --- 合约 -----------------------------------------
    'contract.compiler': '编译器',
    'contract.size': '代码大小',
    'contract.deployer': '部署者',
    'contract.deployedAt': '部署于',
    'contract.metadata': '源码元数据',
    'contract.standards': '接口',
    'contract.proxy': '代理',
    'contract.viaImplementation': '这些是此地址转发到的实现合约的函数，而非它自身代码的函数。',
    'contract.reads': '当前取值',
    'contract.functions': '函数',
    'contract.functions.named': '{total} 个中有 {named} 个已识别',
    'contract.functions.empty.title': '未找到入口',
    'contract.functions.empty.hint': '此字节码中没有任何与函数选择器的比较。它可能是代理、克隆或手写汇编。',
    'contract.events': '事件',
    'contract.bytecode': '字节码',
    'contract.bytecode.show': '展开',
    'contract.bytecode.hide': '收起',
    'contract.unnamed': '未命名函数',
    'contract.mutability.view': '读取',
    'contract.mutability.pure': '纯函数',
    'contract.mutability.nonpayable': '写入',
    'contract.mutability.payable': '可支付',
    'contract.mutability.library': '库',
    'contract.mutability.unknown': '未知',

    'contract.read': '读取',
    'contract.read.hint': '由本浏览器作答。无需钱包，也不收费。',
    'contract.write': '写入',
    'contract.write.hint': '这些会从你自己的钱包在本网络上发出交易。签名前钱包会询问，燃料费由你支付。',
    'contract.unnamedGroup': '未命名选择器',
    'contract.libraryGroup': '库函数',
    'contract.library.hint': '由链接它们的合约通过 delegatecall 执行，因此无法在此调用。',
    'contract.call.query': '查询',
    'contract.call.write': '写入',
    'contract.call.value': '随调用发送的金额（{symbol}）',
    'contract.call.badAmount': '这不是本链可以发送的金额。',
    'contract.call.sent': '交易已发出',
    'contract.call.noReturn': '此调用没有返回值。',

    // --- Flow ledger --------------------------------------------------------------------------
    'flow.title': '流向',
    'flow.in': '流入',
    'flow.out': '流出',
    'flow.empty': '这里还没有交易。当该地址发送或接收时，动向会显示在这里。',
    'flow.empty.filtered': '这个方向上没有任何流动。清除筛选即可看到账目的其余部分。',
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
    'wallet.connect': '连接钱包',
    'wallet.switch': '切换到 {chain}',
    'wallet.switchFailed': '你的钱包没有切换到 {chain}。请先添加该网络，然后重试。',

    // --- Charts -------------------------------------------------------------------------------
    'charts.title': '图表与统计',
    'charts.hint': '下面的每个数字都来自本浏览器自己的索引，并随索引器读取链上数据而更新。',
    'charts.range': '范围',
    'charts.range.days': '最近 {count} 天',
    'charts.section.totals': '累计',
    'charts.section.day': '最近 24 小时',
    'charts.section.blockchain': '链上数据',
    'charts.section.network': '网络数据',
    'charts.section.contracts': '代币与合约',
    'charts.change.total': '最近 24 小时新增',
    'charts.change.day': '相较于之前的 24 小时',
    'charts.chart.latest': '最新',
    'charts.chart.empty': '此范围内尚无已索引的日期。',
    'charts.chart.summary': '{count} 天的{title}。峰值 {peak}，最新 {latest}。',
    'charts.footnote': '这里的每个数字都来自本浏览器自己的索引。它没有价格源、没有内存池订阅、也没有合约验证服务，因此没有行情图、没有待处理交易数、也没有已验证合约数——为一个无人测量的数字画图，比不画更糟。',
    'charts.metric.blocks': '区块',
    'charts.metric.transactions': '交易',
    'charts.metric.transfers': '代币转账',
    'charts.metric.addresses': '地址',
    'charts.metric.activeAddresses': '活跃地址',
    'charts.metric.newAddresses': '新增地址',
    'charts.metric.tokens': '代币',
    'charts.metric.contracts': '已部署合约',
    'charts.metric.fees': '交易手续费',
    'charts.metric.averageFee': '平均交易手续费',
    'charts.metric.gasUsed': '已用 Gas',
    'charts.metric.gasPrice': '平均 Gas 价格',
    'charts.metric.utilization': '网络利用率',
    'charts.metric.blockTime': '平均出块时间',
    'charts.metric.blockSize': '平均区块大小',

    // --- Filters ------------------------------------------------------------------------------
    'filter.all': '全部',
    'filter.status': '状态',
    'filter.status.success': '成功',
    'filter.status.reverted': '已回滚',
    'filter.content': '区块内容',
    'filter.content.filled': '含交易',
    'filter.direction': '方向',
    'filter.direction.in': '收到',
    'filter.direction.out': '发出',
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
    'footer.version': '版本',

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
    'unit.seconds': '{count} 秒',
    'unit.percent': '{count}%',

    // --- Page titles --------------------------------------------------------------------------
    'title.chainExplorer': '{chain} 区块浏览器',
    'title.chainFallback': '链'
};
