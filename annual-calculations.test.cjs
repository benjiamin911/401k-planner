'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { DEFAULTS, DEFAULT_LIMITS, calculate } = require('./annual-calculations.js');
const cents = x => Math.round(x * 100);
const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-8, `${x} != ${y}`);

test('200k is an explicit demo: ideal Snap targets and mathematical percentages', () => {
  const r = calculate();
  assert.deepEqual(r.errors, []);
  assert.equal(r.fullMatchThresholdPercent, 5);
  assert.equal(r.maximumEmployerMatch, 8000);
  assert.equal(r.ideal.regularTarget, 24500);
  assert.equal(r.ideal.regularPercent, 12.25);
  assert.equal(r.ideal.afterTaxTarget, 33100);
  assert.equal(r.ideal.afterTaxPercent, 16.55);
  assert.equal(r.ideal.irsAfterTaxRoom, 39500);
  assert.equal(r.ideal.employerMatch, 8000);
  assert.equal(r.ideal.totalAnnual, 65600);
  assert.equal(r.ideal.rothTarget, 24500);
  assert.equal(r.feasible, true);
});

test('26 rounded paychecks require penny-safe rate adjustment, not an assumed cutoff', () => {
  const r = calculate();
  assert.equal(r.safe.regularPercent, 12.24);
  assert.equal(r.safe.afterTaxPercent, 16.54);
  assert.equal(r.safe.centRoundingAdjusted, true);
  assert.ok(r.safe.regularGap > 0 && r.safe.afterTaxGap > 0);
  assert.ok(r.warnings.some(x => x.includes('四舍五入到分')));
  assert.equal(r.safe.schedule.length, 26);
  assert.equal(r.safe.paycheckGrossSchedule.reduce((a, b) => a + cents(b), 0), 20000000);
});

test('400k salary uses capped matching pay and distinguishes ideal from rounded targets', () => {
  const r = calculate({ annualSalary: 400000 });
  assert.equal(r.eligibleComp, 360000);
  assert.equal(r.maximumEmployerMatch, 14400);
  assert.equal(r.ideal.regularPercent, 6.125);
  assert.equal(r.ideal.afterTaxPercent, 8.275);
  assert.equal(r.ideal.totalAnnualReserved, 72000);
});

test('goals distinguish match only, regular maximum, and full plan savings', () => {
  const match = calculate({ goal: 'match-only' });
  assert.equal(match.ideal.regularTarget, 10000);
  assert.equal(match.ideal.regularPercent, 5);
  assert.equal(match.ideal.afterTaxTarget, 0);
  assert.equal(match.ideal.employerMatch, 8000);
  const regular = calculate({ goal: 'max-regular' });
  assert.equal(regular.ideal.regularTarget, 24500);
  assert.equal(regular.ideal.afterTaxTarget, 0);
  const disabled = calculate({ afterTaxEnabled: false });
  assert.equal(disabled.ideal.afterTaxTarget, 0);
  assert.equal(disabled.safe.afterTaxPercent, 0);
});

test('annual matching uses capped annual compensation for the match-only minimum', () => {
  const annual = calculate({ annualSalary: 400000, matchTiming: 'annual', goal: 'match-only' });
  assert.equal(annual.fullMatchThresholdPercent, 5); // Raw policy tier threshold.
  assert.equal(annual.fullMatchRequiredAnnual, 18000);
  assert.equal(annual.appliedFullMatchThresholdPercent, 4.5);
  assert.equal(annual.ideal.regularTarget, 18000);
  assert.equal(annual.ideal.regularPercent, 4.5);
  assert.equal(annual.ideal.employerMatch, 14400);
  assert.equal(annual.ideal.fullMatchAttainable, true);
  assert.ok(!annual.warnings.some(x => x.includes('每期比例达到')));
  const perPay = calculate({ annualSalary: 400000, matchTiming: 'paycheck', trueUpEligible: 'yes', goal: 'match-only' });
  assert.equal(perPay.fullMatchRequiredAnnual, 20000);
  assert.equal(perPay.appliedFullMatchThresholdPercent, 5);
  assert.equal(perPay.ideal.regularTarget, 20000);
  const annuallyInsufficient = calculate({ annualSalary: 1000000, matchTiming: 'annual', matchTiers: [{ employeePercent: 10, employerMatchPercent: 100 }] });
  assert.equal(annuallyInsufficient.ideal.fullMatchAttainable, false);
  assert.ok(annuallyInsufficient.warnings.some(x => x.includes('普通年度供款额度不足以达到完整年度')));
});

