'use strict';

/* =====================================================================
   航务通 · 货代业务管理系统 —— 主壳
   侧栏仅保留「工作台」「系统设置」两个模块
   页头仅保留标题与主操作按钮，统计卡与原业务卡片区已按要求移除
   ===================================================================== */

const modules = [
  { id: 'dashboard', icon: '▦', name: '工作台', en: 'Dashboard', desc: '订单、船期、待办和收付款，一页掌握。', action: '新建待办' },
  { id: 'settings', icon: '⚙', name: '系统设置', en: 'Settings', desc: '权限、规则、基础数据、日志和备份。', action: '保存设置' }
];

/* 工作台选项卡（原页头统计卡已按要求移除，仅保留选项卡切换内容） */
const DASH_SCOPES = ['全部', '今日待办', '即将截单', '即将到港'];

/* ---------------------------------------------------------------------
   订单流程节点：放舱 / 补料 / 等上船 / 应付 / 应收 / 电放
   各节点独立记录当前状态；等待状态不代表已经完成
   --------------------------------------------------------------------- */
const FLOW_STAGES = [
  { key: 'booking', name: '放舱', states: ['待放舱', '已放舱'] },
  { key: 'si', name: '补料', states: ['待补料', '补料中', '已补料'] },
  { key: 'onboard', name: '等上船', states: ['等上船', '已上船'] },
  { key: 'payable', name: '应付', states: ['待做 PM', '已做 PM', '等船司开票', '等财务付款', '应付已结清'] },
  { key: 'receivable', name: '应收', states: ['等客人确认账单', '等客人付款', '应收已结清'] },
  { key: 'telex', name: '电放', states: ['等客人给电放保函', '等给上家 / 船司保函', '电放已完成'] }
];

/* 订单清单：提单号 / SO号 / 工作号 / 起运港 / 目的港 / 截单 / 截关港 / ETD / ETA / 船名航次 / 销售 */
const ORDER_SEED = [
  { bl: 'BL-2026-0087', so: 'SO-2026-001', wo: 'WO-2026-0311', pol: 'CNSHA 上海', pod: 'USLAX 洛杉矶',
    cutoff: '10/23 17:00', cutport: '10/24 12:00', etd: '10/24', eta: '11/08',
    vessel: 'COSCO SHIPPING / 126E', sales: '李敏', status: '进行中' },
  { bl: 'BL-2026-0092', so: 'SO-2026-002', wo: 'WO-2026-0318', pol: 'CNSHA 上海', pod: 'NLRTM 鹿特丹',
    cutoff: '10/25 17:00', cutport: '10/26 12:00', etd: '10/26', eta: '11/18',
    vessel: 'EVER GIVEN / 028W', sales: '周航', status: '待补料' },
  { bl: 'BL-2026-0096', so: 'SO-2026-003', wo: 'WO-2026-0322', pol: 'CNSHA 上海', pod: 'DEHAM 汉堡',
    cutoff: '10/22 17:00', cutport: '10/23 12:00', etd: '10/23', eta: '11/22',
    vessel: 'ONE TRUST / 061E', sales: '陈亦航', status: '异常' },
  { bl: 'BL-2026-0081', so: 'SO-2026-004', wo: 'WO-2026-0295', pol: 'CNNGB 宁波', pod: 'SGSIN 新加坡',
    cutoff: '10/15 17:00', cutport: '10/16 12:00', etd: '10/16', eta: '10/20',
    vessel: 'MAERSK LIMA / 044W', sales: '李敏', status: '已完成' }
];

const STORE_KEY = 'hangwutong.workspace.v1';
const HOUR = 3600000;
const newId = () => 'id-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));

// 所有业务时间统一按上海时间解析，完整年份保证跨年排序、提醒正确。
function businessNow() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(' ', 'T');
}
function dateValue(value) {
  if (!value || value === '待定') return NaN;
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value)) return NaN;
  return Date.parse(value.length === 10 ? value + 'T00:00:00+08:00' : value + ':00+08:00');
}
function dateText(value) { return value ? esc(String(value).replace('T', ' ')) : '待定'; }
function seedDate(value) {
  return /^\d{2}\/\d{2}/.test(value || '') ? '2026-' + value.replace('/', '-').replace(' ', 'T') : value || '';
}
function loadWorkspace() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || !Array.isArray(saved.orders) || !Array.isArray(saved.todos)) throw new Error('无效数据');
    if (!saved.orders.every(o => o && typeof o.id === 'string' && typeof o.so === 'string' && typeof o.sales === 'string') || !saved.todos.every(t => t && typeof t.id === 'string' && typeof t.title === 'string')) throw new Error('无效数据');
    return saved;
  } catch (error) {
    window.workspaceLoadError = true;
    return null;
  }
}
const restored = loadWorkspace();
const ORDER_LIST = restored ? restored.orders : ORDER_SEED.map(o => ({ ...o, id: newId(), bookingConfirmed: true, siConfirmed: o.status !== '待补料', cutoff: seedDate(o.cutoff), cutport: seedDate(o.cutport), etd: seedDate(o.etd), eta: seedDate(o.eta), cutoffDone: o.status === '已完成', cutportDone: o.status === '已完成', remark: '' }));
const TODO_LIST = restored ? restored.todos : [];
let state = { module: 'dashboard', filter: '全部', query: '', saved: 0, settingsTab: '用户与权限', expanded: null };
const SYNC_KEY = 'hangwutong.sailing-sync.v1';
let syncConfig = { endpoint: '', lastSuccess: '', lastSummary: '', autoAnchor: 0, lastAttempt: 0 };
try {
  const saved = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null');
  if (saved && typeof saved.endpoint === 'string') syncConfig = { ...syncConfig, ...saved };
} catch (error) { /* 未配置时保持空地址，不发起请求。 */ }
let syncBusy = false;

