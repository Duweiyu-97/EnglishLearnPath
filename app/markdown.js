/* Locally bundled Markdown rendering; model output is always untrusted. */
(() => {
  "use strict";
  window.renderReviewMarkdown = (element, source) => {
    element.classList.remove("is-error");
    element.classList.add("markdown-body");
    const text = String(source || "");
    if (!window.marked || !window.DOMPurify) {
      element.textContent = text;
      element.classList.remove("markdown-body");
      return;
    }
    // No images, forms, embedded media, styles or executable HTML from AI.
    const fragment = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true, async: false }), {
      ALLOWED_TAGS: ["p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "del", "s", "ul", "ol", "li", "blockquote", "hr", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "a"],
      ALLOWED_ATTR: ["href", "title", "start"],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true
    });
    fragment.querySelectorAll("a").forEach(link => {
      const href = link.getAttribute("href") || "";
      if (!/^(https?:\/\/|mailto:)/i.test(href)) link.removeAttribute("href");
      else { link.target = "_blank"; link.rel = "noopener noreferrer"; }
    });
    fragment.querySelectorAll("table").forEach(table => {
      const wrapper = document.createElement("div");
      wrapper.className = "markdown-table-scroll";
      wrapper.tabIndex = 0;
      wrapper.setAttribute("role", "region");
      wrapper.setAttribute("aria-label", "反馈表格，可横向滚动");
      table.replaceWith(wrapper);
      wrapper.append(table);
    });
    element.replaceChildren(fragment);
  };

  const emphasizeOverallScore = root => {
    const paragraph = root?.querySelector(".review-score-card > p:first-of-type");
    if (!paragraph) return;
    const text = paragraph.textContent.trim();
    const match = text.match(/^(.{0,18}?(?:总分|Overall(?: Band)? Score))\s*[：:]\s*(\d(?:\.\d)?(?:\s*[–—-]\s*\d(?:\.\d)?)?)(.*)$/i);
    if (!match) { paragraph.classList.add("score-lead-fallback"); return; }
    const highlight = document.createElement("div");
    highlight.className = "score-highlight";
    const label = document.createElement("span");
    label.textContent = "预估总分";
    const score = document.createElement("strong");
    score.textContent = match[2];
    if (/[–—-]/.test(match[2])) highlight.classList.add("has-range");
    highlight.append(label, score);
    if (match[3].trim()) {
      const note = document.createElement("small");
      note.textContent = match[3].trim()
        .replace(/^[（(]\s*/, "")
        .replace(/\s*[）)](?=\s|$)/g, "")
        .trim();
      highlight.append(note);
    }
    paragraph.replaceWith(highlight);
    const tableWrapper = root.querySelector(".review-score-card .markdown-table-scroll");
    if (tableWrapper) {
      const criterionName = raw => {
        const text = String(raw || "").trim();
        if (/\bTA\b|TASK\s+ACHIEVEMENT|任务完成/i.test(text)) return "Task Achievement";
        if (/\bTR\b|TASK\s+RESPONSE|任务回应/i.test(text)) return "Task Response";
        if (/\bCC\b|COHERENCE|衔接/i.test(text)) return "Coherence & Cohesion";
        if (/\bLR\b|LEXICAL|词汇/i.test(text)) return "Lexical Resource";
        if (/\bGRA\b|GRAMMAR|语法/i.test(text)) return "Grammar Range & Accuracy";
        if (/\bFC\b|FLUENCY|流利/i.test(text)) return "Fluency & Coherence";
        if (/\bP\b|PRONUNCIATION|发音/i.test(text)) return "Pronunciation";
        return text;
      };
      const rows = [...tableWrapper.querySelectorAll("tbody tr")];
      const criteria = document.createElement("div");
      criteria.className = "score-criteria-grid";
      for (const row of rows) {
        const cells = [...row.querySelectorAll("th, td")].map(cell => cell.textContent.trim());
        if (cells.length < 2) continue;
        const criterion = document.createElement("article");
        criterion.className = "score-criterion-card";
        const header = document.createElement("header");
        const name = document.createElement("strong");
        name.textContent = criterionName(cells[0]);
        const value = document.createElement("span");
        const rawValue = cells[1];
        const numericBand = rawValue.match(/\d(?:\.\d)?(?:\s*[–—-]\s*\d(?:\.\d)?)?/);
        value.textContent = numericBand ? numericBand[0].replace(/\s+/g, "") : (rawValue || "暂无法评分");
        if (!numericBand) value.className = "score-status";
        header.append(name, value);
        criterion.append(header);
        const evidence = cells.slice(2).join(" ").trim();
        if (evidence) {
          const detail = document.createElement("p");
          detail.textContent = evidence;
          detail.title = evidence;
          criterion.append(detail);
        }
        criteria.append(criterion);
      }
      if (criteria.childElementCount) tableWrapper.replaceWith(criteria);
      const overview = document.createElement("div");
      overview.className = "score-overview-grid";
      highlight.replaceWith(overview);
      overview.append(highlight, criteria.childElementCount ? criteria : tableWrapper);
    }
  };

  const reportSectionKicker = heading => {
    const text = String(heading || "").trim();
    if (/确定语法错误/.test(text)) return "CONFIRMED CORRECTIONS";
    if (/逐[句条].*(?:纠错|修改|修正)/.test(text)) return "CORRECTIONS";
    if (/原文优化建议/.test(text)) return "IMPROVEMENT SUGGESTIONS";
    if (/目标水平范文/.test(text)) return "TARGET-LEVEL MODEL";
    if (/最终值得记忆的语料/.test(text)) return "REUSABLE LANGUAGE";
    if (/转写整理稿/.test(text)) return "TRANSCRIPT EDIT";
    return "REVIEW SECTION";
  };

  const reportSectionKind = heading => {
    const text = String(heading || "").trim();
    if (/(?:评分与小分|分项评分|综合评分|预估总分)/.test(text)) return "score";
    if (/(?:总体评价|总体表现|整体评价|一句话总体)/.test(text)) return "overview";
    if (/(?:逐[句条].*(?:纠错|修改|修正)|确定语法错误)/.test(text)) return "corrections";
    if (/转写整理稿/.test(text)) return "transcript";
    if (/(?:原文|可选).*(?:优化|提升).*建议|优化建议/.test(text)) return "improvement";
    if (/(?:目标水平|参考|示范).*(?:范文|版本)|范文/.test(text)) return "model";
    if (/(?:最终)?值得记忆的语料|可复用语料/.test(text)) return "language";
    return "";
  };

  const memoryGroupFromText = value => /句式|句型|框架|sentence|pattern|frame/i.test(String(value || "")) ? "patterns" : "collocations";

  const splitMemoryExpression = value => {
    const text = String(value || "").trim().replace(/^[“”"']+|[“”"']+$/g, "");
    const separated = text.match(/^(.*?)(?:\s*[｜|]\s*|\s+[—–-]\s+)([^]*[\u3400-\u9fff][^]*)$/);
    return separated
      ? { expression: separated[1].trim().replace(/^[“”"']+|[“”"']+$/g, ""), detail: separated[2].trim() }
      : { expression: text, detail: "" };
  };

  const normalizeReusableLanguageCard = card => {
    const heading = card.querySelector("h3");
    if (!heading || !/最终值得记忆的语料/.test(heading.textContent)) return;
    const entries = { collocations: [], patterns: [] };
    let group = "collocations";
    for (const node of [...card.children]) {
      if (node === heading || node.classList.contains("kicker")) continue;
      if (/^(H4|H5|H6|P)$/.test(node.nodeName)) group = memoryGroupFromText(node.textContent);
      const table = node.matches("table") ? node : node.querySelector("table");
      if (table) {
        for (const row of table.querySelectorAll("tbody tr")) {
          const cells = [...row.querySelectorAll("th, td")].map(cell => cell.textContent.trim());
          if (!cells[0]) continue;
          const target = memoryGroupFromText(cells[1]);
          entries[target].push({ expression: cells[0], detail: cells[2] || cells[1] || "" });
        }
      }
      if (/^(UL|OL)$/.test(node.nodeName)) {
        for (const item of node.querySelectorAll(":scope > li")) entries[group].push(splitMemoryExpression(item.textContent));
      }
    }
    if (!entries.collocations.length && !entries.patterns.length) return;
    [...card.children].filter(node => node !== heading && !node.classList.contains("kicker")).forEach(node => node.remove());
    const groups = document.createElement("div");
    groups.className = "review-memory-groups";
    for (const [key, english, chinese] of [["collocations", "CORE COLLOCATIONS", "核心搭配"], ["patterns", "USEFUL SENTENCE PATTERNS", "实用句式"]]) {
      if (!entries[key].length) continue;
      const seen = new Set();
      const section = document.createElement("section");
      const label = document.createElement("span");
      label.className = "review-memory-label";
      label.textContent = english;
      const title = document.createElement("h4");
      title.textContent = chinese;
      const list = document.createElement("ul");
      for (const entry of entries[key]) {
        const expression = String(entry.expression || "").trim();
        const identity = expression.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        const item = document.createElement("li");
        const phrase = document.createElement("strong");
        phrase.textContent = expression;
        item.append(phrase);
        if (entry.detail) {
          const detail = document.createElement("span");
          detail.textContent = entry.detail;
          item.append(detail);
        }
        list.append(item);
      }
      section.append(label, title, list);
      groups.append(section);
    }
    card.append(groups);
  };

  // Presentation only: stored Markdown remains unchanged.
  window.renderReviewReport = (element, source, navigation, options = {}) => {
    window.renderReviewMarkdown(element, source);
    navigation?.replaceChildren();
    if (navigation) navigation.hidden = true;
    const extracted = {
      score: options.scoreElement || null,
      overview: options.overviewElement || null
    };
    Object.values(extracted).filter(Boolean).forEach(target => target.replaceChildren());
    const nodes = [...element.childNodes];
    const levels = nodes.filter(node => /^H[1-3]$/.test(node.nodeName)).map(node => Number(node.nodeName[1]));
    const level = levels.length ? Math.min(...levels) : 0;
    const fragment = document.createDocumentFragment();
    let card;
    let index = 0;
    let skipCorrection = false;
    let seenHeading = false;
    let destination = "report";
    const extractedCounts = { score: 0, overview: 0 };
    for (const node of nodes) {
      const isHeading = options.strictSections ? /^H[1-3]$/.test(node.nodeName) : level && node.nodeName === `H${level}`;
      if (isHeading) {
        seenHeading = true;
        const kind = reportSectionKind(node.textContent);
        skipCorrection = Boolean((options.dedupeCorrections && kind === "corrections") || (options.hideTranscript && kind === "transcript") || (options.strictSections && !kind));
        if (skipCorrection) { card = null; continue; }
        destination = kind === "score" ? "score" : kind === "overview" ? "overview" : "report";
      }
      if (skipCorrection) continue;
      if (options.strictSections && !seenHeading) continue;
      if (!seenHeading && node.nodeName === 'P') {
        const preamble = node.textContent.trim();
        if (/^主题[：:]/.test(preamble)) continue;
        if (/^(?:好的[，,。！!\s]|你好[，,。！!\s]|很高兴|当然[，,。！!\s])/.test(preamble) && !/(?:\d\s*分|原文[：:]|修改[：:])/.test(preamble)) continue;
      }
      if (!node.textContent.trim() && node.nodeType === Node.TEXT_NODE) continue;
      if (!card || isHeading) {
        card = document.createElement("article");
        card.className = "review-report-card";
        if (destination !== "report" && extracted[destination]) {
          card.className = `review-extracted-card review-${destination}-card`;
          extracted[destination].append(card);
          extractedCounts[destination] += 1;
        } else {
          destination = "report";
          fragment.append(card);
        }
      }
      if (isHeading) {
        card.id = destination === "report" ? `review-report-section-${++index}` : `review-${destination}-summary`;
        if (destination !== "report") continue;
        const kicker = document.createElement("span");
        kicker.className = "kicker";
        kicker.textContent = reportSectionKicker(node.textContent);
        card.append(kicker);
      }
      card.append(node);
    }
    element.replaceChildren(fragment);
    element.querySelectorAll(".review-report-card").forEach(normalizeReusableLanguageCard);
    if (extracted.score && !extractedCounts.score) extracted.score.innerHTML = '<p class="review-extracted-placeholder">本次模型没有返回可识别的总分与小分，请重新生成报告。</p>';
    if (extracted.overview && !extractedCounts.overview) extracted.overview.innerHTML = '<p class="review-extracted-placeholder">本次模型没有返回独立的总体评价，请结合下方报告查看。</p>';
    if (extracted.score && extractedCounts.score) emphasizeOverallScore(extracted.score);
  };
})();
