import type { Dictionary } from './en.ts';

// Spanish (es-ES). Typed against the English dictionary, so a key added there and forgotten here
// is a build error rather than an English string leaking into a Spanish page.
//
// Untranslated on purpose: `gwei`, ERC standard numbers, token symbols, addresses and hashes.
// `hash`, `token` and `calldata` stay as the community reads them; `cartera` over `billetera`
// because the tag is es-ES.
export const es: Dictionary = {
    // --- Brand --------------------------------------------------------------------------------
    // «Explorador Nura». The common noun leads, so the accent leads with it and the proper noun
    // moves to `trail` - the same slot reversal Persian uses, without changing script.
    'brand.name': 'Explorador Nura',
    'brand.lead': '',
    'brand.accent': 'Explorador',
    'brand.trail': 'Nura',

    // --- Chrome -------------------------------------------------------------------------------
    'nav.sections': 'Secciones',
    'nav.home': 'Inicio',
    'nav.blocks': 'Bloques',
    'nav.transactions': 'Transacciones',
    'nav.accounts': 'Cuentas',
    'nav.overview': 'Resumen',
    'nav.menu': 'Menú',
    'nav.open': 'Abrir la navegación',
    'nav.close': 'Cerrar la navegación',
    'nav.elsewhere': 'En otros sitios',

    'theme.label': 'Tema',
    'theme.dark': 'Oscuro',
    'theme.light': 'Claro',

    'language.label': 'Idioma',

    // --- Search -------------------------------------------------------------------------------
    'search.label': 'Buscar por dirección, hash de transacción o número de bloque',
    'search.placeholder': 'Dirección, hash de transacción o número de bloque',
    'search.placeholder.compact': 'Buscar',
    'search.go': 'Ir',
    'search.missing': 'No hay nada indexado con ese valor. Revísalo, o espera si el bloque es muy reciente.',
    'search.failed': 'La búsqueda falló: el explorador no pudo alcanzar su índice.',

    // --- Home ---------------------------------------------------------------------------------
    'home.hero.lead': 'Sigue la',
    'home.hero.accent': 'luz',
    'home.hero.through': 'por',
    'home.hero.fallback': 'la cadena',
    'home.hero.trail': '',
    'home.tagline': 'Cada bloque, transacción y transferencia, indexados para que veas exactamente dónde se movió el valor.',
    'home.behind': 'Indexando: {count} bloques por detrás del nodo.',
    'home.stat.height': 'Altura',
    'home.stat.transactions': 'Transacciones',
    'home.stat.blockTime': 'Tiempo de bloque',
    'home.stat.baseFee': 'Tarifa base',
    'home.latestBlocks': 'Últimos bloques',
    'home.latestTransactions': 'Últimas transacciones',
    'home.all': 'Todo',
    'home.empty.blocks': 'Esperando el primer bloque',
    'home.empty.transactions': 'Aún no hay transacciones',

    // --- Blocks list --------------------------------------------------------------------------
    'blocks.title': 'Bloques',
    'blocks.empty.title': 'Aún no hay bloques indexados',
    'blocks.empty.hint': 'Los bloques aparecen aquí a medida que el indexador los lee de la cadena.',
    'blocks.empty.filtered.title': 'Ningún bloque llevó nada',
    'blocks.empty.filtered.hint': 'Todos los bloques del índice están vacíos. Quita el filtro para verlos.',
    'blocks.total': '{count} bloques indexados.',
    'blocks.total.filtered': '{count} bloques llevan transacciones.',
    'blocks.gasTooltip': '{used} de {limit} de gas usado',

    // --- Transactions list --------------------------------------------------------------------
    'txs.title': 'Transacciones',
    'txs.empty.title': 'Aún no hay transacciones indexadas',
    'txs.empty.hint': 'Cada transacción que la cadena mina llega aquí.',
    'txs.empty.filtered.title': 'Ninguna transacción coincide',
    'txs.empty.filtered.hint': 'Nada en el índice tiene este estado. Quita el filtro para ver el resto.',
    'txs.total': '{count} transacciones indexadas.',
    'txs.total.filtered': '{count} transacciones coinciden.',

    // --- Block detail -------------------------------------------------------------------------
    'block.title': 'Bloque #{number}',
    'block.missing.title': 'El bloque no está en el índice',
    'block.missing.hint': 'Puede ser más nuevo de lo que ha alcanzado el indexador, o anterior al bloque inicial.',
    'block.previous': 'Bloque anterior',
    'block.next': 'Bloque siguiente',
    'block.hash': 'Hash',
    'block.parent': 'Padre',
    'block.validator': 'Validador',
    'block.size': 'Tamaño',
    'block.gasUsed': 'Gas usado',
    'block.gasOf': 'de {limit}',
    'block.baseFee': 'Tarifa base',
    'block.transactions': '{count} transacciones',
    'block.empty.title': 'Este bloque está vacío',
    'block.empty.hint': 'No se incluyó ninguna transacción en él.',

    // --- Transaction detail -------------------------------------------------------------------
    'tx.title': 'Transacción',
    'tx.missing.title': 'La transacción no está en el índice',
    'tx.missing.hint': 'Puede que siga pendiente, o que sea más nueva de lo que ha alcanzado el indexador.',
    'tx.reverted.notice': 'Esta transacción se revirtió. No se movió ningún valor, pero el remitente pagó igualmente el gas de abajo.',
    'tx.hash': 'Hash',
    'tx.block': 'Bloque',
    'tx.position': 'posición {index}',
    'tx.from': 'De',
    'tx.to': 'Para',
    'tx.value': 'Valor',
    'tx.fee': 'Tarifa',
    'tx.feeDetail': '{gas} de gas a {price}',
    'tx.nonce': 'Nonce',
    'tx.calldata': 'calldata {size}',
    'tx.created': 'creado',
    'tx.transfers': 'Transferencias de tokens',
    'tx.token': 'token',

    // --- Address ------------------------------------------------------------------------------
    'address.title': 'Dirección {short}',
    'address.kind.address': 'Dirección',
    'address.kind.contract': 'Contrato',
    'address.kind.token': 'Token',
    'address.activity': 'Actividad',
    'address.balance': 'Saldo',
    'address.received': 'Recibido',
    'address.sent': 'Enviado',
    'address.fees': 'Tarifas pagadas',
    'address.tab.transactions': 'Transacciones',
    'address.tab.transfers': 'Transferencias de tokens',
    'address.tab.contract': 'Contrato',
    'address.transfers.empty.title': 'Sin transferencias de tokens',
    'address.transfers.empty.hint': 'Los movimientos ERC-20, 721 y 1155 de esta dirección aparecen aquí.',
    'address.transfers.token': 'Token',

    // --- Cuentas (lista principal) -------------------------
    'accounts.title': 'Cuentas principales',
    'accounts.hint': 'Ordenadas por saldo nativo, leído en vivo del nodo para cada dirección que el explorador ha visto.',
    'accounts.empty.title': 'Aún no hay cuentas indexadas',
    'accounts.empty.hint': 'Las cuentas aparecen aquí una vez la cadena registra su primera transacción.',

    // --- Contrato -----------------------------------------
    'contract.compiler': 'Compilador',
    'contract.size': 'Tamaño del código',
    'contract.deployer': 'Desplegado por',
    'contract.deployedAt': 'Desplegado en',
    'contract.metadata': 'Metadatos de la fuente',
    'contract.standards': 'Interfaces',
    'contract.proxy': 'Proxy',
    'contract.viaImplementation': 'Son las funciones de la implementación a la que reenvía esta dirección, no las de su propio código.',
    'contract.reads': 'Valores actuales',
    'contract.functions': 'Funciones',
    'contract.functions.named': '{named} de {total} con nombre',
    'contract.functions.empty.title': 'No se encontraron puntos de entrada',
    'contract.functions.empty.hint': 'Nada en este bytecode se compara con un selector de función. Puede ser un proxy, un clon o ensamblador escrito a mano.',
    'contract.events': 'Eventos',
    'contract.bytecode': 'Bytecode',
    'contract.bytecode.show': 'Mostrar',
    'contract.bytecode.hide': 'Ocultar',
    'contract.unnamed': 'función sin nombre',
    'contract.mutability.view': 'lectura',
    'contract.mutability.pure': 'pura',
    'contract.mutability.nonpayable': 'escritura',
    'contract.mutability.payable': 'pagable',
    'contract.mutability.library': 'biblioteca',
    'contract.mutability.unknown': 'desconocida',

    'contract.read': 'Lectura',
    'contract.read.hint': 'Lo responde este explorador. Sin cartera y sin comisión.',
    'contract.write': 'Escritura',
    'contract.write.hint': 'Estas envían una transacción desde tu propia cartera, en esta red. Tu cartera pregunta antes de firmar nada, y el gas lo pagas tú.',
    'contract.unnamedGroup': 'Selectores sin nombre',
    'contract.libraryGroup': 'Funciones de biblioteca',
    'contract.library.hint': 'Se ejecutan por delegatecall desde el contrato que las enlazó, así que aquí no se pueden llamar.',
    'contract.call.query': 'Consultar',
    'contract.call.write': 'Escribir',
    'contract.call.value': 'Valor a enviar ({symbol})',
    'contract.call.badAmount': 'Esa no es una cantidad que esta cadena pueda enviar.',
    'contract.call.sent': 'Transacción enviada',
    'contract.call.noReturn': 'La llamada no devolvió nada.',

    // --- Flow ledger --------------------------------------------------------------------------
    'flow.title': 'Flujo',
    'flow.in': 'entrada',
    'flow.out': 'salida',
    'flow.empty': 'Aún no hay transacciones aquí. Cuando esta dirección envíe o reciba, el movimiento aparecerá aquí.',
    'flow.legend': 'Las barras son relativas al mayor movimiento mostrado. Importes en {symbol}.',
    'flow.call': 'llamada',
    'flow.contractCreated': 'contrato creado',

    // --- Cadence ------------------------------------------------------------------------------
    'cadence.title': 'Cadencia',
    'cadence.caption': 'últimos {count} bloques: la altura es el gas usado',
    'cadence.chart': 'Gas usado en los últimos {count} bloques',
    'cadence.bar': 'Bloque {number}, {count} transacciones',
    'cadence.now': 'ahora',

    // --- Shared chain wording -----------------------------------------------------------------
    'chain.contractCreation': 'creación de contrato',
    'chain.to': 'a {address}',
    'chain.txCount': '{count} tx',
    'chain.gasShare': '{percent}% de gas',
    'chain.notAvailable': 'n/d',
    'chain.status.success': 'exitosa',
    'chain.status.reverted': 'revertida',
    'chain.status.unknown': 'desconocida',

    // --- Copy / wallet ------------------------------------------------------------------------
    'copy.action': 'Copiar {value}',
    'copy.done': 'Copiado al portapapeles',
    'copy.blocked': 'Tu navegador bloqueó el acceso al portapapeles',

    'wallet.add': 'Añadir {chain}',
    'wallet.missing': 'No se encontró ninguna cartera: instala MetaMask y vuelve a intentarlo',
    'wallet.added': '{chain} añadida a tu cartera',
    'wallet.dismissed': 'Solicitud descartada',
    'wallet.refused': 'Tu cartera rechazó añadir la red',
    'wallet.mismatch': 'Tu cartera ya tiene esta red guardada con otro símbolo de moneda. Elimínala allí y vuelve a intentarlo.',
    'wallet.connect': 'Conectar cartera',
    'wallet.switch': 'Cambiar a {chain}',
    'wallet.switchFailed': 'Tu cartera no cambió a {chain}. Añade la red primero y vuelve a intentarlo.',

    // --- Filters ------------------------------------------------------------------------------
    'filter.all': 'Todo',
    'filter.status': 'Estado',
    'filter.status.success': 'Exitosas',
    'filter.status.reverted': 'Revertidas',
    'filter.content': 'Contenido del bloque',
    'filter.content.filled': 'Con transacciones',
    // --- Pagination ---------------------------------------------------------------------------
    'pagination.label': 'Paginación',
    'pagination.first': 'Primera página',
    'pagination.newer': 'Más recientes',
    'pagination.older': 'Más antiguas',
    'pagination.last': 'Última página',
    'pagination.page': 'Página {number}',

    // --- Toasts -------------------------------------------------------------------------------
    'toast.dismiss': 'Cerrar',

    // --- Error and not-found ------------------------------------------------------------------
    'error.title': 'Esta página dejó de funcionar',
    'error.hint': 'Algo falló al renderizar. La cadena y el índice están intactos: reintentar suele resolverlo.',
    'error.retry': 'Reintentar',
    'error.home': 'Volver al resumen',

    'notFound.title': 'No encontrado',
    'notFound.heading': 'No hay nada en esta dirección',
    'notFound.hint': 'Esta página no existe. Si seguías un bloque, una transacción o una cuenta, revisa el valor de abajo, o vuelve a intentarlo en un momento si el indexador aún no ha llegado.',

    // --- Footer -------------------------------------------------------------------------------
    'footer.tagline': 'Un explorador de bloques abierto. Cada bloque, transacción y transferencia se indexa localmente para que puedas seguir el valor por la cadena.',
    'footer.explore': 'Explorar',
    'footer.community': 'Comunidad',
    'footer.note': 'Las lecturas provienen de un índice local de la cadena. Los saldos se leen en vivo del nodo.',
    'footer.builtWith': 'Hecho con',
    'footer.version': 'Versión',

    // --- Time and units -----------------------------------------------------------------------
    'time.justNow': 'justo ahora',
    'time.second': 'hace {count} segundo',
    'time.seconds': 'hace {count} segundos',
    'time.minute': 'hace {count} minuto',
    'time.minutes': 'hace {count} minutos',
    'time.hour': 'hace {count} hora',
    'time.hours': 'hace {count} horas',
    'time.day': 'hace {count} día',
    'time.days': 'hace {count} días',

    'unit.bytes': '{count} B',
    'unit.kilobytes': '{count} KB',
    'unit.gwei': '{amount} gwei',

    // --- Page titles --------------------------------------------------------------------------
    'title.chainExplorer': 'Explorador de {chain}',
    'title.chainFallback': 'Cadena'
};