function persistWorkspace() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, orders: ORDER_LIST, todos: TODO_LIST }));
    window.LocalData?.changed();
    $('#storageStatus').textContent = window.LocalData?.status().text || '已保存在此浏览器 · 上海时间';
    $('#storageStatus').classList.toggle('storage-error', !!window.LocalData?.status().error);
    return true;
  } catch (error) {
    $('#storageStatus').textContent = '本地保存失败，请勿关闭页面';
    $('#storageStatus').classList.add('storage-error');
    toast('浏览器无法保存数据，本次修改仅在当前页面保留', 'error');
    return false;
  }
}

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function tag(status) {
  const cls = status.includes('异常') || status.includes('逾期') ? 'red'
    : status.includes('完成') || status.includes('收款') ? 'green'
      : status.includes('待') ? 'orange' : 'blue';
  return `<span class="tag ${cls}">${esc(status)}</span>`;
}

function money(n) { return '¥ ' + n.toLocaleString('zh-CN'); }

/* ---------------------------------------------------------------------
   流程节点：默认进度按订单状态推导，首次访问时生成
   --------------------------------------------------------------------- */
function flowOf(o) {
  if (!o.flow || Array.isArray(o.flow.booking)) {
    const done = o.status === '已完成';
    o.flow = Object.fromEntries(FLOW_STAGES.map(s => [s.key, done ? s.states.at(-1) : s.states[0]]));
    if (!done && o.bookingConfirmed) o.flow.booking = '已放舱';
    if (!done && o.siConfirmed) o.flow.si = '已补料';
  }
  FLOW_STAGES.forEach(s => { if (!s.states.includes(o.flow[s.key])) o.flow[s.key] = s.states[0]; });
  return o.flow;
}
function orderStatus(o) {
  const f = flowOf(o);
  if (FLOW_STAGES.every(s => f[s.key] === s.states.at(-1))) return '已完成';
  if (o.status === '异常') return '异常';
  return f.si !== '已补料' ? '待补料' : '进行中';
}
function currentNode(o) {
  const f = flowOf(o);
  const active = FLOW_STAGES.filter(s => f[s.key] !== s.states.at(-1));
  return active.length ? active.map(s => f[s.key]).join(' · ') : '全部完成';
}
function deadlineReminders(now = Date.now()) {
  return ORDER_LIST.flatMap(o => orderStatus(o) === '已完成' ? [] : [
    { key: 'cutoff', flag: 'cutoffDone', name: '截单' },
    { key: 'cutport', flag: 'cutportDone', name: '截关 / 港' }
  ].flatMap(d => {
    const at = dateValue(o[d.key]);
    if (o[d.flag] || !Number.isFinite(at) || at - now > 24 * HOUR) return [];
    return [{ id: o.id + '-' + d.key, order: o, ...d, at, overdue: at < now }];
  })).sort((a, b) => a.at - b.at);
}


/* ---------------------------------------------------------------------
   Toast：支持成功 / 失败 / 提醒三种反馈
   --------------------------------------------------------------------- */
function toast(msg, kind = 'success') {
  const el = $('#toast');
  el.className = 'toast toast-' + kind;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.classList.remove('show'); }, 2400);
}

/* ---------------------------------------------------------------------
   弹窗：支持类型化字段与逐字段校验
   fields: [{ key, label, type, value, options, required, hint, full }]
   --------------------------------------------------------------------- */
let modalSubmitHandler = null;

function openForm(title, fields, onSubmit, opts = {}) {
  $('#modalTitle').textContent = title;
  $('#modal').classList.toggle('wide', !!opts.wide);
  const grid = fields.map(f => {
    const id = `mf-${f.key}`;
    const req = f.required ? ' required' : '';
    let control;
    if (f.type === 'select') {
      control = `<select id="${id}" name="${f.key}"${req}>${(f.options || []).map(o => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return `<option value="${esc(v)}"${String(v) === String(f.value) ? ' selected' : ''}>${esc(l)}</option>`;
      }).join('')}</select>`;
    } else if (f.type === 'textarea') {
      control = `<textarea id="${id}" name="${f.key}" rows="3"${req}>${esc(f.value == null ? '' : f.value)}</textarea>`;
    } else if (f.type === 'checkbox') {
      control = `<label class="inline-check"><input type="checkbox" id="${id}" name="${f.key}"${f.value ? ' checked' : ''}><span>${f.hint || ''}</span></label>`;
    } else {
      const min = f.min != null ? ` min="${f.min}"` : '';
      const max = f.max != null ? ` max="${f.max}"` : '';
      control = `<input id="${id}" name="${f.key}" type="${f.type || 'text'}" value="${esc(f.value == null ? '' : f.value)}"${req}${min}${max}>`;
    }
    return `<div class="field${f.full ? ' full' : ''}">
      <label for="${id}">${f.label}${f.required ? ' <span class="req">*</span>' : ''}</label>
      ${control}
      ${f.hint && f.type !== 'checkbox' ? `<small class="field-hint">${f.hint}</small>` : ''}
      <small class="field-error" id="err-${f.key}" hidden></small>
    </div>`;
  }).join('');

  $('#modalBody').innerHTML = `${opts.bodyHtml || ''}${
    fields.length ? `<div class="form-grid">${grid}</div>` : ''}`;

  const save = $('#modalSave');
  save.textContent = opts.submitText || '保存';
  save.className = 'btn ' + (opts.danger ? 'danger' : 'primary');
  $('#modalCancel').hidden = !!opts.hideCancel;
  modalSubmitHandler = onSubmit;
  if (typeof opts.wire === 'function') opts.wire();
  $('#modal').showModal();
  const first = $('#modalBody input, #modalBody select, #modalBody textarea');
  if (first) setTimeout(() => first.focus(), 40);
}

function closeModal() {
  const dlg = $('#modal');
  if (dlg.open) dlg.close();
  modalSubmitHandler = null;
}

function setFieldError(key, msg) {
  const box = $(`#err-${key}`);
  if (box) { box.textContent = msg; box.hidden = false; }
  const input = $(`#mf-${key}`);
  if (input) input.classList.add('invalid');
  // 字段级错误同时给出 toast 反馈，避免用户在弹窗中看不到原因
  toast(msg, 'error');
}

function readModalForm() {
  const out = {};
  $$('#modalBody input, #modalBody select, #modalBody textarea').forEach(el => {
    if (!el.name) return;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
  });
  return out;
}

