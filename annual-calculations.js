/* Start-of-year, under-50, one-employer planner. Public money values are dollars.
 * Internal money values are integer cents. No DOM, storage, network, or account access.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AnnualCalc = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var SCALE = 10000, DEN = 100 * SCALE, BIG_DEN = BigInt(DEN);
  var DEFAULT_LIMITS = Object.freeze({ year: 2026, deferralLimit: 24500, totalLimit: 72000, compensationLimit: 360000 });
  var DEFAULTS = Object.freeze({
    annualSalary: 200000, payPeriods: 26, goal: 'max-all', rothSharePercent: 100,
    matchTiers: Object.freeze([Object.freeze({ employeePercent: 3, employerMatchPercent: 100 }), Object.freeze({ employeePercent: 2, employerMatchPercent: 50 })]),
    matchTiming: 'paycheck', trueUpEligible: 'unknown', afterTaxEnabled: true,
    afterTaxPlanCap: 33100, inPlanConversion: true, payrollStep: 0.01,
    payrollPercentCap: 100, otherEmployerAnnual: 0
  });
  function toCents(n) { return Math.round(n * 100); }
  function dollars(n) { return n / 100; }
  function units(n) { return Math.round(n * SCALE); }
  function decimal(n, places) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return false;
    var x = n * Math.pow(10, places);
    return Math.abs(x - Math.round(x)) <= Math.max(1e-6, Math.abs(x) * Number.EPSILON * 2);
  }
  function money(n) { return decimal(n, 2) && n >= 0 && n <= 1e9; }
  function roundRatio(n, d) { return Number((n + d / 2n) / d); }
  function contribution(gross, rate) { return roundRatio(BigInt(gross) * BigInt(rate), BIG_DEN); }
  function percent(amount, salary) { return salary ? amount / salary * 100 : 0; }
  function sum(values) { return values.reduce(function (a, b) { return a + b; }, 0); }
  function floorPercentForAmount(amount, salary, step) {
    if (!salary || !amount) return 0;
    return Number(BigInt(amount) * BIG_DEN / (BigInt(salary) * BigInt(step))) * step;
  }
  function allocateCents(total, periods) {
    var base = Math.floor(total / periods), remainder = total % periods;
    return Array.from({ length: periods }, function (_, i) { return base + (i < remainder ? 1 : 0); });
  }
  function readKnown(input, defaults, errors, name) {
    if (input === undefined) input = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      errors.push(name + '必须是普通输入对象。');
      return Object.assign({}, defaults);
    }
    var result = {};
    Object.keys(defaults).forEach(function (key) {
      var descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor && !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        errors.push(key + '不能使用动态属性。');
        result[key] = defaults[key];
      } else result[key] = descriptor ? descriptor.value : defaults[key];
    });
    return result;
  }
  function normalize(input, suppliedLimits) {
    var errors = [], s = readKnown(input, DEFAULTS, errors, '计划'), l = readKnown(suppliedLimits, DEFAULT_LIMITS, errors, '年度额度');
    ['annualSalary', 'otherEmployerAnnual'].forEach(function (k) { if (!money(s[k])) errors.push(k + '须为非负美元数值，最多两位小数。'); });
    ['deferralLimit', 'totalLimit', 'compensationLimit'].forEach(function (k) { if (!money(l[k])) errors.push(k + '须为已核实的非负美元额度，最多两位小数。'); });
    if (!Number.isInteger(l.year) || l.year < 2023 || l.year > 2100) errors.push('请输入已核实额度的有效年度（2023–2100）。');
    if (l.year !== 2026 && (!suppliedLimits || !['deferralLimit', 'totalLimit', 'compensationLimit'].every(function (k) { return Object.prototype.hasOwnProperty.call(suppliedLimits, k); }))) errors.push('其他年度须同时提供已核实的全部 IRS 额度，不能沿用 2026 默认值。');
    if (!Number.isInteger(s.payPeriods) || s.payPeriods < 1 || s.payPeriods > 366) errors.push('全年发薪次数须为 1 至 366 的整数。');
    if (['max-all', 'max-regular', 'match-only'].indexOf(s.goal) < 0) errors.push('请选择有效的年度储蓄目标。');
    if (['paycheck', 'annual'].indexOf(s.matchTiming) < 0) errors.push('match 计算方式须为逐期或年度。');
    if (['unknown', 'yes', 'no'].indexOf(s.trueUpEligible) < 0) errors.push('true-up 资格须为 unknown、yes 或 no。');
    ['afterTaxEnabled', 'inPlanConversion'].forEach(function (k) { if (typeof s[k] !== 'boolean') errors.push(k + '须为布尔值。'); });
    if (s.afterTaxPlanCap !== null && !money(s.afterTaxPlanCap)) errors.push('计划 after-tax 上限须为空或非负美元数值。');
    ['rothSharePercent', 'payrollStep', 'payrollPercentCap'].forEach(function (k) {
      if (!decimal(s[k], 4) || s[k] < 0 || s[k] > 100 || (k === 'payrollStep' && s[k] === 0)) errors.push(k + '须在 0 至 100 之间（步进不能为零），最多四位小数。');
    });
    if (!Array.isArray(s.matchTiers) || s.matchTiers.length > 30) errors.push('match 档位须为最多 30 项的数组。');
    var tiers = [];
    if (Array.isArray(s.matchTiers) && s.matchTiers.length <= 30) s.matchTiers.forEach(function (tier) {
      var t = readKnown(tier, { employeePercent: 0, employerMatchPercent: 0 }, errors, 'match 档位');
      if (!decimal(t.employeePercent, 4) || t.employeePercent < 0 || t.employeePercent > 100 || !decimal(t.employerMatchPercent, 4) || t.employerMatchPercent < 0 || t.employerMatchPercent > 1000) errors.push('档位员工比例须为 0–100%，匹配比例须为 0–1000%，最多四位小数。');
      tiers.push(t);
    });
    if (!errors.length && sum(tiers.map(function (t) { return units(t.employeePercent); })) > DEN) errors.push('所有增量档位的员工供款比例合计不能超过 100%。');
    s.matchTiers = tiers;
    return { state: s, limits: l, errors: errors };
  }

  // Match on eligible compensation for a regular-contribution ratio numerator/base.
  // Tier sizes are INCREMENTS (3% then 2%), not cumulative endpoints (3%, 5%).
  // All rational terms are retained until the final cent is rounded.
  function matchRatio(eligible, numerator, base, tiers) {
    if (!eligible || !base || !numerator) return 0;
    var prior = 0, total = 0n;
    tiers.forEach(function (tier) {
      var width = units(tier.employeePercent), match = units(tier.employerMatchPercent);
      var available = BigInt(numerator) * BIG_DEN - BigInt(prior) * BigInt(base);
      var tierCapacity = BigInt(width) * BigInt(base);
      var included = available < 0n ? 0n : available > tierCapacity ? tierCapacity : available;
      total += BigInt(eligible) * included * BigInt(match);
      prior += width;
    });
    return roundRatio(total, BigInt(base) * BIG_DEN * BIG_DEN);
  }
  function matchValues(regular, salary, eligible, s, explicitPayrollMatch) {
    var paycheck = explicitPayrollMatch === undefined ? matchRatio(eligible, regular, salary, s.matchTiers) : explicitPayrollMatch;
    var annual = matchRatio(eligible, regular, eligible, s.matchTiers);
    var reconcile = s.matchTiming === 'annual' || s.trueUpEligible === 'yes';
    var reserve = s.matchTiming === 'annual' ? annual : s.trueUpEligible === 'no' ? paycheck : Math.max(paycheck, annual);
    return { paycheck: paycheck, annual: annual, expected: reconcile ? annual : paycheck,
      reserve: reserve, conditionalTrueUp: s.matchTiming === 'paycheck' && s.trueUpEligible !== 'no' ? Math.max(0, annual - paycheck) : 0,
      potentialTrueUp: Math.max(0, annual - paycheck) };
  }
  function maximumInteger(high, predicate) {
    var low = 0;
    while (low < high) {
      var middle = Math.floor((low + high + 1) / 2);
      if (predicate(middle)) low = middle; else high = middle - 1;
    }
    return low;
  }
  function safeRate(maxUnits, budget, grossSchedule, step, perPayAllowance) {
    return maximumInteger(Math.floor(maxUnits / step), function (steps) {
      var amounts = grossSchedule.map(function (gross) { return contribution(gross, steps * step); });
      return sum(amounts) <= budget && (!perPayAllowance || amounts.every(function (amount, i) { return amount <= perPayAllowance[i]; }));
    }) * step;
  }
  function invalid(errors) { return { errors: errors, warnings: [], assumptions: [], feasible: false, ideal: null, safe: null }; }

  /**
   * Result contract: ideal contains theoretical annual targets and exact percentages.
   * safe contains fixed all-year payroll rates at the requested step. Each source's
   * deductions round to cents each payday; all deductions stay within targets/caps.
   * safe may leave gaps: it does NOT assume an automatic annual payroll cutoff.
   * Gross salary and capped matching compensation are each spread across all checks;
   * a one-cent allocation distributes indivisible annual cents without changing totals.
   * Per-pay match uses the regular payroll percentage on capped per-pay compensation.
   * Annual reconciliation uses regular annual dollars / capped annual compensation.
   * Unknown true-up reserves the larger model but does NOT promise that extra match.
   * safe reserve never falls below the ideal reserve solely due to payroll rounding.
   * Other employer contributions occupy the total limit but do not consume elective room.
   * inPlanConversion is a plan capability, NEVER an election or completed conversion.
   */
  function calculate(input, suppliedLimits) {
    var normalized = normalize(input, suppliedLimits);
    if (normalized.errors.length) return invalid(normalized.errors);
    var s = normalized.state, l = normalized.limits, warnings = [], assumptions = [];
    var salary = toCents(s.annualSalary), effective = Math.min(toCents(l.totalLimit), salary);
    var eligible = Math.min(salary, toCents(l.compensationLimit)), other = toCents(s.otherEmployerAnnual);
    if (other > effective) return invalid(['其他全年雇主供款超过年度总额／100% 薪酬额度 $' + dollars(other - effective).toFixed(2) + '；请先核对。']);
    var thresholdUnits = 0, cumulativeTierUnits = 0;
    s.matchTiers.forEach(function (tier) { cumulativeTierUnits += units(tier.employeePercent); if (tier.employerMatchPercent > 0 && tier.employeePercent > 0) thresholdUnits = cumulativeTierUnits; });
    var maxMatch = matchRatio(eligible, DEN, DEN, s.matchTiers);
    var ordinaryBeforeMatch = Math.min(toCents(l.deferralLimit), salary, effective - other);
    var regularMaximum = maximumInteger(ordinaryBeforeMatch, function (regular) {
      return regular + other + matchValues(regular, salary, eligible, s).reserve <= effective;
    });
    // A genuinely annual formula applies its tier threshold to capped eligible
    // compensation. Paycheck mode keeps the conservative same-percentage-every-pay
    // target even when the employee reports being eligible for a later true-up.
    var fullMatchEmployeeTarget = contribution(s.matchTiming === 'annual' ? eligible : salary, thresholdUnits);
    var regularTarget = s.goal === 'match-only' ? Math.min(regularMaximum, fullMatchEmployeeTarget) : regularMaximum;
    var idealMatch = matchValues(regularTarget, salary, eligible, s);
    var idealReserve = idealMatch.reserve;
    var irsRoom = Math.max(0, Math.min(effective - regularTarget - other - idealReserve, salary - regularTarget));
    var planCap = s.afterTaxPlanCap === null ? irsRoom : toCents(s.afterTaxPlanCap);
    var availableAfterTax = s.afterTaxEnabled ? Math.max(0, Math.min(planCap, irsRoom)) : 0;
    var afterTarget = s.goal === 'max-all' ? availableAfterTax : 0;
    var rothTarget = contribution(regularTarget, units(s.rothSharePercent));
    var preTarget = regularTarget - rothTarget;
    var regularPercent = percent(regularTarget, salary), afterPercent = percent(afterTarget, salary);
    var ideal = {
      regularTarget: dollars(regularTarget), preTaxTarget: dollars(preTarget), rothTarget: dollars(rothTarget),
      regularPercent: regularPercent, preTaxPercent: percent(preTarget, salary), rothPercent: percent(rothTarget, salary),
      afterTaxTarget: dollars(afterTarget), afterTaxPercent: afterPercent,
      afterTaxAnnualRoom: dollars(availableAfterTax), irsAfterTaxRoom: dollars(irsRoom),
      employerMatch: dollars(idealMatch.expected), employerMatchReserve: dollars(idealReserve),
      perPayMatch: dollars(idealMatch.paycheck), annualFormulaMatch: dollars(idealMatch.annual),
      conditionalTrueUp: dollars(idealMatch.conditionalTrueUp), potentialTrueUp: dollars(idealMatch.potentialTrueUp),
      otherEmployer: dollars(other), totalEmployerReserve: dollars(other + idealReserve),
      totalEmployee: dollars(regularTarget + afterTarget), totalAnnual: dollars(regularTarget + afterTarget + other + idealMatch.expected),
      totalAnnualReserved: dollars(regularTarget + afterTarget + other + idealReserve),
      combinedPercent: regularPercent + afterPercent,
      regularPerPay: dollars(regularTarget) / s.payPeriods, afterTaxPerPay: dollars(afterTarget) / s.payPeriods,
      fullMatchRequiredAnnual: dollars(fullMatchEmployeeTarget),
      appliedFullMatchThresholdPercent: percent(fullMatchEmployeeTarget, salary),
      fullMatchAttainable: s.matchTiming === 'annual' ? regularTarget >= fullMatchEmployeeTarget : regularPercent + 1e-10 >= thresholdUnits / SCALE
    };
    var step = units(s.payrollStep), cap = units(s.payrollPercentCap);
    var grossSchedule = allocateCents(salary, s.payPeriods), eligibleSchedule = allocateCents(eligible, s.payPeriods);
    var ordinaryRateCap = Math.min(cap, floorPercentForAmount(regularTarget, salary, 1));
    var maxRothRate = Number(BigInt(ordinaryRateCap) * BigInt(units(s.rothSharePercent)) / BIG_DEN);
    var maxPreRate = ordinaryRateCap - maxRothRate;
    maxPreRate = Math.min(maxPreRate, floorPercentForAmount(preTarget, salary, 1));
    maxRothRate = Math.min(maxRothRate, floorPercentForAmount(rothTarget, salary, 1));
    var initialPreRate = Math.floor(maxPreRate / step) * step, initialRothRate = Math.floor(maxRothRate / step) * step;
    var preRate = safeRate(initialPreRate, preTarget, grossSchedule, step, grossSchedule);
    var preAmounts = grossSchedule.map(function (gross) { return contribution(gross, preRate); });
    var rothRate = safeRate(initialRothRate, rothTarget, grossSchedule, step, grossSchedule.map(function (gross, i) { return gross - preAmounts[i]; }));
    var rothAmounts = grossSchedule.map(function (gross) { return contribution(gross, rothRate); });
    var regularRate = preRate + rothRate, preAnnual = sum(preAmounts), rothAnnual = sum(rothAmounts), regularAnnual = preAnnual + rothAnnual;
    var matchAmounts = eligibleSchedule.map(function (comp) { return matchRatio(comp, regularRate, DEN, s.matchTiers); });
    var safeMatch = matchValues(regularAnnual, salary, eligible, s, sum(matchAmounts));
    var safeReserve = Math.max(idealReserve, safeMatch.reserve);
    // At a 100%-of-compensation boundary, cent rounding of employer match can
    // consume slightly more room than its ideal annual formula. Recheck the JOINT
    // employee + employer total before adding after-tax, lowering a source if needed.
    var jointMatchRoundingAdjusted = regularAnnual + other + safeReserve > effective;
    if (jointMatchRoundingAdjusted) {
      var fitsJointLimit = function (candidatePre, candidateRoth) {
        var candidateAnnual = sum(grossSchedule.map(function (gross) { return contribution(gross, candidatePre) + contribution(gross, candidateRoth); }));
        var candidatePayMatch = sum(eligibleSchedule.map(function (comp) { return matchRatio(comp, candidatePre + candidateRoth, DEN, s.matchTiers); }));
        var candidateMatch = matchValues(candidateAnnual, salary, eligible, s, candidatePayMatch);
        return candidateAnnual + other + Math.max(idealReserve, candidateMatch.reserve) <= effective;
      };
      rothRate = maximumInteger(Math.floor(rothRate / step), function (n) { return fitsJointLimit(preRate, n * step); }) * step;
      if (!fitsJointLimit(preRate, rothRate)) preRate = maximumInteger(Math.floor(preRate / step), function (n) { return fitsJointLimit(n * step, rothRate); }) * step;
      preAmounts = grossSchedule.map(function (gross) { return contribution(gross, preRate); });
      rothAmounts = grossSchedule.map(function (gross) { return contribution(gross, rothRate); });
      preAnnual = sum(preAmounts); rothAnnual = sum(rothAmounts); regularAnnual = preAnnual + rothAnnual;
      regularRate = preRate + rothRate;
      matchAmounts = eligibleSchedule.map(function (comp) { return matchRatio(comp, regularRate, DEN, s.matchTiers); });
      safeMatch = matchValues(regularAnnual, salary, eligible, s, sum(matchAmounts));
      safeReserve = Math.max(idealReserve, safeMatch.reserve);
    }
    var safeRoom = s.afterTaxEnabled ? Math.max(0, Math.min(s.afterTaxPlanCap === null ? effective : toCents(s.afterTaxPlanCap), effective - regularAnnual - other - safeReserve, salary - regularAnnual)) : 0;
    var safeAfterTarget = Math.min(afterTarget, safeRoom);
    var initialAfterRate = Math.min(Math.floor((cap - regularRate) / step) * step, floorPercentForAmount(safeAfterTarget, salary, step));
    var afterRate = safeRate(initialAfterRate, safeAfterTarget, grossSchedule, step, grossSchedule.map(function (gross, i) { return gross - preAmounts[i] - rothAmounts[i]; }));
    var afterAmounts = grossSchedule.map(function (gross) { return contribution(gross, afterRate); }), afterAnnual = sum(afterAmounts);
    var schedule = grossSchedule.map(function (gross, i) { return {
      period: i + 1, gross: dollars(gross), eligibleMatchComp: dollars(eligibleSchedule[i]),
      preTax: dollars(preAmounts[i]), roth: dollars(rothAmounts[i]), regular: dollars(preAmounts[i] + rothAmounts[i]),
      afterTax: dollars(afterAmounts[i]), employeeTotal: dollars(preAmounts[i] + rothAmounts[i] + afterAmounts[i]),
      perPayEmployerMatch: dollars(matchAmounts[i])
    }; });
    var safe = {
      regularPercent: regularRate / SCALE, preTaxPercent: preRate / SCALE, rothPercent: rothRate / SCALE,
      afterTaxPercent: afterRate / SCALE, combinedPercent: (regularRate + afterRate) / SCALE,
      regularAnnual: dollars(regularAnnual), preTaxAnnual: dollars(preAnnual), rothAnnual: dollars(rothAnnual), afterTaxAnnual: dollars(afterAnnual),
      regularPerPay: schedule[0].regular, preTaxPerPay: schedule[0].preTax, rothPerPay: schedule[0].roth, afterTaxPerPay: schedule[0].afterTax,
      regularPerPayMin: Math.min.apply(null, schedule.map(function (row) { return row.regular; })),
      regularPerPayMax: Math.max.apply(null, schedule.map(function (row) { return row.regular; })),
      afterTaxPerPayMin: Math.min.apply(null, schedule.map(function (row) { return row.afterTax; })),
      afterTaxPerPayMax: Math.max.apply(null, schedule.map(function (row) { return row.afterTax; })),
      employerMatch: dollars(safeMatch.expected), employerMatchReserve: dollars(safeReserve),
      perPayMatch: dollars(safeMatch.paycheck), annualFormulaMatch: dollars(safeMatch.annual),
      conditionalTrueUp: dollars(safeMatch.conditionalTrueUp), potentialTrueUp: dollars(safeMatch.potentialTrueUp),
      totalEmployerReserve: dollars(other + safeReserve), otherEmployer: dollars(other),
      totalAnnual: dollars(regularAnnual + afterAnnual + other + safeMatch.expected),
      totalAnnualReserved: dollars(regularAnnual + afterAnnual + other + safeReserve),
      totalEmployee: dollars(regularAnnual + afterAnnual), afterTaxAnnualRoom: dollars(safeRoom),
      regularGap: dollars(regularTarget - regularAnnual), afterTaxGap: dollars(afterTarget - afterAnnual),
      fullMatchAttainable: s.matchTiming === 'annual' ? regularAnnual >= fullMatchEmployeeTarget : regularRate >= thresholdUnits,
      centRoundingAdjusted: preRate < initialPreRate || rothRate < initialRothRate || afterRate < initialAfterRate,
      jointMatchRoundingAdjusted: jointMatchRoundingAdjusted,
      paycheckGrossSchedule: grossSchedule.map(dollars), schedule: schedule
    };
    if (regularMaximum < ordinaryBeforeMatch) warnings.push('为给雇主供款预留空间并遵守 100% 薪酬／总额度限制，普通供款目标已低于名义上限。');
    if (ideal.combinedPercent > s.payrollPercentCap + 1e-10) warnings.push('理想总扣款比例超过每期工资设置上限；固定比例方案优先安排普通供款，仍有目标差额。');
    if (safe.centRoundingAdjusted) warnings.push('每期供款和 match 四舍五入到分会使表面上刚好的百分比略超年度目标；安全固定比例因此再降低一个或多个工资步进。');
    if (safe.regularGap > 0 || safe.afterTaxGap > 0) warnings.push('固定比例均向下调整且不假设工资系统自动截停，因此可能留有年度未存差额。');
    if (thresholdUnits && !ideal.fullMatchAttainable) warnings.push(s.matchTiming === 'annual' ? '普通年度供款额度不足以达到完整年度 match 门槛；公司配比按实际可安排的普通年度供款估算。' : '普通供款额度不足以让全年每期比例达到完整 match 门槛；是否有年度补差取决于计划条款和 true-up 资格。');
    if (s.matchTiming === 'paycheck' && s.trueUpEligible === 'unknown') warnings.push('true-up 资格未知：展示的预计 match 采用逐期模型，after-tax 空间另为潜在年度补差预留；补差并非保证。');
    if (s.afterTaxEnabled && !s.inPlanConversion && afterTarget > 0) warnings.push('计划尚未确认支持 in-plan Roth conversion；普通 after-tax 供款本身不等于已完成 Mega backdoor。');
    if (s.afterTaxEnabled && s.inPlanConversion) warnings.push('支持 in-plan conversion 仅表示计划有此功能，不代表你的自动转换已经启用或完成。');
    assumptions.push('全年在同一雇主、未满 50 岁、均匀基础工资；不包含奖金、RSU、入离职或年中加薪。');
    assumptions.push('可匹配薪酬先受年度薪酬上限限制，再均匀分配到全部发薪期；实际计划可能按不同方式处理达到薪酬上限的时间。');
    assumptions.push('逐期 match 按普通 pre-tax＋Roth 百分比套用档位；年度模型按全年普通供款／受限匹配薪酬计算。普通 after-tax 不参与此 match 模型。');
    assumptions.push('工资按分摊分配，pre-tax、Roth、after-tax 及逐期 match 分别四舍五入到分。其他雇主供款按全年预留。');
    assumptions.push('未扣除所得税、保险和其他工资扣款；实际可用净工资可能限制 after-tax 扣款。');
    var feasible = ideal.combinedPercent <= s.payrollPercentCap + 1e-10;
    return { errors: [], warnings: warnings, assumptions: assumptions, feasible: feasible, limits: Object.assign({}, l),
      eligibleComp: dollars(eligible), effectiveTotalLimit: dollars(effective),
      ordinaryMaxBeforeMatch: dollars(ordinaryBeforeMatch), ordinaryMaximum: dollars(regularMaximum),
      fullMatchThresholdPercent: thresholdUnits / SCALE, maximumEmployerMatch: dollars(maxMatch),
      fullMatchRegularTarget: dollars(fullMatchEmployeeTarget),
      fullMatchRequiredAnnual: dollars(fullMatchEmployeeTarget), appliedFullMatchThresholdPercent: percent(fullMatchEmployeeTarget, salary),
      employerMatchReserve: ideal.employerMatchReserve, conditionalTrueUp: ideal.conditionalTrueUp,
      paycheckGross: s.annualSalary / s.payPeriods, ideal: ideal, safe: safe };
  }
  return Object.freeze({ DEFAULTS: DEFAULTS, DEFAULT_LIMITS: DEFAULT_LIMITS, calculate: calculate });
});
