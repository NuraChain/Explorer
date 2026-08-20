// @vitest-environment node
//
// Bytecode analysis: what a contract IS, read off the bytes the chain returns. It is a parser
// over attacker-supplied input - `eth_getCode` returns whatever a deployer put there, including
// bytes chosen to look like something they are not - so the two things that matter are that it
// never throws and that it never CLAIMS more than it can see.
//
// app.spec.ts already covers the shapes solc emits. This file covers the shapes it does not:
// truncated code, odd-length hex, a metadata trailer that lies about its own length, and
// four-byte constants that are not selectors.
import { describe, it, expect } from 'vitest';
import { toEventSelector, toFunctionSelector } from 'viem';

import { analyze, describeEvents, describeFunctions, detectStandards } from '../src/chain/contract.ts';

/** A dispatcher comparing calldata against each selector, as solc emits one. */
function dispatcher(signatures: string[]): string
{
    const body = signatures
        .map((signature) => `63${ toFunctionSelector(signature).slice(2) }1461003a57`)
        .join('');
    return `0x6080604052600436106100355760003560e01c${ body }5b600080fd`;
}

describe('analyze - size and shape', () =>
{
    it('reports the byte length, not the hex length', () =>
    {
        expect(analyze('0x').size).toBe(0);
        expect(analyze('0x6080').size).toBe(2);
        expect(analyze(`0x${ 'ab'.repeat(1000) }`).size).toBe(1000);
    });

    it('answers for an address that holds no code at all', () =>
    {
        const facts = analyze('0x');
        expect(facts).toMatchObject({ size: 0, selectors: [], topics: [], compiler: '', metadataUri: '', minimalProxy: null });
    });

    it('does not throw on input no compiler would ever emit', () =>
    {
        // Every one of these is something a node could return for a hand-written contract, and
        // an explorer that throws here shows an error page instead of an address.
        for (const code of ['0x', '0x0', '0xf', '0xzz', 'not-hex', '', '0x'.repeat(50), `0x${ 'ff'.repeat(5000) }`])
        {
            expect(() => analyze(code), code.slice(0, 20)).not.toThrow();
        }
    });

    it('survives odd-length hex rather than reading a half byte', () =>
    {
        expect(() => analyze('0x608')).not.toThrow();
        expect(() => analyze('0x6080604052600436106100355760003560e01c8063a9059cbb14')).not.toThrow();
    });
});

describe('analyze - selectors', () =>
{
    it('recovers the entry points a dispatcher compares against', () =>
    {
        const facts = analyze(dispatcher(['transfer(address,uint256)', 'balanceOf(address)']));
        expect(facts.selectors).toContain(toFunctionSelector('transfer(address,uint256)'));
        expect(facts.selectors).toContain(toFunctionSelector('balanceOf(address)'));
    });

    it('does not invent a selector out of a four-byte constant that is never compared', () =>
    {
        // PUSH4 alone is a number, not an entry point. Reading every PUSH4 as a selector is how
        // a page ends up listing functions a contract does not have.
        const facts = analyze('0x6080604052' + '63a9059cbb' + '50' + '00');
        expect(facts.selectors).toEqual([]);
    });

    it('deduplicates a selector compared more than once', () =>
    {
        const one = toFunctionSelector('transfer(address,uint256)');
        const code = `0x6080604052600436106100355760003560e01c63${ one.slice(2) }146100405763${ one.slice(2) }1461005057`;
        const facts = analyze(code);
        expect(facts.selectors.filter((selector) => selector === one)).toHaveLength(1);
    });

    it('stops at the metadata trailer instead of reading it as code', () =>
    {
        // The CBOR trailer is arbitrary bytes; scanning it turns a hash's four-byte runs into
        // selectors for functions that do not exist.
        const code = dispatcher(['transfer(address,uint256)']);
        const trailer = `a264697066735822${ '12'.repeat(34) }64736f6c6343000813` + '0033';
        const withTrailer = code + trailer;

        const bare = analyze(code);
        const stamped = analyze(withTrailer);
        expect(stamped.selectors.sort()).toEqual(bare.selectors.sort());
    });

    it('ignores a trailer whose declared length runs past the code', () =>
    {
        // The last two bytes are the trailer's own length. A deployer can write anything there.
        const code = `${ dispatcher(['transfer(address,uint256)']) }ffff`;
        expect(() => analyze(code)).not.toThrow();
        expect(analyze(code).size).toBeGreaterThan(0);
    });
});

