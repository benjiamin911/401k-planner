/* Read-only IRS annual-limit retrieval. No personal inputs, storage, or DOM access.
 * Public source: IRS COLA table. Jina is a text transport, not the rule publisher.
 * Network failures never silently become successful refreshes from bundled data.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IRSLimits = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var IRSSOURCE = 'https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions';
  var PROXY_SOURCE = 'https://r.jina.ai/' + IRSSOURCE;
  var MAX_BYTES = 1024 * 1024;
  var VERIFIED_LIMITS = Object.freeze({
    2025: Object.freeze({ year: 2025, deferralLimit: 23500, totalLimit: 70000, compensationLimit: 350000,
      sourceUrl: IRSSOURCE, checkedAt: '2026-10-03', method: 'verified-bundled' }),
    2026: Object.freeze({ year: 2026, deferralLimit: 24500, totalLimit: 72000, compensationLimit: 360000,
      sourceUrl: IRSSOURCE, checkedAt: '2026-10-03', method: 'verified-bundled' })
  });

  function failure(message, code) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function validYear(year) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw failure('请选择 2000 至 2100 之间的整数年份。', 'INVALID_YEAR');
    }
  }

  function byteLength(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
    // Conservative UTF-8 bound for the uncommon environment without TextEncoder.
    return text.length * 3;
  }

  function decodeEntities(value) {
    return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, function (whole, decimal, hex, named) {
      if (decimal || hex) {
        var point = parseInt(decimal || hex, decimal ? 10 : 16);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
      }
      var entities = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '-', mdash: '-' };
      return Object.prototype.hasOwnProperty.call(entities, named.toLowerCase()) ? entities[named.toLowerCase()] : whole;
    });
  }

  function cleanCell(value) {
    return decodeEntities(value.replace(/<[^>]*>/g, ' '))
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, '')
      .replace(/[\u00a0\u202f]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function is401kHeader(value) {
    return /^401\(k\),403\(b\),profit-sharingplans(?:,etc\.?)?$/i.test(value.replace(/\s+/g, ''));
  }

  function htmlTables(text) {
    var tables = [];
    var tablePattern = /<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi;
    var table;
    while ((table = tablePattern.exec(text))) {
      var rows = [], rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi, row;
      var ambiguous = /\b(?:colspan|rowspan)\s*=\s*["']?(?:[2-9]|[1-9]\d)/i.test(table[1]);
      while ((row = rowPattern.exec(table[1]))) {
        var cells = [], cellPattern = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/gi, cell;
        while ((cell = cellPattern.exec(row[1]))) cells.push(cleanCell(cell[1]));
        if (cells.length) rows.push(cells);
      }
      if (rows.length) tables.push({ rows: rows, ambiguous: ambiguous });
    }
    return tables;
  }

  function markdownTables(text) {
    var tables = [], rows = [];
    function finish() {
      if (rows.length) tables.push({ rows: rows, ambiguous: false });
      rows = [];
    }
    text.split(/\r?\n/).forEach(function (line) {
      if (line.indexOf('|') < 0) { finish(); return; }
      var cells = line.trim().split('|');
      if (cells[0].trim() === '') cells.shift();
      if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
      cells = cells.map(cleanCell);
      if (cells.every(function (cell) { return /^:?-{3,}:?$/.test(cell); })) return;
      rows.push(cells);
    });
    finish();
    return tables;
  }

  function parseMoney(cell, label) {
    // An entire cell must be one integer amount. Never pick a number from prose,
    // a list, a different year's column, an IRA threshold, or a catch-up footnote.
    if (!/^\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.00)?$/.test(cell)) {
      throw failure('IRS 表中的 ' + label + ' 不是可确认的完整金额。', 'INVALID_VALUES');
    }
    return Number(cell.replace(/[$,\s]/g, ''));
  }

  function parseLimits(text, year) {
    validYear(year);
    if (typeof text !== 'string' || !text.trim()) throw failure('IRS 页面内容为空。', 'INVALID_CONTENT');
    if (text.length > MAX_BYTES || byteLength(text) > MAX_BYTES) throw failure('IRS 页面超过 1 MiB 读取上限。', 'TOO_LARGE');
    // Content is inert text throughout. Do not insert fetched markup into the DOM.
    var inert = text.replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    var tables = /<table\b/i.test(inert) ? htmlTables(inert) : markdownTables(inert);
    var candidates = tables.filter(function (table) {
      return table.rows.length && is401kHeader(table.rows[0][0]);
    });
    if (candidates.length !== 1 || candidates[0].ambiguous) {
      throw failure('无法唯一识别 IRS 的 401(k) 年度限额表；未采用其他退休账户的数字。', 'TABLE_FORMAT');
    }
    var rows = candidates[0].rows, header = rows[0];
    var years = header.slice(1);
    if (!years.length || years.some(function (value) { return !/^20\d{2}$/.test(value); }) || new Set(years).size !== years.length) {
      throw failure('IRS 401(k) 表的年份列不明确，无法安全读取。', 'TABLE_FORMAT');
    }
    var column = header.indexOf(String(year));
    if (column < 1) {
      throw failure('IRS 当前 401(k) 表尚未列出 ' + year + ' 年；该年可能尚未公布或已移入历史档案。不会沿用其他年份。', 'YEAR_NOT_FOUND');
    }
    var labels = {
      'elective deferrals': 'deferralLimit',
      'defined contribution plan limit': 'totalLimit',
      'annual compensation': 'compensationLimit'
    };
    var result = { year: year };
    rows.slice(1).forEach(function (row) {
      var label = row[0].toLowerCase(), key = labels[label];
      if (!key) return;
      if (Object.prototype.hasOwnProperty.call(result, key) || row.length !== header.length) {
        throw failure('IRS 401(k) 表存在重复或不完整的 ' + label + ' 行。', 'TABLE_FORMAT');
      }
      result[key] = parseMoney(row[column], label);
    });
    if (!['deferralLimit', 'totalLimit', 'compensationLimit'].every(function (key) { return Object.prototype.hasOwnProperty.call(result, key); })) {
      throw failure('IRS 401(k) 表缺少该年所需的完整三项限额，未采用部分数据。', 'MISSING_FIELDS');
    }
    if (!Number.isSafeInteger(result.deferralLimit) || result.deferralLimit < 10000 || result.deferralLimit > 150000 ||
        !Number.isSafeInteger(result.totalLimit) || result.totalLimit < 20000 || result.totalLimit > 500000 ||
        !Number.isSafeInteger(result.compensationLimit) || result.compensationLimit < 100000 || result.compensationLimit > 3000000 ||
        !(result.deferralLimit < result.totalLimit && result.totalLimit < result.compensationLimit)) {
      throw failure('读取的 IRS 限额未通过金额范围及相互关系校验。', 'INVALID_VALUES');
    }
    var verified = VERIFIED_LIMITS[year];
    if (verified && ['deferralLimit', 'totalLimit', 'compensationLimit'].some(function (key) { return result[key] !== verified[key]; })) {
      throw failure('读取的 ' + year + ' 年金额与已人工核对的 IRS 记录不同，需重新核对官方公告。', 'VERIFIED_CONFLICT');
    }
    return result;
  }

  async function readBounded(response) {
    var declared = response.headers && response.headers.get ? Number(response.headers.get('content-length')) : 0;
    if (declared > MAX_BYTES) throw failure('IRS 响应超过 1 MiB 读取上限。', 'TOO_LARGE');
    var type = response.headers && response.headers.get ? response.headers.get('content-type') || '' : '';
    if (type && !/^(?:text\/(?:plain|html)|application\/xhtml\+xml)(?:;|$)/i.test(type)) {
      throw failure('IRS 响应不是预期的网页或文本。', 'INVALID_CONTENT');
    }
    if (response.body && typeof response.body.getReader === 'function' && typeof TextDecoder !== 'undefined') {
      var reader = response.body.getReader(), decoder = new TextDecoder(), total = 0, parts = [];
      try {
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          total += chunk.value.byteLength;
          if (total > MAX_BYTES) {
            try { var cancellation = reader.cancel(); if (cancellation && cancellation.catch) cancellation.catch(function () {}); } catch (_) { /* best effort */ }
            throw failure('IRS 响应超过 1 MiB 读取上限。', 'TOO_LARGE');
          }
          parts.push(decoder.decode(chunk.value, { stream: true }));
        }
        parts.push(decoder.decode());
        return parts.join('');
      } finally { if (reader.releaseLock) reader.releaseLock(); }
    }
    var text = await response.text();
    if (text.length > MAX_BYTES || byteLength(text) > MAX_BYTES) throw failure('IRS 响应超过 1 MiB 读取上限。', 'TOO_LARGE');
    return text;
  }

  async function requestText(url, fetchImpl, timeoutMs) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        if (controller) controller.abort();
        reject(failure('读取 IRS 限额超时。', 'TIMEOUT'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async function () {
        var response = await fetchImpl(url, {
          method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
          cache: 'no-store', redirect: 'follow', signal: controller ? controller.signal : undefined
        });
        if (!response || !response.ok) throw failure('读取 IRS 限额失败（HTTP ' + (response ? response.status : '未知') + '）。', 'HTTP_ERROR');
        return await readBounded(response);
      })()]);
    } finally {
      clearTimeout(timer);
      if (controller) controller.abort();
    }
  }

  async function refresh(year, options) {
    validYear(year);
    options = options || {};
    var fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(typeof globalThis !== 'undefined' ? globalThis : null) : null);
    if (typeof fetchImpl !== 'function') throw failure('当前浏览器不支持在线读取，请使用已核对的同年数据。', 'NETWORK_UNAVAILABLE');
    var timeoutMs = options.timeoutMs === undefined ? 10000 : options.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw failure('读取超时须在 1 至 30,000 毫秒之间。', 'INVALID_TIMEOUT');
    var deadline = Date.now() + timeoutMs;
    var routes = [{ url: IRSSOURCE, method: 'irs-direct' }, { url: PROXY_SOURCE, method: 'irs-via-jina' }];
    var attempts = [];
    for (var index = 0; index < routes.length; index += 1) {
      var remaining = deadline - Date.now();
      if (remaining <= 0) break;
      var budget = index === 0 ? Math.max(1, Math.min(3000, Math.floor(timeoutMs * 0.35))) : remaining;
      try {
        var text = await requestText(routes[index].url, fetchImpl, budget);
        var limits = parseLimits(text, year);
        return Object.assign(limits, { sourceUrl: IRSSOURCE, checkedAt: new Date().toISOString(), method: routes[index].method });
      } catch (error) { attempts.push({ method: routes[index].method, code: error.code || 'NETWORK_ERROR', message: error.message || '网络读取失败。' }); }
    }
    var substantive = attempts.find(function (attempt) {
      return ['YEAR_NOT_FOUND', 'MISSING_FIELDS', 'TABLE_FORMAT', 'INVALID_VALUES', 'VERIFIED_CONFLICT', 'TOO_LARGE'].indexOf(attempt.code) >= 0;
    });
    var error = failure(substantive ? substantive.message : '暂时无法在线读取 ' + year + ' 年 IRS 限额。请检查网络，或使用明确标注核对日期的同年数据。', substantive ? substantive.code : 'REFRESH_FAILED');
    error.attempts = attempts;
    throw error;
  }

  return Object.freeze({ IRSSOURCE: IRSSOURCE, VERIFIED_LIMITS: VERIFIED_LIMITS, parseLimits: parseLimits, refresh: refresh });
});