/* ---------------------------------------------------------------------
   渲染
   --------------------------------------------------------------------- */
function renderNav() {
  $('#nav').innerHTML = modules.map(m => `<button class="nav-btn ${m.id === state.module ? 'active' : ''}" data-id="${m.id}" title="${m.name}">
    <span class="nav-icon" aria-hidden="true">${m.icon}</span><span class="nav-text">${m.name}</span></button>`).join('');
  $$('.nav-btn').forEach(b => b.onclick = () => {
    state.module = b.dataset.id;
    state.filter = state.module === 'settings' ? state.settingsTab : '全部';
    state.query = '';
    $('#search').value = '';
    if (sidebarIsDrawer() && $('#sidebar').classList.contains('expanded')) setSidebar(false);
    render();
  });
}

function renderHead(m) {
  $('#eyebrow').textContent = m.en;
  $('#pageTitle').textContent = m.name;
  $('#pageDesc').textContent = m.desc;
  $('#primaryBtn').textContent = (m.id === 'settings' ? '' : '＋ ') + m.action;
  $('#search').parentElement.hidden = m.id !== 'settings';
  $('#storageStatus').hidden = false;
  if (m.id === 'settings' && window.settingsLoadError) {
    $('#storageStatus').hidden = false;
    $('#storageStatus').textContent = '设置数据读取失败，当前显示示例';
    $('#storageStatus').classList.add('storage-error');
  }
}

/** 页头统计条已按要求移除 */

function filters(list) {
  $('#filters').innerHTML = list.map(x => `<button class="chip ${state.filter === x ? 'active' : ''}" data-filter="${x}">${x}</button>`).join('');
  if (state.module === 'dashboard') {
    $('#filters').insertAdjacentHTML('beforeend', `<div class="sync-actions"><button type="button" class="chip sync-refresh" id="sailingRefresh"${syncBusy ? ' disabled' : ''} title="${syncConfig.endpoint ? '查询并更新订单 ETD / ETA' : '地址待配置'}">${syncBusy ? '刷新中…' : '↻ 刷新维运网'}</button><button type="button" class="sync-config" id="sailingConfig" aria-label="维运网刷新设置" title="维运网刷新设置"${syncBusy ? ' disabled' : ''}>⚙</button></div>`);
    $('#sailingRefresh').onclick = refreshSailings;
    $('#sailingConfig').onclick = configureSailingSync;
  }
  $$('[data-filter]').forEach(b => b.onclick = () => {
    state.filter = b.dataset.filter;
    if (state.module === 'settings') state.settingsTab = b.dataset.filter;
    renderContent();
    // 工作台 / 订单清单内容被重写后需重新绑定行内交互
  });
}

function renderContent() {
  if (state.module === 'settings') {
    // 设置页的分区标签由 SettingsPage 提供
    filters(window.SettingsPage.TABS);
    const html = window.SettingsPage.render(state.settingsTab, state.query);
    $('#content').innerHTML = html;
    window.SettingsPage.wire(state.settingsTab, state.query, {
      toast, openForm, closeModal, tag, money, setFieldError, readModalForm
    });
  } else {
    $('#content').innerHTML = dashboard();
    wireDashboard();
    sizeDetails();
  }
}

function relevantTodos(now = Date.now()) {
  const endToday = dateValue(businessNow().slice(0, 10)) + 24 * HOUR;
  return TODO_LIST.filter(t => !t.done && (!t.due || dateValue(t.due) < endToday)).sort((a, b) => (dateValue(a.due) || Infinity) - (dateValue(b.due) || Infinity));
}

function dashboard() {
  filters(DASH_SCOPES);
  const now = Date.now();
  let rows = ORDER_LIST;
  let hint = '点击订单行任意位置展开详情，再次点击收起。';
  if (state.filter === '今日待办') {
    const reminders = deadlineReminders(now);
    const due = relevantTodos(now);
    return `<div class="panel"><div class="panel-head"><h2>今日待办</h2><span>${reminders.length + due.length} 项待处理</span></div>
      <p class="list-hint">含今日及逾期待办、进入截止前 24 小时的未办事项；勾选截止事项后停止提醒。</p>
      ${reminderTable(reminders)}${todoTable(due)}
      <details class="other-todos"><summary>后续待办 / 已完成（${TODO_LIST.length - due.length}）</summary>${todoTable(TODO_LIST.filter(t => !due.includes(t)), true)}</details></div>`;
  }
  if (state.filter === '即将截单') {
    const ids = new Set(deadlineReminders(now).map(r => r.order.id));
    rows = ORDER_LIST.filter(o => ids.has(o.id)).sort((a, b) => nextDeadline(a) - nextDeadline(b));
    hint = '截单或截关 / 港进入截止前 24 小时；未完成的逾期事项继续显示，按最早截止时间排序。';
  } else if (state.filter === '即将到港') {
    const todayStart = dateValue(businessNow().slice(0, 10));
    rows = ORDER_LIST.filter(o => orderStatus(o) !== '已完成' && dateValue(o.eta) >= todayStart && dateValue(o.eta) < todayStart + 48 * HOUR).sort((a, b) => dateValue(a.eta) - dateValue(b.eta));
    hint = '展示今天和明天预计到港的未完结订单，按 ETA 升序。';
  }
  return `<div class="panel">
    <div class="panel-head"><h2>${state.filter === '全部' ? '订单清单' : state.filter}</h2>
      <div class="panel-tools"><span>${rows.length} 票</span><button type="button" class="mini" id="newOrder">＋ 新建订单</button></div></div>
    <p class="list-hint">${hint}</p>${orderTable(rows)}
  </div>`;
}
function nextDeadline(o) {
  return Math.min(o.cutoffDone ? Infinity : dateValue(o.cutoff) || Infinity, o.cutportDone ? Infinity : dateValue(o.cutport) || Infinity);
}

