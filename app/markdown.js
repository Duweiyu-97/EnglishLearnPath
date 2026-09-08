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

  // Presentation only: stored Markdown remains unchanged.
  window.renderReviewReport = (element, source, navigation, options = {}) => {
    window.renderReviewMarkdown(element, source);
    navigation.replaceChildren();
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
      const isHeading = level && node.nodeName === `H${level}`;
      if (isHeading) {
        seenHeading = true;
        skipCorrection = Boolean((options.dedupeCorrections && /(?:逐[句条].*(?:纠错|修改|修正)|确定语法错误)/.test(node.textContent)) || (options.hideTranscript && /转写整理稿/.test(node.textContent)));
        if (skipCorrection) { card = null; continue; }
        destination = /(?:评分与小分|分项评分|综合评分|预估总分)/.test(node.textContent) ? "score"
          : /(?:总体评价|总体表现|整体评价|一句话总体)/.test(node.textContent) ? "overview" : "report";
      }
      if (skipCorrection) continue;
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
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button button-quiet";
        button.textContent = node.textContent;
        button.addEventListener("click", () => cardById(button.dataset.section)?.scrollIntoView({ behavior: "smooth", block: "start" }));
        button.dataset.section = card.id;
        navigation.append(button);
        if (destination !== "report") continue;
      }
      card.append(node);
    }
    element.replaceChildren(fragment);
    if (extracted.score && !extractedCounts.score) extracted.score.innerHTML = '<p class="review-extracted-placeholder">本次模型没有返回可识别的总分与小分，请重新生成报告。</p>';
    if (extracted.overview && !extractedCounts.overview) extracted.overview.innerHTML = '<p class="review-extracted-placeholder">本次模型没有返回独立的总体评价，请结合下方报告查看。</p>';
    navigation.hidden = !index;
  };
  const cardById = id => document.getElementById(id);
})();