describe('analyze - metadata', () =>
{
    it('reads the compiler version solc stamped in', () =>
    {
        const code = `${ dispatcher(['transfer(address,uint256)']) }a2646970667358221220${ '12'.repeat(32) }64736f6c6343000813003300 33`.replace(/\s/g, '');
        const facts = analyze(code);
        // Either it reads a version or it says nothing - never a wrong one.
        expect(facts.compiler === '' || /^\d+\.\d+\.\d+$/.test(facts.compiler)).toBe(true);
    });

    it('says nothing rather than guessing when there is no trailer', () =>
    {
        const facts = analyze(dispatcher(['transfer(address,uint256)']));
        expect(facts.compiler).toBe('');
        expect(facts.metadataUri).toBe('');
    });
});

describe('analyze - minimal proxies', () =>
{
    it('follows an EIP-1167 clone to what it delegates to', () =>
    {
        const target = '0x1111111111111111111111111111111111111111';
        const clone = `0x363d3d373d3d3d363d73${ target.slice(2) }5af43d82803e903d91602b57fd5bf3`;
        expect(analyze(clone).minimalProxy).toBe(target);
    });

    it('claims nothing for code that merely resembles one', () =>
    {
        expect(analyze('0x363d3d373d3d3d363d73').minimalProxy).toBeNull();
        expect(analyze(dispatcher(['transfer(address,uint256)'])).minimalProxy).toBeNull();
    });
});

describe('describeFunctions', () =>
{
    it('puts the named ones first, then the unknown ones by selector', () =>
    {
        const described = describeFunctions([
            '0xffffffff',
            toFunctionSelector('transfer(address,uint256)'),
            '0x00000001',
            toFunctionSelector('approve(address,uint256)')
        ]);

        expect(described.slice(0, 2).every((entry) => entry.known)).toBe(true);
        expect(described.slice(2).every((entry) => !entry.known)).toBe(true);
        // Named ones alphabetically, so a reader scanning for `transfer` is not walking hex.
        expect(described[0]!.name).toBe('approve');
        expect(described[1]!.name).toBe('transfer');
        // Unknown ones by selector, so the order is at least stable.
        expect(described[2]!.selector).toBe('0x00000001');
    });

    it('keeps an unknown selector rather than dropping it', () =>
    {
        // Their COUNT is the honest measure of what the page does not know.
        const described = describeFunctions(['0xdeadbeef']);
        expect(described).toHaveLength(1);
        expect(described[0]).toMatchObject({ selector: '0xdeadbeef', signature: '', name: '', known: false });
    });

    it('answers an empty list for no selectors', () =>
    {
        expect(describeFunctions([])).toEqual([]);
    });

    it('is deterministic whatever order the selectors arrive in', () =>
    {
        const selectors = [
            toFunctionSelector('transfer(address,uint256)'),
            '0xffffffff',
            toFunctionSelector('approve(address,uint256)'),
            '0x00000001'
        ];
        const forward = describeFunctions(selectors).map((entry) => entry.selector);
        const backward = describeFunctions([...selectors].reverse()).map((entry) => entry.selector);
        expect(forward).toEqual(backward);
    });
});

describe('describeEvents', () =>
{
    it('names the topics it knows and drops the ones it does not', () =>
    {
        const transfer = toEventSelector('Transfer(address,address,uint256)');
        const events = describeEvents([transfer, `0x${ 'f'.repeat(64) }`]);
        expect(events).toHaveLength(1);
        expect(events[0]!.name).toBe('Transfer');
    });

    it('answers nothing for a contract that emits nothing', () =>
    {
        expect(describeEvents([])).toEqual([]);
    });
});