function orderTable(rows) {
  if (!rows.length) return '<div class="empty"><h3>暂无匹配订单</h3><p>请切换其他选项卡查看。</p></div>';
  return `<div class="table-wrap"><table class="order-list">
      <caption class="sr-only">订单清单</caption>
      <thead><tr>
        <th>提单号</th><th>SO 号</th><th>工作号</th><th>起运港</th><th>目的港</th>
        <th>截单时间</th><th>截关 / 港时间</th><th>ETD</th><th>ETA</th><th>船名 / 航次</th>
        <th>销售</th><th>当前节点</th><th>状态</th><th class="ra">操作</th>
      </tr></thead>
      <tbody>${rows.map(o => `<tr class="order-row${state.expanded === o.id ? ' expanded' : ''}" data-order-row="${esc(o.id)}" tabindex="0" aria-expanded="${state.expanded === o.id}" aria-controls="detail-${esc(o.id)}" aria-label="${esc(o.so)}，点击展开或收起详情">
        <td><span class="row-arrow" aria-hidden="true">${state.expanded === o.id ? '▾' : '▸'}</span><code>${esc(o.bl || '待补')}</code></td>
        <td><b>${esc(o.so)}</b></td><td><code>${esc(o.wo || '待补')}</code></td>
        <td>${esc(o.pol)}</td><td>${esc(o.pod)}</td>
        <td class="num">${dateText(o.cutoff)}${o.cutoffDone ? '<small class="done-label">✓ 已完成</small>' : ''}</td>
        <td class="num">${dateText(o.cutport)}${o.cutportDone ? '<small class="done-label">✓ 已完成</small>' : ''}</td>
        <td class="num">${dateText(o.etd)}</td><td class="num">${dateText(o.eta)}</td>
        <td>${esc(o.vessel || '待定')}</td><td>${esc(o.sales)}</td>
        <td><span class="node" title="${esc(currentNode(o))}">${esc(currentNode(o))}</span></td>
        <td>${tag(orderStatus(o))}</td>
        <td class="row-actions">
          <button type="button" class="mini" data-order-view="${esc(o.id)}">${state.expanded === o.id ? '收起' : '详情'}</button>
          <button type="button" class="mini" data-order-edit="${esc(o.id)}">编辑</button>
        </td>
      </tr><tr class="order-detail-row" id="detail-${esc(o.id)}"${state.expanded === o.id ? '' : ' hidden'}><td colspan="14">${state.expanded === o.id ? detailHtml(o) : ''}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

/** 今日待办列表 */
function todoTable(rows, other = false) {
  if (!rows.length) return `<div class="empty todo-empty"><p>${other ? '暂无后续或已完成待办' : '暂无需要处理的手工待办'}</p></div>`;
  return `<div class="panel-body"><div class="steps">${rows.map(r => `<div class="step ${r.done ? 'done' : dateValue(r.due) < Date.now() ? 'late' : ''}">
    <input type="checkbox" data-todo="${esc(r.id)}" aria-label="完成待办 ${esc(r.title)}"${r.done ? ' checked' : ''}>
    <div><strong>${esc(r.title)}</strong><small>${esc(r.owner)} · ${dateText(r.due)}${r.so ? ' · ' + esc(r.so) : ''}</small>${r.note ? `<p class="todo-note">${esc(r.note)}</p>` : ''}</div>
    ${tag(r.done ? '已完成' : dateValue(r.due) < Date.now() ? '已逾期' : '待处理')}
  </div>`).join('')}</div></div>`;
}
function reminderTable(rows) {
  return rows.length ? `<div class="panel-body reminder-list"><h3>截止提醒</h3>${rows.map(r => `<label class="deadline-item${r.overdue ? ' overdue' : ''}"><input type="checkbox" data-reminder-order="${esc(r.order.id)}" data-reminder-flag="${r.flag}" aria-label="完成 ${esc(r.order.so)} ${r.name}"><span><b>${esc(r.order.so)} · ${r.name}</b><small>${dateText(r.order[r.key])} · ${r.overdue ? '已逾期，待处理' : '24 小时内截止'}</small></span></label>`).join('')}</div>` : '<p class="list-hint">暂无截止提醒。</p>';
}
function sizeDetails() {
  const wrap = $('#content .table-wrap');
  if (wrap) wrap.style.setProperty('--detail-width', Math.max(0, wrap.clientWidth - 24) + 'px');
}

function render() {
  const m = modules.find(x => x.id === state.module);
  renderNav();
  renderHead(m);
  renderContent();
}

/** 订单详情的元信息 + 流程节点 HTML */
function detailHtml(o) {
  return `<div class="order-detail-inner">
    <div class="detail-heading"><div><h3>${esc(o.so)} · 订单详情</h3><p>${esc(o.pol)} → ${esc(o.pod)} · ${esc(o.vessel || '船名待补')} · 销售 ${esc(o.sales)}</p></div><button type="button" class="mini" data-order-edit="${esc(o.id)}">编辑订单</button></div>
    <div class="detail-deadlines">
      <label class="deadline-item"><input type="checkbox" data-deadline="cutoffDone" data-order="${esc(o.id)}"${o.cutoffDone ? ' checked' : ''}><span><b>截单已完成</b><small>${dateText(o.cutoff)}</small></span></label>
      <label class="deadline-item"><input type="checkbox" data-deadline="cutportDone" data-order="${esc(o.id)}"${o.cutportDone ? ' checked' : ''}><span><b>截关 / 港已完成</b><small>${dateText(o.cutport)}</small></span></label>
      <div class="vessel-query"><a href="https://weiyun001.com/" target="_blank" rel="noopener noreferrer">维运网查询 ↗</a><small>船名 / 航次：${esc(o.vessel || '待补')}<br>ETD ${dateText(o.etd)} · ETA ${dateText(o.eta)}<br>查询后可在“编辑订单”更新船期</small></div>
    </div>
    <div class="flow-head"><h3>流程状态</h3><span class="note">六个节点可独立更新；选择即保存</span></div>
    <ol class="flow flow-grid">${flowItems(o)}</ol>
    <div class="order-remark"><label for="remark-${esc(o.id)}">异常备注</label><textarea id="remark-${esc(o.id)}" data-remark="${esc(o.id)}" rows="2" placeholder="记录这票订单的异常情况">${esc(o.remark || '')}</textarea><button type="button" class="mini" data-remark-save="${esc(o.id)}">保存备注</button><small data-remark-status="${esc(o.id)}" role="status"></small></div>
  </div>`;
}

/** 六个节点的列表项 */
function flowItems(o) {
  const f = flowOf(o);
  return FLOW_STAGES.map((s, i) => {
    const done = f[s.key] === s.states.at(-1);
    return `<li class="flow-step ${done ? 'done' : 'doing'}">
      <span class="flow-dot" aria-hidden="true">${done ? '✓' : i + 1}</span>
      <div class="flow-body">
        <label class="flow-title" for="flow-${esc(o.id)}-${s.key}"><b>${s.name}</b><span class="tag ${done ? 'green' : 'orange'}">${done ? '已完成' : '待跟进'}</span></label>
        <select id="flow-${esc(o.id)}-${s.key}" data-flow="${s.key}" data-order="${esc(o.id)}" aria-label="${s.name}当前状态">${s.states.map(v => `<option${v === f[s.key] ? ' selected' : ''}>${v}</option>`).join('')}</select>
      </div>
    </li>`;
  }).join('');
}

/** 勾选后重绘节点列表并重新绑定（保持弹窗打开） */
function rerenderWorkspace(focusId) {
  const wrap = $('#content .table-wrap');
  const scrollLeft = wrap?.scrollLeft || 0;
  renderContent();
  const nextWrap = $('#content .table-wrap');
  if (nextWrap) nextWrap.scrollLeft = scrollLeft;
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

/** 工作台 / 订单清单：行内「详情」「推进」交互 */
function wireDashboard() {
  const toggle = id => {
    state.expanded = state.expanded === id ? null : id;
    rerenderWorkspace();
    $$('[data-order-row]').find(row => row.dataset.orderRow === id)?.focus({ preventScroll: true });
  };
  $$('[data-order-row]').forEach(row => {
    row.onclick = e => { if (!e.target.closest('button, a, input, select, textarea')) toggle(row.dataset.orderRow); };
    row.onkeydown = e => { if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(row.dataset.orderRow); } };
  });
  $$('[data-order-view]').forEach(b => b.onclick = () => toggle(b.dataset.orderView));
  $$('[data-order-edit]').forEach(b => b.onclick = () => editOrder(ORDER_LIST.find(o => o.id === b.dataset.orderEdit)));
  if ($('#newOrder')) $('#newOrder').onclick = () => editOrder();
  $$('[data-flow]').forEach(el => el.onchange = () => {
    const o = ORDER_LIST.find(o => o.id === el.dataset.order);
    flowOf(o)[el.dataset.flow] = el.value;
    const saved = persistWorkspace();
    rerenderWorkspace(el.id);
    if (saved) toast('当前状态已保存：' + el.value);
  });
  $$('[data-deadline]').forEach(el => el.onchange = () => {
    const o = ORDER_LIST.find(o => o.id === el.dataset.order);
    o[el.dataset.deadline] = el.checked;
    const saved = persistWorkspace();
    rerenderWorkspace();
    if (saved) toast(el.checked ? '已完成，该事项不再提醒' : '已重新开启该事项的截止提醒');
  });
  $$('[data-reminder-order]').forEach(el => el.onchange = () => {
    const o = ORDER_LIST.find(o => o.id === el.dataset.reminderOrder);
    o[el.dataset.reminderFlag] = true;
    const saved = persistWorkspace();
    renderContent();
    if (saved) toast('该截止事项已完成，提醒已停止');
  });
  $$('[data-todo]').forEach(el => el.onchange = () => {
    const t = TODO_LIST.find(t => t.id === el.dataset.todo);
    t.done = el.checked;
    const saved = persistWorkspace();
    renderContent();
    if (saved) toast(t.done ? '待办已完成' : '待办已重新打开');
  });
  $$('[data-remark]').forEach(el => {
    el.oninput = () => { ORDER_LIST.find(o => o.id === el.dataset.remark).remark = el.value; persistWorkspace(); };
  });
  $$('[data-remark-save]').forEach(b => b.onclick = () => {
    if (persistWorkspace()) { toast('订单异常备注已保存'); $(`[data-remark-status="${b.dataset.remarkSave}"]`).textContent = '已保存'; }
  });
}

function editOrder(order) {
  const o = order || {};
  openForm(order ? '编辑订单 · ' + o.so : '新建订单', [
    { key: 'so', label: 'SO 号', value: o.so, required: true },
    { key: 'bl', label: '提单号', value: o.bl }, { key: 'wo', label: '工作号', value: o.wo },
    { key: 'sales', label: '销售', value: o.sales, required: true },
    { key: 'pol', label: '起运港', value: o.pol, required: true }, { key: 'pod', label: '目的港', value: o.pod, required: true },
    { key: 'cutoff', label: '截单时间（上海时间）', type: 'datetime-local', value: o.cutoff },
    { key: 'cutport', label: '截关 / 港时间（上海时间）', type: 'datetime-local', value: o.cutport },
    { key: 'etd', label: 'ETD · 预计开船日期', type: 'date', value: o.etd },
    { key: 'eta', label: 'ETA · 预计到港日期', type: 'date', value: o.eta },
    { key: 'vessel', label: '船名 / 航次', value: o.vessel },
    { key: 'status', label: '异常标记', type: 'select', value: o.status === '异常' ? '异常' : '正常', options: ['正常', '异常'] }
  ], data => {
    for (const key of ['so', 'sales', 'pol', 'pod']) if (!data[key]) { setFieldError(key, '请填写此项'); return false; }
    if (ORDER_LIST.some(x => x.id !== o.id && x.so.toLowerCase() === data.so.toLowerCase())) { setFieldError('so', 'SO 号已存在'); return false; }
    for (const key of ['cutoff', 'cutport', 'etd', 'eta']) if (data[key] && !Number.isFinite(dateValue(data[key]))) { setFieldError(key, '请填写有效日期'); return false; }
    if (data.etd && data.eta && data.eta < data.etd) { setFieldError('eta', '到港日期不能早于开船日期'); return false; }
    const target = order || { id: newId(), remark: '', cutoffDone: false, cutportDone: false };
    if (order && target.cutoff !== data.cutoff) target.cutoffDone = false;
    if (order && target.cutport !== data.cutport) target.cutportDone = false;
    Object.assign(target, data, { status: data.status === '异常' ? '异常' : '进行中' });
    if (!order) ORDER_LIST.unshift(target);
    flowOf(target);
    const saved = persistWorkspace();
    state.filter = '全部';
    state.expanded = target.id;
    renderContent();
    if (saved) toast(order ? '订单已更新' : '订单已创建');
    return true;
  }, { wide: true });
}

/* 船期刷新：地址由用户后期配置，调用数据服务，不将普通网页当作船期结果。 */
function syncEndpoint(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('请填写完整的 http 或 https 数据服务地址');
  return url.href;
}
function configureSailingSync() {
  if (syncBusy) return;
  openForm('维运网刷新设置', [{ key: 'endpoint', label: '船期数据服务地址', type: 'url', value: syncConfig.endpoint, full: true,
    hint: '地址可先留空。填写有效船期数据服务地址后，程序打开期间每小时自动刷新一次；普通网站首页不能直接同步。' }], data => {
    let endpoint = '';
    if (data.endpoint) {
      try { endpoint = syncEndpoint(data.endpoint); }
      catch (error) { setFieldError('endpoint', error.message); return false; }
    }
    const next = endpoint === syncConfig.endpoint ? { ...syncConfig } : { endpoint, lastSuccess: '', lastSummary: '', autoAnchor: Date.now(), lastAttempt: 0 };
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(next)); }
    catch (error) { setFieldError('endpoint', '浏览器无法保存设置，请检查本地存储'); return false; }
    syncConfig = next;
    window.LocalData?.changed();
    scheduleSailingAutoRefresh();
    if (state.module === 'dashboard') renderContent();
    toast(endpoint ? '地址已保存，程序打开期间将每小时自动刷新，也可手动刷新' : '地址已留空，后期填写后启用刷新', endpoint ? 'success' : 'warn');
    return true;
  }, { bodyHtml: `<p class="list-hint">${syncConfig.lastSuccess ? '上次成功检查：' + esc(syncConfig.lastSuccess) + '<br>' + esc(syncConfig.lastSummary) : '尚未同步船期；当前订单日期保持原样。'}</p>` });
}
function sailingIdentity(o) {
  const parts = String(o.vessel || '').split('/').map(x => x.trim());
  const clean = value => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const port = value => /^([A-Z]{5})\b/.exec(clean(value))?.[1] || clean(value);
  if (parts.length !== 2 || !parts[0] || !parts[1] || !o.pol || !o.pod || /待定|待补|待订舱/.test(o.vessel)) return null;
  const query = { vessel: clean(parts[0]), voyage: clean(parts[1]), pol: port(o.pol), pod: port(o.pod) };
  return { key: JSON.stringify(Object.values(query)), ...query };
}
function sailingDate(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('船期日期必须为完整的年-月-日');
  const stamp = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) throw new Error('返回了无效的船期日期');
  return value;
}
async function refreshSailings(options = {}) {
  const automatic = options.automatic === true;
  if (syncBusy) return;
  if (!syncConfig.endpoint) { if (!automatic) configureSailingSync(); return; }
  syncConfig.lastAttempt = Date.now();
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(syncConfig)); window.LocalData?.changed(); } catch (error) { /* 本轮计时仍在内存保留。 */ }
  scheduleSailingAutoRefresh();
  const queries = new Map();
  const snapshots = [];
  ORDER_LIST.forEach(o => {
    if (orderStatus(o) === '已完成') return;
    const query = sailingIdentity(o);
    if (!query) return;
    queries.set(query.key, query);
    snapshots.push({ id: o.id, key: query.key, etd: o.etd, eta: o.eta });
  });
  if (!snapshots.length) { toast('没有可刷新的订单，请先补齐船名、航次和港口', 'warn'); return; }
  let endpoint;
  try { endpoint = syncEndpoint(syncConfig.endpoint); }
  catch (error) { toast(error.message, 'error'); if (!automatic) configureSailingSync(); return; }
  syncBusy = true;
  if (state.module === 'dashboard') filters(DASH_SCOPES);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', cache: 'no-store', signal: abort.signal,
      body: JSON.stringify({ version: 1, sailings: [...queries.values()] }) });
    if (!response.ok) throw new Error('船期服务请求失败（' + response.status + '）');
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('返回的是网页或非船期内容，请检查数据服务地址');
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.sailings)) throw new Error('船期返回格式不正确，订单日期未修改');
    const byKey = new Map();
    payload.sailings.forEach(row => {
      if (!row || typeof row.key !== 'string' || !queries.has(row.key)) return;
      byKey.set(row.key, byKey.has(row.key) ? null : row);
    });
    const changes = [];
    let checked = 0, invalid = 0;
    snapshots.forEach(snapshot => {
      const row = byKey.get(snapshot.key);
      const o = ORDER_LIST.find(o => o.id === snapshot.id);
      if (!row || !o || orderStatus(o) === '已完成' || sailingIdentity(o)?.key !== snapshot.key || o.etd !== snapshot.etd || o.eta !== snapshot.eta) return;
      try {
        const etd = sailingDate(row.etd) || o.etd;
        const eta = sailingDate(row.eta) || o.eta;
        if (!row.etd && !row.eta) return;
        if (etd && eta && eta < etd) throw new Error('到港早于开船');
        checked++;
        if (etd !== o.etd || eta !== o.eta) changes.push({ o, etd, eta, oldEtd: o.etd, oldEta: o.eta });
      } catch (error) { invalid++; }
    });
    if (!checked) throw new Error(invalid ? '返回的船期日期无效，订单日期未修改' : '未取得能明确匹配的船期，订单日期未修改');
    changes.forEach(change => { change.o.etd = change.etd; change.o.eta = change.eta; });
    if (changes.length && !persistWorkspace()) {
      changes.forEach(change => { change.o.etd = change.oldEtd; change.o.eta = change.oldEta; });
      throw new Error('本地保存失败，已保留原船期');
    }
    const summary = '已更新 ' + changes.length + ' 票，船期未变 ' + (checked - changes.length) + ' 票，未更新 ' + (snapshots.length - checked) + ' 票';
    syncConfig = { ...syncConfig, lastSuccess: businessNow().replace('T', ' '), lastSummary: summary };
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(syncConfig)); window.LocalData?.changed(); } catch (error) { /* 船期已另行保存；检查记录仅在当前会话保留。 */ }
    toast(summary);
  } catch (error) {
    const message = error.name === 'AbortError' ? '船期查询超时，请稍后重试' : error instanceof TypeError ? '未能连接船期服务，请检查地址及服务是否允许浏览器访问' : error.message;
    toast(message, 'error');
  } finally {
    clearTimeout(timer);
    syncBusy = false;
    renderContent();
  }
}

