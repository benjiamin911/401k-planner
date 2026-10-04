(function () {
  'use strict';
  const Calc = window.AnnualCalc;
  const IRS = window.IRSLimits;
  const byId = id => document.getElementById(id);
  const put = (id, value) => { byId(id).textContent = value; };
  const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  const WHOLE_USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const money = value => Number.isFinite(value) ? USD.format(value) : '—';
  const whole = value => Number.isFinite(value) ? WHOLE_USD.format(value) : '—';
  const pct = value => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
  const theoreticalPct = value => {
    if (!Number.isFinite(value)) return '—';
    const rounded = Number(value.toFixed(6));
    const approximate = Math.abs(rounded - value) > 1e-10;
    return (approximate ? '≈' : '') + rounded.toLocaleString('en-US', { maximumFractionDigits: 6 });
  };
  const STORAGE = '401k-year-planner.v2';
  const LIMITS_STORAGE = '401k-irs-limits.v1.';
  const currentYear = new Date().getFullYear();
  const form = byId('annual-form');
  const numericKeys = ['annualSalary', 'payPeriods', 'rothSharePercent', 'payrollStep', 'payrollPercentCap', 'otherEmployerAnnual'];
  const enumKeys = ['goal', 'matchTiming', 'trueUpEligible'];
  let year = currentYear;
  let state = defaultState();
  let metadata = { companyPreset: 'snap', capYear: 2026, noSeparateCap: false, salaryIsDemo: true };
  let limits = null;
  let latestResult = null;
  let networkState = 'loading';
  let networkError = '';
  let requestId = 0;
  let toastTimer;
  let yearTimer;

  function defaultState() {
    return { ...Calc.DEFAULTS, matchTiers: Calc.DEFAULTS.matchTiers.map(tier => ({ ...tier })) };
  }
  function toast(message) {
    put('toast', message); byId('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { byId('toast').hidden = true; }, 6500);
  }
  function numeric(id) {
    const raw = byId(id).value.trim();
    return raw === '' ? null : Number(raw);
  }
  function isYear(value) { return Number.isInteger(value) && value >= 2023 && value <= 2100; }
  function validLimits(value, forYear) {
    return value && value.year === forYear && value.sourceUrl === IRS.IRSSOURCE &&
      Number.isInteger(value.deferralLimit) && value.deferralLimit >= 10000 && value.deferralLimit <= 100000 &&
      Number.isInteger(value.totalLimit) && value.totalLimit > value.deferralLimit && value.totalLimit <= 500000 &&
      Number.isInteger(value.compensationLimit) && value.compensationLimit > value.totalLimit && value.compensationLimit <= 3000000 &&
      typeof value.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt)) &&
      ['irs-direct', 'irs-via-jina', 'verified-bundled'].includes(value.method) &&
      (!IRS.VERIFIED_LIMITS[forYear] || ['deferralLimit', 'totalLimit', 'compensationLimit'].every(key => value[key] === IRS.VERIFIED_LIMITS[forYear][key]));
  }
  function cachedLimits(forYear) {
    try {
      const cached = JSON.parse(localStorage.getItem(LIMITS_STORAGE + forYear));
      if (validLimits(cached, forYear)) return cached;
    } catch (_) { /* Cache is optional. */ }
    return IRS.VERIFIED_LIMITS[forYear] || null;
  }
  function renderSource() {
    put('limit-deferral', limits ? whole(limits.deferralLimit) : '—');
    put('limit-total', limits ? whole(limits.totalLimit) : '—');
    put('limit-compensation', limits ? whole(limits.compensationLimit) : '—');
    document.querySelectorAll('.inline-deferral').forEach(node => { node.textContent = limits ? whole(limits.deferralLimit) : '该年度尚未取得'; });
    put('result-year', isYear(year) ? year + ' 计划' : '选择年度');
    const date = limits ? limits.checkedAt.slice(0, 10) : '';
    const transport = limits && limits.method === 'irs-via-jina' ? 'IRS 官方页面，经 Jina 公共文本代理读取' : limits && limits.method === 'irs-direct' ? 'IRS 官方页面直接读取' : '内置 IRS 已核验记录';
    let status, description;
    if (networkState === 'loading') {
      status = '正在联网查询 ' + year + '…';
      description = limits ? '正在重新核对；暂显示 ' + year + ' 年同年记录。上次核对：' + date + '。' : '正在读取所选年度。尚未取得同年限额前，暂停计算，不使用其他年度额度。';
    } else if (networkState === 'live') {
      status = '已在线核对 · ' + date;
      description = transport + '。所选年度：' + year + '；读取时间：' + limits.checkedAt.replace('T', ' ').replace('Z', ' UTC') + '。';
    } else if (limits) {
      status = '在线更新失败 · 使用 ' + year + ' 已核验数据';
      description = '本次在线核对失败：' + networkError + ' 当前使用同年记录，上次核对：' + date + '；来源：' + transport + '。';
    } else {
      status = isYear(year) ? year + ' 额度暂不可用' : '请输入有效年份';
      description = networkError || '请填入 2023–2100 之间的年份。没有同年额度时不会继续计算。';
    }
    put('irs-status', status);
    put('irs-detail', description + ' 在线读取仅请求固定的 IRS 公共限额页面，不发送工资或公司政策；跨站读取受限时使用只读文本代理。');
    byId('refresh-limits').disabled = networkState === 'loading' || !isYear(year);
  }
  async function updateLimits() {
    const token = ++requestId;
    const selectedYear = year;
    if (!isYear(selectedYear)) { limits = null; networkState = 'failed'; networkError = '请输入 2023–2100 之间的整数年份。'; render(); return; }
    limits = cachedLimits(selectedYear);
    networkState = 'loading'; networkError = ''; render();
    try {
      const fresh = await IRS.refresh(selectedYear);
      if (token !== requestId || year !== selectedYear) return;
      if (!validLimits(fresh, selectedYear)) throw new Error('返回的数据未通过年度及金额校验。');
      limits = fresh; networkState = 'live';
      try { localStorage.setItem(LIMITS_STORAGE + selectedYear, JSON.stringify(fresh)); } catch (_) { /* Calculations work without storage. */ }
    } catch (error) {
      if (token !== requestId || year !== selectedYear) return;
      networkState = 'failed'; networkError = error.message || '网络读取失败。';
      // Never claim a refresh succeeded by substituting a prior year's limits.
      limits = cachedLimits(selectedYear);
    }
    render();
  }
  function fillTiers() {
    const container = byId('tier-list'); container.replaceChildren();
    state.matchTiers.forEach((tier, index) => {
      const row = document.createElement('div'); row.className = 'tier-row';
      const employeeWrap = document.createElement('div'); employeeWrap.className = 'input-wrap';
      const prefix = document.createElement('span'); prefix.textContent = index === 0 ? '前' : '接下来';
      const employee = document.createElement('input'); employee.type = 'number'; employee.min = '0'; employee.max = '100'; employee.step = '0.1'; employee.value = tier.employeePercent ?? ''; employee.dataset.tier = String(index); employee.dataset.kind = 'employeePercent'; employee.setAttribute('aria-label', '第 ' + (index + 1) + ' 档员工工资比例');
      const employeeUnit = document.createElement('span'); employeeUnit.textContent = '%';
      employeeWrap.append(prefix, employee, employeeUnit);
      const matchWrap = document.createElement('div'); matchWrap.className = 'input-wrap';
      const match = document.createElement('input'); match.type = 'number'; match.min = '0'; match.max = '1000'; match.step = '1'; match.value = tier.employerMatchPercent ?? ''; match.dataset.tier = String(index); match.dataset.kind = 'employerMatchPercent'; match.setAttribute('aria-label', '第 ' + (index + 1) + ' 档公司配比比例');
      const matchUnit = document.createElement('span'); matchUnit.textContent = '%'; matchWrap.append(match, matchUnit);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'tier-remove'; remove.textContent = '×'; remove.setAttribute('aria-label', '删除第 ' + (index + 1) + ' 档');
      remove.addEventListener('click', () => { state.matchTiers.splice(index, 1); metadata.companyPreset = 'custom'; fillTiers(); byId('companyPreset').value = 'custom'; render(); save(); });
      row.append(employeeWrap, matchWrap, remove); container.append(row);
    });
  }
  function fill() {
    for (const key of numericKeys.concat(enumKeys)) byId(key).value = state[key] ?? '';
    for (const key of ['afterTaxEnabled', 'inPlanConversion']) byId(key).checked = state[key];
    byId('afterTaxPlanCap').value = state.afterTaxPlanCap ?? '';
    byId('noSeparateCap').checked = metadata.noSeparateCap;
    byId('companyPreset').value = metadata.companyPreset;
    byId('taxYear').value = year;
    fillTiers();
  }
  function read() {
    for (const key of numericKeys) state[key] = numeric(key);
    for (const key of enumKeys) state[key] = byId(key).value;
    for (const key of ['afterTaxEnabled', 'inPlanConversion']) state[key] = byId(key).checked;
    metadata.noSeparateCap = byId('noSeparateCap').checked;
    state.afterTaxPlanCap = metadata.noSeparateCap ? null : numeric('afterTaxPlanCap');
    for (const node of byId('tier-list').querySelectorAll('input')) {
      const index = Number(node.dataset.tier);
      state.matchTiers[index][node.dataset.kind] = node.value.trim() === '' ? null : Number(node.value);
    }
  }
  function notices(id, messages) {
    const node = byId(id); node.hidden = messages.length === 0; node.replaceChildren();
    if (messages.length === 1) node.textContent = messages[0];
    else if (messages.length > 1) {
      const list = document.createElement('ul');
      messages.forEach(message => { const item = document.createElement('li'); item.textContent = message; list.append(item); });
      node.append(list);
    }
  }
  function capNeedsConfirmation() {
    return state.goal === 'max-all' && state.afterTaxEnabled && (metadata.capYear !== year || (!metadata.noSeparateCap && state.afterTaxPlanCap === null));
  }
  function modelState() {
    const model = { ...state, matchTiers: state.matchTiers.map(tier => ({ ...tier })) };
    if (!state.afterTaxEnabled || (state.goal !== 'max-all' && state.afterTaxPlanCap === null)) model.afterTaxPlanCap = 0;
    return model;
  }
  function render() {
    renderSource();
    byId('after-tax-settings').hidden = !state.afterTaxEnabled;
    byId('afterTaxPlanCap').disabled = metadata.noSeparateCap;
    document.querySelectorAll('[data-roth]').forEach(button => {
      const active = Number(button.dataset.roth) === state.rothSharePercent;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    document.querySelector('.field-tag').textContent = metadata.salaryIsDemo ? '当前为演示金额' : '你的输入';
    let capNote = metadata.companyPreset === 'snap' && year === 2026 ? '$33,100 来自你提供的 Snap 2026 政策。公司上限需每年另行确认。' : '这是公司计划的独立上限，需要按所选年度确认；IRS 数据不能替代公司政策。';
    if (metadata.capYear !== year) capNote = '所选年度已改变：请填写并确认 ' + year + ' 年公司的 After-tax 上限，不能沿用其他年度。';
    put('plan-cap-note', capNote);
    const model = modelState();
    const errors = [];
    if (!limits) errors.push(networkState === 'loading' ? '正在读取该年度 IRS 限额，取得后自动计算。' : '尚未取得 ' + year + ' 年已核验 IRS 限额。请更新额度或选择已有记录的年度。');
    if (capNeedsConfirmation()) errors.push('请先填写并确认 ' + year + ' 年公司 After-tax 上限；没有单独上限时，勾选已确认的选项。');
    let result = null;
    if (limits) { result = Calc.calculate(model, limits); errors.push(...result.errors); }
    latestResult = result;
    notices('error-box', errors);
    const ideal = errors.length === 0 && result ? result.ideal : null;
    const safe = ideal ? result.safe : null;
    put('regular-rate', ideal ? theoreticalPct(ideal.regularPercent) : '—');
    put('after-rate', ideal ? theoreticalPct(ideal.afterTaxPercent) : '—');
    put('combined-rate', ideal ? theoreticalPct(ideal.combinedPercent) : '—');
    for (const id of ['regular-rate', 'after-rate']) byId(id).classList.toggle('long-rate', byId(id).textContent.length > 6);
    notices('feasibility-notice', ideal && !result.feasible ? ['理想目标超过你填写的工资扣款上限，不能直接按主卡比例设置。请提高允许的比例或调整目标；下方展开项提供当前上限内的保守设置。'] : []);
    put('annual-title', ideal && !result.feasible ? '年度理想目标 · 超当前扣款能力' : '你的年度储蓄目标');
    put('regular-allocation', state.rothSharePercent === 100 ? '全部存入 Roth 401(k)' : state.rothSharePercent === 0 ? '全部存入 Pre-tax 401(k)' : 'Pre-tax + Roth 按比例分配');
    put('conversion-label', !state.afterTaxEnabled ? '公司未提供普通 After-tax' : state.goal !== 'max-all' ? '当前目标不安排额外供款' : state.inPlanConversion ? '支持转换为 Roth · 需另行开启' : '尚未确认计划内 Roth 转换');
    put('paycheck-label', '每年 ' + (state.payPeriods ?? '—') + ' 次');
    put('pre-pay', ideal ? money(ideal.preTaxTarget / state.payPeriods) : '—');
    put('roth-pay', ideal ? money(ideal.rothTarget / state.payPeriods) : '—');
    put('after-pay', ideal ? money(ideal.afterTaxTarget / state.payPeriods) : '—');
    put('pre-rate', ideal ? theoreticalPct(ideal.preTaxPercent) + '%' : '—');
    put('roth-rate', ideal ? theoreticalPct(ideal.rothPercent) + '%' : '—');
    put('after-pay-rate', ideal ? theoreticalPct(ideal.afterTaxPercent) + '%' : '—');
    const appliedThreshold = result && !result.errors.length ? (result.appliedFullMatchThresholdPercent ?? result.fullMatchThresholdPercent) : null;
    put('match-threshold', theoreticalPct(appliedThreshold));
    put('match-card-label', state.matchTiming === 'annual' ? '按年度公式拿满配比，普通供款需达到' : '逐次拿满配比，普通供款需达到');
    put('match-basis-label', state.matchTiming === 'annual' ? '全年基础工资' : '每次工资');
    put('match-max', result && !result.errors.length ? money(result.maximumEmployerMatch) : '—');
    put('policy-summary', result && !result.errors.length ? '配比档位覆盖前 ' + pct(result.fullMatchThresholdPercent) + '% 的符合条件工资，公司最高配 ' + pct(result.eligibleComp ? result.maximumEmployerMatch / result.eligibleComp * 100 : 0) + '%。' : '填写各档工资比例和公司配比，计算完整 match 门槛。');
    let matchNote = state.matchTiers.length ? '普通 After-tax 不计入此配比模型。' : '当前没有公司 match 档位。';
    if (ideal && !ideal.fullMatchAttainable) matchNote = state.matchTiming === 'annual' ? '受普通供款额度限制，当前目标不能达到完整年度配比门槛。' : '受普通供款额度限制，当前工资下无法每期都达到此门槛；年度补配需符合条件。';
    if (ideal && state.annualSalary > limits.compensationLimit) matchNote += ' 配比工资按 IRS 薪酬上限封顶后均摊全年；实际封顶方式需按计划核对。';
    put('match-explanation', matchNote);
    put('annual-total', ideal ? money(ideal.totalAnnual) : '—');
    put('annual-total-caption', state.trueUpEligible === 'yes' || state.matchTiming === 'annual' ? '按年度配比公式与已选择的资格假设估算' : '按全年均匀工资与逐次配比公式估算');
    put('annual-regular', ideal ? money(ideal.regularTarget) : '—');
    put('annual-after', ideal ? money(ideal.afterTaxTarget) : '—');
    put('annual-employer', ideal ? money(ideal.employerMatch + ideal.otherEmployer) : '—');
    put('annual-own', ideal ? money(ideal.totalEmployee) : '—');
    const amounts = ideal ? [ideal.regularTarget, ideal.afterTaxTarget, ideal.employerMatch + ideal.otherEmployer] : [0, 0, 0];
    const total = amounts.reduce((a, b) => a + b, 0);
    ['bar-regular', 'bar-after', 'bar-employer'].forEach((id, index) => { byId(id).style.width = (total ? amounts[index] / total * 100 : 0) + '%'; });
    put('employer-reserve-note', ideal ? '计算 After-tax 空间时，为公司全年供款预留 ' + money(ideal.totalEmployerReserve) + (ideal.conditionalTrueUp > 0 ? '，其中可能的年度补配为 ' + money(ideal.conditionalTrueUp) + '；是否到账取决于资格。' : '。公司金额是公式估算，实际以计划和到账记录为准。') : '');
    put('safe-pre', safe ? pct(safe.preTaxPercent) + '%' : '—');
    put('safe-roth', safe ? pct(safe.rothPercent) + '%' : '—');
    put('safe-after', safe ? pct(safe.afterTaxPercent) + '%' : '—');
    put('regular-gap', safe ? money(safe.regularGap) : '—');
    put('after-gap', safe ? money(safe.afterTaxGap) : '—');
    let safeNote = '按 ' + pct(state.payrollStep) + '% 步长分别设置各供款来源。';
    if (safe && safe.centRoundingAdjusted) safeNote += ' 即使理论比例刚好，逐次四舍五入也可能略超年度额度，因此保守方案再下调一步，并显示年度差额。';
    if (safe && !safe.fullMatchAttainable && state.matchTiers.length) safeNote += ' 取整后的普通比例低于完整配比门槛，可能无法逐次拿满 match。';
    put('safe-note', safeNote);
    put('formula-total', ideal ? money(result.effectiveTotalLimit) : '—');
    put('formula-regular', ideal ? money(ideal.regularTarget) : '—');
    put('formula-employer', ideal ? money(ideal.totalEmployerReserve) : '—');
    put('formula-room', ideal ? money(ideal.irsAfterTaxRoom) : '—');
    put('formula-after', ideal ? money(ideal.afterTaxTarget) : '—');
    const warnings = ideal ? result.warnings.filter(message => !/每期供款和 match 四舍五入|固定比例均向下|支持 in-plan conversion 仅|true-up 资格未知|理想总扣款比例超过/.test(message)) : [];
    if (ideal && state.annualSalary === 0) warnings.push('请输入预计全年基础工资，才能规划有金额的供款。');
    notices('warning-box', warnings);
  }
  function save() {
    // Keep the last valid editable plan if an input is temporarily blank or invalid.
    const checking = Calc.calculate(modelState(), limits || IRS.VERIFIED_LIMITS[2026]);
    if (checking.errors.length || !isYear(year)) return;
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ version: 2, savedCalendarYear: currentYear, year, state, metadata }));
      put('storage-status', '输入已保存在当前浏览器');
    } catch (_) { put('storage-status', '浏览器不允许本地保存；当前仍可计算'); }
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE));
      if (!saved || saved.version !== 2) return;
      if (!isYear(saved.year) || !saved.state || !saved.metadata) throw new Error('invalid saved plan');
      const checking = Calc.calculate({ ...saved.state, afterTaxPlanCap: saved.state.afterTaxPlanCap ?? 0 }, cachedLimits(saved.year) || IRS.VERIFIED_LIMITS[2026]);
      if (checking.errors.length || !['snap', 'custom', 'none'].includes(saved.metadata.companyPreset)) throw new Error('invalid saved plan');
      state = { ...defaultState(), ...saved.state, matchTiers: saved.state.matchTiers.map(tier => ({ ...tier })) };
      metadata = { ...metadata, ...saved.metadata };
      year = saved.savedCalendarYear === currentYear ? saved.year : currentYear;
    } catch (_) { toast('保存的方案不可用，已载入可编辑的演示数据。'); }
    if (metadata.capYear !== year) { state.afterTaxPlanCap = null; metadata.noSeparateCap = false; }
  }
  function edited(event) {
    if (event.target.dataset.tier !== undefined) { metadata.companyPreset = 'custom'; byId('companyPreset').value = 'custom'; }
    if (event.target.id === 'annualSalary') metadata.salaryIsDemo = false;
    if (event.target.id === 'afterTaxPlanCap' || event.target.id === 'noSeparateCap') metadata.capYear = year;
    read(); render(); save();
  }
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', event => { if (!['companyPreset', 'policy-text'].includes(event.target.id)) edited(event); });
  form.addEventListener('change', event => { if (!['companyPreset', 'policy-text'].includes(event.target.id)) edited(event); });
  document.querySelectorAll('[data-roth]').forEach(button => button.addEventListener('click', () => { byId('rothSharePercent').value = button.dataset.roth; read(); render(); save(); }));
  byId('add-tier').addEventListener('click', () => {
    if (state.matchTiers.length >= 8) { toast('本界面最多支持 8 档配比。'); return; }
    state.matchTiers.push({ employeePercent: 1, employerMatchPercent: 50 }); metadata.companyPreset = 'custom'; byId('companyPreset').value = 'custom'; fillTiers(); render(); save();
  });
  byId('companyPreset').addEventListener('change', () => {
    metadata.companyPreset = byId('companyPreset').value;
    if (metadata.companyPreset === 'snap') {
      state.matchTiers = Calc.DEFAULTS.matchTiers.map(tier => ({ ...tier }));
      state.matchTiming = 'paycheck'; state.trueUpEligible = 'unknown'; state.afterTaxEnabled = true; state.inPlanConversion = true;
      state.afterTaxPlanCap = year === 2026 ? 33100 : null; metadata.capYear = 2026; metadata.noSeparateCap = false;
    } else {
      if (metadata.companyPreset === 'none') state.matchTiers = [];
      metadata.capYear = null; metadata.noSeparateCap = false; state.afterTaxPlanCap = null; state.afterTaxEnabled = false; state.inPlanConversion = false;
      toast('公司额外供款选项已清空，请按实际政策填写。');
    }
    fill(); render(); save();
  });
  byId('parse-policy').addEventListener('click', () => {
    const parser = window.PolicyParser;
    if (!parser) { put('policy-parse-status', '文字识别暂不可用，请直接编辑上方档位。'); return; }
    const parsed = parser.parse(byId('policy-text').value);
    if (parsed.errors.length) { put('policy-parse-status', parsed.errors.join(' ')); return; }
    state.matchTiers = parsed.tiers; metadata.companyPreset = 'custom'; byId('companyPreset').value = 'custom';
    fillTiers(); render(); save();
    put('policy-parse-status', '已识别 ' + parsed.tiers.length + ' 档，请核对上方字段。' + parsed.warnings.join(' '));
  });
  function changeYear() {
    const next = numeric('taxYear');
    if (next === year) return;
    year = next;
    if (isYear(year) && metadata.capYear !== year) { state.afterTaxPlanCap = null; metadata.noSeparateCap = false; byId('afterTaxPlanCap').value = ''; byId('noSeparateCap').checked = false; }
    limits = isYear(year) ? cachedLimits(year) : null;
    updateLimits(); save();
  }
  byId('taxYear').addEventListener('input', () => { clearTimeout(yearTimer); yearTimer = setTimeout(changeYear, 350); });
  byId('taxYear').addEventListener('change', () => { clearTimeout(yearTimer); changeYear(); });
  byId('refresh-limits').addEventListener('click', () => { year = numeric('taxYear'); updateLimits(); });
  byId('reset-plan').addEventListener('click', () => {
    state = defaultState(); year = currentYear;
    metadata = { companyPreset: 'snap', capYear: 2026, noSeparateCap: false, salaryIsDemo: true };
    if (year !== 2026) state.afterTaxPlanCap = null;
    fill(); save(); updateLimits(); toast('已恢复年薪 $200,000 的演示方案。');
  });
  restore();
  if (metadata.capYear !== year) { state.afterTaxPlanCap = null; metadata.noSeparateCap = false; }
  fill(); updateLimits();
})();