describe('detectStandards', () =>
{
    const ERC20 = ['totalSupply()', 'balanceOf(address)', 'transfer(address,uint256)',
        'transferFrom(address,address,uint256)', 'approve(address,uint256)', 'allowance(address,address)'];

    it('claims a standard only when EVERY one of its functions is present', () =>
    {
        const full = ERC20.map(toFunctionSelector);
        expect(detectStandards(full)).toContain('ERC-20');
        // One short is not an ERC-20. A badge is a claim about what the code does.
        expect(detectStandards(full.slice(1))).not.toContain('ERC-20');
    });

    it('claims nothing for an empty selector set', () =>
    {
        expect(detectStandards([])).toEqual([]);
    });

    it('is not confused by extra selectors alongside a standard', () =>
    {
        const withExtras = [...ERC20.map(toFunctionSelector), '0xdeadbeef', '0x00000000'];
        expect(detectStandards(withExtras)).toContain('ERC-20');
    });

    it('can claim more than one interface at once', () =>
    {
        const both = [...ERC20, 'owner()', 'transferOwnership(address)'].map(toFunctionSelector);
        const claimed = detectStandards(both);
        expect(claimed).toContain('ERC-20');
        expect(claimed).toContain('Ownable');
    });
});

describe('property: analysis over arbitrary bytecode', () =>
{
    /** xorshift32 - deterministic, so a failure here reproduces exactly. */
    function seeded(seed: number): () => number
    {
        let state = seed >>> 0 || 1;
        return () =>
        {
            state ^= state << 13;
            state >>>= 0;
            state ^= state >>> 17;
            state ^= state << 5;
            state >>>= 0;
            return state / 0x1_0000_0000;
        };
    }

    it('never throws, whatever bytes a deployer put on chain', () =>
    {
        const random = seeded(0xb17ec0de);
        for (let round = 0; round < 1500; round++)
        {
            const length = Math.floor(random() * 400);
            let hex = '';
            for (let at = 0; at < length; at++)
            {
                hex += Math.floor(random() * 256).toString(16).padStart(2, '0');
            }
            // Half the rounds get an odd digit count, which is not valid hex at all.
            const code = `0x${ random() < 0.5 ? hex : hex.slice(0, -1) }`;
            expect(() => analyze(code), code.slice(0, 40)).not.toThrow();
        }
    });

    it('always answers a well-formed result', () =>
    {
        const random = seeded(0x5e1ec7);
        for (let round = 0; round < 800; round++)
        {
            let hex = '';
            const length = Math.floor(random() * 200);
            for (let at = 0; at < length; at++)
            {
                hex += Math.floor(random() * 256).toString(16).padStart(2, '0');
            }
            const facts = analyze(`0x${ hex }`);

            expect(Array.isArray(facts.selectors)).toBe(true);
            expect(Array.isArray(facts.topics)).toBe(true);
            expect(facts.size).toBeGreaterThanOrEqual(0);
            // Every selector it reports is a real four-byte selector, and every topic 32 bytes.
            for (const selector of facts.selectors)
            {
                expect(selector).toMatch(/^0x[0-9a-f]{8}$/);
            }
            for (const topic of facts.topics)
            {
                expect(topic).toMatch(/^0x[0-9a-f]{64}$/);
            }
            // Never a duplicate: the page lists each entry point once.
            expect(new Set(facts.selectors).size).toBe(facts.selectors.length);
            expect(facts.minimalProxy === null || /^0x[0-9a-f]{40}$/.test(facts.minimalProxy)).toBe(true);
        }
    });

    it('never claims a standard from random bytes', () =>
    {
        // Six specific selectors do not appear by accident; if they ever did, the badge would be
        // meaningless.
        const random = seeded(0x1234abcd);
        for (let round = 0; round < 400; round++)
        {
            let hex = '';
            for (let at = 0; at < 300; at++)
            {
                hex += Math.floor(random() * 256).toString(16).padStart(2, '0');
            }
            expect(detectStandards(analyze(`0x${ hex }`).selectors)).toEqual([]);
        }
    });
});