let sailingAutoTimer;
function scheduleSailingAutoRefresh() {
  clearTimeout(sailingAutoTimer);
  if (!syncConfig.endpoint || !window.AppSession?.ready) return;
  if (!syncConfig.autoAnchor && !syncConfig.lastAttempt) {
    syncConfig.autoAnchor = Date.now();
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(syncConfig)); window.LocalData?.changed(); } catch (error) {}
  }
  const due = Math.max(Number(syncConfig.autoAnchor) || 0, Number(syncConfig.lastAttempt) || 0) + HOUR;
  sailingAutoTimer = setTimeout(checkSailingAutoRefresh, Math.max(100, due - Date.now()));
}
function checkSailingAutoRefresh() {
  if (!window.AppSession?.ready || !syncConfig.endpoint) return;
  if (syncBusy) { clearTimeout(sailingAutoTimer); sailingAutoTimer = setTimeout(checkSailingAutoRefresh, 30000); return; }
  const base = Math.max(Number(syncConfig.autoAnchor) || 0, Number(syncConfig.lastAttempt) || 0);
  if (base && Date.now() - base >= HOUR) refreshSailings({ automatic: true });
  else scheduleSailingAutoRefresh();
}
window.addEventListener('hangwutong-ready', scheduleSailingAutoRefresh);
window.addEventListener('focus', checkSailingAutoRefresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSailingAutoRefresh(); });

