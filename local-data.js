'use strict';

// 用户授权的电脑文件夹是持久化位置；浏览器缓存用于即时编辑和失败恢复。
window.LocalData = (() => {
  const KEYS = ['hangwutong.workspace.v1', 'hangwutong.settings.v1', 'hangwutong.notes', 'hangwutong.notes.closed', 'hangwutong.sailing-sync.v1'];
  const META = 'hangwutong.local-data.meta.v1';
  const FILE = 'hangwutong-data.json', BACKUP = 'hangwutong-data.previous.json';
  const S = { handle: null, label: '', ready: false, dirty: false, blocked: false, busy: false, lastSaved: '', revision: '', message: '', host: null };
  let db, debounce, queue = Promise.resolve();
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function meta() {
    try { return JSON.parse(localStorage.getItem(META) || '{}'); } catch { return {}; }
  }
  function storeMeta() {
    localStorage.setItem(META, JSON.stringify({ label: S.label, dirty: S.dirty, lastSaved: S.lastSaved, revision: S.revision }));
  }
  function emit() { paint(); window.dispatchEvent(new Event('local-data-state')); }
  function notify(message, kind = 'success') { S.host?.toast?.(message, kind); }
  function snapshot() {
    const store = {};
    KEYS.forEach(key => { const value = localStorage.getItem(key); if (value != null) store[key] = value; });
    return store;
  }
  function validate(bundle) {
    if (!bundle || bundle.format !== 'hangwutong-local-data' || bundle.version !== 1 || typeof bundle.revision !== 'string' || !bundle.store || typeof bundle.store !== 'object' || Array.isArray(bundle.store)) throw new Error('数据文件格式无效');
    for (const [key, value] of Object.entries(bundle.store)) {
      if (!KEYS.includes(key) || typeof value !== 'string') throw new Error('数据文件包含无效内容');
      const parsed = JSON.parse(value);
      if (key === KEYS[0] && (!parsed || parsed.version !== 1 || !Array.isArray(parsed.orders) || !Array.isArray(parsed.todos) || !parsed.orders.every(o => o && typeof o.id === 'string' && typeof o.so === 'string' && typeof o.sales === 'string') || !parsed.todos.every(t => t && typeof t.id === 'string' && typeof t.title === 'string'))) throw new Error('订单或待办数据无效');
      if (key === KEYS[1] && (!parsed || parsed.version !== 1 || !['rules', 'soRules', 'currencies', 'payees', 'invoiceTypes', 'logs', 'backupRecords'].every(k => Array.isArray(parsed[k])))) throw new Error('设置数据无效');
      if (key === KEYS[2] && (!Array.isArray(parsed) || !parsed.every(n => n && Number.isFinite(n.id) && typeof n.text === 'string'))) throw new Error('备注数据无效');
      if (key === KEYS[3] && typeof parsed !== 'boolean') throw new Error('备注显示设置无效');
      if (key === KEYS[4] && (!parsed || typeof parsed.endpoint !== 'string')) throw new Error('船期同步设置无效');
    }
    if (!bundle.store[KEYS[0]]) throw new Error('数据文件缺少订单数据');
    return bundle;
  }
  async function database() {
    if (db) return db;
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('hangwutong-local-folder', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('folder');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return db;
  }
  async function remember(handle) {
    const connection = await database();
    return new Promise((resolve, reject) => {
      const tx = connection.transaction('folder', 'readwrite');
      tx.objectStore('folder').put(handle, 'current');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function recalled() {
    const connection = await database();
    return new Promise((resolve, reject) => {
      const request = connection.transaction('folder').objectStore('folder').get('current');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  async function permission(handle, ask = false) {
    const opts = { mode: 'readwrite' };
    if (await handle.queryPermission(opts) === 'granted') return true;
    return ask && await handle.requestPermission(opts) === 'granted';
  }
  async function read(handle, name = FILE) {
    try { return validate(JSON.parse(await (await (await handle.getFileHandle(name)).getFile()).text())); }
    catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
  }
  async function write(handle, name, content) {
    const file = await handle.getFileHandle(name, { create: true });
    const stream = await file.createWritable();
    try { await stream.write(content); await stream.close(); }
    catch (error) { try { await stream.abort(); } catch {} throw error; }
  }
  function apply(bundle) {
    validate(bundle);
    const before = snapshot();
    try {
      KEYS.forEach(key => { if (key in bundle.store) localStorage.setItem(key, bundle.store[key]); else localStorage.removeItem(key); });
    } catch (error) {
      KEYS.forEach(key => { try { if (key in before) localStorage.setItem(key, before[key]); else localStorage.removeItem(key); } catch {} });
      throw error;
    }
    S.revision = bundle.revision; S.lastSaved = bundle.savedAt; S.dirty = false;
    storeMeta();
  }
  const prepared = (async () => {
    const cached = meta();
    S.label = cached.label || ''; S.lastSaved = cached.lastSaved || ''; S.revision = cached.revision || ''; S.dirty = !!cached.dirty;
    try { S.handle = await recalled(); }
    catch { if (S.label) S.message = '文件夹连接无法读取，请重新选择；浏览器缓存仍保留。'; }
    return S.handle;
  })();
  async function start() {
    await prepared;
    if (!S.handle) { emit(); return; }
    try {
      if (!await permission(S.handle)) { S.message = '需要重新授权本地文件夹，请在“数据存储”中点击重新连接。'; emit(); return; }
      if (S.dirty) { S.blocked = true; S.message = '有未写入文件夹的浏览器修改，已保留缓存。请选择保存当前数据或读取文件夹数据。'; emit(); return; }
      const bundle = await read(S.handle);
      if (bundle) apply(bundle);
      else if (S.revision) throw new Error('原数据文件不存在，已保留浏览器缓存');
      S.ready = true;
    } catch (error) { S.blocked = true; S.message = error.message + '；未覆盖浏览器缓存或文件，请在数据存储中处理。'; }
    emit();
  }
  function changed() {
    S.dirty = true;
    try { storeMeta(); } catch { S.message = '浏览器无法保存恢复标记，请及时检查本地保存状态。'; }
    emit();
    clearTimeout(debounce);
    if (S.handle && S.ready && !S.blocked) debounce = setTimeout(() => flush().catch(() => {}), 500);
  }
  async function saveFile(force = false) {
    if (!S.handle) throw new Error('请先选择或新建本地数据文件夹');
    if (!await permission(S.handle)) throw new Error('文件夹授权已失效，请点击重新连接');
    if (S.blocked && !force) throw new Error(S.message || '请先处理文件夹连接状态');
    S.busy = true; emit();
    try {
      const previous = await read(S.handle);
      if ((previous?.revision || '') !== S.revision) throw new Error('文件夹数据已发生变化，请先读取文件夹数据；当前修改仍保留在浏览器中');
      const store = snapshot();
      const bundle = validate({ format: 'hangwutong-local-data', version: 1, savedAt: new Date().toISOString(), revision: crypto.randomUUID(), store });
      // createWritable 在 close 后提交；先保留一份上次有效文件，失败时不宣称成功。
      if (previous) await write(S.handle, BACKUP, JSON.stringify(previous, null, 2));
      await write(S.handle, FILE, JSON.stringify(bundle, null, 2));
      S.revision = bundle.revision; S.lastSaved = bundle.savedAt;
      S.dirty = JSON.stringify(snapshot()) !== JSON.stringify(store);
      S.ready = true; S.blocked = false; S.message = '';
      storeMeta();
      if (S.dirty) { clearTimeout(debounce); debounce = setTimeout(() => flush().catch(() => {}), 500); }
      return true;
    } catch (error) { S.dirty = true; S.blocked = true; S.message = error.message; try { storeMeta(); } catch {} throw error; }
    finally { S.busy = false; emit(); }
  }
  function flush(force = false) {
    clearTimeout(debounce);
    const task = queue.catch(() => {}).then(() => saveFile(force));
    queue = task;
    return task;
  }
  async function pick(create) {
    try {
      if (!window.showDirectoryPicker) throw new Error('请使用电脑端最新版谷歌浏览器选择文件夹');
      const name = document.getElementById('localFolderName')?.value.trim() || '航务通数据';
      if (create && (!name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name === '.' || name === '..')) throw new Error('请填写有效的文件夹名称');
      const parent = await showDirectoryPicker({ id: 'hangwutong-data', mode: 'readwrite' });
      const handle = create ? await parent.getDirectoryHandle(name, { create: true }) : parent;
      await queue.catch(() => {});
      if (S.handle && S.dirty && S.ready && !S.blocked) await flush();
      const existing = await read(handle);
      if (existing && !confirm('该文件夹已有航务通数据。是否读取这份数据？当前浏览器数据会先另存一份恢复副本。')) return;
      if (existing) await write(handle, 'hangwutong-browser-recovery-' + Date.now() + '.json', JSON.stringify({ format: 'hangwutong-local-data', version: 1, savedAt: new Date().toISOString(), revision: crypto.randomUUID(), store: snapshot() }, null, 2));
      await remember(handle);
      S.handle = handle; S.label = create ? parent.name + ' / ' + name : handle.name; S.ready = true; S.blocked = false; S.message = ''; S.revision = existing?.revision || ''; S.lastSaved = existing?.savedAt || ''; S.dirty = !existing;
      storeMeta();
      if (existing) { apply(existing); location.reload(); return; }
      await flush();
      notify('数据文件夹已连接，当前数据已写入电脑本地');
    } catch (error) {
      if (error.name !== 'AbortError') notify(error.name === 'NotAllowedError' ? '未获得文件夹读写权限，请重新选择并允许访问' : error.name === 'SecurityError' ? '浏览器不允许访问该位置，请选择普通文档文件夹' : error.message || '无法连接数据文件夹', 'error');
    }
    emit();
  }
  async function reconnect() {
    try {
      if (!S.handle) { await pick(false); return; }
      if (!await permission(S.handle, true)) throw new Error('尚未获得文件夹读写授权');
      S.blocked = false; S.ready = true;
      if (S.dirty) { S.blocked = true; S.message = '授权已恢复。请保存当前数据，或读取文件夹中的数据。'; }
      else { const bundle = await read(S.handle); if (bundle) { apply(bundle); location.reload(); return; } }
      notify('文件夹已重新连接');
    } catch (error) { notify(error.message, 'error'); }
    emit();
  }
  async function saveNow() {
    try { await flush(true); notify('已写入电脑本地数据文件'); }
    catch (error) { notify(error.message, 'error'); }
  }
  async function reloadFile(backup = false) {
    try {
      if (!S.handle || !await permission(S.handle, true)) throw new Error('请先连接本地数据文件夹');
      const bundle = await read(S.handle, backup ? BACKUP : FILE);
      if (!bundle) throw new Error(backup ? '尚无上一份数据备份' : '未找到本地数据文件');
      if (!confirm(backup ? '恢复上一份数据备份？当前浏览器数据和当前数据文件会先另存恢复副本，然后恢复这份备份。' : '读取文件夹中的数据？当前浏览器数据会先另存恢复副本。')) return;
      await write(S.handle, 'hangwutong-browser-recovery-' + Date.now() + '.json', JSON.stringify({ format: 'hangwutong-local-data', version: 1, savedAt: new Date().toISOString(), revision: crypto.randomUUID(), store: snapshot() }, null, 2));
      let target = bundle;
      if (backup) {
        try {
          const original = await (await (await S.handle.getFileHandle(FILE)).getFile()).text();
          await write(S.handle, 'hangwutong-file-recovery-' + Date.now() + '.json', original);
        } catch (error) { if (error.name !== 'NotFoundError') throw error; }
        target = { ...bundle, savedAt: new Date().toISOString(), revision: crypto.randomUUID() };
        await write(S.handle, FILE, JSON.stringify(target, null, 2));
      }
      apply(target); S.ready = true; S.blocked = false; S.message = '';
      location.reload();
    } catch (error) { notify(error.message, 'error'); }
  }
  function status() {
    if (S.message) return { text: S.message, error: true };
    if (!S.handle) return { text: '浏览器本地缓存 · 可在“数据存储”中设置文件夹', error: false };
    if (S.busy) return { text: '正在写入本地数据文件夹…', error: false };
    if (S.dirty) return { text: '浏览器缓存已保存 · 本地文件夹待同步', error: false };
    return { text: '已保存到本地文件夹：' + S.label, error: false };
  }
  function render() {
    return `<section class="panel local-data-panel"><div class="panel-head"><h2>电脑本地数据存储</h2><span class="tag blue">本地文件夹</span></div><div class="panel-body"><p class="local-data-intro">选择电脑上的文件夹保存订单、待办、备注、已保存设置和船期同步配置。连接后，修改会自动写入数据文件，并保留上一份有效数据。</p><dl class="local-data-info"><dt>当前文件夹</dt><dd id="localFolderLabel"></dd><dt>保存状态</dt><dd id="localFolderStatus" role="status"></dd><dt>上次写入</dt><dd id="localFolderTime"></dd><dt>数据文件</dt><dd>${FILE}</dd><dt>上一份备份</dt><dd>${BACKUP}</dd></dl><div class="local-folder-create"><label for="localFolderName">新文件夹名称</label><input id="localFolderName" value="航务通数据" maxlength="100"><button type="button" class="btn primary" id="localFolderCreate">选择位置并新建文件夹</button><button type="button" class="btn" id="localFolderChoose">选择已有数据文件夹</button></div><div class="local-data-buttons"><button type="button" class="btn" id="localFolderSave">立即保存当前数据</button><button type="button" class="btn" id="localFolderReconnect">重新连接 / 授权</button><button type="button" class="btn" id="localFolderRead">读取文件夹数据</button><button type="button" class="btn" id="localFolderBackup">恢复上一份备份</button></div><p class="local-data-note">首次选择需要浏览器授权；再次打开若授权失效，请重新连接。未设置文件夹前，数据仍只保存在当前浏览器缓存中。请勿在多个窗口同时编辑同一数据文件夹。</p></div></section>`;
  }
  function paint() {
    const label = document.getElementById('localFolderLabel');
    if (!label) return;
    label.textContent = S.label || '尚未设置';
    const info = status();
    document.getElementById('localFolderStatus').textContent = info.text;
    document.getElementById('localFolderStatus').classList.toggle('storage-error', info.error);
    document.getElementById('localFolderTime').textContent = S.lastSaved ? new Date(S.lastSaved).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未写入';
    for (const id of ['localFolderSave', 'localFolderRead', 'localFolderBackup']) document.getElementById(id).disabled = !S.handle || S.busy;
  }
  function wire(host) {
    S.host = host;
    document.getElementById('localFolderCreate').onclick = () => pick(true);
    document.getElementById('localFolderChoose').onclick = () => pick(false);
    document.getElementById('localFolderSave').onclick = saveNow;
    document.getElementById('localFolderReconnect').onclick = reconnect;
    document.getElementById('localFolderRead').onclick = () => reloadFile();
    document.getElementById('localFolderBackup').onclick = () => reloadFile(true);
    paint();
  }
  window.addEventListener('beforeunload', event => { if (S.handle && (S.dirty || S.busy)) { event.preventDefault(); event.returnValue = ''; } });
  return { start, changed, flush, saveNow, status, render, wire };
})();
