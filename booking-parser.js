'use strict';

// 与界面分开：只从用户给出的原文提取候选值，不读取网络，也不推测缺失编号。
(function (root) {
  const labels = { so: 'SO / 订舱号', receipt: '接货地', pol: '装港 / 起运港', pod: '卸港 / 目的港', vessel: '船名 / 航次', cutoff: '截单 / 补料时间', cutport: 'FCL 截关 / 港时间', releaseCutoff: '截止放行条时间', etd: 'ETD', eta: '卸港 ETA' };
  const timeKeys = ['cutoff', 'cutport', 'releaseCutoff', 'etd', 'eta'];
  const monthNames = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
  const patterns = [
    ['so', '(?:订舱(?:号|编号)|\\bBOOKING\\s*(?:NO\\.?|NUMBER|#)|(?<![A-Z0-9])S\\s*[/／]?\\s*O\\s*(?:号|NO\\.?)?(?![A-Z0-9]))'],
    ['receipt', '(?:接货地|授货地|授员地|接员地|PLACE\\s+OF\\s+RECEIPT)'],
    ['pol', '(?:装(?:货)?港(?:[（(]挂靠码头[）)])?|起运港|\\bPORT\\s+OF\\s+LOADING\\b|\\bPOL\\b)'],
    ['pod', '(?:卸(?:货)?港|御港|逢港|目的港|\\bPORT\\s+OF\\s+DISCHARGE\\b|\\bPOD\\b)'],
    ['delivery', '(?:交货地|PLACE\\s+OF\\s+DELIVERY)'],
    ['vessel', '(?:船名(?:\\s*[/／|、-]?\\s*航次)?|\\bVESSEL\\s*[/／]\\s*(?:VOYAGE|VOY\\.?)|\\bVESSEL(?:\\s+NAME)?\\b)'],
    ['voyage', '(?:航次|\\bVOYAGE\\b(?:\\s+NO\\b\\.?)?|\\bVOY\\b\\.?)'],
    ['releaseCutoff', '(?:截止放行条时间|放行条截止时间|RELEASE\\s*(?:NOTE\\s*)?CUT[- ]?OFF)'],
    ['cutoff', '(?:截止单证[（(]补料[）)]时间|截(?:止)?单(?:证)?(?:[（(]补料[）)])?(?:时间)?|SI\\s*CUT[- ]?OFF|DOC(?:UMENTATION)?\\s*CUT[- ]?OFF)'],
    ['cutport', '(?:(?:INTENDED\\s+)?FCL\\s*(?:CY\\s*)?CUT[- ]?OFF|CY\\s*CUT[- ]?OFF|截关\\s*[/／]\\s*港(?:时间)?|截港时间)'],
    ['etd', '\\bETD\\b'], ['arrival', '\\bETA\\b']
  ];
  const labelRE = new RegExp(patterns.map(([, p]) => '(' + p + ')').join('|'), 'ig');
  const normalize = s => String(s || '').normalize('NFKC').replace(/[\u200b\ufeff\u00ad]/g, '').replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '').replace(/[\t ]+/g, ' ').trim();
  function prepareText(text) {
    let value = String(text || '').normalize('NFKC').replace(/[\u200b\ufeff\u00ad]/g, '');
    // 有些 PDF 把同一个中文标签拆成独立文字块甚至多行，只拼回已知标签，不拼接业务值。
    for (const word of ['截止放行条时间', '放行条截止时间', '截止单证', '截止时间', '订舱编号', '订舱号', '挂靠码头', '接货地', '授货地', '授员地', '接员地', '装货港', '卸货港', '起运港', '目的港', '交货地', '船名', '航次', '装港', '卸港', '御港', '逢港', '补料']) {
      value = value.replace(new RegExp([...word].join('\\s*'), 'g'), word);
    }
    value = value.replace(/船名\s*([/／|、-]?)\s*航次/g, (_, separator) => '船名' + (separator || '/') + '航次')
      .replace(/装港\s*\(\s*挂靠码头\s*\)/g, '装港(挂靠码头)');
    for (const phrase of ['PORT OF LOADING', 'PORT OF DISCHARGE', 'PLACE OF RECEIPT', 'PLACE OF DELIVERY', 'VESSEL NAME', 'VOYAGE NO']) value = value.replace(new RegExp('\\b' + phrase.split(' ').join('\\s+') + '\\b', 'gi'), phrase);
    return value.replace(/\bVESSEL\s*[/／]\s*VOYAGE\b/gi, 'VESSEL / VOYAGE');
  }
  function labelMatches(line) {
    return [...line.matchAll(new RegExp(labelRE.source, 'ig'))].map(m => ({ index: m.index, end: m.index + m[0].length, key: patterns[m.slice(1).findIndex(v => v !== undefined)][0] }));
  }
  function unrelatedField(value) {
    return /^[^\d:：]{1,45}[:：]/.test(value) || /^(?:ROUTE|CARGO|EXTERNAL REFERENCE) INFORMATION\b/i.test(value);
  }
  function followingValue(lines, index) {
    for (let n = index + 1; n <= Math.min(lines.length - 1, index + 3); n++) {
      const next = lines[n];
      if (/^[:：\s]*$/.test(next) || /^\(?挂靠码头\)?\s*[:：]?$/.test(next)) continue;
      const firstLabel = labelMatches(next)[0];
      const prefix = (firstLabel ? next.slice(0, firstLabel.index) : next).trim();
      return prefix && !unrelatedField(prefix) ? prefix : '';
    }
    return '';
  }
  const keyOf = s => normalize(s).toUpperCase().replace(/[^A-Z0-9\u3400-\u9fff]/g, '');
  function validLocal(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value || '');
    if (!m) return false;
    const [y, mo, d, h, mi] = m.slice(1).map(v => Number(v || 0));
    const dt = new Date(Date.UTC(y, mo - 1, d, h, mi));
    return y >= 1900 && y <= 2200 && dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && h < 24 && mi < 60;
  }
  function parseDate(raw) {
    const s = normalize(raw).replace(/[：]/g, ':');
    let match = /(\d{4})[-年/.](\d{1,2})[-月/.](\d{1,2})日?(?:[ T]+(\d{1,2}):(\d{2}))?/.exec(s);
    let parts;
    if (match) parts = match.slice(1);
    else {
      match = /(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})(?:[ T]+(\d{1,2}):(\d{2}))?/i.exec(s);
      if (match) {
        const mo = monthNames.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
        if (!mo) return null;
        parts = [match[3], mo, match[1], match[4], match[5]];
      }
    }
    if (!parts) return null;
    const value = String(parts[0]) + '-' + String(parts[1]).padStart(2, '0') + '-' + String(parts[2]).padStart(2, '0') + (parts[3] == null ? '' : 'T' + String(parts[3]).padStart(2, '0') + ':' + String(parts[4]).padStart(2, '0'));
    if (!validLocal(value)) return null;
    const zone = /\b(?:UTC|GMT)(?:\s*[+-]\d{1,2}(?::?\d{2})?)?\b|\b(?:CST|PST|PDT|EST|EDT|SGT|HKT|CET|CEST)\b|上海时间|北京时间/ig;
    const rawZone = s.match(zone)?.at(-1)?.replace(/\s/g, '').toUpperCase() || '';
    // CST 和 PST 都可能被船司模板误用，不按缩写默默换算。
    const confirmedZone = /^(?:上海时间|北京时间)$/.test(rawZone) ? 'Asia/Shanghai'
      : ['SGT', 'HKT'].includes(rawZone) ? 'UTC+08:00'
        : ['UTC', 'GMT'].includes(rawZone) ? 'UTC'
          : /^(?:UTC|GMT)[+-]/.test(rawZone) ? rawZone.replace('GMT', 'UTC') : 'unconfirmed';
    return { value, raw: s, rawZone, zone: confirmedZone };
  }
  function epoch(value, zone = 'Asia/Shanghai') {
    if (!validLocal(value) || !zone || zone === 'unconfirmed') return NaN;
    const s = value.length === 10 ? value + 'T00:00' : value;
    const parts = s.match(/\d+/g).map(Number);
    const local = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
    if (zone === 'UTC') return local;
    const fixed = /^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(zone);
    if (fixed) {
      const offset = Number(fixed[2]) * 60 + Number(fixed[3] || 0);
      return offset <= 14 * 60 ? local - (fixed[1] === '+' ? 1 : -1) * offset * 60000 : NaN;
    }
    try {
      const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      let guess = local;
      for (let i = 0; i < 3; i++) {
        const formatted = formatter.format(new Date(guess)).replace(' ', 'T');
        const p = formatted.match(/\d+/g).map(Number);
        guess += local - Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4]);
      }
      if (formatter.format(new Date(guess)).replace(' ', 'T') !== s) return NaN;
      // 夏令时回拨的一小时会出现两次；要求用户明确固定偏移，避免偷偷任选一次。
      if ([-3600000, 3600000].some(delta => formatter.format(new Date(guess + delta)).replace(' ', 'T') === s)) return NaN;
      return guess;
    } catch { return NaN; }
  }
  function parse(sources) {
    const candidates = {}, notices = [], extraArrivals = [];
    let localCandidates = {};
    const add = (key, raw, source) => {
      let value = normalize(raw).replace(/^\s*[:：#-]+\s*/, '').trim();
      if (!value || value.length > 500) return;
      if (source.allowedFields && !source.allowedFields.includes(key)) return;
      if (['pol', 'pod', 'vessel', 'receipt'].includes(key) && (unrelatedField(value) || !/[A-Za-z\u3400-\u9fff]/.test(value) || /^\(?挂靠码头\)?$/.test(value))) return;
      let candidate = { value, raw: value, source: source.name, page: source.page || 1, method: source.method || '', originalLabel: source.fieldLabel || '' };
      if (timeKeys.includes(key)) {
        const dt = parseDate(value);
        if (!dt) { notices.push(`${labels[key]}的日期无法可靠识别：${value}`); return; }
        candidate = { ...candidate, ...dt };
      } else if (key === 'so') {
        const code = value.match(/^[A-Z0-9][A-Z0-9\-/.]{4,49}/i)?.[0];
        if (!code || !/\d/.test(code)) return;
        candidate.value = code.toUpperCase();
      } else if (key === 'vessel' && source.combinedVessel && !value.includes('/')) {
        const split = /^(.+?)\s+(\d{2,5}[A-Z]{1,2})$/i.exec(value);
        if (split) candidate.value = split[1] + ' / ' + split[2];
      }
      const entries = localCandidates[key] ||= [];
      if (!entries.some(c => keyOf(c.value) === keyOf(candidate.value) && (!timeKeys.includes(key) || c.rawZone === candidate.rawZone))) entries.push(candidate);
    };
    for (const source of sources) {
      localCandidates = {};
      if (Array.isArray(source.notices)) notices.push(...source.notices.filter(n => typeof n === 'string'));
      const lines = prepareText(source.text).split(/\r?\n/).map(normalize).filter(Boolean);
      const arrivalCount = lines.reduce((count, line) => count + labelMatches(line).filter(m => m.key === 'arrival').length, 0);
      let context = '', previousKey = '', sourceHasSO = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const matches = labelMatches(line);
        for (let j = 0; j < matches.length; j++) {
          const match = matches[j];
          const fieldLabel = line.slice(match.index, match.end);
          if (/^(?:授货地|授员地|接员地|御港|逢港)$/.test(fieldLabel)) notices.push(`“${fieldLabel}”可能是 OCR 误字，已按“${labels[match.key]}”列出候选，请务必核对原单`);
          let raw = line.slice(match.end, matches[j + 1]?.index ?? line.length).replace(/^\s*[:：]+\s*/, '').trim();
          if (!raw && matches.slice(j + 1).every(m => ['arrival', 'etd'].includes(m.key))) raw = followingValue(lines, i);
          if (match.key === 'so' && /\d/.test(raw)) sourceHasSO = true;
          if (['pol', 'pod', 'delivery', 'receipt'].includes(match.key)) context = match.key;
          if (match.key === 'arrival') {
            if (context === 'pod' || (!context && arrivalCount === 1)) add('eta', raw, source);
            else {
              extraArrivals.push({ context: context || 'unknown', raw, source: source.name });
              if (!context) notices.push('存在多处 ETA，但未能确认对应港口；未将不明归属的 ETA 填入卸港日期');
            }
          } else if (match.key === 'delivery') { /* 交货地 ETA 不能作为卸港 ETA。 */ }
          else if (match.key === 'voyage') add('voyage', raw, source);
          else add(match.key, raw, { ...source, fieldLabel, combinedVessel: match.key === 'vessel' && /航次|VOYAGE/i.test(fieldLabel) });
          if (match.key !== 'arrival') previousKey = match.key;
        }
        if (!matches.length && previousKey === 'pod' && /^(?:Terminal\b|码头)/i.test(line)) {
          const last = localCandidates.pod?.at(-1);
          if (last && !last.value.includes(line)) { last.value += ' ' + line; last.raw += ' ' + line; }
        }
      }
      if (!sourceHasSO) {
        const possible = lines.filter(l => /^[A-Z]{3,8}\d{6,16}$/.test(l));
        possible.forEach(v => add('so', v, source));
        if (possible.length) notices.push('SO 候选来自单据标题中的编号，请对照订舱号栏核实，勿误用提单号');
      }
      // 船名、航次只在同一来源/页内关联；不同单据不能交叉配对。
      if (localCandidates.vessel?.length && localCandidates.voyage?.length) {
        const combined = [];
        for (const vessel of localCandidates.vessel) {
          const split = /^(.*?)\s*\/\s*([A-Z0-9-]+)$/i.exec(vessel.value);
          if (split) combined.push(vessel);
          for (const voyage of localCandidates.voyage) {
            const value = (split ? split[1] : vessel.value) + ' / ' + voyage.value;
            if (!combined.some(c => keyOf(c.value) === keyOf(value))) combined.push({ ...vessel, value, raw: vessel.raw + '；航次 ' + voyage.raw });
          }
        }
        localCandidates.vessel = combined;
      }
      for (const [key, entries] of Object.entries(localCandidates)) for (const candidate of entries) {
        const merged = candidates[key] ||= [];
        if (!merged.some(c => keyOf(c.value) === keyOf(candidate.value) && (!timeKeys.includes(key) || c.rawZone === candidate.rawZone))) merged.push(candidate);
      }
    }
    const values = {}, timeZones = {}, sourceTimes = {};
    for (const [key, entries] of Object.entries(candidates)) {
      if (entries.length !== 1) continue;
      values[key] = entries[0].value;
      if (timeKeys.includes(key)) { timeZones[key] = entries[0].zone; sourceTimes[key] = { ...entries[0] }; }
    }
    return { values, timeZones, sourceTimes, candidates, notices: [...new Set(notices)], extraArrivals };
  }
  function check(order, existing = [], extraction = null) {
    const errors = [], warnings = [];
    for (const key of ['so', 'sales', 'pol', 'pod']) if (!String(order[key] || '').trim()) errors.push(`${key === 'sales' ? '销售' : labels[key]}尚未填写`);
    if (order.so && !/^[A-Za-z0-9][A-Za-z0-9\-/.]{2,49}$/.test(order.so)) errors.push('SO 号只允许字母、数字、横线、斜线和点，请核对识别结果');
    if (existing.some(o => (!order.id || o.id !== order.id) && keyOf(o.so) === keyOf(order.so))) errors.push('SO 号已存在，不能重复新建；请打开原订单核对');
    for (const key of timeKeys) {
      if (!order[key]) { warnings.push(`${labels[key]}未识别或未填写`); continue; }
      if (!validLocal(order[key])) { errors.push(`${labels[key]}不是有效的完整日期`); continue; }
      const zone = order.timeZones?.[key] || 'Asia/Shanghai';
      if (zone === 'unconfirmed') {
        (['etd', 'eta'].includes(key) ? warnings : errors).push(`${labels[key]}的原文时区尚未确认${['etd', 'eta'].includes(key) ? '，暂不参与到港筛选或时间先后比较' : '，请先选择时区才能正确提醒'}`);
      } else if (!Number.isFinite(epoch(order[key], zone))) errors.push(`${labels[key]}的日期与时区组合无效，请检查夏令时切换时刻`);
    }
    const at = key => epoch(order[key], order.timeZones?.[key] || 'Asia/Shanghai');
    if (at('eta') < at('etd')) errors.push('卸港 ETA 早于 ETD，日期或时区存在矛盾');
    for (const key of ['cutoff', 'cutport', 'releaseCutoff']) if (at(key) > at('etd')) errors.push(`${labels[key]}晚于 ETD，请核对是否属于同一航次`);
    for (const key of ['cutoff', 'cutport', 'releaseCutoff']) if (at(key) < Date.now()) warnings.push(`${labels[key]}已过去，保存后会按逾期提醒；请核对年份与日期`);
    if (order.cutoff && order.cutport && at('cutoff') > at('cutport')) warnings.push('截单晚于截关 / 港，请核对船司要求');
    if (order.pol && keyOf(order.pol) === keyOf(order.pod)) warnings.push('起运港与目的港相同，请核对');
    if (!order.vessel) warnings.push('船名 / 航次尚未填写，维运网暂时无法关联查询');
    else if (!/^.+\s\/\s.+$/.test(order.vessel)) warnings.push('船名与航次未能明确分开，请核对并按“船名 / 航次”填写，供船期查询关联');
    if (order.importSource || extraction) warnings.push('已保留原单具体时刻；当前仅返回日期的船期服务不会覆盖这些时刻，请核对后手工更新');
    for (const other of existing) {
      if (order.id && other.id === order.id) continue;
      if (order.bl && keyOf(other.bl) === keyOf(order.bl)) warnings.push(`提单号与 ${other.so} 相同，请核对是否重复订单`);
      if (order.wo && keyOf(other.wo) === keyOf(order.wo)) warnings.push(`工作号与 ${other.so} 相同，请核对关联关系`);
    }
    if (extraction) {
      warnings.push(...extraction.notices);
      for (const [key, entries] of Object.entries(extraction.candidates)) if (entries.length > 1 && labels[key]) {
        const message = `${labels[key]}在原文中有 ${entries.length} 个不同候选值，请明确选择或手工核对`;
        (order[key] ? warnings : errors).push(message);
      }
      if (extraction.extraArrivals.length) warnings.push('已把装港 / 接货地、交货地 ETA 与卸港 ETA 区分，只有卸港 ETA 填入订单');
    }
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  }
  const api = { labels, timeKeys, parse, parseDate, validLocal, epoch, check, keyOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BookingParser = api;
})(globalThis);
