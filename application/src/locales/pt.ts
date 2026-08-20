import type { Dictionary } from './en.ts';

// Portuguese (pt-BR - most readers, and the number and date conventions follow). Typed against
// the English dictionary, so a key added there and forgotten here is a build error rather than
// an English string leaking into a Portuguese page.
//
// Untranslated on purpose: `gwei`, ERC standard numbers, token symbols, addresses and hashes.
export const pt: Dictionary = {
    // --- Brand --------------------------------------------------------------------------------
    // «Explorador Nura». The common noun leads, so the accent leads with it and the proper noun
    // moves to `trail`.
    'brand.name': 'Explorador Nura',
    'brand.lead': '',
    'brand.accent': 'Explorador',
    'brand.trail': 'Nura',

    // --- Chrome -------------------------------------------------------------------------------
    'nav.sections': 'Seções',
    'nav.home': 'Início',
    'nav.blocks': 'Blocos',
    'nav.transactions': 'Transações',
    'nav.accounts': 'Contas',
    'nav.overview': 'Visão geral',
    'nav.menu': 'Menu',
    'nav.open': 'Abrir a navegação',
    'nav.close': 'Fechar a navegação',
    'nav.elsewhere': 'Em outros lugares',

    'theme.label': 'Tema',
    'theme.dark': 'Escuro',
    'theme.light': 'Claro',

    'language.label': 'Idioma',

    // --- Search -------------------------------------------------------------------------------
    'search.label': 'Pesquisar por endereço, hash de transação ou número de bloco',
    'search.placeholder': 'Endereço, hash de transação ou número de bloco',
    'search.placeholder.compact': 'Pesquisar',
    'search.go': 'Ir',
    'search.missing': 'Nada indexado com esse valor. Verifique-o, ou aguarde se o bloco for muito recente.',
    'search.failed': 'A pesquisa falhou - o explorador não conseguiu alcançar seu índice.',

    // --- Home ---------------------------------------------------------------------------------
    'home.hero.lead': 'Siga a',
    'home.hero.accent': 'luz',
    'home.hero.through': 'pela',
    'home.hero.fallback': 'cadeia',
    'home.hero.trail': '',
    'home.tagline': 'Cada bloco, transação e transferência, indexados para você ver exatamente onde o valor se moveu.',
    'home.behind': 'Indexando - {count} blocos atrás do nó.',
    'home.stat.height': 'Altura',
    'home.stat.transactions': 'Transações',
    'home.stat.blockTime': 'Tempo de bloco',
    'home.stat.baseFee': 'Taxa base',
    'home.latestBlocks': 'Últimos blocos',
    'home.latestTransactions': 'Últimas transações',
    'home.all': 'Tudo',
    'home.empty.blocks': 'Aguardando o primeiro bloco',
    'home.empty.transactions': 'Ainda sem transações',

    // --- Blocks list --------------------------------------------------------------------------
    'blocks.title': 'Blocos',
    'blocks.empty.title': 'Ainda não há blocos indexados',
    'blocks.empty.hint': 'Os blocos aparecem aqui à medida que o indexador os lê da cadeia.',
    'blocks.empty.filtered.title': 'Nenhum bloco levou nada',
    'blocks.empty.filtered.hint': 'Todos os blocos do índice estão vazios. Remova o filtro para vê-los.',
    'blocks.total': '{count} blocos indexados.',
    'blocks.total.filtered': '{count} blocos levam transações.',
    'blocks.gasTooltip': '{used} de {limit} de gás usado',

    // --- Transactions list --------------------------------------------------------------------
    'txs.title': 'Transações',
    'txs.empty.title': 'Ainda não há transações indexadas',
    'txs.empty.hint': 'Toda transação que a cadeia minera chega aqui.',
    'txs.empty.filtered.title': 'Nenhuma transação corresponde',
    'txs.empty.filtered.hint': 'Nada no índice tem este estado. Remova o filtro para ver o resto.',
    'txs.total': '{count} transações indexadas.',
    'txs.total.filtered': '{count} transações correspondem.',

    // --- Block detail -------------------------------------------------------------------------
    'block.title': 'Bloco #{number}',
    'block.missing.title': 'Bloco fora do índice',
    'block.missing.hint': 'Pode ser mais novo do que o indexador alcançou, ou anterior ao bloco inicial.',
    'block.previous': 'Bloco anterior',
    'block.next': 'Próximo bloco',
    'block.hash': 'Hash',
    'block.parent': 'Pai',
    'block.validator': 'Validador',
    'block.size': 'Tamanho',
    'block.gasUsed': 'Gás usado',
    'block.gasOf': 'de {limit}',
    'block.baseFee': 'Taxa base',
    'block.transactions': '{count} transações',
    'block.empty.title': 'Este bloco está vazio',
    'block.empty.hint': 'Nenhuma transação foi incluída nele.',

    // --- Transaction detail -------------------------------------------------------------------
    'tx.title': 'Transação',
    'tx.missing.title': 'Transação fora do índice',
    'tx.missing.hint': 'Pode ainda estar pendente, ou ser mais nova do que o indexador alcançou.',
    'tx.reverted.notice': 'Esta transação foi revertida. Nenhum valor se moveu, mas o remetente ainda pagou o gás abaixo.',
    'tx.hash': 'Hash',
    'tx.block': 'Bloco',
    'tx.position': 'posição {index}',
    'tx.from': 'De',
    'tx.to': 'Para',
    'tx.value': 'Valor',
    'tx.fee': 'Taxa',
    'tx.feeDetail': '{gas} de gás a {price}',
    'tx.nonce': 'Nonce',
    'tx.calldata': 'calldata {size}',
    'tx.created': 'criado',
    'tx.transfers': 'Transferências de tokens',
    'tx.token': 'token',

    // --- Address ------------------------------------------------------------------------------
    'address.title': 'Endereço {short}',
    'address.kind.address': 'Endereço',
    'address.kind.contract': 'Contrato',
    'address.kind.token': 'Token',
    'address.activity': 'Atividade',
    'address.balance': 'Saldo',
    'address.received': 'Recebido',
    'address.sent': 'Enviado',
    'address.fees': 'Taxas pagas',
    'address.tab.transactions': 'Transações',
    'address.tab.transfers': 'Transferências de tokens',
    'address.tab.contract': 'Contrato',
    'address.transfers.empty.title': 'Sem transferências de tokens',
    'address.transfers.empty.hint': 'Os movimentos ERC-20, 721 e 1155 deste endereço aparecem aqui.',
    'address.transfers.token': 'Token',

    // --- Contas (lista das maiores) -------------------------
    'accounts.title': 'Maiores contas',
    'accounts.hint': 'Ordenadas pelo saldo nativo, lido ao vivo do nó para cada endereço que o explorador viu.',
    'accounts.empty.title': 'Nenhuma conta indexada ainda',
    'accounts.empty.hint': 'As contas aparecem aqui após a primeira transação da cadeia.',
    'accounts.search.label': 'Buscar na classificação por endereço',
    'accounts.search.placeholder': 'Endereço',
    'accounts.search.empty.title': 'Nenhuma conta corresponde',
    'accounts.search.empty.hint': 'Nenhum endereço classificado contém isso. Aqui só aparecem os endereços que o explorador viu com saldo.',
    'accounts.total': '{count} contas classificadas.',
    'accounts.total.filtered': '{count} contas correspondem.',

    // --- Contrato -----------------------------------------
    'contract.compiler': 'Compilador',
    'contract.size': 'Tamanho do código',
    'contract.deployer': 'Implantado por',
    'contract.deployedAt': 'Implantado em',
    'contract.metadata': 'Metadados da fonte',
    'contract.standards': 'Interfaces',
    'contract.proxy': 'Proxy',
    'contract.viaImplementation': 'São as funções da implementação para a qual este endereço encaminha, não as do seu próprio código.',
    'contract.reads': 'Valores atuais',
    'contract.functions': 'Funções',
    'contract.functions.named': '{named} de {total} nomeadas',
    'contract.functions.empty.title': 'Nenhum ponto de entrada encontrado',
    'contract.functions.empty.hint': 'Nada neste bytecode é comparado com um seletor de função. Pode ser um proxy, um clone ou assembly escrito à mão.',
    'contract.events': 'Eventos',
    'contract.bytecode': 'Bytecode',
    'contract.bytecode.show': 'Mostrar',
    'contract.bytecode.hide': 'Ocultar',
    'contract.unnamed': 'função sem nome',
    'contract.mutability.view': 'leitura',
    'contract.mutability.pure': 'pura',
    'contract.mutability.nonpayable': 'escrita',
    'contract.mutability.payable': 'pagável',
    'contract.mutability.library': 'biblioteca',
    'contract.mutability.unknown': 'desconhecida',

    'contract.read': 'Leitura',
    'contract.read.hint': 'Respondido por este explorador. Sem carteira e sem taxa.',
    'contract.write': 'Escrita',
    'contract.write.hint': 'Estas enviam uma transação a partir da sua própria carteira, nesta rede. A carteira pergunta antes de assinar qualquer coisa, e o gás é pago por você.',
    'contract.unnamedGroup': 'Seletores sem nome',
    'contract.libraryGroup': 'Funções de biblioteca',
    'contract.library.hint': 'Executadas por delegatecall a partir do contrato que as vinculou, por isso não podem ser chamadas aqui.',
    'contract.call.query': 'Consultar',
    'contract.call.write': 'Escrever',
    'contract.call.value': 'Valor a enviar ({symbol})',
    'contract.call.badAmount': 'Esse não é um valor que esta rede possa enviar.',
    'contract.call.sent': 'Transação enviada',
    'contract.call.noReturn': 'A chamada não devolveu nada.',

    // --- Flow ledger --------------------------------------------------------------------------
    'flow.title': 'Fluxo',
    'flow.in': 'entrada',
    'flow.out': 'saída',
    'flow.empty': 'Ainda não há transações aqui. Quando este endereço enviar ou receber, o movimento aparece aqui.',
    'flow.legend': 'As barras são relativas ao maior movimento exibido. Valores em {symbol}.',
    'flow.call': 'chamada',
    'flow.contractCreated': 'contrato criado',

    // --- Cadence ------------------------------------------------------------------------------
    'cadence.title': 'Cadência',
    'cadence.caption': 'últimos {count} blocos - a altura é o gás usado',
    'cadence.chart': 'Gás usado nos últimos {count} blocos',
    'cadence.bar': 'Bloco {number}, {count} transações',
    'cadence.now': 'agora',

    // --- Shared chain wording -----------------------------------------------------------------
    'chain.contractCreation': 'criação de contrato',
    'chain.to': 'para {address}',
    'chain.txCount': '{count} tx',
    'chain.gasShare': '{percent}% de gás',
    'chain.notAvailable': 'n/d',
    'chain.status.success': 'sucesso',
    'chain.status.reverted': 'revertida',
    'chain.status.unknown': 'desconhecida',

    // --- Copy / wallet ------------------------------------------------------------------------
    'copy.action': 'Copiar {value}',
    'copy.done': 'Copiado para a área de transferência',
    'copy.blocked': 'Seu navegador bloqueou o acesso à área de transferência',

    'wallet.add': 'Adicionar {chain}',
    'wallet.missing': 'Nenhuma carteira encontrada - instale a MetaMask e tente novamente',
    'wallet.added': '{chain} adicionada à sua carteira',
    'wallet.dismissed': 'Solicitação dispensada',
    'wallet.refused': 'Sua carteira recusou adicionar a rede',
    'wallet.mismatch': 'Sua carteira já tem esta rede salva com outro símbolo de moeda. Remova-a lá e tente novamente.',
    'wallet.connect': 'Conectar carteira',
    'wallet.switch': 'Mudar para {chain}',
    'wallet.switchFailed': 'Sua carteira não mudou para {chain}. Adicione a rede primeiro e tente de novo.',

    // --- Filters ------------------------------------------------------------------------------
    'filter.all': 'Tudo',
    'filter.status': 'Estado',
    'filter.status.success': 'Bem-sucedidas',
    'filter.status.reverted': 'Revertidas',
    'filter.content': 'Conteúdo do bloco',
    'filter.content.filled': 'Com transações',
    // --- Pagination ---------------------------------------------------------------------------
    'pagination.label': 'Paginação',
    'pagination.first': 'Primeira página',
    'pagination.newer': 'Mais recentes',
    'pagination.older': 'Mais antigas',
    'pagination.last': 'Última página',
    'pagination.page': 'Página {number}',

    // --- Toasts -------------------------------------------------------------------------------
    'toast.dismiss': 'Fechar',

    // --- Error and not-found ------------------------------------------------------------------
    'error.title': 'Esta página parou de funcionar',
    'error.hint': 'Algo falhou ao renderizar. A cadeia e o índice estão intactos - tentar de novo costuma resolver.',
    'error.retry': 'Tentar novamente',
    'error.home': 'Voltar à visão geral',

    'notFound.title': 'Não encontrado',
    'notFound.heading': 'Nada neste endereço',
    'notFound.hint': 'Esta página não existe. Se você seguia um bloco, transação ou conta, verifique o valor abaixo - ou tente de novo em instantes, se o indexador ainda não o alcançou.',

    // --- Footer -------------------------------------------------------------------------------
    'footer.tagline': 'Um explorador de blocos aberto. Cada bloco, transação e transferência é indexado localmente, para você seguir o valor pela cadeia.',
    'footer.explore': 'Explorar',
    'footer.community': 'Comunidade',
    'footer.note': 'As leituras vêm de um índice local da cadeia. Os saldos são lidos ao vivo do nó.',
    'footer.builtWith': 'Feito com',
    'footer.version': 'Versão',

    // --- Time and units -----------------------------------------------------------------------
    'time.justNow': 'agora mesmo',
    'time.second': 'há {count} segundo',
    'time.seconds': 'há {count} segundos',
    'time.minute': 'há {count} minuto',
    'time.minutes': 'há {count} minutos',
    'time.hour': 'há {count} hora',
    'time.hours': 'há {count} horas',
    'time.day': 'há {count} dia',
    'time.days': 'há {count} dias',

    'unit.bytes': '{count} B',
    'unit.kilobytes': '{count} KB',
    'unit.gwei': '{amount} gwei',

    // --- Page titles --------------------------------------------------------------------------
    'title.chainExplorer': 'Explorador de {chain}',
    'title.chainFallback': 'Cadeia'
};
