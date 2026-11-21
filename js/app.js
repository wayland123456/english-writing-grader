/* ============================================================
   app.js — 平台主控
   ============================================================ */

(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => Engine.escapeAttr(s == null ? '' : s);

  const HISTORY_KEY = 'mb_en_history_v1';
  const HISTORY_MAX = 100;

  const state = {
    genre: 'letter',
    points: [],
    images: [],        // 作文图片 {dataUrl}
    promptImages: [],  // 试题图片 {dataUrl}
    analysis: null,
    result: null,
    busy: false,
    ocrBusy: false
  };

  const GENRES = {
    letter: '书信 / 邮件',
    notice: '通知 / 公告',
    speech: '演讲稿',
    application: '申请信 / 自荐信',
    other: '其他应用文'
  };

  /* ============================================================
     启动
     ============================================================ */
  function init() {
    bindTabs();
    bindForm();
    bindUpload();
    bindSettings();
    bindModal();
    renderPresetOptions();
    loadSettingsToForm();
    renderPoints();
    renderHistory();
    updateWordCount();

    if (PRESETS.length) {
      const sel = $('#presetSelect');
      sel.value = PRESETS[0].id;
      applyPreset(PRESETS[0].id);
    }

    // 演示模式：?demo=1 自动走一遍完整流程
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('demo') === '1' && PRESETS.length) {
        const p = PRESETS[0];
        $('#essayText').value = p.demo;
        $('#studentName').value = '示例学生';
        updateWordCount();
        switchMode('type');
        setTimeout(doGrade, 300);
      }
      if (q.get('tab')) switchTab(q.get('tab'));
    } catch (e) {}
  }

  /* ============================================================
     标签页
     ============================================================ */
  function bindTabs() {
    $('#mainTabs').addEventListener('click', e => {
      const btn = e.target.closest('.tab');
      if (btn) switchTab(btn.dataset.tab);
    });
  }

  function switchTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    if (name === 'history') renderHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============================================================
     题目模板
     ============================================================ */
  function renderPresetOptions() {
    const sel = $('#presetSelect');
    sel.innerHTML = '<option value="">自定义题目</option>' +
      PRESETS.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  }

  function applyPreset(id) {
    const p = PRESETS.find(x => x.id === id);
    if (!p) return;
    $('#promptText').value = p.prompt;
    state.points = p.points.map(x => ({ title: x.title, keys: x.keys }));
    // 题库自带体裁
    if (p.format === false) {
      $('#genreSelect').value = 'notice';
      state.genre = 'notice';
    } else {
      $('#genreSelect').value = 'letter';
      state.genre = 'letter';
    }
    renderPoints();
  }

  /* ============================================================
     要点编辑
     ============================================================ */
  function renderPoints() {
    const box = $('#pointsList');
    if (!state.points.length) state.points = [{ title: '', keys: '' }];

    box.innerHTML = state.points.map((p, i) => `
      <div class="point-row" data-i="${i}">
        <div class="point-idx">${i + 1}</div>
        <div class="point-fields">
          <input class="p-title" value="${esc(p.title)}" placeholder="要点描述，如：对课程的整体评价">
          <input class="p-key" value="${esc(p.keys)}" placeholder="英文关键词（可选），如：helpful,enjoy,improve">
        </div>
        <button class="point-del" title="删除该要点">✕</button>
      </div>`).join('');

    $$('.point-row', box).forEach(row => {
      const i = +row.dataset.i;
      $('.p-title', row).addEventListener('input', e => { state.points[i].title = e.target.value; });
      $('.p-key', row).addEventListener('input', e => { state.points[i].keys = e.target.value; });
      $('.point-del', row).addEventListener('click', () => {
        if (state.points.length <= 1) state.points = [{ title: '', keys: '' }];
        else state.points.splice(i, 1);
        renderPoints();
      });
    });
  }

  /* ============================================================
     表单
     ============================================================ */
  function bindForm() {
    $('#genreSelect').addEventListener('change', e => { state.genre = e.target.value; });
    $('#presetSelect').addEventListener('change', e => {
      if (e.target.value) applyPreset(e.target.value);
    });

    $('#btnAddPoint').addEventListener('click', () => {
      state.points.push({ title: '', keys: '' });
      renderPoints();
      const rows = $$('.point-row');
      const last = rows[rows.length - 1];
      if (last) $('.p-title', last).focus();
    });

    $('#essayText').addEventListener('input', updateWordCount);

    $$('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => switchMode(btn.dataset.mode));
    });

    $('#btnSample').addEventListener('click', () => {
      const p = PRESETS.find(x => x.id === $('#presetSelect').value) || PRESETS[0];
      if (!p) return;
      applyPreset(p.id);
      $('#presetSelect').value = p.id;
      $('#essayText').value = p.demo;
      switchMode('type');
      updateWordCount();
      status('已载入示例题目与作文，可直接点「开始批改」');
    });

    $('#btnGrade').addEventListener('click', doGrade);
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doGrade();
    });
  }

  function switchMode(mode) {
    $$('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    $('#mode-handwrite').classList.toggle('active', mode === 'handwrite');
    $('#mode-type').classList.toggle('active', mode === 'type');
  }

  function updateWordCount() {
    const n = Engine.countWords($('#essayText').value);
    const R = RUBRIC.rules;
    $('#liveCount').textContent = n;
    const hint = $('#wcHint');
    if (!n) { hint.textContent = ''; hint.className = 'wc-hint'; return; }
    if (n < R.wordMin) {
      hint.textContent = `少于 ${R.wordMin} 词，将扣 ${R.wordPenalty} 分`;
      hint.className = 'wc-hint wc-warn';
    } else if (n > R.wordMax) {
      hint.textContent = `超过 ${R.wordMax} 词，将扣 ${R.wordPenalty} 分`;
      hint.className = 'wc-hint wc-warn';
    } else {
      hint.textContent = '词数符合要求（60–100）';
      hint.className = 'wc-hint wc-ok';
    }
  }

  function status(msg, type) {
    const el = $('#statusLine');
    el.textContent = msg || '';
    el.className = 'status-line' + (type ? ' ' + type : '');
  }

  /* ============================================================
     图片上传
     ============================================================ */
  function bindUpload() {
    const zones = [
      { zone: $('#uploadZone'), input: $('#fileInput'), kind: 'essay' },
      { zone: $('#promptZone'), input: $('#promptFileInput'), kind: 'prompt' }
    ];

    zones.forEach(({ zone, input, kind }) => {
      zone.addEventListener('click', () => input.click());
      input.addEventListener('change', e => {
        addFiles(Array.from(e.target.files || []), kind);
        e.target.value = '';
      });
      ['dragenter', 'dragover'].forEach(ev =>
        zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('dragover'); }));
      ['dragleave', 'drop'].forEach(ev =>
        zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('dragover'); }));
      zone.addEventListener('drop', e => {
        addFiles(Array.from(e.dataTransfer.files || []), kind);
      });
    });

    $('#btnOcr').addEventListener('click', () => runOcr('essay'));
    $('#btnPromptOcr').addEventListener('click', () => runOcr('prompt'));
  }

  async function addFiles(files, kind) {
    const imgs = files.filter(f => /^image\//.test(f.type));
    if (!imgs.length) return;
    status('正在压缩图片…', 'busy');
    for (const f of imgs) {
      try {
        const dataUrl = await compressImage(f);
        if (kind === 'essay') state.images.push({ dataUrl });
        else state.promptImages.push({ dataUrl });
      } catch (e) { console.error(e); }
    }
    renderImages(kind);
    status('');
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1600;
          let w = img.width, h = img.height;
          if (Math.max(w, h) > MAX) {
            const r = MAX / Math.max(w, h);
            w = Math.round(w * r); h = Math.round(h * r);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderImages(kind) {
    const isEssay = kind === 'essay';
    const list = isEssay ? $('#imageList') : $('#promptImageList');
    const arr = isEssay ? state.images : state.promptImages;

    list.innerHTML = arr.map((img, idx) => `
      <div class="image-item" data-i="${idx}">
        <span class="order">${idx + 1}</span>
        <button class="remove" title="删除">×</button>
        <img src="${img.dataUrl}" alt="第 ${idx + 1} 页">
      </div>`).join('');

    $$('.image-item', list).forEach(el => {
      $('.remove', el).addEventListener('click', ev => {
        ev.stopPropagation();
        arr.splice(+el.dataset.i, 1);
        renderImages(kind);
      });
    });

    const btn = isEssay ? $('#btnOcr') : $('#btnPromptOcr');
    btn.disabled = arr.length === 0;
  }

  /* ============================================================
     手写 / 试题识别
     ============================================================ */
  async function runOcr(kind) {
    const isEssay = kind === 'essay';
    const arr = isEssay ? state.images : state.promptImages;
    if (!arr.length || state.ocrBusy) return;

    const btn = isEssay ? $('#btnOcr') : $('#btnPromptOcr');
    const original = btn.textContent;
    state.ocrBusy = true;
    btn.disabled = true;
    btn.textContent = '识别中…';
    status(`AI 正在${isEssay ? '按页序识别手写作文' : '识别试题'}（${arr.length} 张）…`, 'busy');

    try {
      const text = await API.ocrImages(arr.map(x => x.dataUrl), kind);

      if (isEssay) {
        const box = $('#essayText');
        box.value = box.value.trim() ? box.value.trim() + '\n\n' + text : text;
        switchMode('type');
        updateWordCount();
        status(`识别完成，共 ${Engine.countWords(text)} 词。手写识别可能有误差，请逐句核对后再批改。`, 'ok');
      } else {
        const box = $('#promptText');
        box.value = box.value.trim() ? box.value.trim() + '\n' + text : text;
        status('试题识别完成，已填入「题干」，请检查后开始批改。', 'ok');
      }
    } catch (e) {
      status('识别失败：' + e.message, 'err');
      if (/Key|设置/.test(e.message)) switchTab('settings');
    } finally {
      state.ocrBusy = false;
      btn.disabled = arr.length === 0;
      btn.textContent = original;
    }
  }

  /* ============================================================
     批改主流程
     ============================================================ */
  async function doGrade() {
    if (state.busy) return;

    const essay = $('#essayText').value.trim();
    if (!essay) {
      status('请先输入或识别学生作文内容', 'err');
      switchMode('type');
      return;
    }

    const student = $('#studentName').value.trim();
    const prompt = $('#promptText').value.trim();
    const genre = state.genre;
    const needFormat = (genre === 'letter' || genre === 'application');
    const points = state.points
      .filter(p => (p.title || '').trim() || (p.keys || '').trim())
      .map(p => ({ title: (p.title || '').trim(), keys: (p.keys || '').trim() }));

    const btn = $('#btnGrade');
    state.busy = true;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>批改中…';
    status('正在按五档细则比对要点与语言特征…', 'busy');

    try {
      const analysis = Engine.analyze(essay, { points });
      let result;

      if (API.isReady()) {
        status('AI 正在逐句评阅（约 10–30 秒）…', 'busy');
        try {
          const ai = await API.grade({ prompt, points, essay, genre, analysis });

          // 用 AI 的维度与要点覆盖，走统一的硬规则（封顶/扣分/档内定分）
          const core = Engine.finalize(ai.dims, {
            words: analysis.words,
            coverage: ai.points,
            needFormat,
            lowLevelErrors: (ai.errors || []).filter(e => e.severity === 'major').length,
            format: analysis.format
          });

          result = Object.assign({}, ai, core, {
            points: ai.points,
            errors: { list: ai.errors, total: ai.errors.length, counts: {}, lowLevel: 0 }
          });
        } catch (err) {
          console.warn('[AI 批改失败]', err);
          status('AI 批改失败，已改用本地规则引擎：' + err.message.slice(0, 50), 'err');
          result = localGrade(analysis, points, needFormat);
          result.source = 'local-fallback';
        }
      } else {
        result = localGrade(analysis, points, needFormat);
      }

      state.analysis = analysis;
      state.result = result;

      const data = { analysis, result, student, genre };
      renderResult(data);
      saveHistory(data);

      if (!result.aiError) {
        status(`批改完成：${result.score} 分 · ${result.bandDef.label}`, 'ok');
      }

      if (window.innerWidth <= 1060) {
        setTimeout(() => {
          const el = $('#resultCard');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
      }
    } catch (e) {
      console.error(e);
      status('批改出错：' + e.message, 'err');
    } finally {
      state.busy = false;
      btn.disabled = false;
      btn.textContent = '开始批改';
    }
  }

  function localGrade(analysis, points, needFormat) {
    const r = Engine.grade(analysis, { points, needFormat });
    return Object.assign({}, r, {
      source: 'local',
      points: analysis.coverage.map(c => ({
        index: c.index,
        title: c.title,
        status: c.status,
        matched: c.matched,
        keys: c.keys,
        evidence: '',
        auto: c.auto
      })),
      errors: analysis.errors
    });
  }

  /* ============================================================
     结果渲染
     ============================================================ */
  function bandColor(band) {
    return { 5: '#4ade80', 4: '#60a5fa', 3: '#fbbf24', 2: '#fb923c', 1: '#f87171', 0: '#94a3b8' }[band] || '#94a3b8';
  }

  function dimColor(v) {
    if (v >= 80) return 'linear-gradient(90deg,#2d6a4f,#4ade80)';
    if (v >= 60) return 'linear-gradient(90deg,#1f4e79,#2e6da4)';
    if (v >= 40) return 'linear-gradient(90deg,#b07d2b,#d9a13f)';
    return 'linear-gradient(90deg,#b03a2e,#d9534f)';
  }

  function renderResult(d) {
    const a = d.analysis, r = d.result;
    $('#resultEmpty').hidden = true;
    const box = $('#resultContent');
    box.classList.remove('hidden');

    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    box.innerHTML = `
      <div class="report-head">
        <div>
          <div class="report-school">武汉市江夏实验高级中学</div>
          <div class="report-subtitle">高考英语应用文批改报告</div>
        </div>
        <div class="report-meta">
          学生：<b>${esc(d.student || '未填写')}</b><br>
          ${GENRES[d.genre] || GENRES.other} · ${a.words} 词<br>
          ${stamp}
        </div>
      </div>

      ${heroHtml(r)}

      <div class="report-section">
        <div class="section-title">一、总评</div>
        <div class="comment-box">${esc(r.verdict)}</div>
        ${adviceHtml(r)}
      </div>

      <div class="report-section">
        <div class="section-title">二、能力维度<span class="count">加权综合 ${r.composite || 0}</span></div>
        <div class="dims-wrap">
          <div>${radarSVG(r.dims)}</div>
          <div class="dim-bars">
            ${RUBRIC.dims.map(dim => {
              const v = (r.dims && r.dims[dim.key]) || 0;
              return `<div class="dim-bar">
                <span class="dim-name">${dim.name}</span>
                <span class="dim-track"><span class="dim-fill" style="width:${v}%;background:${dimColor(v)}"></span></span>
                <span class="dim-val">${v}</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="report-section">
        <div class="section-title">三、内容要点<span class="count">${(r.points || []).filter(p => p.status === 'hit').length} / ${(r.points || []).length}</span></div>
        ${pointsHtml(r)}
      </div>

      <div class="report-section">
        <div class="section-title">四、档位与扣分<span class="count">${r.totalDed ? r.totalDed + ' 分' : '无扣分'}</span></div>
        ${deductionHtml(r)}
      </div>

      <div class="report-section">
        <div class="section-title">五、语言诊断</div>
        ${diagnosisHtml(a)}
      </div>

      <div class="report-section">
        <div class="section-title">六、语言错误<span class="count">${((r.errors && r.errors.list) || []).length} 处</span></div>
        ${errorHtml(r)}
      </div>

      <div class="report-section">
        <div class="section-title">七、五档对照<span class="count">当前 ${r.bandDef.label}</span></div>
        <div class="ladder">
          ${RUBRIC.bands.filter(b => b.id > 0).map(b => `
            <div class="rung ${b.id === r.band ? 'active' : ''}">
              <div>
                <div class="rung-label">${b.label}</div>
                <span class="rung-score">${b.min}–${b.max} 分</span>
              </div>
              <div class="rung-desc">${esc(b.desc)}</div>
            </div>`).join('')}
        </div>
      </div>

      <div class="report-actions">
        <button class="btn btn-primary" id="btnPdf">下载 PDF 报告</button>
        <button class="btn btn-outline" id="btnPrint">打印</button>
        <button class="btn btn-outline" id="btnCopy">复制评语</button>
      </div>
    `;

    // 要点人工修正
    $$('#resultContent .pt-item').forEach(el => {
      el.addEventListener('click', () => togglePoint(+el.dataset.i));
    });

    $('#btnPdf').addEventListener('click', () => exportPdf(d));
    $('#btnPrint').addEventListener('click', () => {
      try { Report.printReport(d); } catch (e) { toast(e.message); }
    });
    $('#btnCopy').addEventListener('click', () => {
      copyText(buildPlainText(d)).then(() => toast('评语已复制到剪贴板'));
    });
  }

  function heroHtml(r) {
    const color = bandColor(r.band);
    const tag = r.source === 'ai' ? 'AI 语义评分 · 规则复核'
      : r.source === 'local-fallback' ? 'AI 失败 · 已用本地引擎'
        : '本地规则引擎';
    return `
    <div class="score-hero">
      <div class="score-big">
        <div class="score-num" style="color:${color}">${r.score}</div>
        <div class="score-total">满分 15 分</div>
      </div>
      <div class="score-side">
        <div class="level-badge" style="color:${color}"><span class="dot"></span>${r.bandDef.label} · ${r.bandDef.min}–${r.bandDef.max} 分 · ${r.bandDef.short}</div>
        <p class="verdict">${esc(r.verdict)}</p>
        <div class="score-foot">
          <span class="tag-soft">${tag}</span>
          <span class="tag-soft">综合分 ${r.composite || 0}/100</span>
          ${r.totalDed ? `<span class="tag-soft">扣分 ${r.totalDed}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  function adviceHtml(r) {
    const s = r.strengths || [], w = r.weaknesses || [];
    let html = '';
    if (s.length || w.length) {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:11px;">';
      if (s.length) html += `<div><div class="chip-label" style="color:var(--green)">值得肯定</div>
        <ul class="advice-list">${s.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
      if (w.length) html += `<div><div class="chip-label" style="color:var(--red)">主要问题</div>
        <ul class="advice-list">${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
      html += '</div>';
    }
    if (r.upgrade) {
      html += `<div class="chip-label" style="margin-top:11px">升格示范</div>
        <div class="upgrade-box">${esc(r.upgrade)}</div>`;
    }
    return html;
  }

  function pointsHtml(r) {
    const pts = r.points || [];
    if (!pts.length) return '<p class="form-hint">本题未设置内容要点，未参与要点判定。</p>';

    return pts.map((p, i) => {
      const keys = Array.isArray(p.keys) ? p.keys
        : String(p.keys || '').split(/[,，;；|]/).map(s => s.trim()).filter(Boolean);
      const matched = (p.matched || []).map(String);

      const keysHtml = keys.length
        ? keys.map(k => {
          const hit = matched.some(m =>
            m.toLowerCase().includes(String(k).toLowerCase()) ||
            String(k).toLowerCase().includes(m.toLowerCase()));
          return hit ? `<em>${esc(k)}</em>` : esc(k);
        }).join('、')
        : '未设英文关键词';

      return `<div class="pt-item ${p.status === 'hit' ? 'hit' : 'miss'}" data-i="${i}" title="点击切换判定">
        <span class="pt-mark">${p.status === 'hit' ? '✓' : '✕'}</span>
        <div class="pt-body">
          <div class="pt-title">${i + 1}. ${esc(p.title)}</div>
          <div class="pt-keys">${keysHtml}</div>
          ${p.evidence ? `<div class="pt-evidence">${esc(p.evidence)}</div>` : ''}
        </div>
      </div>`;
    }).join('') + '<p class="form-hint">点击任意要点可人工修正判定，分数会立即按细则重算。</p>';
  }

  function deductionHtml(r) {
    const caps = r.caps || [], deds = r.deductions || [];
    let html = '';
    if (caps.length) {
      html += '<div class="ded-group-label">档位限制</div>';
      html += caps.map(c => `<div class="ded-item">
        <span class="ded-name">${esc(c.reason)}</span>
        <span class="ded-val cap">${c.drop ? '降 ' + c.drop + ' 档' : '封顶第' + ['零', '一', '二', '三', '四', '五'][c.cap] + '档'}</span>
      </div>`).join('');
    }
    if (deds.length) {
      html += '<div class="ded-group-label">分数扣减</div>';
      html += deds.map(x => `<div class="ded-item">
        <span class="ded-name">${esc(x.name)}<small>${esc(x.detail)}</small></span>
        <span class="ded-val">${x.value}</span>
      </div>`).join('');
    }
    if (!caps.length && !deds.length) {
      return '<p class="form-hint">未触发任何档位限制或分数扣减。</p>';
    }
    return html;
  }

  function diagnosisHtml(a) {
    const c = a.connectives || { adv: [], mid: [], basic: [] };
    const pns = a.patterns || { high: [], mid: [], highCount: 0, midCount: 0 };
    const v = a.vocab || { advancedHit: [], guiraud: 0, avgWordLen: 0, derivationRatio: 0 };

    const chip = (t, cls) => `<span class="chip ${cls}">${esc(t)}</span>`;

    const row = (label, arr, cls) => `
      <div class="chip-group">
        <div class="chip-label">${label}（${arr.length}）</div>
        <div class="chips">${arr.length ? arr.map(x => chip(x, cls)).join('') : '<span class="chip none">未使用</span>'}</div>
      </div>`;

    return `
      <div class="chip-group">
        <div class="chip-label">高级句式（拉开档次的关键）</div>
        <div class="chips">${pns.high && pns.high.length
          ? pns.high.map(p => chip(p.label + ' ×' + p.matches.length, 'hi')).join('')
          : '<span class="chip none">未检出复杂结构</span>'}</div>
      </div>
      <div class="chip-group">
        <div class="chip-label">从句与一般结构</div>
        <div class="chips">${pns.mid && pns.mid.length
          ? pns.mid.map(p => chip(p.label + ' ×' + p.matches.length, 'mid')).join('')
          : '<span class="chip none">未检出从句结构</span>'}</div>
      </div>
      ${row('高级衔接', c.adv, 'hi')}
      ${row('中级衔接', c.mid, 'mid')}
      ${row('基础连接', c.basic, '')}
      <div class="chip-group">
        <div class="chip-label">词汇指标</div>
        <div class="chips">
          <span class="chip">高级词 ${v.advancedHit.length} 个</span>
          <span class="chip">多样性 ${v.guiraud}</span>
          <span class="chip">平均词长 ${v.avgWordLen}</span>
          <span class="chip">派生词 ${Math.round((v.derivationRatio || 0) * 100)}%</span>
          <span class="chip">句均 ${a.avgSentenceLen} 词</span>
        </div>
      </div>
      ${v.advancedHit.length ? `<div class="chip-group">
        <div class="chip-label">命中的高级词汇</div>
        <div class="chips">${v.advancedHit.slice(0, 16).map(w => chip(w, 'hi')).join('')}
        ${v.advancedHit.length > 16 ? `<span class="chip">…等 ${v.advancedHit.length} 个</span>` : ''}</div>
      </div>` : ''}
      <div class="chip-group">
        <div class="chip-label">原文标注（<span style="color:#1e40af">蓝</span>＝亮点句型 ／ <span style="color:#7a5a10">黄</span>＝衔接词 ／ <span style="color:#b03a2e">红</span>＝错误）</div>
        <div class="annotated">${Engine.annotate(a)}</div>
      </div>`;
  }

  function errorHtml(r) {
    const errs = (r.errors && r.errors.list) || [];
    if (!errs.length) return '<p class="form-hint">未检测到明显的拼写、搭配或语法错误。</p>';

    return `<table class="err-table">
      <thead><tr>
        <th style="width:58px">类型</th>
        <th style="width:26%">原文</th>
        <th style="width:26%">应改为</th>
        <th>说明</th>
      </tr></thead>
      <tbody>${errs.map(e => `<tr>
        <td><span class="sev ${e.severity === 'major' ? 'major' : 'minor'}">${esc(e.type)}</span></td>
        <td><span class="err-wrong">${esc(e.wrong)}</span></td>
        <td><span class="err-right">${esc(e.right)}</span></td>
        <td class="err-reason">${esc(e.reason)}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }

  function radarSVG(dims) {
    const list = RUBRIC.dims;
    const n = list.length;
    const cx = 100, cy = 100, R = 68;
    const ang = i => -Math.PI / 2 + i * (Math.PI * 2 / n);
    const pt = (i, k) => [cx + R * k * Math.cos(ang(i)), cy + R * k * Math.sin(ang(i))];
    const poly = k => list.map((_, i) => pt(i, k).map(x => x.toFixed(1)).join(',')).join(' ');

    let grid = '';
    [0.25, 0.5, 0.75, 1].forEach(k => {
      grid += `<polygon points="${poly(k)}" fill="${k === 1 ? '#fbfaf7' : 'none'}" stroke="#e6e1d8" stroke-width="1"/>`;
    });
    const axes = list.map((_, i) => {
      const [x, y] = pt(i, 1);
      return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#eeebe4" stroke-width="1"/>`;
    }).join('');
    const dataPts = list.map((d, i) => pt(i, ((dims && dims[d.key]) || 0) / 100).map(x => x.toFixed(1)).join(',')).join(' ');
    const dots = list.map((d, i) => {
      const [x, y] = pt(i, ((dims && dims[d.key]) || 0) / 100);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#1f4e79"/>`;
    }).join('');
    const labels = list.map((d, i) => {
      const [x, y] = pt(i, 1.25);
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="9.5" fill="#5a6470" text-anchor="middle" dominant-baseline="middle">${d.name}</text>`;
    }).join('');

    return `<svg viewBox="0 0 200 200" width="190" height="190" style="display:block;margin:0 auto">
      ${grid}${axes}
      <polygon points="${dataPts}" fill="rgba(31,78,121,.15)" stroke="#1f4e79" stroke-width="1.7" stroke-linejoin="round"/>
      ${dots}${labels}
    </svg>`;
  }

  /* ============================================================
     人工修正要点
     ============================================================ */
  function togglePoint(i) {
    const r = state.result, a = state.analysis;
    if (!r || !a || !r.points || !r.points[i]) return;

    const p = r.points[i];
    p.status = p.status === 'hit' ? 'miss' : 'hit';

    const dims = Object.assign({}, r.dims);
    const autoPts = r.points.filter(x => x.status !== 'unknown');
    const hitN = autoPts.filter(x => x.status === 'hit').length;
    if (autoPts.length) dims.content = Math.round(15 + 85 * Math.pow(hitN / autoPts.length, 0.8));

    const needFormat = (state.genre === 'letter' || state.genre === 'application');
    const core = Engine.finalize(dims, {
      words: a.words,
      coverage: r.points,
      needFormat,
      lowLevelErrors: ((r.errors && r.errors.list) || []).filter(e => e.severity === 'major').length,
      format: a.format
    });

    Object.assign(r, core, { dims });

    if (r.source !== 'ai') {
      r.verdict = Engine.grade(a, { points: state.points, coverage: r.points, needFormat }).verdict;
    }

    const d = {
      analysis: a,
      result: r,
      student: $('#studentName').value.trim(),
      genre: state.genre
    };
    renderResult(d);
    toast(`要点已改为「${p.status === 'hit' ? '已覆盖' : '未覆盖'}」，重算得分 ${r.score} 分`);
  }

  /* ============================================================
     PDF / 复制
     ============================================================ */
  async function exportPdf(d) {
    const btn = $('#btnPdf');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '生成中…';
    try {
      await Report.toPdf(d);
      toast('PDF 报告已生成');
    } catch (e) {
      console.error(e);
      toast('导出失败：' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  function buildPlainText(d) {
    const a = d.analysis, r = d.result;
    const L = [];
    L.push('【高考英语应用文批改报告】');
    L.push(`学生：${d.student || '未填写'}    体裁：${GENRES[d.genre] || ''}    词数：${a.words}`);
    L.push(`得分：${r.score} / 15    ${r.bandDef.label}（${r.bandDef.min}–${r.bandDef.max} 分）`);
    L.push('');
    L.push('一、总评');
    L.push(r.verdict);
    L.push('');
    if ((r.points || []).length) {
      L.push('二、内容要点');
      r.points.forEach((p, i) => L.push(`  ${i + 1}. [${p.status === 'hit' ? '√' : '×'}] ${p.title}`));
      L.push('');
    }
    if ((r.deductions || []).length) {
      L.push('三、扣分明细');
      r.deductions.forEach(x => L.push(`  · ${x.name}（${x.detail}）：${x.value} 分`));
      L.push('');
    }
    const errs = (r.errors && r.errors.list) || [];
    if (errs.length) {
      L.push('四、语言错误');
      errs.forEach((e, i) => L.push(`  ${i + 1}. [${e.type}] ${e.wrong} → ${e.right}（${e.reason}）`));
      L.push('');
    }
    if (r.upgrade) {
      L.push('五、升格建议');
      L.push(r.upgrade);
      L.push('');
    }
    L.push('（武汉市江夏实验高级中学 · 墨韵批文 · 评分仅供参考）');
    return L.join('\n');
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    return new Promise(resolve => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      resolve();
    });
  }

  /* ============================================================
     历史记录
     ============================================================ */
  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveHistory(d) {
    try {
      const list = loadHistory();
      const r = d.result;
      list.unshift({
        id: Date.now(),
        ts: new Date().toISOString(),
        student: d.student,
        genre: d.genre,
        prompt: $('#promptText').value.trim().slice(0, 200),
        essay: d.analysis.text,
        words: d.analysis.words,
        score: r.score,
        band: r.band,
        source: r.source,
        points: state.points.map(p => ({ title: p.title, keys: p.keys })),
        payload: {
          analysis: d.analysis,
          result: r,
          student: d.student,
          genre: d.genre
        }
      });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
    } catch (e) {
      console.warn('历史记录保存失败（可能超出存储配额）', e);
    }
  }

  function renderHistory() {
    const list = loadHistory();
    const kw = ($('#historySearch').value || '').trim().toLowerCase();
    const filtered = kw
      ? list.filter(h => (h.student || '').toLowerCase().includes(kw) || (h.prompt || '').toLowerCase().includes(kw))
      : list;

    $('#historyCount').textContent = `共 ${list.length} 条`;

    const box = $('#historyList');
    if (!filtered.length) {
      box.innerHTML = `<div class="empty-hint">${list.length ? '没有匹配的记录' : '还没有批改记录。<br>批改过一次后会自动保存在这台电脑上。'}</div>`;
      return;
    }

    box.innerHTML = filtered.map((h, i) => {
      const dt = new Date(h.ts);
      const stamp = `${dt.getMonth() + 1}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
      const bandDef = RUBRIC.bands.find(b => b.id === h.band);
      return `<div class="history-item">
        <div class="history-score">${h.score}<small>/15</small></div>
        <div class="history-main">
          <div class="history-name">${esc(h.student || '未填写姓名')}　<span style="font-size:11.5px;color:var(--ink-3);font-weight:400;">${bandDef ? bandDef.label : ''} · ${h.words} 词 · ${GENRES[h.genre] || ''}</span></div>
          <div class="history-meta">${stamp} · ${esc((h.prompt || '无题干').slice(0, 50))}</div>
        </div>
        <div class="history-ops">
          <button class="btn btn-sm btn-outline" data-view="${h.id}">查看</button>
          <button class="btn btn-sm btn-outline" data-load="${h.id}">载入</button>
        </div>
      </div>`;
    }).join('');

    $$('#historyList [data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const h = list.find(x => x.id === +btn.dataset.view);
        if (!h || !h.payload) return;
        $('#studentName').value = h.student || '';
        $('#promptText').value = h.prompt || '';
        $('#essayText').value = h.essay || '';
        state.genre = h.genre || 'letter';
        $('#genreSelect').value = state.genre;
        if (h.points) { state.points = h.points.map(p => ({ title: p.title, keys: p.keys })); renderPoints(); }
        updateWordCount();
        state.analysis = h.payload.analysis;
        state.result = h.payload.result;
        renderResult(h.payload);
        switchTab('grade');
        toast('已打开该次批改报告');
      });
    });

    $$('#historyList [data-load]').forEach(btn => {
      btn.addEventListener('click', () => {
        const h = list.find(x => x.id === +btn.dataset.load);
        if (!h) return;
        $('#studentName').value = h.student || '';
        $('#promptText').value = h.prompt || '';
        $('#essayText').value = h.essay || '';
        state.genre = h.genre || 'letter';
        $('#genreSelect').value = state.genre;
        if (h.points) { state.points = h.points.map(p => ({ title: p.title, keys: p.keys })); renderPoints(); }
        switchMode('type');
        updateWordCount();
        switchTab('grade');
        toast('已载入到批改页，可直接重新批改');
      });
    });
  }

  function bindHistoryEvents() {
    $('#historySearch').addEventListener('input', renderHistory);
    $('#btnClearHistory').addEventListener('click', () => {
      if (!confirm('确定清空全部批改记录？此操作不可撤销。')) return;
      localStorage.removeItem(HISTORY_KEY);
      renderHistory();
      toast('历史记录已清空');
    });
  }

  /* ============================================================
     设置
     ============================================================ */
  function bindSettings() {
    bindHistoryEvents();

    $$('input[name=backend]').forEach(r => {
      r.addEventListener('change', () => {
        const v = r.value;
        $('#qwenPane').classList.toggle('hidden', v !== 'qwen');
        $('#customPane').classList.toggle('hidden', v !== 'custom');
      });
    });

    const toggler = (btnId, inputId) => {
      const btn = $(btnId), input = $(inputId);
      if (!btn || !input) return;
      btn.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? '隐藏' : '显示';
      });
    };
    toggler('#btnToggleKey', '#apiKeyInput');
    toggler('#btnToggleCustomKey', '#customKey');
    toggler('#btnToggleOcrKey', '#customOcrKey');

    $('#btnSaveSettings').addEventListener('click', () => {
      API.saveConfig(readSettingsForm());
      toast('设置已保存');
      status('设置已保存，可以开始批改了', 'ok');
    });

    $('#btnTestKey').addEventListener('click', async () => {
      const backup = API.getConfig();
      API.saveConfig(readSettingsForm());
      const btn = $('#btnTestKey');
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = '测试中…';
      try {
        const res = await API.testConnection();
        toast(`连接成功：${res.model} 回复「${res.reply}」`);
      } catch (e) {
        toast('连接失败：' + e.message.slice(0, 80));
        openModal('连接失败', `<div style="color:var(--red);font-size:13px;line-height:1.9;white-space:pre-wrap">${esc(e.message)}</div>`, '<button class="btn btn-primary" id="mClose">知道了</button>');
      } finally {
        API.saveConfig(backup);
        btn.disabled = false;
        btn.textContent = old;
      }
    });

    $('#btnDiagnose').addEventListener('click', () => {
      const c = readSettingsForm();
      const rows = [
        ['后端', c.backend === 'qwen' ? '通义千问' : '自定义'],
        ['批改模型', c.model || c.customModel || '（未填）'],
        ['OCR 模型', c.ocrModel],
        ['通义 Key 长度', (c.key || '').length + ' 位'],
        ['自定义 Key 长度', (c.customKey || '').length + ' 位'],
        ['当前时间', new Date().toLocaleString('zh-CN')],
        ['网络状态', navigator.onLine ? '在线' : '离线'],
        ['浏览器', (navigator.userAgent.match(/(Chrome|Edg|Firefox|Safari)\/[\d.]+/) || ['未知'])[0]],
        ['页面协议', location.protocol],
        ['历史记录数', loadHistory().length + ' 条']
      ];
      const html = `<table class="diag-table">${rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(String(r[1]))}</td></tr>`).join('')}</table>
        <p style="font-size:11.5px;color:var(--ink-3);margin-top:12px;line-height:1.8">如果「连接测试」失败但这里显示正常，通常是 Key 未开通对应模型，或账户额度用尽。到阿里云百炼控制台确认该模型的「开通状态」与「剩余额度」。</p>`;
      openModal('诊断信息', html, '<button class="btn btn-primary" id="mClose">关闭</button>');
    });
  }

  function readSettingsForm() {
    const backend = ($('input[name=backend]:checked') || {}).value || 'qwen';
    return {
      backend,
      key: $('#apiKeyInput').value.trim(),
      model: $('#modelSelect').value,
      ocrModel: $('#ocrModelSelect').value,
      customBase: $('#customBaseUrl').value.trim(),
      customModel: $('#customModel').value.trim(),
      customKey: $('#customKey').value.trim(),
      customOcrKey: $('#customOcrKey').value.trim()
    };
  }

  function loadSettingsToForm() {
    const c = API.getConfig();
    const radio = $(`input[name=backend][value="${c.backend}"]`);
    if (radio) radio.checked = true;
    $('#qwenPane').classList.toggle('hidden', c.backend !== 'qwen');
    $('#customPane').classList.toggle('hidden', c.backend !== 'custom');

    $('#apiKeyInput').value = c.key || '';
    $('#modelSelect').value = c.model || 'qwen-plus';
    $('#ocrModelSelect').value = c.ocrModel || 'qwen-vl-ocr';
    $('#customBaseUrl').value = c.customBase || '';
    $('#customModel').value = c.customModel || '';
    $('#customKey').value = c.customKey || '';
    $('#customOcrKey').value = c.customOcrKey || '';
  }

  /* ============================================================
     弹层 / Toast
     ============================================================ */
  function bindModal() {
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalMask').addEventListener('click', e => {
      if (e.target === $('#modalMask')) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });
    document.addEventListener('click', e => {
      if (e.target.id === 'mClose') closeModal();
    });
  }

  function openModal(title, body, foot) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    $('#modalFoot').innerHTML = foot || '';
    $('#modalMask').hidden = false;
  }
  function closeModal() { $('#modalMask').hidden = true; }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
  }

  /* ============================================================
     启动
     ============================================================ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