/* ---------------------------------------------------------------------
   侧栏适配控制
   ≥1025px：侧栏常驻，☰ 隐藏
   ≤1024px：图标栏常驻；☰ 展开为抽屉（带遮罩），Esc / 遮罩 / 收起按钮关闭
   --------------------------------------------------------------------- */
const SIDEBAR_BP = 1024;
function sidebarIsDrawer() {
  return window.matchMedia(`(max-width:${SIDEBAR_BP}px)`).matches;
}
function setSidebar(open) {
  const s = $('#sidebar'), scrim = $('#scrim'), btn = $('#menuBtn');
  if (!s) return;
  if (!sidebarIsDrawer()) {
    s.classList.remove('expanded');
    scrim.hidden = true;
    document.body.classList.remove('nav-open');
    btn.setAttribute('aria-expanded', 'true');
    return;
  }
  s.classList.toggle('expanded', !!open);
  scrim.hidden = !open;
  document.body.classList.toggle('nav-open', !!open);
  btn.setAttribute('aria-expanded', String(!!open));
}

/* ---------------------------------------------------------------------
   事件绑定
   --------------------------------------------------------------------- */
$('#menuBtn').onclick = () => setSidebar(!$('#sidebar').classList.contains('expanded'));
$('#sideClose').onclick = () => setSidebar(false);
$('#scrim').onclick = () => setSidebar(false);
$('#railNote').onclick = () => {
  setNotesClosed(false);
  setSidebar(true);
  setTimeout(() => {
    const note = document.querySelector('.side-note');
    if (note) note.scrollIntoView({ block: 'nearest' });
  }, 80);
};
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('#modal') && $('#modal').open) return;   // 弹窗自身处理 Esc
  if ($('#sidebar').classList.contains('expanded')) setSidebar(false);
});


