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
    const nodes = [...element.childNodes];
    const levels = nodes.filter(node => /^H[1-3]$/.test(node.nodeName)).map(node => Number(node.nodeName[1]));
    const level = levels.length ? Math.min(...levels) : 0;
    const fragment = document.createDocumentFragment();
    let card;
    let index = 0;
    let skipCorrection = false;
    let seenHeading = false;
    for (const node of nodes) {
      const isHeading = level && node.nodeName === `H${level}`;
      if (isHeading) {
        seenHeading = true;
        skipCorrection = Boolean((options.dedupeCorrections && /逐[句条].*(?:纠错|修改|修正)/.test(node.textContent)) || (options.hideTranscript && /转写整理稿/.test(node.textContent)));
        if (skipCorrection) { card = null; continue; }
      }
      if (skipCorrection) continue;
      if (!seenHeading && node.nodeName === 'P' && /^(?:好的[，,。！!\s]|你好[，,。！!\s]|很高兴|当然[，,。！!\s])/.test(node.textContent.trim()) && !/(?:\d\s*分|原文[：:]|修改[：:])/.test(node.textContent)) continue;
      if (!node.textContent.trim() && node.nodeType === Node.TEXT_NODE) continue;
      if (!card || isHeading) {
        card = document.createElement("article");
        card.className = "review-report-card";
        fragment.append(card);
      }
      if (isHeading) {
        card.id = `review-report-section-${++index}`;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button button-quiet";
        button.textContent = node.textContent;
        button.addEventListener("click", () => cardById(button.dataset.section)?.scrollIntoView({ behavior: "smooth", block: "start" }));
        button.dataset.section = card.id;
        navigation.append(button);
      }
      card.append(node);
    }
    element.replaceChildren(fragment);
    navigation.hidden = !index;
  };
  const cardById = id => document.getElementById(id);
})();
