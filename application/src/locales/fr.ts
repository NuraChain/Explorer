import type { Dictionary } from './en.ts';

// French (fr-FR). Typed against the English dictionary, so a key added there and forgotten here
// is a build error rather than an English string leaking into a French page.
//
// Untranslated on purpose: `gwei`, `hash`, `calldata`, ERC standard numbers, token symbols,
// addresses and hashes - the French crypto community reads them as-is. Apostrophes are the
// typographic U+2019, which is also what keeps them out of the string quotes.
export const fr: Dictionary = {
    // --- Brand --------------------------------------------------------------------------------
    // «Explorateur Nura». The common noun leads, so the accent leads with it and the proper noun
    // moves to `trail`.
    'brand.name': 'Explorateur Nura',
    'brand.lead': '',
    'brand.accent': 'Explorateur',
    'brand.trail': 'Nura',

    // --- Chrome -------------------------------------------------------------------------------
    'nav.sections': 'Sections',
    'nav.home': 'Accueil',
    'nav.blocks': 'Blocs',
    'nav.transactions': 'Transactions',
    'nav.overview': 'Vue d’ensemble',
    'nav.menu': 'Menu',
    'nav.open': 'Ouvrir la navigation',
    'nav.close': 'Fermer la navigation',
    'nav.elsewhere': 'Ailleurs',

    'theme.label': 'Thème',
    'theme.dark': 'Sombre',
    'theme.light': 'Clair',

    'language.label': 'Langue',

    // --- Search -------------------------------------------------------------------------------
    'search.label': 'Rechercher par adresse, hash de transaction ou numéro de bloc',
    'search.placeholder': 'Adresse, hash de transaction ou numéro de bloc',
    'search.placeholder.compact': 'Rechercher',
    'search.go': 'Aller',
    'search.missing': 'Rien d’indexé pour cette valeur. Vérifiez-la, ou patientez si le bloc est très récent.',
    'search.failed': 'La recherche a échoué - l’explorateur n’a pas pu joindre son index.',

    // --- Home ---------------------------------------------------------------------------------
    'home.hero.lead': 'Suivez la',
    'home.hero.accent': 'lumière',
    'home.hero.through': 'à travers',
    'home.hero.fallback': 'la chaîne',
    'home.hero.trail': '',
    'home.tagline': 'Chaque bloc, transaction et transfert, indexés pour voir exactement où la valeur s’est déplacée.',
    'home.behind': 'Indexation en cours - {count} blocs derrière le nœud.',
    'home.stat.height': 'Hauteur',
    'home.stat.transactions': 'Transactions',
    'home.stat.blockTime': 'Temps de bloc',
    'home.stat.baseFee': 'Frais de base',
    'home.latestBlocks': 'Derniers blocs',
    'home.latestTransactions': 'Dernières transactions',
    'home.all': 'Tout',
    'home.empty.blocks': 'En attente du premier bloc',
    'home.empty.transactions': 'Pas encore de transactions',

    // --- Blocks list --------------------------------------------------------------------------
    'blocks.title': 'Blocs',
    'blocks.empty.title': 'Aucun bloc indexé pour l’instant',
    'blocks.empty.hint': 'Les blocs apparaissent ici à mesure que l’indexeur les lit depuis la chaîne.',
    'blocks.total': '{count} blocs indexés.',
    'blocks.gasTooltip': '{used} sur {limit} de gaz consommé',

    // --- Transactions list --------------------------------------------------------------------
    'txs.title': 'Transactions',
    'txs.empty.title': 'Aucune transaction indexée pour l’instant',
    'txs.empty.hint': 'Chaque transaction minée par la chaîne arrive ici.',
    'txs.total': '{count} transactions indexées.',

    // --- Block detail -------------------------------------------------------------------------
    'block.title': 'Bloc #{number}',
    'block.missing.title': 'Bloc absent de l’index',
    'block.missing.hint': 'Il est peut-être plus récent que là où l’indexeur est arrivé, ou antérieur au bloc de départ.',
    'block.previous': 'Bloc précédent',
    'block.next': 'Bloc suivant',
    'block.hash': 'Hash',
    'block.parent': 'Parent',
    'block.validator': 'Validateur',
    'block.size': 'Taille',
    'block.gasUsed': 'Gaz consommé',
    'block.gasOf': 'sur {limit}',
    'block.baseFee': 'Frais de base',
    'block.transactions': '{count} transactions',
    'block.empty.title': 'Ce bloc est vide',
    'block.empty.hint': 'Aucune transaction n’y a été incluse.',

    // --- Transaction detail -------------------------------------------------------------------
    'tx.title': 'Transaction',
    'tx.missing.title': 'Transaction absente de l’index',
    'tx.missing.hint': 'Elle est peut-être encore en attente, ou plus récente que là où l’indexeur est arrivé.',
    'tx.reverted.notice': 'Cette transaction a été annulée. Aucune valeur n’a bougé, mais l’expéditeur a tout de même payé le gaz ci-dessous.',
    'tx.hash': 'Hash',
    'tx.block': 'Bloc',
    'tx.position': 'position {index}',
    'tx.from': 'De',
    'tx.to': 'Vers',
    'tx.value': 'Valeur',
    'tx.fee': 'Frais',
    'tx.feeDetail': '{gas} de gaz à {price}',
    'tx.nonce': 'Nonce',
    'tx.calldata': 'calldata {size}',
    'tx.created': 'créé',
    'tx.transfers': 'Transferts de jetons',
    'tx.token': 'jeton',

    // --- Address ------------------------------------------------------------------------------
    'address.title': 'Adresse {short}',
    'address.kind.address': 'Adresse',
    'address.kind.contract': 'Contrat',
    'address.kind.token': 'Jeton',
    'address.activity': 'Activité',
    'address.balance': 'Solde',
    'address.received': 'Reçu',
    'address.sent': 'Envoyé',
    'address.fees': 'Frais payés',
    'address.tab.transactions': 'Transactions',
    'address.tab.transfers': 'Transferts de jetons',
    'address.tab.contract': 'Contrat',
    'address.transfers.empty.title': 'Aucun transfert de jetons',
    'address.transfers.empty.hint': 'Les mouvements ERC-20, 721 et 1155 de cette adresse apparaissent ici.',
    'address.transfers.token': 'Jeton',

    // --- Contrat -----------------------------------------
    'contract.notice': 'Aucun code source n’est publié pour ce contrat. Tout ce qui suit est lu depuis le bytecode déployé sur la chaîne.',
    'contract.compiler': 'Compilateur',
    'contract.size': 'Taille du code',
    'contract.deployer': 'Déployé par',
    'contract.deployedAt': 'Déployé dans',
    'contract.metadata': 'Métadonnées de la source',
    'contract.standards': 'Interfaces',
    'contract.proxy': 'Proxy',
    'contract.viaImplementation': 'Ce sont les fonctions de l’implémentation vers laquelle cette adresse renvoie, pas celles de son propre code.',
    'contract.reads': 'Valeurs actuelles',
    'contract.functions': 'Fonctions',
    'contract.functions.named': '{named} sur {total} nommées',
    'contract.functions.empty.title': 'Aucun point d’entrée trouvé',
    'contract.functions.empty.hint': 'Rien dans ce bytecode n’est comparé à un sélecteur de fonction. Ce peut être un proxy, un clone ou de l’assembleur écrit à la main.',
    'contract.events': 'Événements',
    'contract.bytecode': 'Bytecode',
    'contract.bytecode.show': 'Afficher',
    'contract.bytecode.hide': 'Masquer',
    'contract.unnamed': 'fonction sans nom',
    'contract.mutability.view': 'lecture',
    'contract.mutability.pure': 'pure',
    'contract.mutability.nonpayable': 'écriture',
    'contract.mutability.payable': 'payable',
    'contract.mutability.unknown': 'inconnue',

    'contract.read': 'Lecture',
    'contract.read.hint': 'Répondu par cet explorateur. Sans portefeuille et sans frais.',
    'contract.write': 'Écriture',
    'contract.write.hint': 'Celles-ci envoient une transaction depuis votre propre portefeuille, sur ce réseau. Le portefeuille demande avant toute signature, et le gaz est à votre charge.',
    'contract.unnamedGroup': 'Sélecteurs sans nom',
    'contract.call.query': 'Interroger',
    'contract.call.write': 'Écrire',
    'contract.call.value': 'Montant à envoyer ({symbol})',
    'contract.call.badAmount': 'Ce n’est pas un montant que cette chaîne peut envoyer.',
    'contract.call.sent': 'Transaction envoyée',
    'contract.call.noReturn': 'L’appel n’a rien renvoyé.',

    // --- Flow ledger --------------------------------------------------------------------------
    'flow.title': 'Flux',
    'flow.in': 'entrée',
    'flow.out': 'sortie',
    'flow.empty': 'Pas encore de transactions ici. Quand cette adresse enverra ou recevra, le mouvement apparaîtra ici.',
    'flow.legend': 'Les barres sont relatives au plus grand mouvement affiché. Montants en {symbol}.',
    'flow.call': 'appel',
    'flow.contractCreated': 'contrat créé',

    // --- Cadence ------------------------------------------------------------------------------
    'cadence.title': 'Cadence',
    'cadence.caption': 'les {count} derniers blocs - la hauteur représente le gaz consommé',
    'cadence.chart': 'Gaz consommé sur les {count} derniers blocs',
    'cadence.bar': 'Bloc {number}, {count} transactions',
    'cadence.now': 'maintenant',

    // --- Shared chain wording -----------------------------------------------------------------
    'chain.contractCreation': 'création de contrat',
    'chain.to': 'vers {address}',
    'chain.txCount': '{count} tx',
    'chain.gasShare': '{percent}% de gaz',
    'chain.notAvailable': 'n/d',
    'chain.status.success': 'réussie',
    'chain.status.reverted': 'annulée',
    'chain.status.unknown': 'inconnue',

    // --- Copy / wallet ------------------------------------------------------------------------
    'copy.action': 'Copier {value}',
    'copy.done': 'Copié dans le presse-papiers',
    'copy.blocked': 'Votre navigateur a bloqué l’accès au presse-papiers',

    'wallet.add': 'Ajouter {chain}',
    'wallet.missing': 'Aucun portefeuille trouvé - installez MetaMask, puis réessayez',
    'wallet.added': '{chain} ajoutée à votre portefeuille',
    'wallet.dismissed': 'Demande rejetée',
    'wallet.refused': 'Votre portefeuille a refusé d’ajouter le réseau',
    'wallet.mismatch': 'Votre portefeuille a déjà ce réseau avec un autre symbole de devise. Supprimez-le là-bas, puis réessayez.',
    'wallet.connect': 'Connecter un portefeuille',
    'wallet.switch': 'Passer sur {chain}',
    'wallet.switchFailed': 'Votre portefeuille n’est pas passé sur {chain}. Ajoutez d’abord le réseau, puis réessayez.',

    // --- Pagination ---------------------------------------------------------------------------
    'pagination.label': 'Pagination',
    'pagination.first': 'Première page',
    'pagination.newer': 'Plus récentes',
    'pagination.older': 'Plus anciennes',
    'pagination.last': 'Dernière page',
    'pagination.page': 'Page {number}',

    // --- Toasts -------------------------------------------------------------------------------
    'toast.dismiss': 'Fermer',

    // --- Error and not-found ------------------------------------------------------------------
    'error.title': 'Cette page a cessé de fonctionner',
    'error.hint': 'Une erreur est survenue au rendu. La chaîne et l’index sont intacts - réessayer suffit généralement.',
    'error.retry': 'Réessayer',
    'error.home': 'Retour à la vue d’ensemble',

    'notFound.title': 'Introuvable',
    'notFound.heading': 'Rien à cette adresse',
    'notFound.hint': 'Cette page n’existe pas. Si vous suiviez un bloc, une transaction ou un compte, vérifiez la valeur ci-dessous - ou réessayez sous peu, si l’indexeur n’y est pas encore arrivé.',

    // --- Footer -------------------------------------------------------------------------------
    'footer.tagline': 'Un explorateur de blocs ouvert. Chaque bloc, transaction et transfert est indexé localement, pour suivre la valeur le long de la chaîne.',
    'footer.explore': 'Explorer',
    'footer.community': 'Communauté',
    'footer.note': 'Les lectures proviennent d’un index local de la chaîne. Les soldes sont lus en direct depuis le nœud.',
    'footer.builtWith': 'Conçu avec',

    // --- Time and units -----------------------------------------------------------------------
    'time.justNow': 'à l’instant',
    'time.second': 'il y a {count} seconde',
    'time.seconds': 'il y a {count} secondes',
    'time.minute': 'il y a {count} minute',
    'time.minutes': 'il y a {count} minutes',
    'time.hour': 'il y a {count} heure',
    'time.hours': 'il y a {count} heures',
    'time.day': 'il y a {count} jour',
    'time.days': 'il y a {count} jours',

    'unit.bytes': '{count} o',
    'unit.kilobytes': '{count} Ko',
    'unit.gwei': '{amount} gwei',

    // --- Page titles --------------------------------------------------------------------------
    'title.chainExplorer': 'Explorateur {chain}',
    'title.chainFallback': 'Chaîne'
};