$('#primaryBtn').onclick = () => {
  if (state.module === 'settings') {
    window.SettingsPage.saveCurrent(state.settingsTab, { toast, openForm, closeModal });
    return;
  }
  openForm('新建待办', [
    { key: 'title', label: '标题', required: true },
    { key: 'owner', label: '负责人', value: '陈亦航', required: true },
    { key: 'due', label: '截止时间（上海时间）', type: 'datetime-local', value: businessNow() },
    { key: 'so', label: '关联 SO（可选）', type: 'select', options: [{ value: '', label: '不关联订单' }, ...ORDER_LIST.map(o => o.so)] },
    { key: 'note', label: '备注', type: 'textarea', full: true }
  ], data => {
    if (!data.title) { setFieldError('title', '请填写待办标题'); return false; }
    if (!data.owner) { setFieldError('owner', '请指定负责人'); return false; }
    if (data.due && !Number.isFinite(dateValue(data.due))) { setFieldError('due', '请填写有效截止时间'); return false; }
    TODO_LIST.unshift({ ...data, id: newId(), done: false });
    const saved = persistWorkspace();
    state.filter = '今日待办';
    renderContent();
    if (saved) toast('待办已创建：' + data.title);
    return true;
  });
};

$('#search').oninput = e => {
  state.query = e.target.value;
  renderContent();
};

$('#globalSearch').onkeydown = e => {
  if (e.key === 'Enter') {
    state.module = 'settings';
    state.settingsTab = '操作日志';
    state.filter = '操作日志';
    state.query = e.target.value;
    $('#search').value = e.target.value;
    render();
    toast('已跳转系统设置 · 操作日志并执行全局搜索');
  }
};

$('#modalForm').addEventListener('submit', e => {
  e.preventDefault();
  if (modalSubmitHandler) {
    const ok = modalSubmitHandler(readModalForm());
    if (ok === false) return;
  }
  closeModal();
});

$('#modalClose').onclick = closeModal;
$('#modalCancel').onclick = closeModal;
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
// 关闭弹窗后刷新清单，让「当前节点」反映刚勾选的流程进度
$('#modal').addEventListener('close', () => {
  $('#modal').classList.remove('wide');
  if (state.module === 'dashboard') renderContent();
});

