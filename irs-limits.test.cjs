'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Limits = require('./irs-limits.js');

// The exact labels, year order, and surrounding IRA/SIMPLE ambiguity mirror the
// official IRS COLA page retrieved 2026-10-03. No live network is required by tests.
const table = `
| 401(k), 403(b), profit-sharing plans, etc. | 2026 | 2025 | 2024 | 2023 |
| --- | --- | --- | --- | --- |
| Annual compensation | 360,000 | 350,000 | 345,000 | 330,000 |
| Elective deferrals | 24,500 | 23,500 | 23,000 | 22,500 |
| Catch-up contributions | 8,000** | 7,500** | 7,500 | 7,500 |
| Defined contribution plan limit | 72,000 | 70,000 | 69,000 | 66,000 |
| ESOP limits | 1,455,000 290,000 | 1,415,000 280,000 | 1,380,000 275,000 | 1,330,000 265,000 |
`;
const markdown = `Title: COLA increases for dollar limitations on benefits and contributions
URL Source: ${Limits.IRSSOURCE}
Markdown Content:
| IRAs | 2026 | 2025 | 2024 | 2023 |
| --- | --- | --- | --- | --- |
| IRA contribution limit | $7,500 | $7,000 | $7,000 | $6,500 |

| SIMPLE plans | 2026 | 2025 | 2024 | 2023 |
| --- | --- | --- | --- | --- |
| SIMPLE maximum contributions | 17,000 | 16,500 | 16,000 | 15,500 |
${table}
| Other | 2026 | 2025 | 2024 | 2023 |
| --- | --- | --- | --- | --- |
| 457 elective deferrals | 24,500 | 23,500 | 23,000 | 22,500 |
`;
function htmlFromMarkdown(value) {
  const lines = value.trim().split('\n').filter(line => !line.includes('| ---'));
  return '<table class="table complex-table table-striped table-bordered table-responsive"><thead>' + lines.map((line, index) => {
    const cells = line.trim().slice(1, -1).split('|').map(cell => cell.trim());
    const tag = index === 0 ? 'th' : 'td';
    const row = '<tr>' + cells.map(cell => '<' + tag + ' style="width:186px;">' + cell + '</' + tag + '>').join('') + '</tr>';
    return index === 0 ? row + '</thead><tbody>' : row;
  }).join('') + '</tbody></table>';
}
const html = '<html><body><table><tr><th>IRAs</th><th>2026</th></tr><tr><td>IRA contribution limit</td><td>$7,500</td></tr></table>' + htmlFromMarkdown(table) + '</body></html>';
const expected2026 = { year: 2026, deferralLimit: 24500, totalLimit: 72000, compensationLimit: 360000 };
function response(text, options = {}) {
  return { ok: true, status: 200, headers: { get(name) { return name === 'content-type' ? 'text/plain; charset=utf-8' : null; } }, text: async () => text, ...options };
}

