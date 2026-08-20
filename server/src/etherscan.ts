// An Etherscan-compatible read API, so a wallet configured to talk to Etherscan can talk to this
// explorer instead. Wallets do not speak this project's typed `/api/...` routes; they speak
// `?module=account&action=txlist`, and they parse a fixed envelope. This module is that shim and
// nothing more - it reads the SAME index the UI reads and invents no data.
//
// Shapes here are copied from docs.etherscan.io, field name for field name. Where a name looks
// redundant or oddly cased (`txreceipt_status`, `tokenDecimal` singular), that IS the contract:
// a client matching on it is why this file exists, so nothing here is "tidied up".
//
// What this deliberately does NOT do: write. There is no `proxy` module and no
// `eth_sendRawTransaction`, because forwarding arbitrary calls would turn the explorer into an
// open relay for its own node. A wallet sends transactions through its own RPC endpoint.

import { json } from '@azerothjs/http';

import type { ChainGateway } from './chain/client.ts';
import { normalize, type IndexStore, type TransactionRow, type TransferRow } from './chain/store.ts';

/** The widest block range Etherscan's own examples use, and the default when none is given. */
const MAX_BLOCK = 999_999_999;

/** Etherscan caps a page at 10000 records; anything larger is refused rather than truncated. */
const MAX_OFFSET = 10_000;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * The headers that make this surface readable from somewhere else, which is the entire point of
 * it: the callers are a wallet's webview, a script, a dashboard - never this explorer's own pages.
 *
 * `securityHeaders()` defaults Cross-Origin-Resource-Policy to `same-origin` for the whole app,
 * and that alone discards the response in the browser even when Access-Control-Allow-Origin is
 * present - the request goes out, the server answers, the reply never reaches the caller. Those
 * defaults apply only where a response does not already carry the header, so setting it here is
 * what overrides it; no proxy rule can, because nginx cannot strip a header it did not add.
 *
 * `*` is the right value and not a loosening: every answer below is public, read-only chain data
 * that anyone can also get from the node. Nothing here reads a cookie, a session or an
 * Authorization header, so there is no credentialed request for a wildcard to expose.
 */
const CROSS_ORIGIN: HeadersInit = {
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin'
};

/**
 * The three envelopes Etherscan answers with. A client tells them apart by `status`, so the
 * distinction between "nothing found" and "your request was wrong" has to survive: a wallet that
 * reads an error as an empty history will happily show an account as having never transacted.
 */
function ok(result: unknown): Response
{
    return json({ status: '1', message: 'OK', result }, { headers: CROSS_ORIGIN });
}

function none(message: string): Response
{
    return json({ status: '0', message, result: [] }, { headers: CROSS_ORIGIN });
}

function fail(reason: string): Response
{
    return json({ status: '0', message: 'NOTOK', result: reason }, { headers: CROSS_ORIGIN });
}

interface Paging
{
    from: number;
    to: number;
    limit: number;
    offset: number;
    ascending: boolean;
}

/** Reads the shared `startblock`/`endblock`/`page`/`offset`/`sort` quintet. */
function paging(query: URLSearchParams): Paging | string
{
    const page = Number(query.get('page') ?? '1');
    const size = Number(query.get('offset') ?? '100');

    // SAFE integers, not merely integral ones. `Number('999999999999999999999')` is 1e21, which
    // `Number.isInteger` calls an integer because it is integral as a double - and it then rode
    // through the page arithmetic into a bound sqlite parameter, which refuses a non-safe integer
    // with "datatype mismatch". That is an unhandled throw, so an absurd page number answered
    // with a 500 from the one function whose whole job is to refuse absurd input.
    if (!Number.isSafeInteger(page) || page < 1)
    {
        return 'Error! Invalid page';
    }
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_OFFSET)
    {
        return `Error! Invalid offset, must be between 1 and ${ MAX_OFFSET }`;
    }

    const from = Number(query.get('startblock') ?? '0');
    const to = Number(query.get('endblock') ?? String(MAX_BLOCK));
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < 0)
    {
        return 'Error! Invalid block range';
    }

    // Both operands are safe on their own; their PRODUCT need not be.
    const offset = (page - 1) * size;
    if (!Number.isSafeInteger(offset))
    {
        return 'Error! Invalid page';
    }

    return {
        from,
        to,
        limit: size,
        offset,
        // Etherscan's default is ascending; a wallet paging forward from its last seen height
        // depends on it, so an unrecognised value takes the documented default rather than
        // silently reversing the history.
        ascending: (query.get('sort') ?? 'asc').toLowerCase() !== 'desc'
    };
}

