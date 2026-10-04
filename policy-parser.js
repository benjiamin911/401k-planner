/* Conservative, local-only recognition of a few explicit matching-policy forms.
 * No language-model/API calls, evaluation of pasted content, or DOM access.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PolicyParser = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var WARNING = '只识别配比档位；true-up、薪酬定义、计划上限需单独确认。';
  var NUMBER = '(\\d+(?:\\.\\d+)?)';
  var RATE = NUMBER + '\\s*%\\s*(?:match(?:es|ing)?\\s*)?(?:on\\s+the\\s+dollar\\s+|per\\s+dollar\\s+)?(?:on\\s+|for\\s+)?(?:the\\s+)?';
  var FIRST = RATE + 'first\\s+' + NUMBER + '\\s*%';
  var NEXT = RATE + 'next\\s+' + NUMBER + '\\s*%';
  var PAY_SUFFIX = '(?:\\s+(?:you\\s+contribute|of\\s+(?:your\\s+)?(?:salary|pay|compensation)))?';
  var JOIN = '\\s*[,;:.–—-]*\\s*(?:(?:and|then|plus)\\s+)?';

  function normalized(text) {
    return text.normalize('NFKC').toLowerCase()
      .replace(/[\u2212]/g, '-')
      .replace(/dollar[ -]for[ -]dollar/g, '100%')
      .replace(/\$\s*0\.50(?!\d)/g, '50%')
      .replace(/\b50\s*(?:¢|cents\b|c\b)/g, '50%')
      .replace(/\s+/g, ' ').trim();
  }

  function find(text, pattern, map) {
    var regex = new RegExp(pattern, 'g'), matches = [], match;
    while ((match = regex.exec(text))) {
      // Never turn -50% or the tail of another numeric token into a valid rate.
      if (match.index > 0 && /[\d.+-]/.test(text[match.index - 1])) continue;
      matches.push({ start: match.index, end: regex.lastIndex, tiers: map(match) });
    }
    return matches;
  }

  function tier(employee, employer) {
    return { employeePercent: Number(employee), employerMatchPercent: Number(employer) };
  }

  function parse(text) {
    var result = { tiers: [], warnings: [WARNING], errors: [] };
    function reject(message) { result.errors.push(message); return result; }
    if (typeof text !== 'string' || !text.trim()) return reject('请粘贴包含具体员工供款档位与公司配比率的政策。');
    if (text.length > 20000) return reject('政策文本过长；请仅粘贴配比公式段落，或手动填写档位。');
    var source = normalized(text);
    var candidates = find(source, FIRST + PAY_SUFFIX + JOIN + NEXT + PAY_SUFFIX, function (m) {
      return [tier(m[2], m[1]), tier(m[4], m[3])];
    }).concat(find(source, '前\\s*' + NUMBER + '\\s*%\\s*(?:配比|匹配)\\s*' + NUMBER + '\\s*%\\s*[,;、]?\\s*(?:接下来(?:的)?|接着|随后)\\s*' + NUMBER + '\\s*%\\s*(?:配比|匹配)\\s*' + NUMBER + '\\s*%', function (m) {
      return [tier(m[1], m[2]), tier(m[3], m[4])];
    }));
    if (!candidates.length) {
      candidates = find(source, FIRST + PAY_SUFFIX, function (m) { return [tier(m[2], m[1])]; })
        .concat(find(source, NUMBER + '\\s*%\\s+match(?:es|ing)?\\s+(?:on\\s+(?:employee|your)\\s+contributions\\s+)?up\\s+to\\s+' + NUMBER + '\\s*%\\s+of\\s+(?:your\\s+)?(?:salary|pay|compensation)\\b', function (m) { return [tier(m[2], m[1])]; }))
        .concat(find(source, '(?:公司)?\\s*匹配员工供款的\\s*' + NUMBER + '\\s*%\\s*[,;、]?\\s*最高至工资的\\s*' + NUMBER + '\\s*%', function (m) { return [tier(m[2], m[1])]; }))
        .concat(find(source, '前\\s*' + NUMBER + '\\s*%\\s*(?:配比|匹配)\\s*' + NUMBER + '\\s*%', function (m) { return [tier(m[1], m[2])]; }));
    }
    if (candidates.length !== 1) return reject('无法唯一识别完整配比公式。请手动填写；仅有“最多配比多少”不足以推导档位。');
    var candidate = candidates[0];
    var prefix = source.slice(0, candidate.start).split(/[.;!?。]/).pop();
    if (/\b(?:no|not|never|without)\b|不提供|不会|不匹配/.test(prefix)) {
      return reject('公式前存在否定或例外条件，无法确认该配比适用；请手动填写。');
    }
    var totalEmployee = candidate.tiers.reduce(function (sum, value) { return sum + value.employeePercent; }, 0);
    var totalMatch = candidate.tiers.reduce(function (sum, value) { return sum + value.employeePercent * value.employerMatchPercent / 100; }, 0);
    if (totalEmployee > 100 || candidate.tiers.some(function (value) {
      return !Number.isFinite(value.employeePercent) || !Number.isFinite(value.employerMatchPercent) ||
        value.employeePercent <= 0 || value.employeePercent > 100 || value.employerMatchPercent <= 0 || value.employerMatchPercent > 1000;
    })) return reject('识别出的比例超出支持范围，请检查政策并手动填写。');

    // Optional Snap-style summary is a consistency check, never a source of tiers.
    var remainder = source.slice(0, candidate.start) + ' ' + source.slice(candidate.end);
    var badSummary = false;
    remainder = remainder.replace(new RegExp('up\\s+to\\s+' + NUMBER + '\\s*%\\s+match\\s+when\\s+(?:you\\s+)?contribute\\s+' + NUMBER + '\\s*%', 'g'), function (_, maximum, contribution) {
      if (Math.abs(Number(maximum) - totalMatch) > 0.000001 || Math.abs(Number(contribution) - totalEmployee) > 0.000001) badSummary = true;
      return ' ';
    });
    if (badSummary) return reject('政策摘要与识别出的档位不一致，请核对后手动填写。');
    var monetaryMatchCondition = remainder.split(/[.;!?。]/).some(function (clause) {
      return /\$\s*\d/.test(clause) && /\bmatch(?:es|ing)?\b|配比|匹配/.test(clause) && !/after[- ]tax|税后/.test(clause);
    });
    if (monetaryMatchCondition) return reject('还存在金额形式的配比或薪酬条件，请核对完整条件并手动填写档位。');
    if (/%|\b(?:next|additional|thereafter)\b/.test(remainder) || /接下来|接着|随后|其余|额外.*配比/.test(remainder)) {
      return reject('文本还包含未识别的比例或后续档位。为避免漏掉条件，请仅粘贴完整配比公式，或手动填写。');
    }
    result.tiers = candidate.tiers;
    return result;
  }

  return Object.freeze({ parse: parse });
});
