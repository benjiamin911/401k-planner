'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Parser = require('./policy-parser.js');
const snap = [{ employeePercent: 3, employerMatchPercent: 100 }, { employeePercent: 2, employerMatchPercent: 50 }];
function accepts(text, tiers) {
  const result = Parser.parse(text);
  assert.deepEqual(result.tiers, tiers);
  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join(' '), /true-up、薪酬定义、计划上限/);
}
function rejects(text) {
  const result = Parser.parse(text);
  assert.deepEqual(result.tiers, []);
  assert.ok(result.errors.length > 0);
}

test('recognizes the exact pasted Snap wording', () => {
  accepts('Dollar-for-dollar on the first 3% you contribute 50¢ on the dollar for the next 2%', snap);
});
test('recognizes 50 cents, 50c, and $0.50 rate variants', () => {
  for (const rate of ['50¢', '50c', '50 cents', '$0.50']) accepts('Dollar-for-dollar on the first 3% you contribute ' + rate + ' on the dollar for the next 2%', snap);
});
test('recognizes explicit English two-tier rates with decimal tiers', () => {
  accepts('100% match on first 3% then 50% match on next 2%', snap);
  accepts('100% match on the first 2.5% of salary, and 50% match on the next 1.5% of salary', [
    { employeePercent: 2.5, employerMatchPercent: 100 }, { employeePercent: 1.5, employerMatchPercent: 50 }
  ]);
});
test('recognizes a complete English single tier', () => {
  accepts('50% match up to 6% of salary', [{ employeePercent: 6, employerMatchPercent: 50 }]);
  accepts('100% match on first 4% of your salary', [{ employeePercent: 4, employerMatchPercent: 100 }]);
});
test('recognizes the explicit Chinese two-tier and one-tier variants', () => {
  accepts('前3%配比100%，接下来2%配比50%', snap);
  accepts('前３％配比１００％，接下来的２％配比５０％', snap);
  accepts('公司匹配员工供款的50%，最高至工资的6%', [{ employeePercent: 6, employerMatchPercent: 50 }]);
});
test('Snap summary is only a consistency check and dollar limits do not become tiers', () => {
  accepts('Snap matches: Dollar-for-dollar on the first 3% you contribute\n50¢ on the dollar for the next 2%. That’s up to 4% match when you contribute 5%. Snap does not match after-tax contributions. In 2026, after-tax is limited to $33,100. True-up eligibility must be confirmed.', snap);
  rejects('Up to 4% match when you contribute 5%');
  rejects('100% match on first 3% then 50% match on next 2%. Up to 5% match when you contribute 5%.');
});
test('unsupported subsequent tiers do not fall back to a supported first fragment', () => {
  rejects('100% match on first 3%, then half of your following contributions up to 2%.');
  rejects('100% match on first 3% then 50% match on next 2%, then 25% match on next 1%.');
  rejects('前3%配比100%，接着两档另行计算。');
});
test('ambiguous extra percentages or separate formulas require manual entry', () => {
  rejects('50% match up to 6% of salary or 100% match on first 3%.');
  rejects('100% match on first 3% then 50% match on next 2%. For some employees compensation is capped at 80%.');
  rejects('Matching 50%, contribution 6%, company maximum 4%.');
});
test('invalid numeric rates are not converted into plausible positive values', () => {
  rejects('-50% match up to 6% of salary');
  rejects('100% match on first 0%');
  rejects('100% match on first 80% then 50% match on next 30%');
  rejects('10000% match on first 3%');
  rejects('150c on the dollar for the first 3%');
});
test('negated formulas and unexplained dollar matching caps are not accepted as simple tiers', () => {
  rejects('We do not provide 100% match on first 3% of salary.');
  rejects('50% match up to 6% of salary. Employer match is capped at $5,000.');
  rejects('Your salary is $200,000 and employer matching compensation is $150,000: 50% match up to 6% of salary.');
});
test('empty, unsupported, non-string and excessively long policies safely return errors', () => {
  for (const value of ['', null, undefined, 33, {}, 'No company match.', 'Your match depends on years of service.', 'x'.repeat(20001)]) rejects(value);
});
test('pasted code is not executed and results do not depend on browser APIs', () => {
  globalThis.policyParserExecution = false;
  rejects('<script>globalThis.policyParserExecution=true</script>');
  assert.equal(globalThis.policyParserExecution, false);
  delete globalThis.policyParserExecution;
});
