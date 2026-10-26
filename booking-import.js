'use strict';

window.BookingImport = (() => {
  const P = window.BookingParser;
  const loads = new Map();
  const decode = value => Uint8Array.from(atob(value), ch => ch.charCodeAt(0));
  function loadScript(name) {
    if (!loads.has(name)) loads.set(name, new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = name + '?v=1.4.0';
      script.onload = resolve; script.onerror = () => { loads.delete(name); script.remove(); reject(new Error('识别组件未能加载，请检查程序文件是否完整，或联网后重试')); };
      document.head.appendChild(script);
    }));
    return loads.get(name);
  }
  // 通过版面坐标合并左右列，保留“装港 ETA / 卸港 ETA / 交货地 ETA”的行关系。
  function mergeRows(items) {
    const rows = [];
    for (const item of items.filter(i => i.text?.trim()).sort((a, b) => a.y - b.y || a.x - b.x)) {
      let row = rows.at(-1);
      if (!row || Math.abs(item.y - row.y) > Math.max(3, Math.min(item.height || 12, row.height || 12) * .45)) {
        row = { y: item.y, height: item.height, items: [] }; rows.push(row);
      }
      row.items.push(item);
    }
    return rows.map(row => row.items.sort((a, b) => a.x - b.x).map(i => i.text).join(' ')).join('\n');
  }
  class Scanner {
    constructor(progress) { this.progress = progress; this.cancelled = false; this.worker = null; this.workerURL = ''; this.pdfTask = null; }
    guard() { if (this.cancelled) throw new Error('识别已取消，未创建订单'); }
    async stop() {
      this.cancelled = true;
      if (this.worker) { await this.worker.terminate(); this.worker = null; }
      if (this.workerURL) URL.revokeObjectURL(this.workerURL);
      if (this.pdfTask) { try { await this.pdfTask.destroy(); } catch {} this.pdfTask = null; }
    }
    async ocr(canvas, name, page = 1) {
      this.guard();
      if (!this.worker) {
        this.progress('正在加载本地中英文识别组件…首次使用可能需要一些时间');
        await Promise.all([loadScript('vendor/tesseract.min.js'), loadScript('vendor/ocr-assets.js')]);
        this.guard();
        const assets = window.BookingOCRAssets;
        // 引擎、WASM、字库都来自同一交付包；Blob worker 兼容本地 HTML，不请求 CDN。
        const prefix = 'const localLanguages=' + JSON.stringify(assets.languages) + ';\nself.fetch=async function(url){const code=/\\/(eng|chi_sim)\\.traineddata(?:\\.gz)?$/.exec(String(url))?.[1];if(!code)throw new Error("Unexpected OCR resource");const data=Uint8Array.from(atob(localLanguages[code]),c=>c.charCodeAt(0));return new Response(data,{status:200});};\n';
        this.workerURL = URL.createObjectURL(new Blob([decode(assets.core), '\n', prefix, decode(assets.worker)], { type: 'application/javascript' }));
        const pending = Tesseract.createWorker('chi_sim+eng', 1, { workerPath: this.workerURL, workerBlobURL: false, langPath: new URL('vendor/ocr-lang', document.baseURI).href, cacheMethod: 'none', gzip: false,
          logger: entry => { if (!this.cancelled && entry.status === 'recognizing text') this.progress(`正在识别 ${name} · 第 ${page} 页 · ${Math.round(entry.progress * 100)}%`); }, errorHandler: () => {} });
        this.worker = await pending;
        if (this.cancelled) { await this.worker.terminate(); this.worker = null; this.guard(); }
        await this.worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
      }
      this.guard();
      const result = await this.worker.recognize(canvas, {}, { text: true, blocks: true });
      this.guard();
      const items = [];
      for (const block of result.data.blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) {
        items.push({ text: line.text, x: line.bbox.x0, y: (line.bbox.y0 + line.bbox.y1) / 2, height: line.bbox.y1 - line.bbox.y0 });
      }
      return { name, page, text: items.length ? mergeRows(items) : result.data.text, method: 'OCR', confidence: result.data.confidence };
    }
    async image(file) {
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 50000000) throw new Error('图片尺寸过大，请先裁剪到订舱单内容后重试');
        const scale = Math.min(2, 3000 / Math.max(bitmap.width, bitmap.height), Math.sqrt(8000000 / (bitmap.width * bitmap.height)));
        const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        try { return [await this.ocr(canvas, file.name || '粘贴的截图')]; } finally { canvas.width = canvas.height = 0; }
      } finally { bitmap.close(); }
    }
    async pdf(file, forceOCR) {
      this.progress('正在加载 PDF 提取组件…');
      await Promise.all([loadScript('vendor/pdf.js'), loadScript('vendor/pdf.worker.js'), loadScript('vendor/pdf-assets.js')]);
      this.guard();
      const BinaryDataFactory = class {
        async fetch({ filename }) {
          const data = window.BookingPDFAssets[filename];
          if (!data) throw new Error('PDF 字体或字形资源暂不支持：' + filename);
          return decode(data);
        }
      };
      this.pdfTask = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), BinaryDataFactory, useWorkerFetch: false, useWasm: false, enableXfa: false, isImageDecoderSupported: false, isOffscreenCanvasSupported: false, maxImageSize: 30000000, canvasMaxAreaInBytes: 32000000, verbosity: 0 });
      this.pdfTask.onPassword = () => { this.pdfTask?.destroy().catch(() => {}); };
      try {
        const pdf = await this.pdfTask.promise;
        if (pdf.numPages > 20) throw new Error('单个 PDF 最多识别 20 页，请拆分后导入');
        const result = [], nativePages = [];
        const recognizePage = async (page, n) => {
          const initial = page.getViewport({ scale: 1 });
          const scale = Math.min(4, 3000 / Math.max(initial.width, initial.height), Math.sqrt(8000000 / (initial.width * initial.height)));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          try { await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; return await this.ocr(canvas, file.name, n); }
          finally { canvas.width = canvas.height = 0; }
        };
        for (let n = 1; n <= pdf.numPages; n++) {
          this.guard(); this.progress(`正在读取 ${file.name} · 第 ${n} / ${pdf.numPages} 页`);
          const page = await pdf.getPage(n);
          try {
            const content = await page.getTextContent();
            const text = mergeRows(content.items.filter(i => i.str).map(i => ({ text: i.str, x: i.transform[4], y: -i.transform[5], height: i.height || 10 })));
            const readable = (text.match(/[\u3400-\u9fffA-Za-z0-9]/g) || []).length;
            if (!forceOCR && readable >= 60 && !/[\uFFFD]{3}/.test(text)) {
              const source = { name: file.name, page: n, text, method: 'PDF 文字' };
              result.push(source); nativePages.push(source);
            } else result.push(await recognizePage(page, n));
          } finally { page.cleanup(); }
        }
        // 英文日期可读不代表中文港口标签可读。按整个文件的实际字段覆盖检查，缺关键项才补 OCR。
        const critical = ['pol', 'pod', 'vessel'];
        const missingCritical = () => {
          const parsed = P.parse(result);
          return critical.filter(key => !parsed.candidates[key]?.length);
        };
        if (!forceOCR && missingCritical().length && nativePages.length) {
          const routePages = nativePages.filter(source => /ROUTE\s+INFORMATION|\b(?:ETD|ETA|PORT|VESSEL)\b|装.{0,4}港|卸.{0,4}港|航次/i.test(source.text));
          for (const source of routePages.length ? routePages : nativePages) {
            this.guard();
            const missing = missingCritical();
            if (!missing.length) break;
            const parsed = P.parse(result);
            const allowedFields = Object.keys(P.labels).filter(key => !parsed.candidates[key]?.length);
            if (allowedFields.includes('vessel')) allowedFields.push('voyage');
            this.progress(`文字层未识别 ${missing.map(key => P.labels[key]).join('、')}，正在图片补识别 · 第 ${source.page} 页`);
            const page = await pdf.getPage(source.page);
            try {
              const recovered = await recognizePage(page, source.page);
              // 补识别不能悄悄盖掉文字层；两种方法确有不同值时，保留双方候选交由用户核对。
              const imageFields = P.parse([recovered]).candidates;
              const compatible = (key, a, b) => {
                if (P.timeKeys.includes(key)) return a.value.slice(0, Math.min(a.value.length, b.value.length)) === b.value.slice(0, Math.min(a.value.length, b.value.length)) && (!a.rawZone || !b.rawZone || a.rawZone === b.rawZone);
                const first = P.keyOf(a.value), second = P.keyOf(b.value);
                return first === second || (['pol', 'pod', 'receipt', 'vessel'].includes(key) && (first.startsWith(second) || second.startsWith(first)));
              };
              for (const key of Object.keys(P.labels)) if (parsed.candidates[key]?.length && imageFields[key]?.some(image => !parsed.candidates[key].some(native => compatible(key, image, native)))) allowedFields.push(key);
              result.push({ ...recovered, method: 'PDF 图片补识别（OCR）', allowedFields,
                notices: ['PDF 文字层有关键字段缺失，已用页面图片补识别；若两种结果不同会列出候选，须核对后选择，不自动覆盖。'] });
            } catch (error) {
              this.guard();
              source.notices = [...(source.notices || []), '图片补识别未完成，已保留 PDF 文字结果；缺失字段请核对原文件后填写或重新导入。'];
            } finally { page.cleanup(); }
          }
        }
        return result;
      } catch (error) {
        if (/password|Password|destroyed/i.test(String(error))) throw new Error('PDF 已加密或读取已取消，请先解锁后导入');
        throw error;
      } finally { if (this.pdfTask) { await this.pdfTask.destroy(); this.pdfTask = null; } }
    }
    async read(file, forceOCR = false) {
      this.guard();
      if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('每个文件须小于 20 MB，且不能为空');
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return this.pdf(file, forceOCR);
      if (/^image\/(png|jpeg|webp|bmp)$/.test(file.type) || /\.(png|jpe?g|webp|bmp)$/i.test(file.name)) return this.image(file);
      throw new Error('请选择 PDF、PNG、JPG、WebP 或 BMP 文件');
    }
  }
  const zones = [
    ['unconfirmed', '原文时区待核实'], ['Asia/Shanghai', '上海 / 北京时间 UTC+8'], ['UTC', 'UTC'],
    ['America/Los_Angeles', '美国西岸当地时间（含夏令时）'], ['UTC-08:00', '固定 PST / UTC-8'], ['UTC-07:00', '固定 PDT / UTC-7'],
    ['UTC+08:00', '固定 UTC+8'], ['America/New_York', '美国东岸当地时间（含夏令时）'], ['Europe/Amsterdam', '荷兰当地时间（含夏令时）']
  ].map(([value, label]) => ({ value, label }));
  function open(host, todoDraft = {}) {
    const { esc, openForm, getOrders } = host;
    let sources = [], parsed = P.parse([]), scanner = null, active = true, busy = false, generation = 0, analyzed = false;
    const previewURLs = new Set();
    function releaseUnusedPreviews() {
      for (const url of previewURLs) if (!sources.some(source => source.previewURL === url)) { URL.revokeObjectURL(url); previewURLs.delete(url); }
    }
    const fields = [
      { key: 'so', label: 'SO 号（使用订舱号）', required: true },
      { key: 'sales', label: '销售', required: true },
      { key: 'receipt', label: '接货地', full: true },
      { key: 'pol', label: '装港 / 起运港', required: true }, { key: 'pod', label: '卸港 / 目的港', required: true },
      { key: 'vessel', label: '船名 / 航次', full: true },
      ...P.timeKeys.flatMap(key => [{ key, label: P.labels[key] + '（原文当地时间）', type: 'datetime-local' }, { key: 'zone_' + key, label: P.labels[key] + ' · 时区', type: 'select', options: zones, value: 'unconfirmed' }]),
      { key: 'bl', label: '提单号（可选，不把订舱号当提单号）' }, { key: 'wo', label: '工作号（可选）' },
      { key: 'title', label: '关联待办标题', value: todoDraft.title || '', required: true, full: true },
      { key: 'owner', label: '待办负责人', value: todoDraft.owner || '陈亦航', required: true },
      { key: 'due', label: '待办截止时间（上海时间，可空）', type: 'datetime-local', value: todoDraft.due || '' },
      { key: 'note', label: '待办备注', type: 'textarea', value: todoDraft.note || '', full: true }
    ];
    const inputHtml = `<section class="booking-input"><p>粘贴订舱单文字、截图或 PDF 文件，也可选择文件。支持多页；同一票订单可分多张截图添加。</p><div class="booking-actions"><button type="button" class="mini" id="bookingChoose">选择 PDF / 图片</button><button type="button" class="mini" id="bookingPaste">粘贴剪贴板</button><button type="button" class="mini" id="bookingAnalyze">识别文字并填充</button><button type="button" class="mini" id="bookingStop" hidden>取消识别</button><button type="button" class="mini" id="bookingClear">清空导入</button><label><input type="checkbox" id="bookingForceOCR">PDF 强制图片识别</label></div><input type="file" id="bookingFiles" accept="application/pdf,image/png,image/jpeg,image/webp,image/bmp,.pdf,.png,.jpg,.jpeg,.webp,.bmp" multiple hidden><label class="sr-only" for="bookingText">订舱单原文</label><textarea id="bookingText" rows="5" placeholder="在这里按 Ctrl+V 粘贴文字、截图或 PDF 文件；也可将文件拖到这里。"></textarea><small>文件在电脑浏览器内识别，不上传。单个文件最多 20 MB、20 页。可选取多份来源，但一次仅新建一票订单。</small><p id="bookingProgress" role="status" aria-live="polite"></p><ul id="bookingSources"></ul><details><summary>查看识别原文和候选值</summary><div id="bookingEvidence"></div></details></section><section class="booking-check" aria-labelledby="bookingCheckTitle"><h3 id="bookingCheckTitle">关联自检</h3><div id="bookingChecks" aria-live="polite">尚未识别。识别后会检查重复 SO、日期先后、时区及不同来源的冲突。</div></section><div class="booking-review"><label><input id="bookingReviewed" type="checkbox">我已对照原单核对字段、候选值和提示；未确认时区的船期暂不参与自动筛选。</label></div>`;
    let lastChecked = '';
    function read() {
      const data = host.readForm();
      data.timeZones = Object.fromEntries(P.timeKeys.map(key => [key, data['zone_' + key]]));
      return data;
    }
    function selfCheck() {
      if (!active) return;
      const data = read(), result = P.check(data, getOrders(), analyzed ? parsed : null);
      if (!data.title) result.errors.push('关联待办标题尚未填写');
      if (!data.owner) result.errors.push('待办负责人尚未填写');
      if (data.due && !P.validLocal(data.due)) result.errors.push('待办截止时间无效');
      const box = document.getElementById('bookingChecks');
      box.innerHTML = (result.errors.length ? '<h4>需要修正</h4><ul>' + result.errors.map(v => `<li class="check-error">${esc(v)}</li>`).join('') + '</ul>' : '<p class="check-pass">未发现阻止创建的关联矛盾。</p>') + (result.warnings.length ? '<h4>请核对</h4><ul>' + result.warnings.map(v => `<li>${esc(v)}</li>`).join('') + '</ul>' : '');
      const fingerprint = JSON.stringify(data);
      if (lastChecked && lastChecked !== fingerprint) document.getElementById('bookingReviewed').checked = false;
      lastChecked = fingerprint;
      for (const key of Object.keys(P.labels)) {
        const input = document.getElementById('mf-' + key);
        if (!input) continue;
        let hint = input.closest('.field').querySelector('.booking-field-status');
        if (!hint) { hint = document.createElement('small'); hint.className = 'field-hint booking-field-status'; input.closest('.field').appendChild(hint); }
        const count = parsed.candidates[key]?.length || 0;
        hint.textContent = !analyzed || input.value ? '' : count > 1 ? `识别出 ${count} 个不同值，请在上方候选中选择或对照原单填写。` : count === 0 ? '未能可靠识别，请查看原文件核对后补填或重新导入。' : '原文信息不完整，请对照原单补齐。';
        hint.hidden = !hint.textContent;
      }
      document.getElementById('modalSave').disabled = busy || !analyzed || result.errors.length > 0 || !document.getElementById('bookingReviewed').checked;
      return result;
    }
    function paintSources() {
      releaseUnusedPreviews();
      document.getElementById('bookingSources').innerHTML = sources.map((s, i) => `<li>${esc(s.name)} · 第 ${s.page || 1} 页 · ${esc(s.method || '文字')}${s.confidence != null ? ' · 引擎评分 ' + Math.round(s.confidence) : ''} ${s.previewURL ? `<a href="${esc(s.previewURL)}" target="_blank" rel="noopener noreferrer">查看原文件</a> ` : ''}<button type="button" class="mini" data-remove-source="${i}" aria-label="移除来源 ${esc(s.name)}">移除</button></li>`).join('');
      document.querySelectorAll('[data-remove-source]').forEach(button => button.onclick = () => { if (!busy) { sources.splice(Number(button.dataset.removeSource), 1); fill(); } });
    }
    function fill() {
      if (!active) return;
      parsed = P.parse(sources); analyzed = sources.length > 0;
      for (const key of Object.keys(P.labels)) {
        const el = document.getElementById('mf-' + key); if (!el) continue;
        const value = parsed.values[key] || '';
        if (P.timeKeys.includes(key)) {
          el.type = ['etd', 'eta'].includes(key) && value.length === 10 ? 'date' : 'datetime-local';
          el.value = value.length === 10 && !['etd', 'eta'].includes(key) ? '' : value;
          if (value.length === 10 && !['etd', 'eta'].includes(key)) parsed.notices.push(P.labels[key] + '原文只有日期，未虚构具体截止时刻，请手工补齐');
        } else el.value = value;
        if (P.timeKeys.includes(key)) document.getElementById('mf-zone_' + key).value = parsed.timeZones[key] || 'unconfirmed';
      }
      if (!todoDraft.title) document.getElementById('mf-title').value = parsed.values.so ? '跟进订舱 · ' + parsed.values.so : '';
      const evidence = document.getElementById('bookingEvidence');
      evidence.innerHTML = Object.entries(parsed.candidates).filter(([key]) => P.labels[key]).map(([key, entries]) => `<div class="booking-candidate"><b>${esc(P.labels[key])}</b>${entries.length > 1 ? `<select data-candidate="${key}" aria-label="选择${esc(P.labels[key])}候选值"><option value="">多个候选，请选择或在下方手工填写</option>${entries.map((entry, i) => `<option value="${i}">${esc(entry.raw)} · ${esc(entry.source)} 第${entry.page}页 · ${esc(entry.method || '文字')}</option>`).join('')}</select>` : ''}${entries.map(e => `<p>${esc(e.raw)} <small>来源：${esc(e.source)} · 第 ${e.page} 页 · ${esc(e.method || '文字')}</small></p>`).join('')}</div>`).join('') + sources.map(source => `<h4>${esc(source.name)} · 第 ${source.page || 1} 页 · ${esc(source.method || '文字')}</h4><pre>${esc(source.text)}</pre>`).join('');
      document.querySelectorAll('[data-candidate]').forEach(select => select.onchange = () => {
        const key = select.dataset.candidate, entry = parsed.candidates[key][Number(select.value)];
        if (select.value === '' || !entry) return;
        const input = document.getElementById('mf-' + key);
        if (P.timeKeys.includes(key)) input.type = ['etd', 'eta'].includes(key) && entry.value.length === 10 ? 'date' : 'datetime-local';
        input.value = P.timeKeys.includes(key) && entry.value.length === 10 && !['etd', 'eta'].includes(key) ? '' : entry.value;
        if (P.timeKeys.includes(key)) document.getElementById('mf-zone_' + key).value = entry.zone;
        selfCheck();
      });
      if (Object.values(parsed.candidates).some(entries => entries.length > 1)) evidence.closest('details').open = true;
      document.getElementById('bookingReviewed').checked = false;
      paintSources(); selfCheck();
    }
    function progress(text) { if (active) document.getElementById('bookingProgress').textContent = text; }
    function setBusy(value) {
      busy = value;
      if (value) document.getElementById('bookingReviewed').checked = false;
      for (const id of ['bookingChoose', 'bookingPaste', 'bookingAnalyze', 'bookingClear', 'bookingFiles', 'bookingForceOCR']) document.getElementById(id).disabled = value;
      document.getElementById('bookingStop').hidden = !value;
      selfCheck();
    }
    function analyzeText() {
      if (busy) return;
      const text = document.getElementById('bookingText').value.trim();
      if (!text) { progress('请先粘贴原文，或选择 PDF / 图片。'); return; }
      if (text.length > 100000) { progress('粘贴文字超过 10 万字，请只保留当前一票订舱单。'); return; }
      sources = sources.filter(s => s.name !== '粘贴文字'); sources.push({ name: '粘贴文字', page: 1, text, method: '文字' }); fill(); progress('文字已识别，请核对自动填充内容。');
    }
    async function readFiles(files) {
      if (busy || !active) return;
      if (!files.length || files.length > 10 || files.reduce((sum, f) => sum + f.size, 0) > 40 * 1024 * 1024) { progress('每次最多选择 10 个文件，总大小不超过 40 MB。'); return; }
      const token = ++generation; setBusy(true);
      const current = scanner = new Scanner(progress);
      let timer = setTimeout(() => { current.stop().catch(() => {}); if (active && token === generation) { progress('识别超时，已停止。请裁剪图片或分批导入后重试。'); generation++; setBusy(false); } }, 180000);
      try {
        const next = [];
        for (const file of files) {
          const pages = await current.read(file, document.getElementById('bookingForceOCR').checked);
          current.guard();
          const previewURL = URL.createObjectURL(file); previewURLs.add(previewURL);
          next.push(...pages.map(source => ({ ...source, previewURL })));
        }
        if (!active || token !== generation) return;
        if (sources.length + next.length > 40) throw new Error('当前来源已超过 40 页，请只导入同一票相关页面');
        sources.push(...next); fill();
        const unclear = ['pol', 'pod', 'vessel'].filter(key => !parsed.values[key]);
        progress(unclear.length ? '识别完成；' + unclear.map(key => P.labels[key]).join('、') + '尚需核对，已在字段下说明原因。' : '识别完成，请对照原单核对并处理自检提示。');
      } catch (error) { if (active && token === generation) progress('未完成导入：' + (error.message || String(error))); }
      finally { clearTimeout(timer); await current.stop().catch(() => {}); releaseUnusedPreviews(); if (scanner === current) scanner = null; if (active && token === generation) setBusy(false); }
    }
    function cleanup() {
      active = false; generation++;
      for (const url of previewURLs) URL.revokeObjectURL(url);
      previewURLs.clear();
      scanner?.stop().catch(() => {});
      const save = document.getElementById('modalSave'); save.disabled = false;
      document.getElementById('modalBody').removeEventListener('input', change);
      document.getElementById('modalBody').removeEventListener('change', change);
    }
    function change(event) {
      if (event.target.id === 'bookingText') { if (analyzed) { analyzed = false; progress('粘贴文字已修改，请重新点击“识别文字并填充”，再核对。'); } }
      selfCheck();
    }
    openForm('导入订舱单 · 新建订单与待办', fields, () => {
      const data = read(), result = selfCheck();
      if (!analyzed || busy || result.errors.length || !document.getElementById('bookingReviewed').checked) return false;
      const order = Object.fromEntries(['so', 'sales', 'receipt', 'pol', 'pod', 'vessel', 'bl', 'wo', ...P.timeKeys].map(key => [key, data[key]]));
      order.timeZones = data.timeZones;
      order.importSource = { importedAt: new Date().toISOString(), documents: sources.map(s => ({ name: s.name, page: s.page || 1, method: s.method, confidence: s.confidence })), candidates: parsed.candidates, sourceTimes: parsed.sourceTimes, reviewed: true, warnings: result.warnings };
      // 原文和原图仅留在本次核对界面；保存字段证据，不把文件塞入浏览器配额。
      const todo = { title: data.title, owner: data.owner, due: data.due, note: data.note, so: order.so };
      const ok = host.create(order, todo);
      if (ok === false) return false;
      cleanup(); return true;
    }, { wide: true, bodyHtml: inputHtml, submitText: '确认新建订单并关联待办', wire: () => {
      document.getElementById('modal').classList.add('booking-modal');
      document.getElementById('modalBody').append(document.querySelector('.booking-check'), document.querySelector('.booking-review'));
      document.getElementById('modal').addEventListener('close', () => { cleanup(); document.getElementById('modal').classList.remove('booking-modal'); }, { once: true });
      document.getElementById('modalBody').addEventListener('input', change);
      document.getElementById('modalBody').addEventListener('change', change);
      document.getElementById('bookingChoose').onclick = () => document.getElementById('bookingFiles').click();
      document.getElementById('bookingFiles').onchange = event => { readFiles([...event.target.files]); event.target.value = ''; };
      document.getElementById('bookingAnalyze').onclick = analyzeText;
      document.getElementById('bookingStop').onclick = () => { generation++; scanner?.stop().catch(() => {}); setBusy(false); progress('识别已取消，未创建订单。'); };
      document.getElementById('bookingClear').onclick = () => { sources = []; document.getElementById('bookingText').value = ''; fill(); progress('已清空导入内容，可重新导入同一票文件。'); };
      const area = document.getElementById('bookingText');
      area.addEventListener('paste', event => {
        const files = [...(event.clipboardData?.files || [])];
        if (files.length) { event.preventDefault(); readFiles(files); }
        else if (!busy) setTimeout(analyzeText, 0);
      });
      area.ondragover = event => event.preventDefault();
      area.ondrop = event => { event.preventDefault(); readFiles([...(event.dataTransfer.files || [])]); };
      document.getElementById('bookingPaste').onclick = async () => {
        try {
          if (!navigator.clipboard?.read) throw new Error();
          const items = await navigator.clipboard.read(); const files = []; let text = '';
          for (const item of items) {
            const type = item.types.find(t => t === 'application/pdf' || /^image\/(png|jpeg|webp|bmp)$/.test(t));
            if (type) { const blob = await item.getType(type); files.push(new File([blob], '剪贴板.' + (type === 'application/pdf' ? 'pdf' : type.split('/')[1]), { type })); }
            else if (item.types.includes('text/plain')) text += await (await item.getType('text/plain')).text();
          }
          if (files.length) await readFiles(files);
          else if (text) { area.value = text; analyzeText(); }
          else progress('剪贴板中没有可识别的文字或图片；复制 PDF 文件请在输入区按 Ctrl+V。');
        } catch { progress('浏览器未允许读取剪贴板。请点击输入区并按 Ctrl+V，或选择文件导入。'); area.focus(); }
      };
      selfCheck();
    } });
  }
  return { open, Scanner, mergeRows, zones };
})();