test('custom incremental tiers, zero match, and total compensation cap', () => {
  const custom = calculate({ matchTiers: [{ employeePercent: 6, employerMatchPercent: 50 }] });
  assert.equal(custom.fullMatchThresholdPercent, 6);
  assert.equal(custom.maximumEmployerMatch, 6000);
  const none = calculate({ matchTiers: [], goal: 'match-only' });
  assert.equal(none.ideal.regularTarget, 0);
  assert.equal(none.maximumEmployerMatch, 0);
  const zeroThenPositive = calculate({ matchTiers: [{ employeePercent: 3, employerMatchPercent: 0 }, { employeePercent: 2, employerMatchPercent: 50 }] });
  assert.equal(zeroThenPositive.fullMatchThresholdPercent, 5);
  assert.equal(zeroThenPositive.maximumEmployerMatch, 2000);
});

test('high salary ordinary cap cannot achieve the full per-pay matching percentage', () => {
  const r = calculate({ annualSalary: 1000000, afterTaxPlanCap: null });
  assert.equal(r.ideal.regularPercent, 2.45);
  assert.equal(r.ideal.fullMatchAttainable, false);
  assert.equal(r.ideal.perPayMatch, 8820);
  assert.equal(r.ideal.annualFormulaMatch, 14400);
  assert.equal(r.ideal.conditionalTrueUp, 5580);
  assert.equal(r.ideal.employerMatch, 8820); // No promise of an unknown true-up.
  assert.equal(r.ideal.employerMatchReserve, 14400);
  assert.equal(r.ideal.afterTaxTarget, 33100);
  assert.equal(r.ideal.totalAnnualReserved, 72000);
  const no = calculate({ annualSalary: 1000000, afterTaxPlanCap: null, trueUpEligible: 'no' });
  assert.equal(no.ideal.employerMatchReserve, 8820);
  assert.equal(no.ideal.afterTaxTarget, 38680);
  assert.equal(no.ideal.conditionalTrueUp, 0);
  for (const state of [{ matchTiming: 'annual' }, { trueUpEligible: 'yes' }]) {
    const yes = calculate({ annualSalary: 1000000, afterTaxPlanCap: null, ...state });
    assert.equal(yes.ideal.employerMatch, 14400);
    assert.equal(yes.ideal.afterTaxTarget, 33100);
  }
});

test('low salary reserves employer money before regular savings to satisfy 100% compensation', () => {
  const low = calculate({ annualSalary: 20000 });
  assert.deepEqual(low.errors, []);
  assert.equal(low.effectiveTotalLimit, 20000);
  assert.equal(low.ideal.regularTarget, 19200);
  assert.equal(low.ideal.employerMatch, 800);
  assert.equal(low.ideal.afterTaxTarget, 0);
  assert.equal(low.ideal.totalAnnualReserved, 20000);
  assert.ok(low.safe.totalAnnualReserved <= 20000);
  const other = calculate({ annualSalary: 20000, otherEmployerAnnual: 1000 });
  assert.equal(other.ideal.regularTarget, 18200);
  assert.equal(other.ideal.totalAnnualReserved, 20000);
});

test('employer per-pay cent rounding cannot push a fully used low-salary limit over the cap', () => {
  for (const [annualSalary, payPeriods] of [[4301, 12], [13542.87, 52], [11671.83, 52]]) {
    const r = calculate({ annualSalary, payPeriods, payrollStep: 0.1, rothSharePercent: 50 });
    assert.equal(r.safe.jointMatchRoundingAdjusted, true);
    assert.ok(cents(r.safe.totalAnnualReserved) <= cents(annualSalary));
    assert.ok(r.safe.regularGap > 0);
  }
});

test('zero salary and absent tiers stay finite without phantom contributions', () => {
  const zero = calculate({ annualSalary: 0 });
  assert.deepEqual(zero.errors, []);
  assert.equal(zero.ideal.regularPercent, 0);
  assert.equal(zero.ideal.afterTaxPercent, 0);
  assert.equal(zero.safe.totalAnnual, 0);
  assert.equal(zero.feasible, true);
});

test('a combined payroll cap limits safe rates and reports the unmet ideal target', () => {
  const r = calculate({ payrollPercentCap: 15 });
  assert.equal(r.feasible, false);
  assert.ok(r.safe.combinedPercent <= 15);
  assert.ok(r.safe.afterTaxGap > 0);
  const lower = calculate({ payrollPercentCap: 5, rothSharePercent: 50 });
  assert.ok(lower.safe.combinedPercent <= 5);
  assert.ok(lower.safe.regularGap > 0);
  assert.ok(lower.safe.schedule.every(row => row.employeeTotal <= row.gross));
});

test('each pre-tax and Roth source respects the payroll percentage step independently', () => {
  const r = calculate({ rothSharePercent: 50 });
  assert.equal(r.ideal.rothTarget, 12250);
  assert.equal(r.ideal.preTaxTarget, 12250);
  near(r.safe.rothPercent / 0.01, Math.round(r.safe.rothPercent / 0.01));
  near(r.safe.preTaxPercent / 0.01, Math.round(r.safe.preTaxPercent / 0.01));
  assert.ok(r.safe.preTaxAnnual <= 12250);
  assert.ok(r.safe.rothAnnual <= 12250);
});