function address(query: URLSearchParams, key = 'address'): string | null
{
    const value = query.get(key);
    return value !== null && ADDRESS.test(value) ? normalize(value) : null;
}

export interface EtherscanDeps
{
    store: IndexStore;
    chain: ChainGateway;
}

export function createEtherscanApi({ store, chain }: EtherscanDeps): (query: URLSearchParams) => Promise<Response>
{
    /** Confirmations count the including block itself, matching Etherscan's own arithmetic. */
    const confirmationsAt = (height: number, head: number): string => String(Math.max(0, head - height + 1));

    const transaction = (row: TransactionRow, head: number): Record<string, string> => ({
        blockNumber: String(row.block_number),
        blockHash: store.blockByNumber(row.block_number)?.hash ?? '',
        timeStamp: String(row.timestamp),
        hash: row.hash,
        nonce: String(row.nonce),
        transactionIndex: String(row.tx_index),
        from: row.from_addr,
        to: row.to_addr ?? '',
        value: row.value,
        // `gas` (the LIMIT) and `cumulativeGasUsed` are not in the index - the indexer keeps what
        // the explorer displays, and neither is displayed. Empty rather than invented: a wallet
        // that reads a fabricated gas limit would mis-estimate its next transaction.
        gas: '',
        gasPrice: row.effective_gas_price,
        // Only the SIZE of the calldata is indexed, which is enough to be certain about the one
        // case that matters: zero bytes means a plain transfer, and '0x' is the true answer.
        // Anything else is left empty rather than guessed.
        input: row.input_size === 0 ? '0x' : '',
        contractAddress: row.contract_address ?? '',
        cumulativeGasUsed: '',
        gasUsed: row.gas_used,
        confirmations: confirmationsAt(row.block_number, head),
        // Two spellings of the same fact, because clients read one or the other.
        txreceipt_status: row.status === 1 ? '1' : '0',
        isError: row.status === 1 ? '0' : '1'
    });

    const transfer = (row: TransferRow, head: number): Record<string, string> =>
    {
        const parent = store.transactionByHash(row.tx_hash);
        const token = store.token(row.token);
        return {
            blockNumber: String(row.block_number),
            timeStamp: String(row.timestamp),
            hash: row.tx_hash,
            nonce: parent === null ? '' : String(parent.nonce),
            blockHash: store.blockByNumber(row.block_number)?.hash ?? '',
            from: row.from_addr,
            contractAddress: row.token,
            to: row.to_addr,
            value: row.value,
            tokenName: token?.name ?? '',
            tokenSymbol: token?.symbol ?? '',
            tokenDecimal: String(token?.decimals ?? 0),
            transactionIndex: parent === null ? '' : String(parent.tx_index),
            gas: '',
            gasPrice: parent?.effective_gas_price ?? '',
            gasUsed: parent?.gas_used ?? '',
            cumulativeGasUsed: '',
            // Etherscan returns this literal for token transfers; it is not a placeholder of ours.
            input: 'deprecated',
            confirmations: confirmationsAt(row.block_number, head)
        };
    };

    /** The three token endpoints differ only in which `kind` they select and what they add. */
    const tokenTransfers = async (query: URLSearchParams, kind: string): Promise<Response> =>
    {
        const account = address(query);
        if (account === null)
        {
            return fail('Error! Invalid address format');
        }
        const page = paging(query);
        if (typeof page === 'string')
        {
            return fail(page);
        }
        const contract = query.get('contractaddress');
        if (contract !== null && !ADDRESS.test(contract))
        {
            return fail('Error! Invalid contract address format');
        }

        const head = store.stats().head;
        // Filtered AFTER the range query rather than in SQL: `kind` is not indexed, and the three
        // token standards share one table, so the page size is applied to the mixed set first.
        const rows = store
            .addressTransfersInRange(account, page.from, page.to, page.limit, page.offset, page.ascending, contract)
            .filter((row) => row.kind === kind);

        if (rows.length === 0)
        {
            return none('No transactions found');
        }

        return ok(rows.map((row) =>
        {
            const base = transfer(row, head);
            if (kind === 'erc20')
            {
                return base;
            }
            const withId = { ...base, tokenID: row.token_id ?? '' };
            return kind === 'erc1155' ? { ...withId, tokenValue: row.value } : withId;
        }));
    };

    const account = async (action: string, query: URLSearchParams): Promise<Response> =>
    {
        if (action === 'balance')
        {
            const who = address(query);
            if (who === null)
            {
                return fail('Error! Invalid address format');
            }
            return ok((await chain.balance(who)).toString());
        }

        if (action === 'balancemulti')
        {
            const raw = (query.get('address') ?? '').split(',').filter((value) => value !== '');
            // Etherscan caps this at 20 addresses per call; the cap is the reason the endpoint
            // exists, so refusing past it is part of the contract rather than a local limit.
            if (raw.length === 0 || raw.length > 20 || raw.some((value) => !ADDRESS.test(value)))
            {
                return fail('Error! Invalid address format');
            }
            const balances = await Promise.all(raw.map(async (value) => ({
                account: normalize(value),
                balance: (await chain.balance(normalize(value))).toString()
            })));
            return ok(balances);
        }

        if (action === 'txlist')
        {
            const who = address(query);
            if (who === null)
            {
                return fail('Error! Invalid address format');
            }
            const page = paging(query);
            if (typeof page === 'string')
            {
                return fail(page);
            }
            const head = store.stats().head;
            const rows = store.addressTransactionsInRange(who, page.from, page.to, page.limit, page.offset, page.ascending);
            return rows.length === 0 ? none('No transactions found') : ok(rows.map((row) => transaction(row, head)));
        }

        if (action === 'txlistinternal')
        {
            // Internal transactions come from tracing (debug_traceTransaction / trace_block), which
            // this indexer does not call - it reads blocks and receipts only. Answering "none
            // found" would be a lie an accounting tool cannot detect, so this says so instead.
            return fail('Error! Internal transactions are not indexed by this explorer');
        }

        if (action === 'tokentx')
        {
            return tokenTransfers(query, 'erc20');
        }
        if (action === 'tokennfttx')
        {
            return tokenTransfers(query, 'erc721');
        }
        if (action === 'token1155tx')
        {
            return tokenTransfers(query, 'erc1155');
        }

        return fail('Error! Missing or unsupported action');
    };

    const transactionModule = (action: string, query: URLSearchParams): Response =>
    {
        const hash = query.get('txhash');
        if (hash === null || !HASH.test(hash))
        {
            return fail('Error! Invalid transaction hash format');
        }
        const row = store.transactionByHash(hash.toLowerCase());

        if (action === 'gettxreceiptstatus')
        {
            // An unknown hash is not a failed transaction. Etherscan answers with an empty status
            // rather than '0', and the difference is "we have never seen this" versus "it reverted".
            return ok({ status: row === null ? '' : (row.status === 1 ? '1' : '0') });
        }

        if (action === 'getstatus')
        {
            return ok({
                isError: row === null || row.status === 1 ? '0' : '1',
                errDescription: row !== null && row.status !== 1 ? 'Reverted' : ''
            });
        }

        return fail('Error! Missing or unsupported action');
    };

    return async (query: URLSearchParams): Promise<Response> =>
    {
        const module = (query.get('module') ?? '').toLowerCase();
        const action = (query.get('action') ?? '').toLowerCase();

        if (module === 'account')
        {
            return account(action, query);
        }
        if (module === 'transaction')
        {
            return transactionModule(action, query);
        }
        if (module === 'stats' && action === 'ethsupply')
        {
            return fail('Error! Supply is not tracked by this explorer');
        }

        return fail('Error! Missing or unsupported module');
    };
}
