/* =====================================================================
   航务通 · 系统设置 Settings —— 业务逻辑
   前端演示数据，已保存的设置保存在当前浏览器
   接口占位：/api/settings/...
   ===================================================================== */
'use strict';

window.SettingsPage = (function () {

  /* -------------------------------------------------------------------
     数据模型
     ------------------------------------------------------------------- */
  const ROLES = [
    { id: 'admin', name: '管理员', desc: '系统最高权限，可配置全部参数' },
    { id: 'sales', name: '业务员', desc: '负责订单创建、跟进与客户维护' },
    { id: 'finance', name: '财务', desc: '负责费用、收付款与发票开具' },
    { id: 'viewer', name: '只读用户', desc: '仅可查看，不可编辑或导出' }
  ];

  const PERM_GROUPS = [
    { group: '订单管理', items: [
      { key: 'order.view', label: '订单查看' }, { key: 'order.create', label: '订单创建' },
      { key: 'order.edit', label: '订单编辑' }, { key: 'order.delete', label: '订单删除' },
      { key: 'order.export', label: '订单导出' } ] },
    { group: '财务', items: [
      { key: 'finance.view', label: '费用查看' }, { key: 'finance.edit', label: '费用录入' },
      { key: 'finance.receive', label: '收款登记' }, { key: 'finance.invoice', label: '发票开具' },
      { key: 'finance.approve', label: '付款审批' } ] },
    { group: '客户与船期', items: [
      { key: 'customer.view', label: '客户查看' }, { key: 'customer.edit', label: '客户编辑' },
      { key: 'tracking.view', label: '船期查看' }, { key: 'tracking.edit', label: '船期更新' } ] },
    { group: '系统设置', items: [
      { key: 'settings.user', label: '用户管理' }, { key: 'settings.role', label: '角色管理' },
      { key: 'settings.dict', label: '基础数据' }, { key: 'settings.audit', label: '日志查看' },
      { key: 'settings.backup', label: '备份执行' } ] }
  ];

  const ALL_KEYS = PERM_GROUPS.flatMap(g => g.items.map(i => i.key));

  const DEFAULT_PERM = {
    admin: ALL_KEYS.slice(),
    sales: ['order.view', 'order.create', 'order.edit', 'order.export',
      'customer.view', 'customer.edit', 'tracking.view', 'tracking.edit'],
    finance: ['order.view', 'finance.view', 'finance.edit', 'finance.receive',
      'finance.invoice', 'finance.approve', 'customer.view'],
    viewer: ['order.view', 'finance.view', 'customer.view', 'tracking.view']
  };

  let rules = [
    { id: 'R-001', name: '截单前 24 小时提醒', event: '订舱截单', threshold: 24, unit: '小时', target: '业务员 + 船务', channel: '站内信 + 邮件', enabled: true },
    { id: 'R-002', name: '到港前两天提醒', event: '船期变更', threshold: 48, unit: '小时', target: '业务员', channel: '站内信', enabled: true },
    { id: 'R-003', name: '账单逾期提醒', event: '账单逾期', threshold: 3, unit: '天', target: '财务', channel: '站内信 + 邮件', enabled: true },
    { id: 'R-004', name: '异常订单升级通知', event: '异常订单', threshold: 0, unit: '次', target: '业务主管', channel: '企业微信', enabled: false }
  ];

  let soRules = [
    { id: 'S-001', name: '标准 SO 邮件模板', method: '正文关键字', priority: 10, hits: 128, enabled: true, sample: '主题：SO Request - ABC Trading',
      mappings: [
        { id: 'M-01', source: 'Shipper', target: 'customerName', required: true },
        { id: 'M-02', source: 'Pol / Pod', target: 'route', required: true },
        { id: 'M-03', source: 'ETD', target: 'etd', required: true },
        { id: 'M-04', source: 'Commodity', target: 'goods', required: false } ] },
    { id: 'S-002', name: 'Acme PDF 提单模板', method: 'PDF 版式', priority: 20, hits: 64, enabled: true, sample: 'PDF 表头区 · Acme Logistics',
      mappings: [
        { id: 'M-05', source: 'Consignor', target: 'customerName', required: true },
        { id: 'M-06', source: 'Place of Receipt', target: 'pol', required: false },
        { id: 'M-07', source: 'Place of Delivery', target: 'pod', required: false } ] },
    { id: 'S-003', name: '遗留表格式样例', method: '固定模板', priority: 30, hits: 12, enabled: false, sample: '旧版 Excel 模板 v1',
      mappings: [ { id: 'M-08', source: '客户名称', target: 'customerName', required: true } ] }
  ];

  let currencies = [
    { id: 'C-001', code: 'CNY', name: '人民币', symbol: '¥', decimals: 2, rate: 1, isDefault: true, enabled: true },
    { id: 'C-002', code: 'USD', name: '美元', symbol: '$', decimals: 2, rate: 7.12, isDefault: false, enabled: true },
    { id: 'C-003', code: 'EUR', name: '欧元', symbol: '€', decimals: 2, rate: 7.78, isDefault: false, enabled: true },
    { id: 'C-004', code: 'HKD', name: '港币', symbol: 'HK$', decimals: 2, rate: 0.91, isDefault: false, enabled: true },
    { id: 'C-005', code: 'JPY', name: '日元', symbol: '¥', decimals: 0, rate: 0.048, isDefault: false, enabled: false }
  ];

  let payees = [
    { id: 'P-001', code: 'HT-SH', name: '航务通（上海）国际货运有限公司', taxNo: '91310000MA1FL8X2K3', bank: '中国银行上海市分行', currency: 'CNY', enabled: true },
    { id: 'P-002', code: 'HT-SZ', name: '航务通（深圳）供应链有限公司', taxNo: '91440300MA5EQ9T7L', bank: '招商银行深圳分行', currency: 'CNY', enabled: true },
    { id: 'P-003', code: 'HT-HK', name: '航務通（香港）物流有限公司', taxNo: 'HK31876542', bank: '汇丰银行香港分行', currency: 'HKD', enabled: true }
  ];

  let invoiceTypes = [
    { id: 'I-001', code: 'FWD', name: '海运费发票', scope: '海运费', taxRate: 13, enabled: true },
    { id: 'I-002', code: 'CUS', name: '报关费发票', scope: '报关费', taxRate: 6, enabled: true },
    { id: 'I-003', code: 'TRN', name: '陆运费发票', scope: '陆运费', taxRate: 9, enabled: true },
    { id: 'I-004', code: 'OTH', name: '其他服务发票', scope: '其他', taxRate: 6, enabled: false }
  ];

  let logs = [
    { id: 'L-001', time: '2026-10-24 09:12:31', actor: '陈亦航', module: '基础数据', action: '新增', target: '币种 CNY', detail: '新增默认币种人民币', result: '成功' },
    { id: 'L-002', time: '2026-10-24 09:08:02', actor: '陈亦航', module: '用户与权限', action: '修改', target: '角色 业务员', detail: '新增「订单导出」权限点', result: '成功' },
    { id: 'L-003', time: '2026-10-23 18:40:57', actor: '李敏', module: '提醒规则', action: '停用', target: '异常订单升级通知', detail: '暂停企业微信推送', result: '成功' },
    { id: 'L-004', time: '2026-10-23 17:22:14', actor: '周航', module: 'SO 识别规则', action: '修改', target: 'S-002 Acme PDF 提单模板', detail: '调整 Place of Delivery 映射', result: '成功' },
    { id: 'L-005', time: '2026-10-23 14:05:33', actor: '系统', module: '操作日志', action: '备份', target: '全量快照', detail: '每日 02:00 自动备份完成', result: '成功' },
    { id: 'L-006', time: '2026-10-23 11:47:09', actor: '陈亦航', module: '基础数据', action: '删除', target: '付款主体 HT-SZ', detail: '被 3 张账单引用，已拒绝删除', result: '失败' },
    { id: 'L-007', time: '2026-10-22 16:30:00', actor: '系统', module: '操作日志', action: '备份', target: '全量快照', detail: '每日 02:00 自动备份完成', result: '成功' }
  ];

  const attachPolicy = { maxSize: 50, total: 20, types: 'pdf,xlsx,xls,docx,doc,png,jpg,jpeg,zip', retention: 365, watermark: true, virus: true, oss: false };
  const backupPolicy = { cycle: 'DAILY', keep: 30, time: '02:00', scope: 'FULL' };
  let backupRecords = [
    { id: 'B-002', time: '2026-10-24 02:00:00', scope: '全量备份', size: '1.24 GB', status: '成功' },
    { id: 'B-001', time: '2026-10-23 02:00:00', scope: '全量备份', size: '1.21 GB', status: '成功' }
  ];

  /* 运行态 */
  const S = {
    perm: JSON.parse(JSON.stringify(DEFAULT_PERM)),
    savedPerm: JSON.parse(JSON.stringify(DEFAULT_PERM)),
    onlyDiff: false,
    ruleQuery: '',
    selectedSo: 'S-001',
    masterTab: '币种',
    logFilter: { actor: '', module: '', action: '', keyword: '' }
  };

  let ctx = {};   // 由 wire() 注入的宿主函数

  /* -------------------------------------------------------------------
     工具
     ------------------------------------------------------------------- */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function nowStamp() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date());
  }
  function today() {
    return nowStamp().slice(0, 10);
  }
  let seq = 0;
  const SETTINGS_KEY = 'hangwutong.settings.v1';
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || ![saved.rules, saved.soRules, saved.currencies, saved.payees, saved.invoiceTypes, saved.logs, saved.backupRecords].every(Array.isArray)) throw new Error('设置数据格式无效');
      rules = saved.rules; soRules = saved.soRules; currencies = saved.currencies;
      payees = saved.payees; invoiceTypes = saved.invoiceTypes; logs = saved.logs; backupRecords = saved.backupRecords;
      Object.assign(attachPolicy, saved.attachPolicy); Object.assign(backupPolicy, saved.backupPolicy);
      if (saved.permissions && ROLES.every(r => Array.isArray(saved.permissions[r.id]))) {
        S.savedPerm = saved.permissions; S.perm = JSON.parse(JSON.stringify(saved.permissions));
      }
    }
  } catch (error) { window.settingsLoadError = true; }
  let committedSoRules = JSON.parse(JSON.stringify(soRules));
  let settingsSaveFailed = false;
  function persistSettings(module) {
    if (module === 'SO 识别规则') committedSoRules = JSON.parse(JSON.stringify(soRules));
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, rules, soRules: committedSoRules, currencies, payees, invoiceTypes, logs, backupRecords, attachPolicy, backupPolicy, permissions: S.savedPerm }));
      window.LocalData?.changed();
      settingsSaveFailed = false;
      return true;
    } catch (error) {
      settingsSaveFailed = true;
      document.getElementById('storageStatus').hidden = false;
      document.getElementById('storageStatus').textContent = '设置本地保存失败，请勿关闭页面';
      document.getElementById('storageStatus').classList.add('storage-error');
      return false;
    }
  }
  function uid(p) { seq += 1; return `${p}-${Date.now().toString(36)}-${seq}`; }
  function has(roleId, key) { return (S.perm[roleId] || []).includes(key); }
  function statusTag(on, onText = '已启用', offText = '已停用') {
    return `<span class="status ${on ? 'on' : 'off'}"><i aria-hidden="true"></i>${on ? onText : offText}</span>`;
  }
  function pushLog(module, action, target, detail) {
    logs.unshift({ id: uid('L'), time: nowStamp(), actor: '陈亦航', module, action, target, detail, result: '成功' });
    persistSettings(module);
  }
  function emptyBox(title, desc) {
    return `<div class="panel empty"><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>`;
  }

  /* -------------------------------------------------------------------
     1. 权限矩阵
     ------------------------------------------------------------------- */
  function renderPerms() {
    const groups = PERM_GROUPS.map(g => {
      const items = g.items.filter(i => !S.onlyDiff ||
        ROLES.some(r => has(r.id, i.key) !== DEFAULT_PERM[r.id].includes(i.key)));
      if (!items.length) return '';
      return `<tr class="grp"><th colspan="${ROLES.length + 1}">${esc(g.group)}</th></tr>` +
        items.map(i => {
          const diff = ROLES.some(r => has(r.id, i.key) !== DEFAULT_PERM[r.id].includes(i.key));
          return `<tr class="${diff ? 'diff' : ''}">
            <th scope="row"><span>${esc(i.label)}</span><code>${esc(i.key)}</code></th>
            ${ROLES.map(r => `<td class="ctr"><input type="checkbox" data-perm="${i.key}" data-role="${r.id}"${
              has(r.id, i.key) ? ' checked' : ''} aria-label="${esc(r.name)} 拥有 ${esc(i.label)} 权限"></td>`).join('')}
          </tr>`;
        }).join('');
    }).join('');

    const total = ALL_KEYS.length;
    const stats = ROLES.map(r => {
      const n = (S.perm[r.id] || []).length;
      const pct = Math.round(n / total * 100);
      const cls = pct >= 95 ? 'full' : pct >= 50 ? '' : 'warn';
      return `<li><div class="st-main"><b>${esc(r.name)}</b><small>${esc(r.desc)}</small></div>
        <div class="st-right"><span class="meter"><i class="${cls}" style="width:${pct}%"></i></span><em>${n}/${total}</em></div></li>`;
    }).join('');

    return `<div class="set-grid">
      <div class="set-main">
        <section class="panel">
          <div class="panel-head">
            <h2>权限矩阵</h2>
            <div class="panel-tools">
              <label class="inline-check"><input type="checkbox" id="onlyDiff"${S.onlyDiff ? ' checked' : ''}><span>仅显示与默认不同的项</span></label>
              <button class="mini" id="permReset">恢复默认</button>
              <button class="btn primary" id="permSave">保存权限</button>
            </div>
          </div>
          <p class="hint">表头可整列全选 / 清空；勾选后需点击「保存权限」才生效。接口占位：<code>PUT /api/settings/roles/permissions</code></p>
          <div class="table-wrap">
            <table class="matrix">
              <caption class="sr-only">角色功能权限矩阵，行首为权限点，列为角色</caption>
              <thead><tr><th scope="col">权限点</th>${ROLES.map(r =>
                `<th scope="col">${esc(r.name)}<button class="colall" data-roleall="${r.id}">全选 / 清空</button></th>`).join('')}</tr></thead>
              <tbody>${groups}</tbody>
            </table>
          </div>
        </section>
      </div>
      <aside class="set-side">
        <section class="panel">
          <div class="panel-head"><h2>角色概览</h2></div>
          <ul class="stat-list">${stats}</ul>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>约束提示</h2></div>
          <ul class="rule-list">
            <li><span class="tag red">禁止</span>用户为自己新增其本身不具备的权限。</li>
            <li><span class="tag red">禁止</span>停用或删除最后一个可登录的管理员。</li>
            <li><span class="tag orange">注意</span>只读用户仅授予查看类权限，不可授予导出。</li>
            <li><span class="tag blue">生效</span>权限保存后即时生效，部分用户需重新登录刷新令牌。</li>
          </ul>
        </section>
      </aside>
    </div>`;
  }

  function wirePerms() {
    document.querySelectorAll('[data-perm]').forEach(cb => cb.onchange = () => {
      const set = new Set(S.perm[cb.dataset.role] || []);
      if (cb.checked) set.add(cb.dataset.perm); else set.delete(cb.dataset.perm);
      S.perm[cb.dataset.role] = [...set];
      ctx.toast('已更新勾选，记得点击「保存权限」', 'warn');
    });
    document.querySelectorAll('[data-roleall]').forEach(b => b.onclick = () => {
      const role = b.dataset.roleall;
      const all = S.perm[role] || [];
      S.perm[role] = all.length === ALL_KEYS.length ? [] : ALL_KEYS.slice();
      ctx.toast(all.length === ALL_KEYS.length ? '已清空该角色权限' : '已全选该角色权限', 'warn');
      ctx.rerender();
    });
    const od = document.getElementById('onlyDiff');
    if (od) od.onchange = () => { S.onlyDiff = od.checked; ctx.rerender(); };
    const rs = document.getElementById('permReset');
    if (rs) rs.onclick = () => {
      S.perm = JSON.parse(JSON.stringify(DEFAULT_PERM));
      ctx.toast('已恢复为默认权限，记得保存', 'warn');
      ctx.rerender();
    };
    const sv = document.getElementById('permSave');
    if (sv) sv.onclick = savePerms;
  }

  function savePerms() {
    const DANGEROUS = /edit|delete|export|approve|backup|user|role/;
    const bad = (S.perm.viewer || []).filter(k => DANGEROUS.test(k));
    if (bad.length) {
      ctx.toast(`保存失败：只读用户不可拥有编辑类权限（${bad.join('、')}）`, 'error');
      return;
    }
    if ((S.perm.admin || []).length < ALL_KEYS.length) {
      ctx.toast('保存失败：管理员权限不可削减，系统至少需保留一个完整权限管理员', 'error');
      return;
    }
    S.savedPerm = JSON.parse(JSON.stringify(S.perm));
    pushLog('用户与权限', '修改', '角色权限矩阵', `调整 ${ROLES.length} 个角色的权限点`);
    ctx.toast('权限已保存（接口占位 PUT /api/settings/roles/permissions）');
  }

  /* -------------------------------------------------------------------
     2. 提醒规则
     ------------------------------------------------------------------- */
  function renderRules(query) {
    const q = (query || S.ruleQuery || '').toLowerCase();
    const rows = rules.filter(r => !q || (r.name + r.target + r.event).toLowerCase().includes(q));
    const body = rows.length ? rows.map(r => `<tr>
      <td><b>${esc(r.name)}</b><small>${esc(r.id)}</small></td>
      <td>${esc(r.event)}</td>
      <td class="num">${esc(r.threshold)} ${esc(r.unit)}</td>
      <td>${esc(r.target)}</td>
      <td>${esc(r.channel)}</td>
      <td>${statusTag(r.enabled)}</td>
      <td class="row-actions">
        <button class="mini" data-rule-toggle="${r.id}">${r.enabled ? '停用' : '启用'}</button>
        <button class="mini" data-rule-edit="${r.id}">编辑</button>
        <button class="mini danger" data-rule-del="${r.id}">删除</button>
      </td></tr>`).join('') : '';

    return `<div class="set-grid">
      <div class="set-main">
        <section class="panel">
          <div class="panel-head">
            <h2>规则列表</h2>
            <div class="panel-tools">
              <label class="search sm"><span>⌕</span><input id="ruleSearch" value="${esc(S.ruleQuery)}" placeholder="搜索规则名称 / 接收对象"></label>
              <button class="btn primary" id="ruleAdd">新增规则</button>
            </div>
          </div>
          ${rows.length ? `<div class="table-wrap"><table>
            <caption class="sr-only">提醒规则列表</caption>
            <thead><tr><th>规则名称</th><th>触发事件</th><th>阈值</th><th>接收对象</th><th>渠道</th><th>状态</th><th class="ra">操作</th></tr></thead>
            <tbody>${body}</tbody></table></div>`
        : emptyBox('暂无匹配的提醒规则', '调整搜索关键字，或点击「新增规则」创建第一条规则。')}
        </section>
      </div>
      <aside class="set-side">
        <section class="panel">
          <div class="panel-head"><h2>触发事件说明</h2></div>
          <dl class="desc">
            <dt>订舱截单</dt><dd>SO 确认后倒计时提醒业务补充货物信息。</dd>
            <dt>船期变更</dt><dd>承运人推送 ETD/ETM 变更时触发。</dd>
            <dt>到港提醒</dt><dd>目的港代理预计到港前 N 小时提醒。</dd>
            <dt>账单逾期</dt><dd>应收账单超过约定账期未核销时提醒财务。</dd>
          </dl>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>渠道可用性</h2></div>
          <ul class="stat-list">
            <li><div class="st-main"><b>规则总数</b><small>含停用</small></div><span class="tag blue">${rules.length}</span></li>
            <li><div class="st-main"><b>已启用</b><small>正在推送</small></div><span class="tag green">${rules.filter(r => r.enabled).length}</span></li>
            <li><div class="st-main"><b>已停用</b><small>暂停推送</small></div><span class="tag orange">${rules.filter(r => !r.enabled).length}</span></li>
            <li><div class="st-main"><b>覆盖渠道</b><small>站内信 / 邮件 / 企微</small></div><span class="tag blue">${new Set(rules.map(r => r.channel)).size}</span></li>
          </ul>
        </section>
      </aside>
    </div>`;
  }

  function ruleFields(r) {
    return [
      { key: 'name', label: '规则名称', value: r.name, required: true },
      { key: 'event', label: '触发事件', type: 'select', value: r.event, options: ['订舱截单', '船期变更', '到港提醒', '账单逾期', '异常订单'] },
      { key: 'threshold', label: '触发阈值', type: 'number', value: r.threshold, min: 0 },
      { key: 'unit', label: '阈值单位', type: 'select', value: r.unit, options: ['小时', '天', '次'] },
      { key: 'target', label: '接收对象', value: r.target, required: true },
      { key: 'channel', label: '通知渠道', type: 'select', value: r.channel, options: ['站内信', '站内信 + 邮件', '企业微信', '邮件'] },
      { key: 'enabled', label: '启用该规则', type: 'checkbox', value: r.enabled, full: true }
    ];
  }

  function wireRules(query) {
    const s = document.getElementById('ruleSearch');
    if (s) s.oninput = e => { S.ruleQuery = e.target.value; ctx.rerender(); };
    const add = document.getElementById('ruleAdd');
    if (add) add.onclick = () => {
      ctx.openForm('新增提醒规则', ruleFields({ name: '', event: '订舱截单', threshold: 24, unit: '小时', target: '', channel: '站内信', enabled: true }), data => {
        if (!data.name) { ctx.setFieldError('name', '请填写规则名称'); return false; }
        if (!data.target) { ctx.setFieldError('target', '请填写接收对象'); return false; }
        const th = Number(data.threshold);
        if (Number.isNaN(th) || th < 0) { ctx.setFieldError('threshold', '阈值必须为不小于 0 的数字'); return false; }
        rules.push({ id: uid('R'), ...data, threshold: th });
        pushLog('提醒规则', '新增', data.name, `阈值 ${th} ${data.unit}`);
        ctx.toast(`提醒规则已新增：${data.name}`);
        ctx.rerender();
        return true;
      });
    };
    document.querySelectorAll('[data-rule-edit]').forEach(b => b.onclick = () => {
      const r = rules.find(x => x.id === b.dataset.ruleEdit);
      ctx.openForm('编辑提醒规则', ruleFields(r), data => {
        if (!data.name) { ctx.setFieldError('name', '请填写规则名称'); return false; }
        if (!data.target) { ctx.setFieldError('target', '请填写接收对象'); return false; }
        const th = Number(data.threshold);
        if (Number.isNaN(th) || th < 0) { ctx.setFieldError('threshold', '阈值必须为不小于 0 的数字'); return false; }
        Object.assign(r, data, { threshold: th });
        pushLog('提醒规则', '修改', data.name, `阈值 ${th} ${data.unit}`);
        ctx.toast(`提醒规则已更新：${data.name}`);
        ctx.rerender();
        return true;
      });
    });
    document.querySelectorAll('[data-rule-toggle]').forEach(b => b.onclick = () => {
      const r = rules.find(x => x.id === b.dataset.ruleToggle);
      r.enabled = !r.enabled;
      pushLog('提醒规则', r.enabled ? '启用' : '停用', r.name, '');
      ctx.toast(r.enabled ? `规则已启用：${r.name}` : `规则已停用：${r.name}`, r.enabled ? 'success' : 'warn');
      ctx.rerender();
    });
    document.querySelectorAll('[data-rule-del]').forEach(b => b.onclick = () => {
      const r = rules.find(x => x.id === b.dataset.ruleDel);
      ctx.openForm('删除提醒规则', [
        { key: 'confirm', label: `确定要删除规则「${r.name}」吗？`, type: 'checkbox', value: false, hint: '删除后该规则立即失效，历史记录仍保留在操作日志中', full: true }
      ], data => {
        if (!data.confirm) { ctx.setFieldError('confirm', '请勾选确认后再删除'); return false; }
        rules = rules.filter(x => x.id !== r.id);
        pushLog('提醒规则', '删除', r.name, '删除提醒规则');
        ctx.toast(`提醒规则已删除：${r.name}`);
        ctx.rerender();
        return true;
      }, { submitText: '确认删除', danger: true });
    });
  }

  /* -------------------------------------------------------------------
     3. SO 识别规则与字段映射
     ------------------------------------------------------------------- */
  function renderSo() {
    const rule = soRules.find(r => r.id === S.selectedSo) || soRules[0];
    if (rule) S.selectedSo = rule.id;

    const rows = soRules.length ? soRules.map(r => `<tr class="${r.id === S.selectedSo ? 'sel' : ''}" data-so-row="${r.id}">
      <td><b>${esc(r.name)}</b><small>${esc(r.id)}</small></td>
      <td>${esc(r.method)}</td>
      <td class="num">${esc(r.priority)}</td>
      <td class="num">${esc(r.hits)}</td>
      <td>${statusTag(r.enabled)}</td>
      <td class="row-actions">
        <button class="mini" data-so-toggle="${r.id}">${r.enabled ? '停用' : '启用'}</button>
        <button class="mini danger" data-so-del="${r.id}">删除</button>
      </td></tr>`).join('') : '';

    const maps = rule ? rule.mappings.map(m => `<div class="map-item">
      <input class="input sm" value="${esc(m.source)}" data-map-src="${m.id}" placeholder="源字段，如 Shipper" aria-label="源字段名称">
      <span class="arrow" aria-hidden="true">→</span>
      <input class="input sm" value="${esc(m.target)}" data-map-dst="${m.id}" placeholder="目标字段，如 customerName" aria-label="目标字段编码">
      <button class="mini danger" data-map-del="${m.id}">删除</button>
      <div class="map-meta">
        <label class="inline-check"><input type="checkbox" data-map-req="${m.id}"${m.required ? ' checked' : ''}><span>必填字段</span></label>
        <span>映射 ${esc(m.id)}</span>
      </div></div>`).join('') : '';

    return `<div class="set-grid">
      <div class="set-main">
        <section class="panel">
          <div class="panel-head">
            <h2>识别规则</h2>
            <div class="panel-tools"><button class="btn primary" id="soAdd">新增识别规则</button></div>
          </div>
          <p class="hint">点击行可在右侧编辑该规则的字段映射。接口占位：<code>PUT /api/settings/so-rules/{id}/mappings</code></p>
          ${soRules.length ? `<div class="table-wrap"><table>
            <caption class="sr-only">SO 识别规则列表</caption>
            <thead><tr><th>规则名称</th><th>识别方式</th><th>优先级</th><th>命中</th><th>状态</th><th class="ra">操作</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`
        : emptyBox('尚未配置识别规则', '新增规则后，为其添加「源字段 → 目标字段」映射即可参与解析。')}
        </section>
      </div>
      <aside class="set-side">
        <section class="panel">
          <div class="panel-head">
            <h2>字段映射</h2>
            <span class="note">${rule ? esc(rule.name) : '未选择规则'}</span>
          </div>
          ${rule ? `<div class="map-list">${maps}</div>
            <button class="btn ghost full-w" id="mapAdd">新增字段映射</button>
            <button class="btn primary full-w" id="soSave">保存规则</button>`
        : emptyBox('未选择规则', '请先在左侧选择或新增一条识别规则。')}
        </section>
      </aside>
    </div>`;
  }

  function wireSo() {
    const add = document.getElementById('soAdd');
    if (add) add.onclick = () => {
      ctx.openForm('新增识别规则', [
        { key: 'name', label: '规则名称', required: true },
        { key: 'method', label: '识别方式', type: 'select', value: '正文关键字', options: ['正文关键字', 'PDF 版式', '固定模板'] },
        { key: 'priority', label: '优先级', type: 'number', value: 50, min: 1, hint: '数值越小越先匹配' },
        { key: 'sample', label: '样例文本', type: 'textarea', full: true, hint: '粘贴一段客户来件样例，便于校验' }
      ], data => {
        if (!data.name) { ctx.setFieldError('name', '请填写规则名称'); return false; }
        soRules.push({ id: uid('S'), name: data.name, method: data.method, priority: Number(data.priority), hits: 0, enabled: true, sample: data.sample, mappings: [] });
        S.selectedSo = soRules[soRules.length - 1].id;
        pushLog('SO 识别规则', '新增', data.name, '新增识别规则');
        ctx.toast(`识别规则已新增：${data.name}`);
        ctx.rerender();
        return true;
      });
    };
    document.querySelectorAll('[data-so-row]').forEach(tr => tr.onclick = e => {
      if (e.target.closest('button')) return;
      S.selectedSo = tr.dataset.soRow;
      ctx.rerender();
    });
    document.querySelectorAll('[data-so-toggle]').forEach(b => b.onclick = () => {
      const r = soRules.find(x => x.id === b.dataset.soToggle);
      r.enabled = !r.enabled;
      pushLog('SO 识别规则', r.enabled ? '启用' : '停用', r.name, '');
      ctx.toast(r.enabled ? `规则已启用：${r.name}` : `规则已停用：${r.name}`, r.enabled ? 'success' : 'warn');
      ctx.rerender();
    });
    document.querySelectorAll('[data-so-del]').forEach(b => b.onclick = () => {
      const r = soRules.find(x => x.id === b.dataset.soDel);
      ctx.openForm('删除识别规则', [
        { key: 'confirm', label: `确定删除「${r.name}」及其 ${r.mappings.length} 条字段映射吗？`, type: 'checkbox', value: false, hint: '删除后该模板将不再参与 SO 识别', full: true }
      ], data => {
        if (!data.confirm) { ctx.setFieldError('confirm', '请勾选确认后再删除'); return false; }
        soRules = soRules.filter(x => x.id !== r.id);
        if (S.selectedSo === r.id) S.selectedSo = soRules.length ? soRules[0].id : '';
        pushLog('SO 识别规则', '删除', r.name, '删除识别规则及其映射');
        ctx.toast(`识别规则已删除：${r.name}`);
        ctx.rerender();
        return true;
      }, { submitText: '确认删除', danger: true });
    });
    const ma = document.getElementById('mapAdd');
    if (ma) ma.onclick = () => {
      const rule = soRules.find(r => r.id === S.selectedSo);
      if (!rule) { ctx.toast('请先选择一条识别规则', 'warn'); return; }
      rule.mappings.push({ id: uid('M'), source: '', target: '', required: false });
      ctx.toast('已添加映射行，填写后点击保存', 'warn');
      ctx.rerender();
    };
    document.querySelectorAll('[data-map-del]').forEach(b => b.onclick = () => {
      const rule = soRules.find(r => r.id === S.selectedSo);
      rule.mappings = rule.mappings.filter(m => m.id !== b.dataset.mapDel);
      ctx.rerender();
    });
    const sv = document.getElementById('soSave');
    if (sv) sv.onclick = () => {
      soRules.forEach(r => r.mappings.forEach(m => {
        const s = document.querySelector(`[data-map-src="${m.id}"]`);
        const d = document.querySelector(`[data-map-dst="${m.id}"]`);
        const q = document.querySelector(`[data-map-req="${m.id}"]`);
        if (s) m.source = s.value.trim();
        if (d) m.target = d.value.trim();
        if (q) m.required = q.checked;
      }));
      const bad = soRules.flatMap(r => r.mappings.filter(m => !m.source || !m.target));
      if (bad.length) { ctx.toast('保存失败：存在未填完整的字段映射', 'error'); return; }
      pushLog('SO 识别规则', '修改', '字段映射', `更新 ${soRules.length} 条规则的映射配置`);
      ctx.toast('识别规则已保存（接口占位 PUT /api/settings/so-rules/{id}/mappings）');
    };
  }

  /* -------------------------------------------------------------------
     4. 基础数据
     ------------------------------------------------------------------- */
  function renderMaster() {
    const tab = S.masterTab;
    const tabs = ['币种', '付款主体', '发票类型'];
    let body = '';

    if (tab === '币种') {
      body = currencies.length ? `<div class="table-wrap"><table>
        <caption class="sr-only">常用币种列表</caption>
        <thead><tr><th>币种代码</th><th>名称</th><th>符号</th><th>小数位</th><th>参考汇率</th><th>默认</th><th>状态</th><th class="ra">操作</th></tr></thead>
        <tbody>${currencies.map(c => `<tr>
          <td><code>${esc(c.code)}</code></td>
          <td><b>${esc(c.name)}</b></td>
          <td>${esc(c.symbol)}</td>
          <td class="num">${esc(c.decimals)}</td>
          <td class="num">${esc(c.rate)}</td>
          <td>${c.isDefault ? '<span class="tag blue">默认</span>' : ''}</td>
          <td>${statusTag(c.enabled, '启用', '停用')}</td>
          <td class="row-actions">
            <button class="mini" data-cur-toggle="${c.id}">${c.enabled ? '停用' : '启用'}</button>
            <button class="mini" data-cur-edit="${c.id}">编辑</button>
            <button class="mini danger" data-cur-del="${c.id}">删除</button>
          </td></tr>`).join('')}</tbody></table></div>`
        : emptyBox('暂无币种', '点击右上角「新增」添加币种。');
    } else if (tab === '付款主体') {
      body = payees.length ? `<div class="table-wrap"><table>
        <caption class="sr-only">付款主体列表</caption>
        <thead><tr><th>主体代码</th><th>主体名称</th><th>税号</th><th>开户行</th><th>默认币种</th><th>状态</th><th class="ra">操作</th></tr></thead>
        <tbody>${payees.map(p => `<tr>
          <td><code>${esc(p.code)}</code></td>
          <td><b>${esc(p.name)}</b></td>
          <td><code>${esc(p.taxNo)}</code></td>
          <td>${esc(p.bank)}</td>
          <td>${esc(p.currency)}</td>
          <td>${statusTag(p.enabled, '启用', '停用')}</td>
          <td class="row-actions">
            <button class="mini" data-pay-toggle="${p.id}">${p.enabled ? '停用' : '启用'}</button>
            <button class="mini" data-pay-edit="${p.id}">编辑</button>
            <button class="mini danger" data-pay-del="${p.id}">删除</button>
          </td></tr>`).join('')}</tbody></table></div>`
        : emptyBox('暂无付款主体', '点击右上角「新增」添加付款主体。');
    } else {
      body = invoiceTypes.length ? `<div class="table-wrap"><table>
        <caption class="sr-only">发票类型列表</caption>
        <thead><tr><th>类型代码</th><th>类型名称</th><th>适用费用</th><th>税率</th><th>状态</th><th class="ra">操作</th></tr></thead>
        <tbody>${invoiceTypes.map(i => `<tr>
          <td><code>${esc(i.code)}</code></td>
          <td><b>${esc(i.name)}</b></td>
          <td>${esc(i.scope)}</td>
          <td class="num">${esc(i.taxRate)}%</td>
          <td>${statusTag(i.enabled, '启用', '停用')}</td>
          <td class="row-actions">
            <button class="mini" data-inv-toggle="${i.id}">${i.enabled ? '停用' : '启用'}</button>
            <button class="mini" data-inv-edit="${i.id}">编辑</button>
            <button class="mini danger" data-inv-del="${i.id}">删除</button>
          </td></tr>`).join('')}</tbody></table></div>`
        : emptyBox('暂无发票类型', '点击右上角「新增」添加发票类型。');
    }

    return `<section class="panel">
      <div class="panel-head">
        <h2>基础数据</h2>
        <div class="panel-tools">
          <div class="seg" role="tablist" aria-label="基础数据分类">
            ${tabs.map(t => `<button class="seg-btn ${t === tab ? 'on' : ''}" data-mtab="${t}" role="tab" aria-selected="${t === tab}">${t}</button>`).join('')}
          </div>
          <button class="btn primary" id="masterAdd">新增</button>
        </div>
      </div>
      <p class="hint">基础数据被订单、财务、单证模块以下拉方式引用；停用项不再可选，但历史单据仍按原名称回显。</p>
      ${body}
    </section>`;
  }

  function wireMaster() {
    document.querySelectorAll('[data-mtab]').forEach(b => b.onclick = () => { S.masterTab = b.dataset.mtab; ctx.rerender(); });
    const add = document.getElementById('masterAdd');
    if (add) add.onclick = () => {
      const tab = S.masterTab;
      if (tab === '币种') {
        ctx.openForm('新增币种', [
          { key: 'code', label: '币种代码', required: true, hint: '如 USD' },
          { key: 'name', label: '币种名称', required: true },
          { key: 'symbol', label: '符号', required: true, hint: '如 $' },
          { key: 'decimals', label: '小数位', type: 'number', value: 2, min: 0, max: 4 },
          { key: 'rate', label: '参考汇率', type: 'number', value: 1, min: 0, hint: '相对本位币 CNY 的折算率' },
          { key: 'isDefault', label: '设为系统默认币种', type: 'checkbox', value: false },
          { key: 'enabled', label: '启用该币种', type: 'checkbox', value: true, full: true }
        ], data => {
          if (!data.code) { ctx.setFieldError('code', '请填写币种代码'); return false; }
          if (!data.name) { ctx.setFieldError('name', '请填写币种名称'); return false; }
          if (currencies.some(c => c.code.toUpperCase() === data.code.toUpperCase())) { ctx.setFieldError('code', `币种代码 ${data.code} 已存在`); return false; }
          if (data.isDefault) currencies.forEach(c => { c.isDefault = false; });
          currencies.push({ id: uid('C'), ...data, code: data.code.toUpperCase(), decimals: Number(data.decimals), rate: Number(data.rate) });
          pushLog('基础数据', '新增', `币种 ${data.code.toUpperCase()}`, `新增币种 ${data.name}`);
          ctx.toast(`币种已新增：${data.name}`);
          ctx.rerender();
          return true;
        });
      } else if (tab === '付款主体') {
        ctx.openForm('新增付款主体', [
          { key: 'code', label: '主体代码', required: true },
          { key: 'name', label: '主体名称', required: true },
          { key: 'taxNo', label: '税号', required: true },
          { key: 'bank', label: '开户行', required: true },
          { key: 'currency', label: '默认币种', type: 'select', value: 'CNY', options: currencies.map(c => c.code) },
          { key: 'enabled', label: '启用该付款主体', type: 'checkbox', value: true, full: true }
        ], data => {
          if (!data.code) { ctx.setFieldError('code', '请填写主体代码'); return false; }
          if (!data.name) { ctx.setFieldError('name', '请填写主体名称'); return false; }
          if (!data.taxNo) { ctx.setFieldError('taxNo', '请填写税号'); return false; }
          payees.push({ id: uid('P'), ...data });
          pushLog('基础数据', '新增', `付款主体 ${data.code}`, `新增 ${data.name}`);
          ctx.toast(`付款主体已新增：${data.name}`);
          ctx.rerender();
          return true;
        });
      } else {
        ctx.openForm('新增发票类型', [
          { key: 'code', label: '类型代码', required: true },
          { key: 'name', label: '类型名称', required: true },
          { key: 'scope', label: '适用费用', required: true, hint: '如：海运费' },
          { key: 'taxRate', label: '税率(%)', type: 'number', value: 6, min: 0, max: 100 },
          { key: 'enabled', label: '启用该发票类型', type: 'checkbox', value: true, full: true }
        ], data => {
          if (!data.code) { ctx.setFieldError('code', '请填写类型代码'); return false; }
          if (!data.name) { ctx.setFieldError('name', '请填写类型名称'); return false; }
          invoiceTypes.push({ id: uid('I'), ...data, taxRate: Number(data.taxRate) });
          pushLog('基础数据', '新增', `发票类型 ${data.code}`, `新增 ${data.name}`);
          ctx.toast(`发票类型已新增：${data.name}`);
          ctx.rerender();
          return true;
        });
      }
    };

    document.querySelectorAll('[data-cur-edit]').forEach(b => b.onclick = () => {
      const c = currencies.find(x => x.id === b.dataset.curEdit);
      ctx.openForm('编辑币种', [
        { key: 'code', label: '币种代码', value: c.code, required: true },
        { key: 'name', label: '币种名称', value: c.name, required: true },
        { key: 'symbol', label: '符号', value: c.symbol, required: true },
        { key: 'decimals', label: '小数位', type: 'number', value: c.decimals, min: 0, max: 4 },
        { key: 'rate', label: '参考汇率', type: 'number', value: c.rate, min: 0 },
        { key: 'isDefault', label: '设为系统默认币种', type: 'checkbox', value: c.isDefault },
        { key: 'enabled', label: '启用该币种', type: 'checkbox', value: c.enabled, full: true }
      ], data => {
        if (!data.code) { ctx.setFieldError('code', '请填写币种代码'); return false; }
        if (!data.name) { ctx.setFieldError('name', '请填写币种名称'); return false; }
        if (currencies.some(x => x.code.toUpperCase() === data.code.toUpperCase() && x.id !== c.id)) { ctx.setFieldError('code', `币种代码 ${data.code} 已存在`); return false; }
        if (data.isDefault) currencies.forEach(x => { x.isDefault = false; });
        Object.assign(c, data, { code: data.code.toUpperCase(), decimals: Number(data.decimals), rate: Number(data.rate) });
        pushLog('基础数据', '修改', `币种 ${c.code}`, `更新币种 ${c.name}`);
        ctx.toast(`币种已更新：${c.name}`);
        ctx.rerender();
        return true;
      });
    });
    document.querySelectorAll('[data-cur-toggle]').forEach(b => b.onclick = () => {
      const c = currencies.find(x => x.id === b.dataset.curToggle);
      c.enabled = !c.enabled;
      pushLog('基础数据', c.enabled ? '启用' : '停用', `币种 ${c.code}`, '');
      ctx.toast(c.enabled ? `币种已启用：${c.code}` : `币种已停用：${c.code}`, c.enabled ? 'success' : 'warn');
      ctx.rerender();
    });
    document.querySelectorAll('[data-cur-del]').forEach(b => b.onclick = () => {
      const c = currencies.find(x => x.id === b.dataset.curDel);
      ctx.openForm('删除币种', [
        { key: 'confirm', label: `确定要删除「${c.code} ${c.name}」吗？`, type: 'checkbox', value: false, hint: '若已被业务单据引用，正式环境将拒绝删除并仅允许停用', full: true }
      ], data => {
        if (!data.confirm) { ctx.setFieldError('confirm', '请勾选确认后再删除'); return false; }
        currencies = currencies.filter(x => x.id !== c.id);
        pushLog('基础数据', '删除', `币种 ${c.code}`, '删除币种');
        ctx.toast(`币种已删除：${c.code}`);
        ctx.rerender();
        return true;
      }, { submitText: '确认删除', danger: true });
    });

    document.querySelectorAll('[data-pay-edit]').forEach(b => b.onclick = () => {
      const p = payees.find(x => x.id === b.dataset.payEdit);
      ctx.openForm('编辑付款主体', [
        { key: 'code', label: '主体代码', value: p.code, required: true },
        { key: 'name', label: '主体名称', value: p.name, required: true },
        { key: 'taxNo', label: '税号', value: p.taxNo, required: true },
        { key: 'bank', label: '开户行', value: p.bank, required: true },
        { key: 'currency', label: '默认币种', type: 'select', value: p.currency, options: currencies.map(c => c.code) },
        { key: 'enabled', label: '启用该付款主体', type: 'checkbox', value: p.enabled, full: true }
      ], data => {
        if (!data.code) { ctx.setFieldError('code', '请填写主体代码'); return false; }
        if (!data.name) { ctx.setFieldError('name', '请填写主体名称'); return false; }
        if (!data.taxNo) { ctx.setFieldError('taxNo', '请填写税号'); return false; }
        Object.assign(p, data);
        pushLog('基础数据', '修改', `付款主体 ${p.code}`, `更新 ${p.name}`);
        ctx.toast(`付款主体已更新：${p.name}`);
        ctx.rerender();
        return true;
      });
    });
    document.querySelectorAll('[data-pay-toggle]').forEach(b => b.onclick = () => {
      const p = payees.find(x => x.id === b.dataset.payToggle);
      p.enabled = !p.enabled;
      pushLog('基础数据', p.enabled ? '启用' : '停用', `付款主体 ${p.code}`, '');
      ctx.toast(p.enabled ? `付款主体已启用：${p.code}` : `付款主体已停用：${p.code}`, p.enabled ? 'success' : 'warn');
      ctx.rerender();
    });
    document.querySelectorAll('[data-pay-del]').forEach(b => b.onclick = () => {
      const p = payees.find(x => x.id === b.dataset.payDel);
      ctx.openForm('删除付款主体', [
        { key: 'confirm', label: `确定要删除「${p.code} ${p.name}」吗？`, type: 'checkbox', value: false, hint: '若被账单引用，正式环境将拒绝删除', full: true }
      ], data => {
        if (!data.confirm) { ctx.setFieldError('confirm', '请勾选确认后再删除'); return false; }
        payees = payees.filter(x => x.id !== p.id);
        pushLog('基础数据', '删除', `付款主体 ${p.code}`, '删除付款主体');
        ctx.toast(`付款主体已删除：${p.code}`);
        ctx.rerender();
        return true;
      }, { submitText: '确认删除', danger: true });
    });

    document.querySelectorAll('[data-inv-edit]').forEach(b => b.onclick = () => {
      const i = invoiceTypes.find(x => x.id === b.dataset.invEdit);
      ctx.openForm('编辑发票类型', [
        { key: 'code', label: '类型代码', value: i.code, required: true },
        { key: 'name', label: '类型名称', value: i.name, required: true },
        { key: 'scope', label: '适用费用', value: i.scope, required: true },
        { key: 'taxRate', label: '税率(%)', type: 'number', value: i.taxRate, min: 0, max: 100 },
        { key: 'enabled', label: '启用该发票类型', type: 'checkbox', value: i.enabled, full: true }
      ], data => {
        if (!data.code) { ctx.setFieldError('code', '请填写类型代码'); return false; }
        if (!data.name) { ctx.setFieldError('name', '请填写类型名称'); return false; }
        Object.assign(i, data, { taxRate: Number(data.taxRate) });
        pushLog('基础数据', '修改', `发票类型 ${i.code}`, `更新 ${i.name}`);
        ctx.toast(`发票类型已更新：${i.name}`);
        ctx.rerender();
        return true;
      });
    });
    document.querySelectorAll('[data-inv-toggle]').forEach(b => b.onclick = () => {
      const i = invoiceTypes.find(x => x.id === b.dataset.invToggle);
      i.enabled = !i.enabled;
      pushLog('基础数据', i.enabled ? '启用' : '停用', `发票类型 ${i.code}`, '');
      ctx.toast(i.enabled ? `发票类型已启用：${i.code}` : `发票类型已停用：${i.code}`, i.enabled ? 'success' : 'warn');
      ctx.rerender();
    });
    document.querySelectorAll('[data-inv-del]').forEach(b => b.onclick = () => {
      const i = invoiceTypes.find(x => x.id === b.dataset.invDel);
      ctx.openForm('删除发票类型', [
        { key: 'confirm', label: `确定要删除「${i.code} ${i.name}」吗？`, type: 'checkbox', value: false, hint: '已被历史发票引用时，正式环境将拒绝删除', full: true }
      ], data => {
        if (!data.confirm) { ctx.setFieldError('confirm', '请勾选确认后再删除'); return false; }
        invoiceTypes = invoiceTypes.filter(x => x.id !== i.id);
        pushLog('基础数据', '删除', `发票类型 ${i.code}`, '删除发票类型');
        ctx.toast(`发票类型已删除：${i.code}`);
        ctx.rerender();
        return true;
      }, { submitText: '确认删除', danger: true });
    });
  }

  /* -------------------------------------------------------------------
     5. 操作日志
     ------------------------------------------------------------------- */
  function filteredLogs(query) {
    const f = S.logFilter;
    const q = (query || '').toLowerCase();
    return logs.filter(l => {
      if (f.actor && !l.actor.includes(f.actor)) return false;
      if (f.module && l.module !== f.module) return false;
      if (f.action && l.action !== f.action) return false;
      if (q && !(`${l.target} ${l.detail} ${l.actor} ${l.module}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function renderLogs(query) {
    const rows = filteredLogs(query);
    const mods = [...new Set(logs.map(l => l.module))];
    const acts = [...new Set(logs.map(l => l.action))];
    const body = rows.length ? rows.map(l => `<tr>
      <td><code>${esc(l.time)}</code></td>
      <td>${esc(l.actor)}</td>
      <td>${esc(l.module)}</td>
      <td>${esc(l.action)}</td>
      <td><b>${esc(l.target)}</b></td>
      <td>${esc(l.detail)}</td>
      <td><span class="tag ${l.result === '成功' ? 'green' : 'red'}">${esc(l.result)}</span></td>
    </tr>`).join('') : '';

    return `<section class="panel">
      <div class="panel-head">
        <h2>操作日志</h2>
        <div class="panel-tools">
          <button class="mini" id="logReset">重置筛选</button>
          <button class="btn ghost" id="logExport">导出 CSV</button>
        </div>
      </div>
      <form class="filter-bar" id="logFilter">
        <label><span>操作人</span><input class="input sm" name="actor" value="${esc(S.logFilter.actor)}" placeholder="如：陈亦航"></label>
        <label><span>模块</span><select class="input sm" name="module">
          <option value="">全部模块</option>
          ${mods.map(m => `<option value="${esc(m)}"${S.logFilter.module === m ? ' selected' : ''}>${esc(m)}</option>`).join('')}
        </select></label>
        <label><span>动作</span><select class="input sm" name="action">
          <option value="">全部动作</option>
          ${acts.map(a => `<option value="${esc(a)}"${S.logFilter.action === a ? ' selected' : ''}>${esc(a)}</option>`).join('')}
        </select></label>
        <button class="btn primary sm" type="submit">查询</button>
      </form>
      ${rows.length ? `<div class="table-wrap"><table>
        <caption class="sr-only">操作日志列表</caption>
        <thead><tr><th>时间</th><th>操作人</th><th>模块</th><th>动作</th><th>对象</th><th>详情</th><th>结果</th></tr></thead>
        <tbody>${body}</tbody></table></div>`
        : emptyBox('没有符合条件的日志记录', '请放宽筛选条件或清空关键字后重试。')}
      <p class="foot-note">共 ${rows.length} 条记录（总计 ${logs.length} 条）· 审计日志仅追加，不可编辑或删除</p>
    </section>`;
  }

  function wireLogs(query) {
    const f = document.getElementById('logFilter');
    if (f) f.onsubmit = e => {
      e.preventDefault();
      const d = new FormData(f);
      S.logFilter = { actor: (d.get('actor') || '').trim(), module: d.get('module') || '', action: d.get('action') || '' };
      ctx.rerender();
      ctx.toast(`已按条件筛选，命中 ${filteredLogs(query).length} 条记录`);
    };
    const rs = document.getElementById('logReset');
    if (rs) rs.onclick = () => {
      S.logFilter = { actor: '', module: '', action: '' };
      ctx.rerender();
      ctx.toast('筛选条件已重置', 'warn');
    };
    const ex = document.getElementById('logExport');
    if (ex) ex.onclick = () => {
      const rows = filteredLogs(query);
      if (!rows.length) { ctx.toast('没有可导出的记录，请先调整筛选条件', 'warn'); return; }
      const head = ['时间', '操作人', '模块', '动作', '对象', '详情', '结果'];
      const csv = [head, ...rows.map(l => [l.time, l.actor, l.module, l.action, l.target, l.detail, l.result])]
        .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `操作日志_${today()}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      ctx.toast(`日志已导出，共 ${rows.length} 条记录`);
    };
  }

  /* -------------------------------------------------------------------
     6. 附件策略与数据备份
     ------------------------------------------------------------------- */
  function renderSystem() {
    const a = attachPolicy, b = backupPolicy;
    return `<div class="set-grid">
      <div class="set-main">
        <section class="panel">
          <div class="panel-head"><h2>附件策略</h2><span class="tag blue">即时生效</span></div>
          <div class="form-grid">
            <div class="field"><label for="attMax">单文件大小上限（MB）</label>
              <input class="input" id="attMax" type="number" min="1" max="500" value="${a.maxSize}">
              <small class="field-hint">取值范围 1–500 MB，超出限制的上传将被拒绝。</small>
              <small class="field-error" id="err-attMax" hidden></small></div>
            <div class="field"><label for="attTotal">账号总容量（GB）</label>
              <input class="input" id="attTotal" type="number" min="1" max="100" value="${a.total}">
              <small class="field-hint">超出后禁止上传并提示清理历史附件。</small>
              <small class="field-error" id="err-attTotal" hidden></small></div>
            <div class="field"><label for="attTypes">允许的文件类型</label>
              <input class="input" id="attTypes" value="${esc(a.types)}">
              <small class="field-hint">英文逗号分隔的扩展名，例如 pdf,xlsx,docx。</small>
              <small class="field-error" id="err-attTypes" hidden></small></div>
            <div class="field"><label for="attKeep">附件保留天数</label>
              <input class="input" id="attKeep" type="number" min="30" max="3650" value="${a.retention}">
              <small class="field-hint">到期附件转入归档池，不直接物理删除。</small>
              <small class="field-error" id="err-attKeep" hidden></small></div>
          </div>
          <fieldset class="switches">
            <legend>附加策略</legend>
            <label class="switch"><input type="checkbox" id="attWm"${a.watermark ? ' checked' : ''}><span class="track" aria-hidden="true"><i></i></span><span>导出文件添加水印（含操作人账号）</span></label>
            <label class="switch"><input type="checkbox" id="attVirus"${a.virus ? ' checked' : ''}><span class="track" aria-hidden="true"><i></i></span><span>上传前执行病毒扫描</span></label>
            <label class="switch"><input type="checkbox" id="attOss"${a.oss ? ' checked' : ''}><span class="track" aria-hidden="true"><i></i></span><span>切换为对象存储（需重启生效）</span></label>
          </fieldset>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>数据备份</h2><span class="tag orange">需调度任务配合</span></div>
          <div class="form-grid">
            <div class="field"><label for="bkCycle">备份周期</label>
              <select class="input" id="bkCycle">
                <option value="DAILY"${b.cycle === 'DAILY' ? ' selected' : ''}>每日</option>
                <option value="WEEKLY"${b.cycle === 'WEEKLY' ? ' selected' : ''}>每周</option>
                <option value="MONTHLY"${b.cycle === 'MONTHLY' ? ' selected' : ''}>每月</option>
                <option value="MANUAL"${b.cycle === 'MANUAL' ? ' selected' : ''}>仅手动</option>
              </select></div>
            <div class="field"><label for="bkKeep">备份保留份数</label>
              <input class="input" id="bkKeep" type="number" min="1" max="60" value="${b.keep}">
              <small class="field-hint">超出份数的最旧备份将被清理。</small>
              <small class="field-error" id="err-bkKeep" hidden></small></div>
            <div class="field"><label for="bkTime">执行时间</label>
              <input class="input" id="bkTime" type="time" value="${b.time}">
              <small class="field-hint">仅在备份周期为每日时生效。</small></div>
            <div class="field"><label for="bkScope">备份范围</label>
              <select class="input" id="bkScope">
                <option value="FULL"${b.scope === 'FULL' ? ' selected' : ''}>全量备份</option>
                <option value="CONFIG"${b.scope === 'CONFIG' ? ' selected' : ''}>仅配置数据</option>
                <option value="BUSINESS"${b.scope === 'BUSINESS' ? ' selected' : ''}>仅业务数据</option>
              </select></div>
          </div>
          <div class="btn-row"><button class="btn ghost" id="backupNow">立即备份</button></div>
        </section>
      </div>

      <aside class="set-side">
        <section class="panel">
          <div class="panel-head"><h2>备份记录</h2></div>
          ${backupRecords.length ? `<ul class="timeline">${backupRecords.map(x => `<li class="${x.status === '成功' ? '' : 'fail'}">
            <b>${esc(x.scope)} · ${esc(x.size)}</b>
            <span>${esc(x.time)} · ${esc(x.id)}</span>
            <em class="tag ${x.status === '成功' ? 'green' : 'red'}">${esc(x.status)}</em>
          </li>`).join('')}</ul>`
        : emptyBox('暂无备份记录', '点击「立即备份」创建第一份快照。')}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>环境信息（只读）</h2></div>
          <dl class="desc">
            <dt>系统版本</dt><dd>1.4.0（电脑端演示）</dd>
            <dt>运行环境</dt><dd>浏览器本地模拟数据</dd>
            <dt>时区</dt><dd>Asia/Shanghai</dd>
            <dt>接口状态</dt><dd><span class="tag orange">未接入</span> 前端原型阶段</dd>
          </dl>
        </section>
      </aside>
    </div>`;
  }

  function wireSystem() {
    const bn = document.getElementById('backupNow');
    if (bn) bn.onclick = () => {
      bn.disabled = true; bn.textContent = '备份中…';
      setTimeout(() => {
        const scope = backupPolicy.scope === 'FULL' ? '全量备份' : backupPolicy.scope === 'CONFIG' ? '仅配置数据' : '仅业务数据';
        backupRecords.unshift({ id: uid('B'), time: nowStamp(), scope, size: (1.2 + Math.random() * 0.1).toFixed(2) + ' GB', status: '成功' });
        pushLog('操作日志', '备份', '手动备份', '手动触发备份');
        ctx.toast('备份完成（接口占位 POST /api/settings/backup）');
        if (typeof ctx.rerender === 'function') ctx.rerender();
        else {
          const el = document.getElementById('content');
          if (el) el.innerHTML = render('附件与备份', '');
        }
      }, 650);
    };
  }

  function saveSystem() {
    const maxSize = Number(document.getElementById('attMax').value);
    const total = Number(document.getElementById('attTotal').value);
    const types = document.getElementById('attTypes').value.trim();
    const keep = Number(document.getElementById('attKeep').value);
    const bkKeep = Number(document.getElementById('bkKeep').value);

    const fail = (id, msg) => {
      const box = document.getElementById('err-' + id);
      if (box) { box.textContent = msg; box.hidden = false; }
      const input = document.getElementById(id);
      if (input) input.classList.add('invalid');
      ctx.toast('保存失败：' + msg, 'error');
    };
    const clear = () => {
      document.querySelectorAll('.field-error').forEach(e => { e.hidden = true; e.textContent = ''; });
      document.querySelectorAll('.invalid').forEach(e => e.classList.remove('invalid'));
    };
    clear();

    if (!maxSize || maxSize < 1 || maxSize > 500) { fail('attMax', '单文件上限取值范围为 1–500 MB'); return; }
    if (!total || total < 1 || total > 100) { fail('attTotal', '账号总容量取值范围为 1–100 GB'); return; }
    if (!types) { fail('attTypes', '请至少填写一种允许的文件类型'); return; }
    if (!keep || keep < 30 || keep > 3650) { fail('attKeep', '附件保留天数取值范围为 30–3650 天'); return; }
    if (!bkKeep || bkKeep < 1 || bkKeep > 60) { fail('bkKeep', '备份保留份数取值范围为 1–60 份'); return; }

    attachPolicy.maxSize = maxSize; attachPolicy.total = total; attachPolicy.types = types;
    attachPolicy.retention = keep;
    attachPolicy.watermark = document.getElementById('attWm').checked;
    attachPolicy.virus = document.getElementById('attVirus').checked;
    attachPolicy.oss = document.getElementById('attOss').checked;
    backupPolicy.cycle = document.getElementById('bkCycle').value;
    backupPolicy.keep = bkKeep;
    backupPolicy.time = document.getElementById('bkTime').value;
    backupPolicy.scope = document.getElementById('bkScope').value;

    pushLog('操作日志', '修改', '附件与备份策略', '更新附件上限、类型与备份周期');
    ctx.toast('设置已保存（接口占位 PUT /api/settings/system/policy）');
  }

  /* -------------------------------------------------------------------
     出口
     ------------------------------------------------------------------- */
  const TABS = ['用户与权限', '提醒规则', 'SO 识别规则', '基础数据', '操作日志', '附件与备份', '数据存储'];

  function render(tab, query) {
    switch (tab) {
      case '数据存储': return window.LocalData.render();
      case '提醒规则': return renderRules(query);
      case 'SO 识别规则': return renderSo();
      case '基础数据': return renderMaster();
      case '操作日志': return renderLogs(query);
      case '附件与备份': return renderSystem();
      default: return renderPerms();
    }
  }

  function wire(tab, query, host) {
    // 合并宿主函数，保留 rerender 等内部能力
    bindHost(host);
    // 稳定的重渲染入口：异步回调（备份等）也能安全调用
    ctx.rerender = () => {
      const el = document.getElementById('content');
      if (!el) return;
      el.innerHTML = render(tab, query);
      wire(tab, query, null);
    };
    if (tab === '数据存储') window.LocalData.wire(ctx);
    else if (tab === '提醒规则') wireRules(query);
    else if (tab === 'SO 识别规则') wireSo();
    else if (tab === '基础数据') wireMaster();
    else if (tab === '操作日志') wireLogs(query);
    else if (tab === '附件与备份') wireSystem();
    else wirePerms();
  }

  function saveCurrent(tab, host) {
    // 合并宿主函数，保留 rerender 等内部能力（不可整体替换 ctx）
    bindHost(host);
    if (tab === '数据存储') { window.LocalData.saveNow(); return; }
    if (tab === '用户与权限') savePerms();
    else if (tab === 'SO 识别规则') {
      const sv = document.getElementById('soSave');
      if (sv) sv.onclick();
    } else if (tab === '附件与备份') saveSystem();
    else ctx.toast('当前分区无需额外保存，操作已即时生效', 'warn');
  }

  function bindHost(host) {
    if (host) {
      ctx = Object.assign({}, ctx, host);
      if (host.toast) ctx.hostToast = host.toast;
    }
    ctx.toast = (message, kind = 'success') => ctx.hostToast(
      settingsSaveFailed && kind === 'success' ? '设置本地保存失败，本次修改仅在当前页面保留' : message,
      settingsSaveFailed && kind === 'success' ? 'error' : kind
    );
  }

  try { if (!localStorage.getItem(SETTINGS_KEY)) persistSettings(); } catch (error) {}
  return { render, wire, saveCurrent, TABS };
})();
