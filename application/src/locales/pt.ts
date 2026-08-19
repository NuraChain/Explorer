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
    'blocks.total': '{count} blocos indexados.',
    'blocks.gasTooltip': '{used} de {limit} de gás usado',

    // --- Transactions list --------------------------------------------------------------------
    'txs.title': 'Transações',
    'txs.empty.title': 'Ainda não há transações indexadas',
    'txs.empty.hint': 'Toda transação que a cadeia minera chega aqui.',
    'txs.total': '{count} transações indexadas.',

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

    // --- Contrato -----------------------------------------
    'contract.notice': 'Nenhum código-fonte foi publicado para este contrato. Tudo abaixo é lido do bytecode implantado na rede.',
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
    'contract.mutability.unknown': 'desconhecida',

    'contract.read': 'Leitura',
    'contract.read.hint': 'Respondido por este explorador. Sem carteira e sem taxa.',
    'contract.write': 'Escrita',
    'contract.write.hint': 'Estas enviam uma transação a partir da sua própria carteira, nesta rede. A carteira pergunta antes de assinar qualquer coisa, e o gás é pago por você.',
    'contract.unnamedGroup': 'Seletores sem nome',
    'contract.call.query': 'Consultar',
    'contract.call.write': 'Escrever',
    'contract.call.value': 'Valor a enviar ({symbol})',
    'contract.call.badAmount': 'Esse não é um valor que esta rede possa enviar.',
    'contract.call.sent': 'Transação enviada',
    'contract.call.noReturn': 'A chamada não devolveu nada.',

    // --- Verified source ----------------------------------------------------------------------
    'contract.verified.full': 'Código-fonte verificado',
    'contract.verified.partial': 'Código-fonte verificado - correspondência parcial',
    'contract.verified.detail': '{name}, compilado com solc {compiler}',
    'contract.verified.partial.hint': 'O código implantado corresponde; só difere a cauda de metadados, e basta um comentário deslocado ou outro caminho de arquivo para mudá-la. As instruções estão provadas; os comentários em torno delas, não.',
    'contract.verified.viaImplementation': 'O código publicado pertence à implementação para a qual este endereço encaminha.',
    'contract.source': 'Código-fonte',
    'contract.source.optimized': 'otimizador ligado, {runs} execuções',
    'contract.source.unoptimized': 'otimizador desligado',
    'contract.source.copyAbi': 'Copiar ABI',

    // --- Publishing source --------------------------------------------------------------------
    'verify.cta': 'Publicar o código',
    'verify.title': 'Verificar {short}',
    'verify.heading': 'Publicar e verificar o código-fonte',
    'verify.intro': 'Aqui nada é aceito por confiança. Este explorador compila o que você envia e só aceita se o resultado for o bytecode já implantado neste endereço - não há conta a criar nem ninguém a esperar.',
    'verify.offline': 'Não foi possível obter a lista de compiladores, então só dá para usar as versões já presentes neste servidor. Peça a quem o administra que adicione a de que você precisa.',
    'verify.kind': 'Formato de envio',
    'verify.kind.single': 'Arquivo único',
    'verify.kind.json': 'Standard JSON',
    'verify.compiler': 'Build do compilador',
    'verify.compiler.hint': 'O build exato, não apenas a versão - a saída do solc muda entre correções. Um ponto marca os builds já presentes neste servidor.',
    'verify.evmVersion': 'Versão da EVM',
    'verify.evmVersion.default': 'O padrão do compilador',
    'verify.evmVersion.hint': 'Deixe no padrão a menos que o contrato tenha sido compilado com um valor explícito. Escolher outro muda os opcodes gerados.',
    'verify.name': 'Nome do contrato',
    'verify.name.hint': 'Opcional. Vazio, cada contrato do código é testado.',
    'verify.fileName': 'Nome do arquivo',
    'verify.fileName.hint': 'O caminho sob o qual o arquivo foi compilado. Ele entra no hash dos metadados, então o errado transforma uma correspondência completa em parcial.',
    'verify.optimizer': 'Otimizador',
    'verify.optimizer.enabled': 'Ativado',
    'verify.optimizer.hint': 'Precisam ser os mesmos usados na implantação, senão o bytecode não será.',
    'verify.runs': 'Execuções do otimizador',
    'verify.license': 'Licença',
    'verify.source': 'Código Solidity',
    'verify.source.placeholder': 'Cole o contrato inteiro, com os imports.',
    'verify.json': 'Entrada Standard JSON',
    'verify.json.placeholder': 'Cole a entrada solc standard-json que sua build produziu.',
    'verify.json.hint': 'As configurações são usadas exatamente como escritas - remappings, endereços de bibliotecas e viaIR inclusive. Só a seleção de saída é ampliada.',
    'verify.submit': 'Verificar e publicar',
    'verify.submit.hint': 'Compilar leva alguns segundos, e um envio roda por vez.',
    'verify.failed.hint': 'Uma divergência quase sempre é o build do compilador, o ajuste do otimizador ou o número de execuções. Compare cada um com o que foi usado na implantação.',
    'verify.done.detail': 'O código de {name} está publicado neste contrato, e suas funções agora têm nome e podem ser chamadas.',
    'verify.done.open': 'Abrir o contrato',

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
