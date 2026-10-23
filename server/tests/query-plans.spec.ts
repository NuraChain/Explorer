// @vitest-environment node
//
// What the QUERY PLANNER does with the aggregation behind /api/stats/charts.
//
// Every other test in this suite asserts an answer. These assert the shape of the work done to
// reach it, because the failure they exist for does not produce a wrong answer: it produces the
// right one slowly, and only on a chain long enough for anybody to notice.
//
// The production symptom that prompted them: the charts endpoint took seven to ten seconds on a
// 1.08-million-block chain, and on the synchronous sqlite index those seconds stalled every other
// request with it - a trivial /api/healthz issued during one took 7.3 seconds. Two queries were
// reading the whole `blocks` table. Both are covered by an index, and these fail the moment either
// stops being.
//
// They explain the store's OWN statements, not copies of them. On a near-empty table the planner
// rightly prefers a sequential scan whatever indexes exist, so the cheaper alternatives are switched
// off for the one transaction that asks for the plan: what is left is the path an index offers -
// index-only while the index covers the query, a plain index scan the moment it stops covering,
// which is exactly the regression guarded.
import pg from 'pg';
import { describe, it, expect } from 'vitest';

import { ZERO_ADDRESS } from '../src/chain/rows.ts';
import { addressesSql, dailyBlocksSql } from '../src/chain/store.ts';
import { tablesIn } from '../src/chain/tables.ts';
import { openTestStore, schemaOf, testDatabase } from './support/database.ts';

interface PlanNode
{
    'Node Type': string;
    'Relation Name'?: string;
    'Index Name'?: string;
    Plans?: PlanNode[];
}

/** Every node of a plan, depth first. */
function walk(node: PlanNode): PlanNode[]
{
    return [node, ...(node.Plans ?? []).flatMap(walk)];
}

/** A freshly migrated schema, and every scan of a table in the plan `sql` gets there, as `type:index`. */
async function scans(sql: (schema: string) => string, parameters: unknown[]): Promise<string[]>
{
    const schema = schemaOf(await openTestStore());
    const client = new pg.Client({ connectionString: testDatabase() });
    await client.connect();
    try
    {
        await client.query('BEGIN');
        // LOCAL, so the settings go with the transaction: nothing else ever plans under them.
        await client.query('SET LOCAL enable_seqscan = off');
        await client.query('SET LOCAL enable_bitmapscan = off');
        const result = await client.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>(
            `EXPLAIN (FORMAT JSON, COSTS OFF) ${ sql(schema) }`, parameters);
        await client.query('ROLLBACK');
        return walk(result.rows[0]!['QUERY PLAN'][0]!.Plan)
            .filter((node) => node['Relation Name'] !== undefined)
            .map((node) => `${ node['Node Type'] }:${ node['Index Name'] ?? '-' }`);
    }
    finally
    {
        await client.end();
    }
}

describe('the charts aggregation reads indexes, not tables', () =>
{
    it('rolls days up from a COVERING index, touching no block row', async () =>
    {
        const plan = await scans((schema) => dailyBlocksSql(tablesIn(schema)), [0, 2 ** 31]);

        // Index-only is the whole assertion. A plain index scan of idx_blocks_daily also finds
        // the right rows - and then fetches size, gas_used and gas_limit from each one, which at
        // three-second blocks is ~864,000 heap visits for a thirty-day window.
        expect(plan).toEqual(['Index Only Scan:idx_blocks_daily']);
    });

    it('counts distinct addresses with every arm of the union on an index of its own', async () =>
    {
        const plan = await scans(
            (schema) => `SELECT COUNT(*) AS n FROM (${ addressesSql(tablesIn(schema)) }) AS addresses`, [ZERO_ADDRESS]);

        // `miner` is the column that made this expensive: one per block, and two distinct values
        // across a million rows. A scan of any of these tables is the regression.
        expect(plan.every((scan) => scan.startsWith('Index Only Scan:'))).toBe(true);
        expect(new Set(plan)).toEqual(new Set([
            'Index Only Scan:idx_tx_from',
            'Index Only Scan:idx_tx_to',
            'Index Only Scan:idx_blocks_miner',
            'Index Only Scan:idx_transfer_from',
            'Index Only Scan:idx_transfer_to',
            'Index Only Scan:idx_transfer_token'
        ]));
    });
});