/* ---------------------------------------------------------------------
   侧栏异常备注：记录异常情况，可标记已处理 / 删除，本地持久化
   --------------------------------------------------------------------- */
const NOTE_KEY = 'hangwutong.notes';
const NOTE_CLOSED_KEY = 'hangwutong.notes.closed';

function setNotesClosed(closed, save = true) {
  $('#noteContent').hidden = closed;
  $('.side-note').classList.toggle('note-closed', closed);
  $('#noteClose').hidden = closed;
  $('#noteOpen').hidden = !closed;
  $('#noteClose').setAttribute('aria-expanded', String(!closed));
  $('#noteOpen').setAttribute('aria-expanded', String(!closed));
  if (save) {
    try { localStorage.setItem(NOTE_CLOSED_KEY, String(closed)); window.LocalData?.changed(); } catch (error) { /* 关闭状态无法保存时仍可在当前页面使用。 */ }
  }
}
$('#noteClose').onclick = () => { setNotesClosed(true); $('#noteOpen').focus(); };
$('#noteOpen').onclick = () => { setNotesClosed(false); $('#noteInput').focus(); };
try { setNotesClosed(localStorage.getItem(NOTE_CLOSED_KEY) === 'true', false); }
catch (error) { setNotesClosed(false, false); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadNotes() {
  const seed = [
    { id: 1, text: 'SO-2026-002 舱位超售，船司要求改配下一水，需与客人确认交期。', time: '10/24 09:12', done: false },
    { id: 2, text: 'SO-2026-003 补料多次退回，客人提供的箱号与 VGM 不一致。', time: '10/23 16:40', done: false }
  ];
  try {
    const raw = localStorage.getItem(NOTE_KEY);
    const parsed = raw ? JSON.parse(raw) : seed;
    return Array.isArray(parsed) && parsed.every(n => n && Number.isFinite(n.id) && typeof n.text === 'string') ? parsed : seed;
  } catch (e) { return seed; }
}

let notes = loadNotes();
let noteSeq = notes.reduce((mx, n) => Math.max(mx, n.id), 0) + 1;

function persistNotes() {
  try { localStorage.setItem(NOTE_KEY, JSON.stringify(notes)); window.LocalData?.changed(); return true; } catch (e) { toast('备注本地保存失败，本次修改仅在当前页面保留', 'error'); return false; }
}

function renderNotes() {
  const box = $('#noteList');
  if (!box) return;
  $('#noteCount').textContent = notes.length;
  const railCount = $('#railNoteCount');
  if (railCount) {
    const pending = notes.filter(n => !n.done).length;
    railCount.textContent = pending || '';
    railCount.dataset.zero = pending ? '0' : '1';
  }
  box.innerHTML = notes.length ? notes.map(n => `<li class="note-item${n.done ? ' done' : ''}">
    <div class="note-text">${esc(n.text)}</div>
    <div class="note-meta">
      <span>${esc(n.time)}</span>
      <button type="button" class="note-act" data-note-done="${n.id}">${n.done ? '已处理' : '标记已处理'}</button>
      <button type="button" class="note-act danger" data-note-del="${n.id}" aria-label="删除备注">×</button>
    </div>
  </li>`).join('') : '<li class="note-empty">暂无异常备注</li>';

  box.querySelectorAll('[data-note-done]').forEach(b => b.onclick = () => {
    const n = notes.find(x => x.id === Number(b.dataset.noteDone));
    if (!n) return;
    n.done = !n.done;
    const saved = persistNotes();
    renderNotes();
    if (saved) toast(n.done ? '备注已标记为已处理' : '备注已重新打开为待处理');
  });
  box.querySelectorAll('[data-note-del]').forEach(b => b.onclick = () => {
    const i = notes.findIndex(x => x.id === Number(b.dataset.noteDel));
    if (i < 0) return;
    notes.splice(i, 1);
    const saved = persistNotes();
    renderNotes();
    if (saved) toast('备注已删除');
  });
}

function saveNote() {
  const input = $('#noteInput');
  const err = $('#noteErr');
  const text = input.value.trim();
  if (!text) {
    err.textContent = '请先填写异常情况再保存';
    err.hidden = false;
    input.focus();
    toast('备注内容不能为空', 'error');
    return;
  }
  err.hidden = true;
  notes.unshift({
    id: noteSeq++,
    text,
    time: businessNow().replace('T', ' '),
    done: false
  });
  input.value = '';
  const saved = persistNotes();
  renderNotes();
  if (saved) toast('异常备注已保存');
}

$('#noteSave').onclick = saveNote;
$('#noteInput').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveNote(); }
});
renderNotes();
try { if (!localStorage.getItem(NOTE_KEY)) persistNotes(); } catch (error) {}

/* 侧栏初始状态：桌面常驻；窄屏为图标栏，抽屉默认收起 */
setSidebar(false);
// 跨断点时重置，避免从抽屉态切回桌面后残留遮罩
let wasDrawer = sidebarIsDrawer();
window.addEventListener('resize', () => {
  const now = sidebarIsDrawer();
  if (now !== wasDrawer) { wasDrawer = now; setSidebar(false); }
  sizeDetails();
});

render();

// 打开页面、回到页面和每分钟检查一次；不在后台发送消息。
function refreshReminders() {
  if (state.module === 'dashboard' && state.filter !== '全部' && !$('#modal').open && !document.activeElement.matches('input, select, textarea')) renderContent();
}
setInterval(refreshReminders, 60000);
window.addEventListener('focus', refreshReminders);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshReminders(); });
if (window.workspaceLoadError) {
  $('#storageStatus').textContent = '本地数据读取失败，当前显示示例；原存储尚未覆盖';
  $('#storageStatus').classList.add('storage-error');
} else if (!restored) persistWorkspace();

window.addEventListener('local-data-state', updateDataStorageStatus);
function updateDataStorageStatus() {
  const info = window.LocalData.status();
  $('#storageStatus').textContent = info.text;
  $('#storageStatus').classList.toggle('storage-error', info.error);
}
if (!window.workspaceLoadError && !$('#storageStatus').classList.contains('storage-error')) updateDataStorageStatus();
