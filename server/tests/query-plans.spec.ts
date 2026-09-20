// @vitest-environment node
//
// What the QUERY PLANNER does with the aggregation behind /api/stats/charts.
//
// Every other test in this suite asserts an answer. These assert the shape of the work done to
// reach it, because the failure they exist for does not produce a wrong answer: it produces the
// right one slowly, and only on a chain long enough for anybody to notice.
//
// The production symptom that prompted them: the charts endpoint took seven to ten seconds on a
// 1.08-million-block chain, and because `node:sqlite` is SYNCHRONOUS, those seconds blocked the
// event loop - so every other request the site was serving stalled with it. A trivial
// /api/healthz issued during one of those windows took 7.3 seconds to answer. The page that was
// slow was not the only page that was slow.
//
// Two queries were reading the whole `blocks` table. Both are now covered by an index, and these
// tests fail the moment either stops being.
import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IndexStore } from '../src/chain/store.ts';

/** A real file, because a plan is read from a second connection and ':memory:' is per-connection. */
const made: string[] = [];

function schema(): DatabaseSync
{
    const directory = mkdtempSync(join(tmpdir(), 'nura-plan-'));
    made.push(directory);

    // The store writes the schema, indexes included, on construction.
    const path = join(directory, 'index.db');
    const store = new IndexStore(path);
    store.close();

    return new DatabaseSync(path, { readOnly: true });
}

afterEach(() =>
{
    while (made.length > 0)
    {
        rmSync(made.pop() as string, { recursive: true, force: true });
    }
});

/** Every SCAN/SEARCH line the planner reports, joined - the shape of the work. */
const planOf = (db: DatabaseSync, sql: string, ...args: Array<string | number>): string =>
    (db.prepare(`EXPLAIN QUERY PLAN ${ sql }`).all(...args) as Array<{ detail: string }>)
        .map((row) => row.detail)
        .join(' | ');

describe('the charts aggregation reads indexes, not tables', () =>
{
    it('rolls days up from a COVERING index, touching no block row', () =>
    {
        const db = schema();

        // The query `statsDaily` runs: a timestamp window grouped by day, reading size and gas.
        const plan = planOf(db, `
            SELECT CAST(timestamp / 86400 AS INTEGER) AS day, COUNT(*) AS blocks, AVG(size) AS size,
                   SUM(CAST(gas_used AS INTEGER)) AS gasUsed, SUM(CAST(gas_limit AS INTEGER)) AS gasLimit,
                   MIN(timestamp) AS first, MAX(timestamp) AS last
            FROM blocks WHERE timestamp >= ? AND timestamp < ? GROUP BY day ORDER BY day ASC`, 0, 1);

        db.close();

        // COVERING is the whole assertion. A plain `SEARCH blocks USING INDEX idx_blocks_ts` also
        // finds the right rows - and then fetches size, gas_used and gas_limit from each one. At
        // three-second blocks a thirty-day window is ~864,000 of those fetches, which is most of
        // the table, one page at a time.
        expect(plan).toContain('COVERING INDEX');
        expect(plan).not.toMatch(/SCAN blocks(?! USING)/);
    });

    it('counts distinct addresses without scanning every block', () =>
    {
        const db = schema();

        // The `addresses` half of `totals()`. `miner` is the column that made this expensive:
        // every block carries one, and this chain has two distinct values across a million rows.
        const plan = planOf(db, `
            SELECT COUNT(*) AS n FROM (
                SELECT DISTINCT addr FROM (
                    SELECT from_addr AS addr FROM transactions
                    UNION ALL SELECT to_addr AS addr FROM transactions
                    UNION ALL SELECT miner AS addr FROM blocks
                    UNION ALL SELECT from_addr AS addr FROM token_transfers
                    UNION ALL SELECT to_addr AS addr FROM token_transfers
                    UNION ALL SELECT token AS addr FROM token_transfers
                ) WHERE addr IS NOT NULL AND addr != ?
            )`, '0x0');

        db.close();

        // Every arm of the union reads an index. A bare `SCAN blocks` here is the regression.
        expect(plan).not.toMatch(/SCAN blocks(?! USING)/);
        expect(plan).not.toMatch(/SCAN transactions(?! USING)/);
        expect(plan).not.toMatch(/SCAN token_transfers(?! USING)/);
    });
});
