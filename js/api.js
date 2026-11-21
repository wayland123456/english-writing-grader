/* ============================================================
   api.js — AI 接口层
   批改：通义千问 qwen-plus / 自定义 OpenAI 兼容服务
   手写识别：通义 Qwen-VL 系列（多图整篇转录）
   ============================================================ */

const API = (function () {
  'use strict';

  const PREFIX = 'mb_en_';
  const DASHSCOPE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

  const K = {
    backend: 'backend',
    key: 'key',
    model: 'model',
    ocrModel: 'ocrModel',
    cBase: 'customBase',
    cModel: 'customModel',
    cKey: 'customKey',
    cOcrKey: 'customOcrKey'
  };

  function get(k, d) {
    try { const v = localStorage.getItem(PREFIX + k); return v == null ? d : v; }
    catch (e) { return d; }
  }
  function set(k, v) {
    try { localStorage.setItem(PREFIX + k, v); } catch (e) {}
  }

  function getConfig() {
    return {
      backend: get(K.backend, 'qwen'),
      key: get(K.key, ''),
      model: get(K.model, 'qwen-plus'),
      ocrModel: get(K.ocrModel, 'qwen-vl-ocr'),
      customBase: get(K.cBase, ''),
      customModel: get(K.cModel, ''),
      customKey: get(K.cKey, ''),
      customOcrKey: get(K.cOcrKey, '')
    };
  }

  function saveConfig(c) {
    set(K.backend, c.backend || 'qwen');
    set(K.key, c.key || '');
    set(K.model, c.model || 'qwen-plus');
    set(K.ocrModel, c.ocrModel || 'qwen-vl-ocr');
    set(K.cBase, c.customBase || '');
    set(K.cModel, c.customModel || '');
    set(K.cKey, c.customKey || '');
    set(K.cOcrKey, c.customOcrKey || '');
  }

  function isReady() {
    const c = getConfig();
    if (c.backend === 'custom') return !!(c.customBase && c.customModel && c.customKey);
    return !!c.key;
  }

  /* ---------------- 端点 ---------------- */
  function chatEndpoint() {
    const c = getConfig();
    if (c.backend === 'custom') {
      let base = (c.customBase || '').trim().replace(/\/+$/, '');
      if (!base) throw new Error('设置里还没填「接口地址」');
      if (!/\/chat\/completions$/.test(base)) base += '/chat/completions';
      return { url: base, key: c.customKey, model: c.customModel };
    }
    if (!c.key) throw new Error('设置里还没填通义千问 API Key');
    return { url: DASHSCOPE + '/chat/completions', key: c.key, model: c.model };
  }

  function ocrEndpoint() {
    const c = getConfig();
    const key = (c.backend === 'custom' ? (c.customOcrKey || c.key) : c.key);
    if (!key) throw new Error('手写识别需要通义千问 API Key，请到「设置」里填写');
    return { url: DASHSCOPE + '/chat/completions', key: key, model: c.ocrModel || 'qwen-vl-ocr' };
  }

  /* ---------------- 底层请求 ---------------- */
  async function post(url, key, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 120000);

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('请求超时，模型响应过慢，请重试');
      throw new Error('网络请求失败：' + (e.message || '可能是浏览器拦截或断网') + '\n如果是跨域限制，请换用通义千问官方接口。');
    }
    clearTimeout(timer);

    if (!res.ok) {
      let detail = '';
      try {
        const err = await res.json();
        detail = (err.error && (err.error.message || err.error.code)) || JSON.stringify(err);
      } catch (e) {
        detail = await res.text().catch(() => '');
      }
      let hint = '';
      if (res.status === 401) hint = '（API Key 无效或已过期）';
      else if (res.status === 429) hint = '（请求过于频繁或额度用尽）';
      else if (res.status === 403) hint = '（Key 无该模型权限，或未开通）';
      else if (res.status === 404) hint = '（模型名称写错，或该模型未开通）';
      throw new Error('接口返回 ' + res.status + hint + '：' + String(detail).slice(0, 240));
    }

    const data = await res.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    const content = msg ? msg.content : '';
    if (!content) throw new Error('模型没有返回内容，请重试');
    return content;
  }

  /* ---------------- 提示词 ---------------- */
  function bandText() {
    return RUBRIC.bands.slice().sort((a, b) => b.id - a.id)
      .map(b => b.id === 0
        ? `【0 分】${b.desc}`
        : `【${b.label}】${b.min}–${b.max} 分：${b.desc}`)
      .join('\n');
  }

  function systemPrompt() {
    return `你是一位有二十年高考英语阅卷经验的评卷组长，熟悉高考英语应用文（满分 15 分）评分细则的每一个字。你的任务是严格按五档标准给学生作文打分，并给出可直接打印给学生的诊断报告。

## 五档评分细则（唯一依据，不得自创标准）
${bandText()}

## 补充扣分规则
1. 词数少于 60 词或多于 100 词，从总分中扣 2 分。
2. 拼写和标点错误视其对交际的影响程度考虑，英美拼写均可接受。
3. 书写差到影响交际，分数降一个档次（本次以识别文本评分，不做卷面扣分）。

## 评分纪律（必须遵守）
- **要点优先于语言**。漏掉 1 个要点最高只能给第四档；漏 2 个最高第三档；漏 3 个及以上最高第二档；要点全未涉及最高第二档。
- **五档是硬边界**。语言再好也不能跨档给分，只能在档内上下浮动 1 分。
- **拿不准就往下压一档**。给低了能加，给高了改不回来。
- 只有**真正的高级结构**才加分：非谓语作状语/定语、倒装（Only/Never/Not only 引导的倒装）、强调句（It is ... that）、名词性从句、独立主格。**套话不算**（如 It is my honor to stand here 只是普通句）。
- 逐个要点判断是否"写到了"——只要学生用任何同义表达传达了该要点即算覆盖，不要苛求用词一致。
- 错误必须**逐条列出**，写清原文错在哪、正确形式是什么、为什么错。
- 如果学生写了与题目无关的内容（跑题、背模板、抄阅读原文），必须在 verdict 中明确指出并降档。

## 输出格式
只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块。结构如下：

{
  "points": [
    {"index": 1, "title": "要点名称", "covered": true, "evidence": "学生原文中对应的句子片段（未覆盖则写空字符串）"}
  ],
  "dims": {
    "content": 0-100, "grammar": 0-100, "vocab": 0-100,
    "coherence": 0-100, "accuracy": 0-100, "format": 0-100
  },
  "errors": [
    {"wrong": "原文错误片段", "right": "正确形式", "type": "拼写|搭配|语法|标点|大小写|时态|其他", "severity": "major|minor", "reason": "错误原因（15 字以内）"}
  ],
  "deductions": [{"name": "扣分项名称", "detail": "说明", "value": -2}],
  "band": 0-5 的整数,
  "score": 0-15 的整数,
  "verdict": "总评，120–180 字，先定档再说要点覆盖，再说语言亮点与问题，最后一句给下一步建议",
  "strengths": ["具体优点，每条不超过 30 字"],
  "weaknesses": ["具体问题，每条不超过 30 字"],
  "upgrade": "挑出学生原文中 1–2 个句子，给出升格改写示范，格式：原句 → 改句（说明用了什么结构）"
}

注意：
- score 必须落在 band 对应的分数区间内。
- dims 六项是相对分数（0–100），不是档位分，用于雷达图。content 对应要点覆盖度，format 对应书信/通知/演讲稿的格式完整度。
- 有效英文不足 15 词时 band = 0、score = 0。
- 所有字段都必须存在，数组无内容时给空数组。`;
  }

  function userPrompt(p) {
    const points = (p.points || []).map((x, i) =>
      `${i + 1}. ${x.title}${x.keys ? '（英文关键词参考：' + x.keys + '）' : ''}`
    ).join('\n') || '（本题未列出具体要点，请按题干自行拆解为 3 个内容要点判断）';

    const genreMap = {
      letter: '书信 / 邮件，必须有称呼（Dear ...）和落款（Yours, / Li Hua）。',
      notice: '通知 / 公告，通常有标题，不需要称呼和落款。',
      speech: '演讲稿，通常有开场问候（Good morning, everyone）和结束致谢。',
      application: '申请信 / 自荐信，需称呼和落款，语气正式。',
      other: '通用应用文，按题干要求判断格式。'
    };

    return `## 作文题目
${p.prompt || '（题目未提供，请根据学生作文内容判断其是否扣题）'}

## 体裁与格式要求
${genreMap[p.genre] || genreMap.other}

## 内容要点
${points}

## 学生作文（原文，含原始错误）
"""
${p.essay}
"""

请按评分细则评分，输出 JSON。`;
  }

  /* ---------------- JSON 解析 ---------------- */
  function extractJson(raw) {
    if (!raw) throw new Error('模型返回为空');
    let s = String(raw).trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    try { return JSON.parse(s); } catch (e) {}
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      const body = s.slice(a, b + 1);
      try { return JSON.parse(body); } catch (e) {}
      const fixed = body.replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
      try { return JSON.parse(fixed); } catch (e) {}
    }
    throw new Error('模型返回的不是合法 JSON，请重试');
  }

  /* ---------------- 批改 ---------------- */
  async function grade(payload) {
    const ep = chatEndpoint();
    const content = await post(ep.url, ep.key, {
      model: ep.model,
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: userPrompt(payload) }
      ],
      temperature: 0.2,
      max_tokens: 2600
    }, 120000);

    return normalize(extractJson(content), payload);
  }

  function clampInt(v, lo, hi, def) {
    const n = Number(v);
    if (isNaN(n)) return def;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }

  function normalize(j, payload) {
    const band = clampInt(j.band, 0, 5, 3);
    const bandDef = RUBRIC.bands.find(b => b.id === band) || RUBRIC.bands[2];
    let score = clampInt(j.score, 0, 15, bandDef.min);
    if (band === 0) score = 0;
    else score = Math.max(bandDef.min, Math.min(bandDef.max, score));

    const dims = {};
    RUBRIC.dims.forEach(d => {
      dims[d.key] = clampInt(j.dims && j.dims[d.key], 0, 100, 60);
    });

    const points = (j.points || []).map((p, i) => ({
      index: i,
      title: p.title || ((payload.points && payload.points[i] && payload.points[i].title) || ('要点 ' + (i + 1))),
      status: p.covered ? 'hit' : 'miss',
      matched: [],
      keys: (payload.points && payload.points[i] && payload.points[i].keys) || '',
      evidence: p.evidence || '',
      auto: true
    }));

    const errors = (j.errors || []).map(e => ({
      type: e.type || '其他',
      severity: e.severity === 'major' ? 'major' : 'minor',
      wrong: e.wrong || '',
      right: e.right || '',
      reason: e.reason || '',
      index: -1, len: 0
    }));

    const deductions = (j.deductions || []).map(d => ({
      name: d.name || '扣分',
      detail: d.detail || '',
      value: Number(d.value) || 0
    }));

    return {
      source: 'ai',
      dims, points, errors, deductions,
      band, bandDef, score, rawScore: score,
      verdict: j.verdict || '',
      strengths: Array.isArray(j.strengths) ? j.strengths : [],
      weaknesses: Array.isArray(j.weaknesses) ? j.weaknesses : [],
      upgrade: j.upgrade || ''
    };
  }

  /* ---------------- 手写识别 ---------------- */
  async function ocrImages(dataUrls, kind) {
    const ep = ocrEndpoint();
    const n = dataUrls.length;

    const content = dataUrls.map(url => ({ type: 'image_url', image_url: { url: url } }));

    if (kind === 'prompt') {
      content.push({
        type: 'text',
        text: `这 ${n} 张图片是同一道英语作文试题（可能含题目要求、要点提示和注意事项），按先后顺序排列（第 1 张在最前）。请逐字转录试题全文。要求：
1.按图片顺序合并输出完整试题，包括"假定你是李华""注意：1. 词数 80 左右"等全部引导语与要求；
2.只输出试题原文，不要任何解释或点评；中文部分照原样保留；
3.保留原有换行与分点编号；
4.无法辨认的字用□占位；
5.如果图片中没有作文试题内容，只输出 NOT_PROMPT。`
      });
    } else {
      content.push({
        type: 'text',
        text: `这 ${n} 张图片是同一篇学生手写的英语作文，按先后顺序排列（第 1 张在最前）。请完整逐字转录整篇作文。要求：
1.只输出作文正文英文，不要任何解释、标注或格式说明；
2.严格保留原有段落划分，段落之间用一个空行分隔；
3.拼写错误、语法错误必须原样保留，不要替学生改正，也不要补充或润色；
4.标点符号按原样转录；
5.无法辨认的词用□占位；
6.如果图片中不是手写作文内容，只输出 NOT_HANDWRITING。`
      });
    }

    const text = (await post(ep.url, ep.key, {
      model: ep.model,
      messages: [{ role: 'user', content: content }],
      temperature: 0,
      max_tokens: 4000
    }, 150000)).trim();

    if (text === 'NOT_PROMPT') throw new Error('图片中未检测到试题内容，请检查图片是否清晰');
    if (text === 'NOT_HANDWRITING') throw new Error('图片中未检测到手写作文内容，请检查图片是否清晰');
    return text;
  }

  /* ---------------- 连接测试 ---------------- */
  async function testConnection() {
    const ep = chatEndpoint();
    const content = await post(ep.url, ep.key, {
      model: ep.model,
      messages: [{ role: 'user', content: '只回复两个字：正常' }],
      max_tokens: 20,
      temperature: 0
    }, 30000);
    return { model: ep.model, reply: String(content).trim().slice(0, 40) };
  }

  return {
    getConfig, saveConfig, isReady, grade, ocrImages, testConnection,
    chatEndpoint, ocrEndpoint, systemPrompt
  };
})();

window.API = API;
