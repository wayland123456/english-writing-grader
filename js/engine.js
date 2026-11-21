/* ============================================================
   engine.js — 本地规则评分引擎
   把五档细则拆成可计算的语言特征
   ============================================================ */

const Engine = (function () {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  function allMatches(text, re) {
    try {
      const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
      const r = new RegExp(re.source, flags);
      const out = [];
      let m;
      while ((m = r.exec(text)) !== null) {
        out.push({ text: m[0], index: m.index, len: m[0].length });
        if (m.index === r.lastIndex) r.lastIndex++;
      }
      return out;
    } catch (e) { return []; }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------------- 词数统计 ---------------- */
  function countWords(text) {
    if (!text) return 0;
    const s = text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\b([ap])\.\s?m\.?/gi, '$1m')
      .replace(/\b(\d{1,2})[:：](\d{2})\b/g, '$1$2')
      .replace(/[^A-Za-z0-9'\-\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return 0;
    return s.split(' ').filter(w => /[A-Za-z0-9]/.test(w)).length;
  }

  /* ---------------- 分句 ---------------- */
  function splitSentences(text) {
    const clean = text.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    // 用 lookbehind 在 . ! ? 之后切，且后面跟大写或引号
    let parts;
    try {
      parts = clean.split(/(?<=[.!?])\s+(?=["'(\[A-Z])/);
    } catch (e) {
      parts = clean.split(/([.!?])\s+/).map((s, i, arr) => i % 2 === 0 ? s + (arr[i + 1] || '') : '');
      parts = parts.filter(Boolean);
    }
    return parts.map(s => s.trim()).filter(s => countWords(s) > 0);
  }

  /* ---------------- 段落 ---------------- */
  function splitParagraphs(text) {
    return text.replace(/\r/g, '').split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean);
  }

  /* ---------------- 连接词 ---------------- */
  function findConnectives(text) {
    const lower = ' ' + text.toLowerCase().replace(/\s+/g, ' ') + ' ';
    const used = new Set();
    const result = { adv: [], mid: [], basic: [] };

    function scan(list, bucket) {
      // 长短语优先，避免 "as well" 重复命中 "well"
      const sorted = [...list].sort((a, b) => b.length - a.length);
      sorted.forEach(phrase => {
        const re = new RegExp('(?<![a-z])' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z])', 'i');
        if (re.test(lower)) {
          const norm = phrase.toLowerCase();
          if (used.has(norm)) return;
          // 已被更高层级的更短语覆盖则跳过
          used.add(norm);
          result[bucket].push(phrase);
        }
      });
    }
    scan(CONNECTIVES.adv, 'adv');
    scan(CONNECTIVES.mid, 'mid');
    scan(CONNECTIVES.basic, 'basic');
    return result;
  }

  /* ---------------- 句式模式 ---------------- */
  function findPatterns(text) {
    const found = [];      // {label, key, tier, weight, matches:[{text,index,len}]}
    const seenKeys = new Set();

    PATTERNS.forEach(p => {
      const hits = allMatches(text, p.re);
      if (!hits.length) return;
      // 同一句内多次命中同种结构只算一次（避免 "which...which" 刷分）
      const uniq = [];
      const usedIdx = [];
      hits.forEach(h => {
        const near = usedIdx.find(i => Math.abs(i - h.index) < 25);
        if (near === undefined) { uniq.push(h); usedIdx.push(h.index); }
      });
      if (!uniq.length) return;
      const dedupeKey = p.label;
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);
      found.push({ label: p.label, key: p.key, tier: p.tier, weight: p.weight, matches: uniq });
    });

    const high = found.filter(f => f.tier === 'high');
    const mid = found.filter(f => f.tier === 'mid');
    return { list: found, high, mid, highCount: high.length, midCount: mid.length };
  }

  /* ---------------- 词汇 ---------------- */
  const ADV_SET = new Set(ADVANCED_WORDS.map(w => w.toLowerCase()));

  // 词形还原：broadens → broaden，opportunities → opportunity
  function stem(w) {
    if (/ies$/.test(w)) return w.replace(/ies$/, 'y');
    if (/(sses|shes|ches|xes)$/.test(w)) return w.replace(/es$/, '');
    if (/s$/.test(w) && !/ss$/.test(w)) return w.replace(/s$/, '');
    if (/ing$/.test(w)) {
      const b = w.replace(/ing$/, '');
      return (b.length > 3 && b[b.length - 1] === b[b.length - 2]) ? b.slice(0, -1) : b;
    }
    if (/ed$/.test(w)) {
      const b = w.replace(/ed$/, '');
      return (b.length > 3 && b[b.length - 1] === b[b.length - 2]) ? b.slice(0, -1) : b;
    }
    return w;
  }

  function analyzeVocab(text) {
    const words = (text.toLowerCase().match(/[a-z][a-z'\-]*/g) || []).filter(w => w.length > 1);
    const unique = new Set(words);
    const n = words.length || 1;
    const guiraud = unique.size / Math.sqrt(n);

    const advancedHit = [];
    unique.forEach(w => {
      if (ADV_SET.has(w)) { advancedHit.push(w); return; }
      const s = stem(w);
      if (s !== w && s.length >= 4 && ADV_SET.has(s)) advancedHit.push(w);
    });

    const derivRe = /(tion|sion|ment|ness|ity|ance|ence|ful|less|able|ible|ive|ous|ward|ship|hood)$/;
    const derivWords = [...unique].filter(w => w.length > 5 && derivRe.test(w));

    const avgWordLen = words.length
      ? words.reduce((s, w) => s + w.length, 0) / words.length
      : 0;

    return {
      total: n,
      unique: unique.size,
      guiraud: +guiraud.toFixed(2),
      advancedHit: advancedHit.sort(),
      derivations: derivWords,
      derivationRatio: unique.size ? derivWords.length / unique.size : 0,
      avgWordLen: +avgWordLen.toFixed(2)
    };
  }

  /* ---------------- 错误检测 ---------------- */
  // 英美拼写差异，两边都接受，不判错
  const ACCEPTED_VARIANTS = new Set([
    'practise', 'practice', 'apologise', 'apologize', 'recognise', 'recognize',
    'organise', 'organize', 'realise', 'realize', 'neighbour', 'neighbor',
    'colour', 'color', 'favour', 'favor', 'honour', 'honor', 'labour', 'labor',
    'centre', 'center', 'theatre', 'theater', 'travelling', 'traveling',
    'travelled', 'traveled', 'cancelled', 'canceled', 'programme', 'program',
    'analyse', 'analyze', 'licence', 'license', 'defence', 'defense'
  ]);

  const SPELL_INDEX = (function () {
    const map = {};
    Object.keys(SPELLING_ERRORS).forEach(k => {
      const right = SPELLING_ERRORS[k];
      if (!right || right === k) return;
      if (ACCEPTED_VARIANTS.has(k) && ACCEPTED_VARIANTS.has(right)) return;
      map[k.toLowerCase()] = right;
    });
    return map;
  })();

  function detectErrors(text, sentences) {
    const errors = [];
    const lower = text.toLowerCase();

    /* --- 1. 拼写错误 --- */
    const wordTokens = allMatches(text, /[A-Za-z][A-Za-z'\-]*/g);
    wordTokens.forEach(tok => {
      const w = tok.text.toLowerCase().replace(/^[-']+|[-']+$/g, '');
      if (w.length < 3) return;
      if (SPELL_INDEX[w]) {
        errors.push({
          type: '拼写', severity: 'minor', level: 'low',
          wrong: tok.text, right: SPELL_INDEX[w],
          reason: '高频拼写错误', index: tok.index, len: tok.len
        });
      }
    });

    /* --- 2. 固定搭配 / 用法 --- */
    COLLOCATION_ERRORS.forEach(c => {
      allMatches(text, c.re).forEach(m => {
        // 过滤明显误报：consist of 那条只在句末无宾语时提示
        if (/consist\s+of/.test(m.text) && /\bconsist\s+of\s+\w/.test(m.text)) return;
        errors.push({
          type: '搭配', severity: 'major', level: 'low',
          wrong: m.text.trim(), right: c.right,
          reason: c.reason, index: m.index, len: m.len
        });
      });
    });

    /* --- 2.5 中式英语与可数性（高考最高频的硬伤） --- */
    const chinglish = [
      { re: /\bI\s+very\s+(like|love|enjoy|want|hope|hate)\b/gi, right: 'I ... very much', reason: 'very 不能直接修饰动词' },
      { re: /\b(?:more|most)\s+(?:better|worse|easier|harder|bigger|smaller|fewer)\b/gi, right: '去掉 more / most', reason: '比较级或最高级重复' },
      { re: /\b(?:a|an)\s+(?:news|information|advice|equipment|furniture|homework)\b/gi, right: '去掉冠词', reason: '不可数名词不加冠词' },
      { re: /\bmany\s+(?:information|advice|equipment|furniture|homework|money|water)\b/gi, right: 'much ...', reason: '不可数名词用 much' },
      { re: /\bmuch\s+(?:books|students|people|friends|things|problems|reasons|activities)\b/gi, right: 'many ...', reason: '可数复数用 many' },
      { re: /\balthough\b[^.!?]{0,70}\bbut\b/gi, right: 'although ...（删掉 but）', reason: 'although 与 but 不能连用' },
      { re: /\bbecause\b[^.!?]{0,60}\bso\b/gi, right: 'because ...（删掉 so）', reason: 'because 与 so 不能连用' },
      { re: /\b(?:open|close)\s+the\s+(?:light|lights|computer|TV)\b/gi, right: 'turn on / turn off', reason: '开关电器用 turn on/off' },
      { re: /\beveryday\s+(?:I|we|he|she|they|it)\b/gi, right: 'every day', reason: 'everyday 是形容词，时间状语用 every day' },
      { re: /\b(?:do|does|did|don't|doesn't|didn't|can|could|will|would|should|must|may|might)\s+(?:known|went|came|saw|took|made|got|said|told|thought|found|gave|been|done|written|spoken|taken|given)\b/gi, right: '改为动词原形', reason: '助动词后必须接动词原形' }
    ];
    chinglish.forEach(p => {
      allMatches(text, p.re).forEach(m => {
        errors.push({
          type: '搭配', severity: 'major', level: 'low',
          wrong: m.text.trim().slice(0, 42), right: p.right,
          reason: p.reason, index: m.index, len: m.len
        });
      });
    });

    /* --- 3. 主谓一致（启发式） --- */
    const agreementPatterns = [
      { re: /\b(?:he|she|it|everyone|everybody|someone|somebody|nobody|nothing)\s+(?:don't|have|are|were|do|seem|need|want)\b/gi,
        reason: '第三人称单数主谓不一致' },
      { re: /\b(?:I|we|you|they)\s+(?:is|was|has|does)\b/gi,
        reason: '主谓不一致' },
      { re: /\b(?:he|she|it|everyone|everybody|someone|nobody)\s+(?:are|were)\b/gi,
        reason: '单数主语配复数动词' }
    ];
    agreementPatterns.forEach(p => {
      allMatches(text, p.re).forEach(m => {
        errors.push({
          type: '主谓一致', severity: 'major', level: 'low',
          wrong: m.text.trim(), right: '检查主谓是否一致',
          reason: p.reason, index: m.index, len: m.len
        });
      });
    });

    /* --- 4. 冠词 a/an --- */
    const aRe = /\ba\s+([aeiouAEIOU][a-z]+)\b/g;
    let am;
    while ((am = aRe.exec(text)) !== null) {
      const word = am[1];
      if (!/^(one|once|university|uniform|unit|union|unique|useful|used|usual|european|user|uk|us)\b/i.test(word)) {
        errors.push({
          type: '冠词', severity: 'minor', level: 'mid',
          wrong: 'a ' + word, right: 'an ' + word,
          reason: '元音音素开头用 an', index: am.index, len: am[0].length
        });
      }
      if (am.index === aRe.lastIndex) aRe.lastIndex++;
    }

    const anRe = /\ban\s+([bcdfgjklmnpqrstvwxyzBCDFGJKLMNPQRSTVWXYZ][a-z]+)\b/g;
    while ((am = anRe.exec(text)) !== null) {
      const word = am[1];
      if (!/^(hour|honest|honor|honour|heir)\b/i.test(word)) {
        errors.push({
          type: '冠词', severity: 'minor', level: 'mid',
          wrong: 'an ' + word, right: 'a ' + word,
          reason: '辅音音素开头用 a', index: am.index, len: am[0].length
        });
      }
      if (am.index === anRe.lastIndex) anRe.lastIndex++;
    }

    /* --- 5. 标点与大小写 --- */
    sentences.forEach(s => {
      const idx = text.indexOf(s);
      if (idx < 0) return;
      const first = s.trim().charAt(0);
      if (first && /[a-z]/.test(first)) {
        errors.push({
          type: '大小写', severity: 'minor', level: 'mid',
          wrong: s.trim().slice(0, 18) + '…', right: '句首字母大写',
          reason: '句首未大写', index: idx, len: 1
        });
      }
      const last = s.trim().slice(-1);
      // 落款、标题等短行不加句号是正常的，跳过
      if (last && !/[.!?…"'”’]/.test(last) && countWords(s) >= 4) {
        errors.push({
          type: '标点', severity: 'minor', level: 'mid',
          wrong: s.trim().slice(-18), right: '句末补标点',
          reason: '句末缺标点', index: idx + s.length - 1, len: 1
        });
      }
      // 逗号粘连：一句里逗号 >= 4 且无分号
      const commas = (s.match(/,/g) || []).length;
      if (commas >= 4 && !/;/.test(s) && countWords(s) > 28) {
        errors.push({
          type: '标点', severity: 'minor', level: 'mid',
          wrong: s.trim().slice(0, 22) + '…', right: '拆句或改分号',
          reason: '逗号粘连（run-on sentence）', index: idx, len: 0
        });
      }
    });

    // 重复标点 / 多余空格
    allMatches(text, /[,;:]{2,}|\.{2,}(?!\.)/g).forEach(m => {
      errors.push({
        type: '标点', severity: 'minor', level: 'mid',
        wrong: m.text, right: '保留单个标点',
        reason: '标点重复', index: m.index, len: m.len
      });
    });

    /* --- 6. 时态混乱 ---
       本地正则无法可靠判断时态是否一致（演讲稿、记叙文合法使用
       过去叙事 + 现在议论），强行检测误伤率过高。这一项交给
       启用 AI 评分时的语义判断，本地引擎不做扣分。 */

    /* --- 5.5 碎片句：整篇大量不足 4 词的短句 --- */
    const frags = sentences.filter(s => {
      const w = countWords(s);
      const t = s.trim();
      return w > 0 && w <= 3 &&
        !/^(dear|hi|hello|yours|sincerely|faithfully|best|regards|thank)/i.test(t) &&
        !/^[A-Z][a-z]+(\s+[A-Z][a-z]+)?$/.test(t);
    });
    if (sentences.length >= 4 && frags.length >= 2 && frags.length / sentences.length > 0.28) {
      errors.push({
        type: '句式', severity: 'major', level: 'low',
        wrong: frags.slice(0, 2).map(s => s.trim()).join(' / '),
        right: '合并成完整句子',
        reason: '有 ' + frags.length + ' 个不足 4 词的碎片句，句子不成立',
        index: -1, len: 0
      });
    }

    // 同一条错误只留一次（按 wrong+type 去重）
    const deduped = [];
    const keys = new Set();
    errors.forEach(e => {
      const k = e.type + '|' + String(e.wrong).toLowerCase() + '|' + e.index;
      if (keys.has(k)) return;
      keys.add(k);
      deduped.push(e);
    });

    const counts = {};
    deduped.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
    const lowLevel = deduped.filter(e => e.level === 'low').length;

    return { list: deduped, counts, lowLevel, total: deduped.length };
  }

  /* ---------------- 格式检测 ---------------- */
  function detectFormat(text, paragraphs) {
    const lines = paragraphs;
    const first = (lines[0] || '').trim();
    const tail = lines.slice(-3).join(' ').trim();

    const hasSalutation =
      /^(dear|hello|hi|good (morning|afternoon|evening))/i.test(first) ||
      (/^[A-Z][a-z]+(?: [A-Z][a-z]+)?,$/.test(first) && countWords(first) <= 3);

    const hasClosing =
      /\b(yours|sincerely|faithfully|best regards|best wishes|truly|regards)\b/i.test(tail) ||
      /\bli\s*hua\b/i.test(tail);

    const hasTitle =
      lines.length > 1 &&
      countWords(first) > 0 && countWords(first) <= 12 &&
      !/^(dear|hello|hi)/i.test(first) &&
      (/^[A-Z\s]{6,}$/.test(first) || /notice|announcement|speech|report|letter/i.test(first));

    const hasSpeechOpen = /\b(good (morning|afternoon|evening)|dear (teachers|friends|classmates|students)|hello,? everyone)\b/i.test(text.slice(0, 220));
    const hasSpeechClose = /\b(thank(s| you) (you )?for (listening|your listening)|that'?s all)\b/i.test(text.slice(-200));

    const contentParas = lines.filter(p => countWords(p) >= 5).length;

    return {
      hasSalutation, hasClosing, hasTitle, hasSpeechOpen, hasSpeechClose,
      contentParagraphs: contentParas,
      totalParagraphs: lines.length,
      letterLike: hasSalutation || hasClosing,
      noticeLike: hasTitle,
      speechLike: hasSpeechOpen || hasSpeechClose
    };
  }

  /* ---------------- 要点覆盖 ---------------- */
  function matchPoints(text, points) {
    const lower = ' ' + text.toLowerCase().replace(/\s+/g, ' ') + ' ';
    return (points || []).map((p, i) => {
      const raw = (p.keys || '').trim();
      const keys = raw ? raw.split(/[,，;；|]/).map(s => s.trim()).filter(Boolean) : [];
      if (!keys.length) {
        return { index: i, title: p.title || ('要点 ' + (i + 1)), keys: [], status: 'unknown', matched: [], auto: false };
      }
      const matched = keys.filter(k => {
        const kk = k.toLowerCase().trim();
        if (!kk) return false;
        if (kk.includes(' ')) return lower.includes(kk);
        // 单词用词边界，允许常见后缀
        const re = new RegExp('(?<![a-z])' + kk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[a-z]{0,3}(?![a-z])', 'i');
        return re.test(lower);
      });
      return {
        index: i, title: p.title || ('要点 ' + (i + 1)), keys,
        status: matched.length ? 'hit' : 'miss', matched, auto: true
      };
    });
  }

  /* ---------------- 主分析 ---------------- */
  function analyze(text, options) {
    const opts = options || {};
    const words = countWords(text);
    const sentences = splitSentences(text);
    const paragraphs = splitParagraphs(text);

    const patterns = findPatterns(text);
    const connectives = findConnectives(text);
    const vocab = analyzeVocab(text);
    const errors = detectErrors(text, sentences);
    const format = detectFormat(text, paragraphs);

    const lens = sentences.map(countWords).filter(n => n > 0);
    const avgLen = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
    const variance = lens.length
      ? lens.reduce((a, b) => a + Math.pow(b - avgLen, 2), 0) / lens.length : 0;
    const stdLen = Math.sqrt(variance);

    const coverage = matchPoints(text, opts.points || []);

    return {
      text, words, sentences, sentenceCount: sentences.length,
      paragraphs, paragraphCount: paragraphs.length,
      avgSentenceLen: +avgLen.toFixed(1), sentenceStd: +stdLen.toFixed(1),
      patterns, connectives, vocab, errors, coverage,
      format, options: opts
    };
  }

  /* ---------------- 维度打分 ---------------- */
  function scoreDims(a, ctx) {
    const R = RUBRIC;
    const dims = {};

    /* --- 内容要点 --- */
    const cov = ctx.coverage || a.coverage;
    const autoPts = cov.filter(c => c.status !== 'unknown');
    const unknownPts = cov.filter(c => c.status === 'unknown');
    const hitPts = autoPts.filter(c => c.status === 'hit');
    const missCount = autoPts.length - hitPts.length;

    let content;
    if (!cov.length) {
      content = 62; // 未设要点，不参与封顶
    } else if (!autoPts.length) {
      content = 62; // 全是要人工判断的要点
    } else {
      const ratio = hitPts.length / autoPts.length;
      content = Math.round(15 + 85 * Math.pow(ratio, 0.8));
      // 人工勾选的要点计入但不改变自动比率之外的结果
    }
    dims.content = clamp(content, 0, 100);

    /* --- 语法结构 --- */
    const hiN = a.patterns.highCount;
    const midN = a.patterns.midCount;
    let grammar = 30 + hiN * 12 + midN * 5;
    if (a.avgSentenceLen >= 12 && a.avgSentenceLen <= 24 && a.sentenceStd >= 5) grammar += 8;
    if (a.avgSentenceLen < 9 && a.words > 50) grammar -= 12;
    if (a.words < 40) grammar -= 10;
    if (hiN === 0 && midN === 0) grammar = Math.min(grammar, 22);
    dims.grammar = clamp(Math.round(grammar), 0, 100);

    /* --- 词汇 --- */
    const v = a.vocab;
    let vocabScore = 28;
    vocabScore += Math.min(v.advancedHit.length, 10) * 3.5;
    if (v.guiraud >= 7.5) vocabScore += 20;
    else if (v.guiraud >= 6) vocabScore += 14;
    else if (v.guiraud >= 4.5) vocabScore += 7;
    if (v.avgWordLen >= 5.3) vocabScore += 14;
    else if (v.avgWordLen >= 4.6) vocabScore += 8;
    if (v.derivationRatio >= 0.2) vocabScore += 10;
    else if (v.derivationRatio >= 0.1) vocabScore += 5;
    dims.vocab = clamp(Math.round(vocabScore), 0, 100);

    /* --- 连贯 --- */
    const c = a.connectives;
    let coherence = 30 + c.adv.length * 14 + c.mid.length * 7 + c.basic.length * 2.5;
    if (a.format.contentParagraphs >= 3) coherence += 8;
    if (a.format.contentParagraphs <= 1 && a.words >= 60) coherence -= 12;
    dims.coherence = clamp(Math.round(coherence), 0, 100);

    /* --- 准确 --- */
    const per100 = a.words ? (a.errors.total / a.words) * 100 : 0;
    let accuracy = 100 - per100 * 6.2;
    if (a.errors.total === 0 && a.words >= 40) accuracy = 100;
    dims.accuracy = clamp(Math.round(accuracy), 4, 100);

    /* --- 格式 --- */
    let fmt;
    if (ctx.needFormat) {
      fmt = 0;
      if (a.format.hasSalutation) fmt += 38;
      if (a.format.hasClosing) fmt += 38;
      if (a.format.contentParagraphs >= 2) fmt += 24;
      if (!a.format.hasSalutation && !a.format.hasClosing) fmt = Math.min(fmt, 18);
    } else {
      fmt = 58;
      if (a.format.contentParagraphs >= 2) fmt += 22;
      if (a.format.hasSpeechOpen || a.format.hasSpeechClose || a.format.hasTitle) fmt += 20;
    }
    dims.format = clamp(Math.round(fmt), 0, 100);

    return dims;
  }

  /* ---------------- 评语生成 ---------------- */
  function buildComment(a, dims, band, score, ctx) {
    const cov = ctx.coverage || a.coverage;
    const autoPts = cov.filter(c => c.status !== 'unknown');
    const hitN = autoPts.filter(c => c.status === 'hit').length;
    const missN = autoPts.length - hitN;
    const parts = [];

    const openers = {
      5: '本篇完全完成了试题规定的任务，属于很好的档次。',
      4: '本篇基本完成了试题规定的任务，属于较好的档次。',
      3: '本篇基本完成了任务，但要点或语言上有明显欠缺。',
      2: '本篇未适当完成任务，要点和表达都存在较大问题。',
      1: '本篇未完成任务，内容偏离要求，语言障碍严重。',
      0: '内容过少或与题目无关，无法评分。'
    };
    parts.push(openers[band] || '');

    // 要点
    if (autoPts.length) {
      if (missN === 0) parts.push(`三个内容要点均已覆盖（${hitN}/${autoPts.length}），审题完整。`);
      else {
        const names = autoPts.filter(c => c.status === 'miss').map(c => '「' + c.title + '」').join('、');
        parts.push(`内容要点覆盖 ${hitN}/${autoPts.length}，${names}未写到或表述不清，这是本篇最主要的失分点。`);
      }
    }

    // 句式与词汇
    const hiLabels = a.patterns.high.map(p => p.label);
    if (hiLabels.length) {
      parts.push(`语言上使用了${hiLabels.slice(0, 3).join('、')}等较复杂结构，句式不单调。`);
    } else if (a.patterns.midCount > 0) {
      parts.push('句式以从句为主，缺少非谓语、倒装、强调句这类能拉开档次的复杂结构。');
    } else {
      parts.push('句子基本是简单句的堆砌，语法结构单调，是制约档次的关键。');
    }

    if (a.vocab.advancedHit.length >= 5) {
      parts.push(`词汇有一定丰富度（高级词 ${a.vocab.advancedHit.length} 个，如 ${a.vocab.advancedHit.slice(0, 3).join('、')}）。`);
    } else if (a.vocab.guiraud < 4.5) {
      parts.push('词汇重复率偏高，建议用同义替换和词性变化提升表达。');
    }

    // 衔接
    if (a.connectives.adv.length + a.connectives.mid.length === 0) {
      parts.push('缺少必要的衔接成分，句与句之间跳跃，建议补 however、what\'s more、therefore 等过渡词。');
    } else if (a.connectives.adv.length >= 2) {
      parts.push('衔接成分有层次，行文连贯。');
    }

    // 错误
    if (a.errors.total > 0) {
      const majorN = a.errors.list.filter(e => e.severity === 'major').length;
      const types = Object.keys(a.errors.counts)
        .sort((x, y) => a.errors.counts[y] - a.errors.counts[x]).slice(0, 3);
      parts.push(`共发现 ${a.errors.total} 处语言错误（其中较严重 ${majorN} 处），集中在${types.join('、')}，须逐条订正。`);
    } else if (a.words >= 30) {
      parts.push('未见明显拼写和搭配错误，语言基本功扎实。');
    }

    // 字数
    const R = RUBRIC.rules;
    if (a.words < R.wordMin) parts.push(`全文 ${a.words} 词，少于 ${R.wordMin} 词，按规定扣 ${R.wordPenalty} 分。`);
    else if (a.words > R.wordMax) parts.push(`全文 ${a.words} 词，超过 ${R.wordMax} 词，按规定扣 ${R.wordPenalty} 分。`);

    // 下一步
    if (band <= 3) {
      parts.push('下一步：先把每个要点用一句完整的话写清楚，再逐步加入定语从句和非谓语结构。');
    } else if (band === 4) {
      parts.push('下一步：挑 2–3 个句子改写成倒装句或强调句，并精简冗余表达，即可冲进第五档。');
    }

    return parts.filter(Boolean).join(' ');
  }

  /* ---------------- 档位判定 + 封顶 + 定分（本地与大模型共用） ---------------- */
  function finalize(dims, meta) {
    const R = RUBRIC;
    const words = meta.words || 0;
    const needFormat = !!meta.needFormat;
    const lowLevel = meta.lowLevelErrors || 0;
    const fmtInfo = meta.format || {};
    const covList = meta.coverage || [];

    // 综合分
    let composite = 0;
    R.dims.forEach(d => { composite += (dims[d.key] || 0) * (R.weights[d.key] || 0); });
    composite = Math.round(composite);

    // 初始档位
    let band = 0;
    for (const t of R.thresholds) {
      if (composite >= t.min) { band = t.band; break; }
    }

    const caps = [];
    const deductions = [];

    /* ---- 内容量硬门槛 ---- */
    if (words < 15) {
      band = 0;
      caps.push({ reason: '有效英文不足 15 词，视为未作答', cap: 0 });
    } else if (words < 25) {
      band = Math.min(band, 2);
      caps.push({ reason: '有效英文仅 ' + words + ' 词，内容量严重不足，最高第二档', cap: 2 });
    } else if (words < 40) {
      band = Math.min(band, 3);
      caps.push({ reason: '仅 ' + words + ' 词，篇幅明显不够，最高第三档', cap: 3 });
    } else if (words < 60) {
      band = Math.min(band, 4);
      caps.push({ reason: '仅 ' + words + ' 词，低于规定下限 60 词，最高第四档', cap: 4 });
    }

    /* ---- 要点封顶（细则核心：要点优先于语言） ---- */
    const autoPts = covList.filter(c => c.status !== 'unknown');
    const hitN = autoPts.filter(c => c.status === 'hit').length;
    const missN = autoPts.length - hitN;
    if (autoPts.length && words >= 15) {
      if (hitN === 0) {
        band = Math.min(band, 2);
        caps.push({ reason: '内容要点基本未涉及', cap: 2 });
      } else if (missN >= 3) {
        band = Math.min(band, 2);
        caps.push({ reason: '漏掉 ' + missN + ' 个内容要点', cap: 2 });
      } else if (missN === 2) {
        band = Math.min(band, 3);
        caps.push({ reason: '漏掉 2 个内容要点，最高第三档', cap: 3 });
      } else if (missN === 1) {
        band = Math.min(band, 4);
        caps.push({ reason: '漏掉 1 个内容要点，最高第四档', cap: 4 });
      }
    }

    /* ---- 衔接封顶：第五档要求"连接成分自然流畅" ---- */
    if ((dims.coherence || 0) < 45 && band > 4) {
      band = 4;
      caps.push({ reason: '衔接成分明显不足，第五档要求连接自然流畅', cap: 4 });
    }

    /* ---- 低级错误：每 3 处降一档（降档即影响档内定分，不再额外扣分） ---- */
    const drop = Math.min(
      Math.floor(lowLevel / R.rules.errorsPerBandDrop),
      R.rules.maxBandDrop
    );
    if (drop > 0) {
      band = Math.max(1, band - drop);
      caps.push({
        reason: '低级错误（拼写/搭配/主谓一致）共 ' + lowLevel + ' 处，每 ' + R.rules.errorsPerBandDrop + ' 处降一档',
        cap: band, drop
      });
    }

    /* ---- 档内定分 ---- */
    const bandDef = R.bands.find(b => b.id === band) || R.bands[R.bands.length - 1];
    let score;
    if (band === 0) {
      score = 0;
    } else {
      const cur = R.thresholds.find(t => t.band === band);
      const prev = R.thresholds.find(t => t.band === band + 1);
      const lo = cur ? cur.min : 0;
      const hi = prev ? prev.min : 100;
      const pos = clamp((composite - lo) / Math.max(hi - lo, 1), 0, 1);
      score = bandDef.min + Math.round(pos * (bandDef.max - bandDef.min));
      score = clamp(score, bandDef.min, bandDef.max);
    }

    /* ---- 扣分明细（0 分卷不再记扣分，避免"0 分又扣 2 分"的怪显示） ---- */
    if (band > 0 && words < R.rules.wordMin && words >= 15) {
      deductions.push({
        name: '词数不足',
        detail: '全文 ' + words + ' 词，少于规定下限 ' + R.rules.wordMin + ' 词',
        value: -R.rules.wordPenalty
      });
    } else if (band > 0 && words > R.rules.wordMax) {
      deductions.push({
        name: '词数超出',
        detail: '全文 ' + words + ' 词，超过规定上限 ' + R.rules.wordMax + ' 词',
        value: -R.rules.wordPenalty
      });
    }
    if (band > 0 && needFormat && !fmtInfo.hasSalutation && !fmtInfo.hasClosing) {
      deductions.push({
        name: '书信格式缺失',
        detail: '既无称呼也无落款',
        value: -2
      });
    } else if (band > 0 && needFormat && (!fmtInfo.hasSalutation || !fmtInfo.hasClosing)) {
      deductions.push({
        name: '书信格式不全',
        detail: fmtInfo.hasSalutation ? '缺落款' : '缺称呼',
        value: -1
      });
    }

    const totalDed = deductions.reduce((s, d) => s + d.value, 0);
    const rawScore = band === 0 ? 0 : score;
    const finalScore = clamp(rawScore + totalDed, 0, R.fullMark);

    // 扣分后可能跨档，重新定位
    const finalBand = R.bands.find(b => finalScore >= b.min && finalScore <= b.max) || R.bands[R.bands.length - 1];

    return {
      score: finalScore,
      band: finalBand.id,
      bandDef: finalBand,
      rawScore,
      composite,
      deductions,
      totalDed,
      caps
    };
  }

  /* ---------------- 本地引擎总评 ---------------- */
  function grade(a, ctx) {
    const dims = scoreDims(a, ctx);
    const core = finalize(dims, {
      words: a.words,
      coverage: ctx.coverage || a.coverage,
      needFormat: ctx.needFormat,
      lowLevelErrors: a.errors.lowLevel,
      format: a.format
    });
    core.dims = dims;
    core.verdict = buildComment(a, dims, core.band, core.score, ctx);
    return core;
  }

  /* ---------------- 原文标注 ---------------- */
  function annotate(a) {
    const text = a.text;
    const spans = [];

    // 连接词
    ['adv', 'mid', 'basic'].forEach(tier => {
      a.connectives[tier].forEach(phrase => {
        const re = new RegExp('(?<![a-zA-Z])' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-zA-Z])', 'gi');
        allMatches(text, re).forEach(m => {
          spans.push({ start: m.index, end: m.index + m.len, cls: tier === 'adv' ? 'hi' : 'cn', title: '连接词' });
        });
      });
    });

    // 高级句式
    a.patterns.high.forEach(p => {
      p.matches.forEach(m => {
        spans.push({ start: m.index, end: m.index + m.len, cls: 'hi', title: p.label });
      });
    });

    // 错误
    a.errors.list.forEach(e => {
      if (e.index >= 0 && e.len > 0) {
        spans.push({ start: e.index, end: e.index + e.len, cls: 'err', title: e.type + '：' + e.reason });
      }
    });

    // 排序 + 去重（错误优先，其次高级句式，其次连接词）
    spans.sort((x, y) => (x.start - y.start) || (y.end - x.end));
    const merged = [];
    spans.forEach(s => {
      if (merged.length && s.start < merged[merged.length - 1].end) {
        // 重叠：错误标注优先保留
        const last = merged[merged.length - 1];
        if (s.cls === 'err' && last.cls !== 'err') { merged[merged.length - 1] = s; }
        return;
      }
      merged.push(s);
    });

    // 生成 HTML
    let html = '';
    let cursor = 0;
    merged.forEach(s => {
      if (s.start < cursor) return;
      html += escapeHtml(text.slice(cursor, s.start));
      const label = s.title ? ` data-tip="${escapeAttr(s.title)}" title="${escapeAttr(s.title)}"` : '';
      html += `<mark class="${s.cls}"${label}>${escapeHtml(text.slice(s.start, s.end))}</mark>`;
      cursor = s.end;
    });
    html += escapeHtml(text.slice(cursor));
    return html;
  }

  return {
    analyze, grade, finalize, scoreDims, countWords, matchPoints,
    splitSentences, splitParagraphs, annotate, escapeHtml, escapeAttr
  };
})();

window.Engine = Engine;
