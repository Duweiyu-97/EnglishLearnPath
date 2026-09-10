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
  function locateAll(original, quote, punctuationOnly, allowRepeated = false) {
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
    if (allowRepeated) {
      haystack = haystack.toLocaleLowerCase();
      needle = needle.toLocaleLowerCase();
    }
    if (!needle) return [];
    const found = [];
    for (let start = haystack.indexOf(needle); start >= 0; start = haystack.indexOf(needle, start + Math.max(1, needle.length))) {
      const end = start + needle.length;
      const mapped = !positions ? {start, end} : {start:positions[start], end:ends ? ends[end - 1] : positions[end - 1] + 1};
      // Never match a quoted word inside another word.
      const startsInsideWord = /[\p{L}\p{N}]/u.test(original[mapped.start - 1] || '') && /[\p{L}\p{N}]/u.test(original[mapped.start] || '');
      const endsInsideWord = /[\p{L}\p{N}]/u.test(original[mapped.end - 1] || '') && /[\p{L}\p{N}]/u.test(original[mapped.end] || '');
      if (!startsInsideWord && !endsInsideWord) found.push(mapped);
    }
    return found.length > 1 && !allowRepeated ? [] : found;
  }

  const definiteWritingError = type => /(?:语法|拼写|词形|主谓一致|时态|冠词|单复数|介词|句法|标点|grammar|spelling|agreement|tense|article|plural|preposition|syntax|punctuation)/i.test(String(type || ""))
    && !/(?:优化|更自然|更地道|高级|简洁|衔接|结构|论证|风格|表达建议|style|optional|polish)/i.test(String(type || ""));

  const optionalTypographyRevision = item => {
    const description = `${item?.type || ""} ${item?.explanation || ""}`;
    return window.isPunctuationOnlyRevision(item?.original, item?.corrected)
      && /(?:标点|punctuation|破折号|连字符|em\s*dash|en\s*dash|hyphen)/i.test(description)
      && /\s-\s/.test(item.original)
      && /(?:[—–]|,)/.test(item.corrected);
  };

  const repeatSafeWritingRevision = item => window.isPunctuationOnlyRevision(item?.original, item?.corrected)
    && /(?:拼写|大小写|专有名词|spelling|capitali[sz]ation)/i.test(String(item?.type || ""));

  function extract(markdown, definiteOnly = false) {
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
    return (definiteOnly ? results.filter(item => definiteWritingError(item.type) && !optionalTypographyRevision(item)) : results).slice(0, 100);
  }

  window.renderReviewAnnotations = ({ original, markdown, originalElement, correctionsElement, countElement, noticeElement, punctuationOnly = false, definiteOnly = false, notebookOriginal = original, onSaveCorrection, isCorrectionSaved = () => false }) => {
    const corrections = extract(markdown, definiteOnly);
    originalElement.replaceChildren();
    correctionsElement.replaceChildren();
    const ranges = [];
    corrections.forEach((item, index) => {
      const locations = locateAll(original, item.original, punctuationOnly, definiteOnly && repeatSafeWritingRevision(item));
      const accepted = locations.filter(location => !ranges.some(range => location.start < range.end && location.end > range.start));
      accepted.forEach((location, occurrence) => ranges.push({ ...location, item, index, occurrence, markId:`review-original-${index}${occurrence ? `-${occurrence}` : ""}` }));
      const matched = accepted.length > 0;
      const card = document.createElement("article");
      card.className = "correction-card";
      card.id = `review-correction-${index}`;
      card.tabIndex = -1;
      const heading = document.createElement("h4"); heading.textContent = `${index + 1}. ${item.type || "修改建议"}`;
      const header = document.createElement("header"); header.className = "correction-heading";
      const actions = document.createElement("div"); actions.className = "correction-actions";
      header.append(heading, actions);
      const before = document.createElement("p"); before.className = "correction-before"; before.textContent = item.original;
      const after = document.createElement("p"); after.className = "correction-after"; after.textContent = item.corrected;
      const comparison = document.createElement("div"); comparison.className = "correction-comparison";
      [["原句", before], ["修改", after]].forEach(([label, paragraph]) => {
        const column = document.createElement("div");
        const caption = document.createElement("span"); caption.className = "correction-label"; caption.textContent = label;
        column.append(caption, paragraph); comparison.append(column);
      });
      const reason = document.createElement("p"); reason.className = "correction-reason"; reason.textContent = item.explanation || "";
      const status = document.createElement("small"); status.className = "correction-location";
      status.textContent = matched ? "" : "暂未定位原文";
      status.title = "原文不完全一致、重复出现或与其他标注重叠";
      card.append(header, comparison, reason, status);
      const canSave = typeof onSaveCorrection === "function" && definiteWritingError(item.type) && !optionalTypographyRevision(item)
        && locateAll(notebookOriginal, item.original, punctuationOnly, repeatSafeWritingRevision(item)).length > 0;
      if (canSave) {
        const saveButton = document.createElement("button");
        saveButton.type = "button";
        saveButton.className = "button button-secondary correction-save";
        saveButton.disabled = isCorrectionSaved(item);
        saveButton.textContent = saveButton.disabled ? "已加入错题本" : "加入错题本";
        const saveStatus = document.createElement("small");
        saveStatus.className = "correction-save-status";
        saveStatus.setAttribute("role", "status");
        saveButton.addEventListener("click", async () => {
          saveButton.disabled = true;
          saveButton.textContent = "正在保存…";
          saveStatus.textContent = "";
          try {
            await onSaveCorrection({ ...item });
            saveButton.textContent = "已加入错题本";
          } catch {
            saveButton.disabled = false;
            saveButton.textContent = "重试加入错题本";
            saveStatus.textContent = "保存失败，请检查本地数据服务后重试。";
          }
        });
        actions.append(saveButton);
        card.append(saveStatus);
      }
      if (matched) {
        const returnButton = document.createElement("button");
        returnButton.type = "button";
        returnButton.className = "button button-quiet correction-return";
        returnButton.textContent = accepted.length > 1 ? `返回原文（${accepted.length} 处）` : "返回原文";
        returnButton.setAttribute("aria-controls", `review-original-${index}`);
        returnButton.addEventListener("click", () => {
          const mark = document.getElementById(`review-original-${index}`);
          if (!mark) return;
          originalElement.querySelectorAll(".is-returned").forEach(node => node.classList.remove("is-returned"));
          mark.classList.add("is-returned");
          mark.focus({preventScroll:true});
          mark.scrollIntoView({behavior:"smooth",block:"center"});
        });
        actions.prepend(returnButton);
      }
      correctionsElement.append(card);
    });
    let cursor = 0;
    ranges.sort((a,b) => a.start - b.start).forEach(range => {
      originalElement.append(document.createTextNode(original.slice(cursor, range.start)));
      const mark = document.createElement("mark");
      mark.className = "annotation-mark";
      mark.id = range.markId;
      mark.textContent = original.slice(range.start, range.end);
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
      mark.setAttribute("aria-label", `查看修改 ${range.index + 1}：${range.item.original}`);
      mark.title = `建议：${range.item.corrected}`;
      const card = document.getElementById(`review-correction-${range.index}`);
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
    const locatedCorrections = new Set(ranges.map(range => range.index)).size;
    countElement.textContent = String(locatedCorrections);
    noticeElement.textContent = corrections.length ? (definiteOnly ? `已定位 ${locatedCorrections} / ${corrections.length} 条确定语法错误。点击标红原文查看最小修改；可选优化只在报告中展示，不会标红。` : `已定位 ${locatedCorrections} / ${corrections.length} 条 AI 修改。点击标红原文查看建议。`) : (definiteOnly ? "没有可定位的确定语法错误。可选优化仍可在下方报告中查看，原文不会因此标红。" : "尚无可定位的逐句修改，原文保持完整。已有评价仍可在下方查看。");
    if (!corrections.length) correctionsElement.textContent = definiteOnly ? "这份报告没有可识别的确定语法错误；页面不会把风格优化标成错误。" : "这份报告没有可识别的“原文—修改”条目。页面不会自行编造错误。";
    return { count: corrections.length };
  };
})();