test('parses the official HTML table in Node without DOMParser', () => {
  assert.deepEqual(Limits.parseLimits(html, 2026), expected2026);
});
test('parses Jina markdown without confusing IRA, SIMPLE, catch-up, or 457 numbers', () => {
  assert.deepEqual(Limits.parseLimits(markdown, 2026), expected2026);
  assert.deepEqual(Limits.parseLimits(markdown, 2025), { year: 2025, deferralLimit: 23500, totalLimit: 70000, compensationLimit: 350000 });
});
test('uses exact requested-year column even when it is neither first nor last', () => {
  assert.deepEqual(Limits.parseLimits(table, 2024), { year: 2024, deferralLimit: 23000, totalLimit: 69000, compensationLimit: 345000 });
});
test('HTML formatting and entities do not change labels or values', () => {
  assert.deepEqual(Limits.parseLimits(html.replace('401(k)', '401&#40;k&#41;').replace('24,500', '<strong>$24,500</strong>').replace('Annual compensation', 'Annual&nbsp;compensation'), 2026), expected2026);
});
test('never falls back to an existing year when requested year is unpublished', () => {
  assert.throws(() => Limits.parseLimits(markdown + '\nA future 2027 announcement is expected.', 2027), { code: 'YEAR_NOT_FOUND' });
});
test('rejects invalid requested year before reading content', () => {
  for (const year of ['2026', null, 2026.5, NaN, 1999, 2101]) assert.throws(() => Limits.parseLimits(table, year), { code: 'INVALID_YEAR' });
});
test('missing or partial required rows never produce partial results', () => {
  assert.throws(() => Limits.parseLimits(table.replace(/^\| Annual compensation.*\n/m, ''), 2026), { code: 'MISSING_FIELDS' });
  assert.throws(() => Limits.parseLimits(table.replace('72,000 | 70,000', ' | 70,000'), 2026), { code: 'INVALID_VALUES' });
  assert.throws(() => Limits.parseLimits(table.replace('72,000 | 70,000 | 69,000 | 66,000', '72,000 | 70,000 | 69,000'), 2026), { code: 'TABLE_FORMAT' });
});
test('only a 401(k) table qualifies; similarly named rows in IRA are rejected', () => {
  assert.throws(() => Limits.parseLimits(table.replace('401(k), 403(b), profit-sharing plans, etc.', 'IRAs'), 2026), { code: 'TABLE_FORMAT' });
});
test('duplicate year columns and ambiguous table boundaries are rejected', () => {
  assert.throws(() => Limits.parseLimits(table.replace('| 2025 |', '| 2026 |'), 2026), { code: 'TABLE_FORMAT' });
  assert.throws(() => Limits.parseLimits(table + '\n' + table, 2026), { code: 'TABLE_FORMAT' });
  assert.throws(() => Limits.parseLimits(html.replace('<th style=', '<th colspan="2" style='), 2026), { code: 'TABLE_FORMAT' });
});
test('multiple values, unexpected amounts and values inconsistent with verified years fail closed', () => {
  assert.throws(() => Limits.parseLimits(table.replace('24,500', '24,500 7,500'), 2026), { code: 'INVALID_VALUES' });
  assert.throws(() => Limits.parseLimits(table.replace('24,500', '7,500'), 2026), { code: 'INVALID_VALUES' });
  assert.throws(() => Limits.parseLimits(table.replace('72,000', '20,000'), 2026), { code: 'INVALID_VALUES' });
  assert.throws(() => Limits.parseLimits(table.replace('24,500', '25,000'), 2026), { code: 'VERIFIED_CONFLICT' });
});
test('script/comment/template text cannot create a fake table', () => {
  const fake = htmlFromMarkdown(table.replace('2026', '2027'));
  assert.deepEqual(Limits.parseLimits('<script>' + fake + '</script><!--' + fake + '--><template>' + fake + '</template>' + html, 2026), expected2026);
  assert.throws(() => Limits.parseLimits('<script>' + fake + '</script>', 2027), { code: 'TABLE_FORMAT' });
});
test('new published-year table can be read without inventing future constants', () => {
  const simulated = table.replace('2026', '2027').replace('24,500', '25,000').replace('72,000', '74,000').replace('360,000', '370,000');
  assert.deepEqual(Limits.parseLimits(simulated, 2027), { year: 2027, deferralLimit: 25000, totalLimit: 74000, compensationLimit: 370000 });
  assert.equal(Limits.VERIFIED_LIMITS[2027], undefined);
});
test('successful direct retrieval is marked direct and makes only one read-only public request', async () => {
  const calls = [];
  const result = await Limits.refresh(2026, { fetchImpl: async (...args) => { calls.push(args); return response(html); } });
  assert.equal(result.method, 'irs-direct');
  assert.equal(result.sourceUrl, Limits.IRSSOURCE);
  assert.equal(result.totalLimit, 72000);
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], Limits.IRSSOURCE);
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(calls[0][1].referrerPolicy, 'no-referrer');
  assert.equal(calls[0][1].body, undefined);
});
test('direct CORS failure falls back to CORS-enabled public IRS text proxy', async () => {
  const calls = [];
  const result = await Limits.refresh(2025, { fetchImpl: async url => {
    calls.push(url);
    if (url === Limits.IRSSOURCE) throw new TypeError('Failed to fetch');
    return response(markdown);
  } });
  assert.equal(result.method, 'irs-via-jina');
  assert.equal(result.deferralLimit, 23500);
  assert.deepEqual(calls, [Limits.IRSSOURCE, 'https://r.jina.ai/' + Limits.IRSSOURCE]);
});
test('network failures throw and never relabel local verified values as refreshed', async () => {
  await assert.rejects(Limits.refresh(2026, { fetchImpl: async () => { throw new Error('offline'); } }), { code: 'REFRESH_FAILED' });
  assert.equal(Limits.VERIFIED_LIMITS[2026].checkedAt, '2026-10-03');
  assert.equal(Limits.VERIFIED_LIMITS[2026].method, 'verified-bundled');
  assert.ok(Object.isFrozen(Limits.VERIFIED_LIMITS[2026]));
});
test('HTTP errors and unsupported response types do not become parsed success', async () => {
  await assert.rejects(Limits.refresh(2026, { fetchImpl: async () => response(table, { ok: false, status: 429 }) }), { code: 'REFRESH_FAILED' });
  await assert.rejects(Limits.refresh(2026, { fetchImpl: async () => response(table, { headers: { get: () => 'application/json' } }) }), { code: 'REFRESH_FAILED' });
});
test('unpublished year still throws even though a bundled previous year exists', async () => {
  await assert.rejects(Limits.refresh(2027, { fetchImpl: async () => response(markdown) }), { code: 'YEAR_NOT_FOUND' });
});
test('timeout bounds stalled fetch and body reading including mocks ignoring abort', async () => {
  const start = Date.now();
  await assert.rejects(Limits.refresh(2026, { timeoutMs: 40, fetchImpl: () => new Promise(() => {}) }), { code: 'REFRESH_FAILED' });
  assert.ok(Date.now() - start < 1000);
  await assert.rejects(Limits.refresh(2026, { timeoutMs: 40, fetchImpl: async () => response('', { text: () => new Promise(() => {}) }) }), { code: 'REFRESH_FAILED' });
});
test('1 MiB bounds apply to input, declared response sizes, and streamed bytes', async () => {
  assert.throws(() => Limits.parseLimits('x'.repeat(1048577), 2026), { code: 'TOO_LARGE' });
  let read = false;
  await assert.rejects(Limits.refresh(2026, { fetchImpl: async () => response('', {
    headers: { get: name => name === 'content-length' ? '1048577' : 'text/plain' },
    text: async () => { read = true; return table; }
  }) }), { code: 'TOO_LARGE' });
  assert.equal(read, false);
  let cancelled = 0;
  await assert.rejects(Limits.refresh(2026, { fetchImpl: async () => response('', {
    body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(1048577) }), cancel: () => { cancelled += 1; }, releaseLock() {} }) }
  }) }), { code: 'TOO_LARGE' });
  assert.equal(cancelled, 2);
});
test('streamed valid UTF-8 is decoded without DOM or a text() fallback', async () => {
  const encoded = new TextEncoder().encode(markdown);
  const result = await Limits.refresh(2026, { fetchImpl: async () => {
    let part = 0;
    return response('', { body: { getReader: () => ({ read: async () => part++ ? { done: true } : { done: false, value: encoded }, releaseLock() {} }) } });
  } });
  assert.equal(result.deferralLimit, 24500);
});
