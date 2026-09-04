/* UI-only adapter: render model-provided corrections; never judge the answer. */
(() => {
  "use strict";
  const clean = text => String(text || "").trim().replace(/^[`"“”]+|[`"“”]+$/g, "").replace(/^(?:\.{3}|…)\s*|\s*(?:\.{3}|…)$/g, "").trim();
  const originalLabel = /^(?:原文(?:精确片段)?|原句|原片段|original(?: text)?)/i;
  const correctionLabel = /^(?:最小修改|局部修改|修改(?:后)?(?:句|表达)?|修正(?:后)?(?:句|表达)?|建议修改|corrected|correction)/i;
  const typeLabel = /^(?:错误类型|类型|type)/i;
  const reasonLabel = /^(?:中文原因|原因|解释|说明|explanation|reason)/i;
  const letters = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  window.isPunctuationOnlyRevision = (original, revised) => Boolean(letters(original)) && letters(original) === letters(revised);
  window.extractTranscriptPunctuation = markdown => {
    const root = document.createElement('div');
    window.renderReviewMarkdown(root, markdown);
    let reading = false;
    const parts = [];
    for (const node of root.children) {
      if (/^H[1-6]$/.test(node.tagName)) {
        if (reading) break;
        reading = /^(?:\d+[.、]\s*)?转写整理稿$/.test(node.textContent.trim());
      } else if (reading) parts.push(node.textContent);
    }
    return parts.join('\n\n').trim();
  };
  function locate(original, quote, punctuationOnly) {
    let haystack = original, needle = quote, positions, ends;
    if (punctuationOnly) {
      positions = [];
      haystack = '';
      for (let i = 0; i < original.length; i++) {
        if (/[\p{L}\p{N}]/u.test(original[i])) { positions.push(i); haystack += original[i].toLowerCase(); }
      }
      needle = letters(quote);
    } else {
      // Normalize typography only for matching; offsets still point into the
      // untouched original. Do not fuzzy-match missing or substituted words.
      const typography = value => {
        let text = '';
        const starts = [], ends = [];
        for (let offset = 0; offset < value.length; offset++) {
          let character = value[offset];
          if (/[\u2010-\u2015\uFE63\uFF0D]/.test(character)) character = '-';
          else if (/[\u2018\u2019\u201A\u201B\uFF07]/.test(character)) character = "'";
          else if (/[\u201C\u201D\u201E\u201F\uFF02]/.test(character)) character = '"';
          else if (/\s/u.test(character)) character = ' ';
          if (character === ' ' && text.endsWith(' ')) { ends[ends.length - 1] = offset + 1; continue; }
          text += character; starts.push(offset); ends.push(offset + 1);
        }
        return {text, starts, ends};
      };
      const normalized = typography(original);
      haystack = normalized.text;
      positions = normalized.starts;
      ends = normalized.ends;
      needle = typography(quote).text;
    }
    if (!needle) return null;
    const start = haystack.indexOf(needle);
    if (start < 0 || haystack.indexOf(needle, start + 1) >= 0) return null;
    const end = start + needle.length;
    if (!positions) return {start, end};
    const mapped = {start:positions[start], end:ends ? ends[end - 1] : positions[end - 1] + 1};
    // Never match a quoted word inside another word.
    if (punctuationOnly && (/[\p{L}\p{N}]/u.test(original[mapped.start - 1] || '') || /[\p{L}\p{N}]/u.test(original[mapped.end] || ''))) return null;
    return mapped;
  }

  function extract(markdown) {
    const root = document.createElement("div");
    window.renderReviewMarkdown(root, markdown);
    const results = [];
    const add = item => {
      if (!item?.original || !item?.corrected) return;
      item.original = clean(item.original);
      item.corrected = clean(item.corrected);
      if (item.original && item.corrected && item.original !== item.corrected && !results.some(old => old.original === item.original && old.corrected === item.corrected)) results.push(item);
    };
    root.querySelectorAll("table").forEach(table => {
      const labels = [...table.querySelectorAll("thead th")].map(cell => cell.textContent.trim());
      const find = pattern => labels.findIndex(label => pattern.test(label));
      const oi = find(originalLabel), ci = find(correctionLabel), ti = find(typeLabel), ri = find(reasonLabel);
      if (oi < 0 || ci < 0) return;
      table.querySelectorAll("tbody tr").forEach(row => {
        const cells = [...row.children].map(cell => cell.textContent.trim());
        add({original:cells[oi],corrected:cells[ci],type:cells[ti] || "修改建议",explanation:cells[ri] || ""});
      });
    });
    let pending;
    root.querySelectorAll("li,p").forEach(node => {
      if (node.closest("table") || (node.tagName === "P" && node.closest("li"))) return;
      const own = node.cloneNode(true);
      own.querySelectorAll("ul,ol").forEach(child => child.remove());
      const line = own.textContent.trim();
      const match = /^([^:：\n]{1,24})\s*[:：]\s*([\s\S]+)$/.exec(line);
      if (!match) return;
      const label = match[1].trim(), value = match[2].trim();
      if (originalLabel.test(label)) { add(pending); pending = {original:value,type:"修改建议",explanation:""}; }
      else if (pending && correctionLabel.test(label)) pending.corrected = value;
      else if (pending && typeLabel.test(label)) pending.type = value;
      else if (pending && reasonLabel.test(label)) pending.explanation = value;
    });
    add(pending);
    return results.slice(0, 100);
  }

  window.renderReviewAnnotations = ({ original, markdown, originalElement, correctionsElement, countElement, noticeElement, punctuationOnly = false }) => {
    const corrections = extract(markdown);
    originalElement.replaceChildren();
    correctionsElement.replaceChildren();
    const ranges = [];
    corrections.forEach((item, index) => {
      const location = locate(original, item.original, punctuationOnly);
      const start = location?.start ?? -1, end = location?.end ?? -1;
      // Ambiguous, missing or overlapping quotes stay in the list only.
      const matched = location && !ranges.some(range => start < range.end && end > range.start);
      if (matched) ranges.push({ start, end, item, index });
      const card = document.createElement("article");
      card.className = "correction-card";
      card.id = `review-correction-${index}`;
      card.tabIndex = -1;
      const heading = document.createElement("h4"); heading.textContent = `${index + 1}. ${item.type || "修改建议"}`;
      const before = document.createElement("p"); before.className = "correction-before"; before.textContent = item.original;
      const after = document.createElement("p"); after.className = "correction-after"; after.textContent = item.corrected;
      const reason = document.createElement("p"); reason.textContent = item.explanation || "详细说明见下方完整报告。";
      const status = document.createElement("small"); status.textContent = matched ? "已在原文中标注" : "未自动定位：原文不完全一致、重复出现或与其他标注重叠";
      card.append(heading, before, after, reason, status);
      correctionsElement.append(card);
    });
    let cursor = 0;
    ranges.sort((a,b) => a.start - b.start).forEach(range => {
      originalElement.append(document.createTextNode(original.slice(cursor, range.start)));
      const mark = document.createElement("mark");
      mark.className = "annotation-mark";
      mark.id = `review-original-${range.index}`;
      mark.textContent = original.slice(range.start, range.end);
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
      mark.setAttribute("aria-label", `查看修改 ${range.index + 1}：${range.item.original}`);
      mark.title = `建议：${range.item.corrected}`;
      const card = document.getElementById(`review-correction-${range.index}`);
      const returnButton = document.createElement("button");
      returnButton.type = "button";
      returnButton.className = "button button-quiet correction-return";
      returnButton.textContent = "返回原文";
      returnButton.setAttribute("aria-controls", mark.id);
      returnButton.addEventListener("click", () => {
        originalElement.querySelectorAll(".is-returned").forEach(node => node.classList.remove("is-returned"));
        mark.classList.add("is-returned");
        mark.focus({preventScroll:true});
        mark.scrollIntoView({behavior:"smooth",block:"center"});
      });
      card.append(returnButton);
      const select = () => {
        correctionsElement.querySelectorAll(".is-selected").forEach(card => card.classList.remove("is-selected"));
        card.classList.add("is-selected");
        card.focus({preventScroll:true});
        card.scrollIntoView({behavior:"smooth",block:"center"});
      };
      mark.addEventListener("click", select);
      mark.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } });
      originalElement.append(mark);
      cursor = range.end;
    });
    originalElement.append(document.createTextNode(original.slice(cursor)));
    countElement.textContent = String(ranges.length);
    noticeElement.textContent = corrections.length ? `已定位 ${ranges.length} / ${corrections.length} 条 AI 修改。点击标红原文查看建议；标注不代表所有建议都是确定错误，请结合报告核对。` : "尚无可定位的逐句修改，原文保持完整。已有评价仍可在下方查看。";
    if (!corrections.length) correctionsElement.textContent = "这份报告没有可识别的“原文—修改”条目。页面不会自行编造错误。";
    return { count: corrections.length };
  };
})();
