/* ============================================================
   report.js — 生成带学校抬头的 A4 批改报告并导出 PDF
   依赖：html2canvas、jsPDF（vendor 目录）
   ============================================================ */

const Report = (function () {
  'use strict';

  const SCHOOL = '武汉市江夏实验高级中学';
  const TITLE = '高考英语应用文批改报告';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const GENRE = {
    letter: '书信 / 邮件',
    notice: '通知 / 公告',
    speech: '演讲稿',
    application: '申请信 / 自荐信',
    other: '其他应用文'
  };

  /**
   * 生成报告 HTML
   * @param {Object} d { analysis, result, student, prompt, genre, ai }
   */
  function buildHtml(d) {
    const a = d.analysis, r = d.result;
    const stu = d.student || '未填写';
    const genre = GENRE[d.genre] || GENRE.other;
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const bandColor = {
      5: '#2d6a4f', 4: '#2e6da4', 3: '#b07d2b', 2: '#b5651d', 1: '#b03a2e', 0: '#8b939e'
    }[r.band] || '#8b939e';

    /* --- 要点 --- */
    const pointsHtml = (r.points || []).map((p, i) => `
      <div style="display:flex;gap:8px;padding:7px 10px;margin-bottom:5px;border:1px solid ${p.status === 'hit' ? '#c9e4d6' : '#f0cdc7'};background:${p.status === 'hit' ? '#eaf4ef' : '#fdf0ee'};border-radius:6px;font-size:12px;">
        <span style="font-weight:700;color:${p.status === 'hit' ? '#2d6a4f' : '#b03a2e'};flex:0 0 14px;">${p.status === 'hit' ? '✓' : '✕'}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;color:#1f2328;">${i + 1}. ${esc(p.title)}</div>
          ${p.evidence ? `<div style="font-size:11px;color:#5a6470;margin-top:2px;font-family:Georgia,serif;">${esc(p.evidence)}</div>` : ''}
        </div>
      </div>`).join('') || '<div style="font-size:12px;color:#8b939e;">本题未设置内容要点</div>';

    /* --- 维度 --- */
    const dimsHtml = RUBRIC.dims.map(dim => {
      const v = (r.dims && r.dims[dim.key]) || 0;
      return `<tr>
        <td style="padding:3px 0;font-size:11.5px;color:#5a6470;width:72px;">${dim.name}</td>
        <td style="padding:3px 8px;">
          <div style="height:6px;background:#f0ece4;border-radius:99px;overflow:hidden;">
            <div style="height:6px;width:${v}%;background:${v >= 80 ? '#2d6a4f' : v >= 60 ? '#2e6da4' : v >= 40 ? '#b07d2b' : '#b03a2e'};border-radius:99px;"></div>
          </div>
        </td>
        <td style="padding:3px 0;font-size:11px;color:#8b939e;width:34px;text-align:right;font-family:monospace;">${v}</td>
      </tr>`;
    }).join('');

    /* --- 扣分 --- */
    const caps = r.caps || [];
    const deds = r.deductions || [];
    let dedHtml = '';
    if (caps.length) {
      dedHtml += '<div style="font-size:11px;font-weight:600;color:#8b939e;margin:6px 0 3px;">档位限制</div>';
      dedHtml += caps.map(c => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px dashed #e6e1d8;">
        <span style="color:#5a6470;flex:1;">${esc(c.reason)}</span>
        <span style="color:#b07d2b;font-weight:600;white-space:nowrap;margin-left:10px;">${c.drop ? '降 ' + c.drop + ' 档' : '封顶第' + ['零', '一', '二', '三', '四', '五'][c.cap] + '档'}</span>
      </div>`).join('');
    }
    if (deds.length) {
      dedHtml += '<div style="font-size:11px;font-weight:600;color:#8b939e;margin:10px 0 3px;">分数扣减</div>';
      dedHtml += deds.map(x => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px dashed #e6e1d8;">
        <span style="color:#5a6470;flex:1;">${esc(x.name)}${x.detail ? '<span style="color:#8b939e;font-size:11px;"> · ' + esc(x.detail) + '</span>' : ''}</span>
        <span style="color:#b03a2e;font-weight:700;white-space:nowrap;margin-left:10px;font-family:monospace;">${x.value}</span>
      </div>`).join('');
    }
    if (!caps.length && !deds.length) {
      dedHtml = '<div style="font-size:12px;color:#8b939e;">未触发任何档位限制或分数扣减。</div>';
    }

    /* --- 错误 --- */
    const errs = (r.errors && r.errors.list) || [];
    const errHtml = errs.length ? `
      <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
        <thead><tr>
          <th style="text-align:left;padding:5px 6px;border-bottom:1px solid #e6e1d8;color:#8b939e;font-size:10.5px;width:56px;">类型</th>
          <th style="text-align:left;padding:5px 6px;border-bottom:1px solid #e6e1d8;color:#8b939e;font-size:10.5px;">原文</th>
          <th style="text-align:left;padding:5px 6px;border-bottom:1px solid #e6e1d8;color:#8b939e;font-size:10.5px;">应改为</th>
          <th style="text-align:left;padding:5px 6px;border-bottom:1px solid #e6e1d8;color:#8b939e;font-size:10.5px;">说明</th>
        </tr></thead>
        <tbody>
        ${errs.map(e => `<tr>
          <td style="padding:5px 6px;border-bottom:1px dashed #e6e1d8;"><span style="font-size:10px;padding:1px 5px;border-radius:3px;background:${e.severity === 'major' ? '#fdf0ee' : '#faf3e3'};color:${e.severity === 'major' ? '#b03a2e' : '#b07d2b'};">${esc(e.type)}</span></td>
          <td style="padding:5px 6px;border-bottom:1px dashed #e6e1d8;color:#b03a2e;font-family:Georgia,serif;">${esc(e.wrong)}</td>
          <td style="padding:5px 6px;border-bottom:1px dashed #e6e1d8;color:#2d6a4f;font-weight:600;font-family:Georgia,serif;">${esc(e.right)}</td>
          <td style="padding:5px 6px;border-bottom:1px dashed #e6e1d8;color:#8b939e;font-size:10.5px;">${esc(e.reason)}</td>
        </tr>`).join('')}
        </tbody>
      </table>` : '<div style="font-size:12px;color:#8b939e;">未检测到明显的拼写、搭配或语法错误。</div>';

    /* --- 升格 --- */
    const upgradeHtml = r.upgrade
      ? `<div style="font-size:12px;line-height:1.85;padding:10px 12px;border-radius:6px;background:#faf3e3;border:1px solid #ecd9b0;white-space:pre-wrap;font-family:Georgia,serif;">${esc(r.upgrade)}</div>`
      : '';

    const adviceHtml = (r.strengths && r.strengths.length) || (r.weaknesses && r.weaknesses.length) ? `
      <div style="display:flex;gap:16px;margin-top:10px;">
        ${r.strengths && r.strengths.length ? `<div style="flex:1;">
          <div style="font-size:11px;font-weight:600;color:#2d6a4f;margin-bottom:4px;">值得肯定</div>
          ${r.strengths.map(s => `<div style="font-size:11.5px;color:#5a6470;line-height:1.75;">· ${esc(s)}</div>`).join('')}
        </div>` : ''}
        ${r.weaknesses && r.weaknesses.length ? `<div style="flex:1;">
          <div style="font-size:11px;font-weight:600;color:#b03a2e;margin-bottom:4px;">主要问题</div>
          ${r.weaknesses.map(s => `<div style="font-size:11.5px;color:#5a6470;line-height:1.75;">· ${esc(s)}</div>`).join('')}
        </div>` : ''}
      </div>` : '';

    const secTitle = (t, sub) => `
      <div style="display:flex;align-items:baseline;gap:8px;margin:20px 0 9px;padding-bottom:5px;border-bottom:1px solid #e6e1d8;">
        <span style="font-size:13px;font-weight:700;color:#1f2328;letter-spacing:.5px;">${t}</span>
        ${sub ? `<span style="font-size:10.5px;color:#8b939e;">${sub}</span>` : ''}
      </div>`;

    return `
<div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#1f2328;line-height:1.7;">

  <!-- 抬头 -->
  <div style="display:flex;align-items:flex-end;justify-content:space-between;border-bottom:2.5px solid #1f2328;padding-bottom:10px;">
    <div>
      <div style="font-family:Georgia,serif;font-size:16px;font-weight:700;letter-spacing:2px;">${SCHOOL}</div>
      <div style="font-size:12px;color:#5a6470;margin-top:3px;letter-spacing:1px;">${TITLE}</div>
    </div>
    <div style="font-size:10.5px;color:#8b939e;text-align:right;line-height:1.8;font-family:monospace;">
      生成时间：${stamp}<br>
      评卷引擎：${r.source === 'ai' ? 'AI 语义评分 + 规则复核' : '本地规则引擎'}
    </div>
  </div>

  <!-- 基本信息 + 分数 -->
  <div style="display:flex;gap:16px;margin-top:14px;align-items:stretch;">
    <div style="flex:1;font-size:12px;color:#5a6470;line-height:2;">
      <div><span style="color:#8b939e;">学生姓名：</span><b style="color:#1f2328;">${esc(stu)}</b></div>
      <div><span style="color:#8b939e;">体裁：</span>${genre}　<span style="color:#8b939e;">词数：</span><b>${a.words}</b> 词</div>
      <div><span style="color:#8b939e;">评分时间：</span>${stamp}</div>
    </div>
    <div style="flex:0 0 190px;border:1.5px solid ${bandColor};border-radius:8px;padding:11px 14px;background:#fbfaf7;">
      <div style="display:flex;align-items:baseline;gap:6px;">
        <span style="font-family:Georgia,serif;font-size:40px;font-weight:700;color:${bandColor};line-height:1;">${r.score}</span>
        <span style="font-size:12px;color:#8b939e;">/ 15 分</span>
      </div>
      <div style="font-size:12px;font-weight:600;color:${bandColor};margin-top:5px;">${r.bandDef.label} · ${r.bandDef.min}–${r.bandDef.max} 分</div>
      <div style="font-size:10.5px;color:#8b939e;margin-top:2px;">${r.bandDef.short}</div>
    </div>
  </div>

  <!-- 一、总评 -->
  ${secTitle('一、总评')}
  <div style="font-size:12px;line-height:1.9;color:#3a4048;text-align:justify;">${esc(r.verdict)}</div>
  ${adviceHtml}

  <!-- 二、内容要点 -->
  ${secTitle('二、内容要点', (r.points || []).filter(p => p.status === 'hit').length + ' / ' + (r.points || []).length)}
  ${pointsHtml}

  <!-- 三、能力维度 -->
  ${secTitle('三、能力维度', '加权综合 ' + (r.composite || 0) + ' / 100')}
  <table style="width:100%;border-collapse:collapse;">${dimsHtml}</table>

  <!-- 四、扣分 -->
  ${secTitle('四、档位与扣分', (r.totalDed ? r.totalDed + ' 分' : '无扣分'))}
  ${dedHtml}

  <!-- 五、语言错误 -->
  ${secTitle('五、语言错误', errs.length + ' 处')}
  ${errHtml}

  ${upgradeHtml ? secTitle('六、升格建议') + upgradeHtml : ''}

  <!-- 七、原文 -->
  ${secTitle('七、作文原文')}
  <div style="font-family:Georgia,serif;font-size:12px;line-height:1.95;padding:12px 14px;background:#fbfaf7;border:1px solid #e6e1d8;border-radius:6px;white-space:pre-wrap;">${esc(a.text)}</div>

  <!-- 页脚 -->
  <div style="margin-top:22px;padding-top:10px;border-top:1px solid #e6e1d8;font-size:10px;color:#8b939e;display:flex;justify-content:space-between;">
    <span>${SCHOOL} · 墨韵批文 · 英语应用文智能批改</span>
    <span>评分仅供参考，最终成绩以教师复核为准</span>
  </div>

</div>`;
  }

  /* ---------------- 导出 PDF ---------------- */
  async function toPdf(d) {
    if (!window.html2canvas) throw new Error('PDF 组件未加载，请刷新页面');
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('PDF 组件未加载，请刷新页面');

    const stage = document.getElementById('reportStage');
    if (!stage) throw new Error('报告容器缺失');

    stage.innerHTML = buildHtml(d);

    // 等字体和图片渲染稳定
    await new Promise(r => setTimeout(r, 120));

    const canvas = await html2canvas(stage, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: 794
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');

    const pageW = 210, pageH = 297;
    const margin = 10;
    const imgW = pageW - margin * 2;          // 190mm
    const imgH = canvas.height * imgW / canvas.width;
    const usableH = pageH - margin * 2;       // 277mm

    // 一页放不下时：轻微超出（≤18%）就等比缩到单页，避免孤零零的第二页；
    // 超出较多才做分页切片。
    if (imgH > usableH && imgH <= usableH * 1.18) {
      const fit = usableH / imgH;
      const w2 = imgW * fit;
      const h2 = imgH * fit;
      pdf.addImage(imgData, 'JPEG', margin + (imgW - w2) / 2, margin, w2, h2);
    } else {
      pdf.addImage(imgData, 'JPEG', margin, margin, imgW, imgH);
      let heightLeft = imgH - usableH;
      while (heightLeft > 0) {
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', margin, margin - (imgH - heightLeft), imgW, imgH);
        heightLeft -= usableH;
      }
    }

    const name = (d.student || '学生').replace(/[\\/:*?"<>|]/g, '');
    const dt = new Date();
    const stamp = `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`;
    pdf.save(`英语应用文批改_${name}_${d.result.score}分_${stamp}.pdf`);

    stage.innerHTML = '';
    return true;
  }

  /* ---------------- 打开打印视图 ---------------- */
  function printReport(d) {
    const stage = document.getElementById('reportStage');
    stage.innerHTML = buildHtml(d);
    stage.style.left = '0';
    stage.style.position = 'static';
    stage.style.width = '100%';
    stage.style.padding = '0';

    const html = stage.innerHTML;

    const w = window.open('', '_blank');
    if (!w) {
      stage.innerHTML = '';
      stage.removeAttribute('style');
      throw new Error('打印窗口被浏览器拦截，请允许弹出窗口');
    }
    w.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
      <title>${TITLE} - ${esc(d.student || '')}</title>
      <style>
        @page{size:A4;margin:14mm 12mm;}
        body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      </style></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);

    stage.innerHTML = '';
    stage.removeAttribute('style');
  }

  return { buildHtml, toPdf, printReport, SCHOOL, GENRE };
})();

window.Report = Report;
