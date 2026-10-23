// The index's tables as raw SQL names them: schema-qualified and quoted.
//
// Every statement the store and its migration write by hand takes its table names from here, never
// from a bare `blocks`. A deployment keeps the index in `public`; the suite gives every store a
// schema of its own in one shared database, and a single unqualified name would quietly read or
// write some other test's rows.

export interface Tables
{
    meta: string;
    blocks: string;
    transactions: string;
    transfers: string;
    tokens: string;
}

/** A schema name this module is willing to splice into SQL: lower-case letters, digits and `_`. */
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export function tablesIn(schema: string): Tables
{
    if (!IDENTIFIER.test(schema))
    {
        throw new Error(`index store: '${ schema }' is not a schema name the index will quote into SQL`);
    }
    const name = (table: string): string => `"${ schema }"."${ table }"`;
    return {
        meta: name('meta'),
        blocks: name('blocks'),
        transactions: name('transactions'),
        transfers: name('token_transfers'),
        tokens: name('tokens')
    };
}