test('invalid data, unsupported years, accessors, and actual employer over-cap suppress results', () => {
  const cases = [null, [], { annualSalary: '200000' }, { annualSalary: NaN }, { annualSalary: Infinity },
    { annualSalary: -1 }, { annualSalary: 0.001 }, { annualSalary: 1e100 }, { payPeriods: 0 }, { payPeriods: 1000 },
    { payrollStep: 0 }, { payrollPercentCap: 101 }, { goal: 'trade-stocks' }, { matchTiers: 'bad' },
    { matchTiers: [{ employeePercent: 101, employerMatchPercent: 50 }] },
    { matchTiers: [{ employeePercent: 70, employerMatchPercent: 50 }, { employeePercent: 50, employerMatchPercent: 10 }] },
    { annualSalary: 100, otherEmployerAnnual: 101 }];
  for (const input of cases) { const r = calculate(input); assert.ok(r.errors.length); assert.equal(r.ideal, null); assert.equal(r.safe, null); }
  assert.ok(calculate({}, { year: 2027 }).errors.length);
  const get = Object.defineProperty({}, 'annualSalary', { get() { throw new Error('must not execute'); } });
  assert.ok(calculate(get).errors.length);
});

test('another year requires all explicit limits and uses those supplied amounts', () => {
  const r = calculate({ afterTaxPlanCap: null }, { year: 2025, deferralLimit: 23500, totalLimit: 70000, compensationLimit: 350000 });
  assert.deepEqual(r.errors, []);
  assert.equal(r.limits.year, 2025);
  assert.equal(r.ideal.regularTarget, 23500);
  assert.equal(r.ideal.afterTaxTarget, 38500);
  assert.equal(r.ideal.totalAnnualReserved, 70000);
  assert.ok(calculate({}, { year: 2025 }).errors.length);
  assert.ok(calculate({}, { year: 2027 }).errors.length);
  assert.ok(calculate({}, { year: 2022, deferralLimit: 20500, totalLimit: 61000, compensationLimit: 305000 }).errors.length);
});

test('randomized salaries, tiers, split rates, and steps never breach contribution or payroll bounds', () => {
  let seed = 24680;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 250; i++) {
    const state = { annualSalary: Math.floor(random() * (i % 2 ? 2500001 : 150000001)) / 100, payPeriods: [12, 24, 26, 52][i % 4],
      rothSharePercent: [0, 25, 50, 75, 100][i % 5], payrollStep: [1, 0.1, 0.01, 0.25][i % 4],
      payrollPercentCap: Math.floor(random() * 101), afterTaxPlanCap: i % 2 ? null : 33100,
      trueUpEligible: ['yes', 'no', 'unknown'][i % 3] };
    const r = calculate(state);
    assert.deepEqual(r.errors, []);
    assert.ok(cents(r.ideal.totalAnnualReserved) <= cents(r.effectiveTotalLimit));
    assert.ok(cents(r.safe.totalAnnualReserved) <= cents(r.effectiveTotalLimit));
    assert.ok(cents(r.safe.regularAnnual) <= 2450000);
    assert.ok(cents(r.safe.afterTaxAnnual) <= cents(r.ideal.afterTaxTarget));
    assert.ok(r.safe.combinedPercent <= state.payrollPercentCap + 1e-9);
    assert.ok(r.safe.schedule.every(row => cents(row.employeeTotal) <= cents(row.gross)));
    for (const key of ['preTaxPercent', 'rothPercent', 'afterTaxPercent']) near(r.safe[key] / state.payrollStep, Math.round(r.safe[key] / state.payrollStep));
  }
});

test('conversion capability is not an enrollment input and does not create extra room', () => {
  const yes = calculate(), no = calculate({ inPlanConversion: false });
  assert.equal(yes.ideal.afterTaxTarget, no.ideal.afterTaxTarget);
  assert.equal(yes.safe.afterTaxAnnual, no.safe.afterTaxAnnual);
  assert.ok(no.warnings.some(x => x.includes('不等于已完成')));
  assert.deepEqual(calculate({ ytdRoth: 12000, ytdAfterTax: 13500, conversionAmount: 50000 }).ideal, yes.ideal);
});

test('CommonJS and browser exports are offline and do not mutate inputs or defaults', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('./annual-calculations.js'), 'utf8'), context);
  assert.equal(context.window.AnnualCalc.calculate().ideal.regularTarget, 24500);
  const state = Object.freeze({ annualSalary: 300000 });
  calculate(state);
  assert.equal(DEFAULTS.annualSalary, 200000);
  assert.equal(DEFAULT_LIMITS.year, 2026);
});
