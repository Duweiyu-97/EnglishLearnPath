(() => {
  "use strict";

  const DEFAULT_STATE = {
    listening: [],
    reading: [],
    writings: [],
    speaking: [],
    activityDates: []
  };

  const titles = {
    home: ["TODAY'S PATH", "学习概览"],
    listening: ["LISTENING LAB", "听力练习"],
    reading: ["READING DESK", "阅读练习"],
    writing: ["WRITING STUDIO", "写作工坊"],
    speaking: ["SPEAKING ROOM", "口语练习"],
    settings: ["PRIVATE BY DEFAULT", "AI 与数据设置"],
    guide: ["START HERE", "使用指南"]
  };

  let state = structuredClone(DEFAULT_STATE);
  let diskReady = false;
  let diskStatus = null;
  let saveQueue = Promise.resolve();
  let resourceCatalog = { listening: [], reading: [], warnings: [], listeningFolder: "", readingFolder: "" };
  let activeListeningId = null;
  let activeReadingId = null;
  let activeWritingId = null;
  let aiConnected = false;
  let timerInterval = null;
  let timerSeconds = 40 * 60;
  let recorder = null;
  let recordingStream = null;
  let recordingChunks = [];
  let recordingBlob = null;
  let recordSeconds = 0;
  let recordInterval = null;
  let toastTimer = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const normalized = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  function normalizeState(value) {
    const candidate = value && typeof value === "object" ? value : {};
    return {
      listening: Array.isArray(candidate.listening) ? candidate.listening : [],
      reading: Array.isArray(candidate.reading) ? candidate.reading : [],
      writings: Array.isArray(candidate.writings) ? candidate.writings : [],
      speaking: Array.isArray(candidate.speaking) ? candidate.speaking : [],
      activityDates: Array.isArray(candidate.activityDates) ? candidate.activityDates : []
    };
  }

  function saveState(markActivity = false) {
    if (markActivity && !state.activityDates.includes(today())) state.activityDates.push(today());
    renderMetrics();
    const snapshot = structuredClone(state);
    const task = saveQueue.catch(() => undefined).then(async () => {
      const response = await fetch("/api/data", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: snapshot })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "无法写入本地数据文件");
      updateDiskStatus(result.storage);
      return result;
    });
    saveQueue = task.catch(error => {
      setStorageError(error.message);
      return undefined;
    });
    return task;
  }

  async function loadStateFromDisk() {
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "启动器没有返回数据");
      state = normalizeState(result.data);
      diskReady = true;
      updateDiskStatus(result.storage);
    } catch (error) {
      diskReady = false;
      setStorageError(`永久数据目录不可用：${error.message}`);
      showToast("无法连接永久数据目录，请确认使用便携启动器打开");
    }
  }

  function updateDiskStatus(status) {
    if (!status) return;
    diskStatus = status;
    const bound = Boolean(status.bound ?? status.ready);
    diskReady = bound;
    const topBadge = $("#storageStatusBadge");
    topBadge.textContent = bound ? "本地文件已连接" : "尚未选择数据目录";
    topBadge.className = `status-badge storage-badge ${diskReady ? "status-on" : "status-off"}`;
    $("#diskStatusBadge").textContent = bound ? "永久写盘" : "待选择";
    $("#diskStatusBadge").className = `status-badge ${diskReady ? "status-on" : "status-off"}`;
    $("#storageOnboarding").classList.toggle("hidden", bound);
    $("#unboundStoragePrompt").classList.toggle("hidden", bound);
    $("#boundStorageDetails").classList.toggle("hidden", !bound);
    $("#openDataDirectory").disabled = !bound;
    $("#writeDataNow").disabled = !bound;
    $("#dataDirectoryPath").textContent = status.directory || "尚未选择";
    $("#dataFileStatus").textContent = status.fileExists
      ? `数据文件已建立${status.lastWriteAt ? ` · 最近写入 ${new Date(status.lastWriteAt).toLocaleString()}` : ""}`
      : "数据文件将在第一次保存时建立";
  }

  function setStorageError(message) {
    diskReady = false;
    $("#storageStatusBadge").textContent = "数据写入失败";
    $("#storageStatusBadge").className = "status-badge storage-badge status-off";
    $("#diskStatusBadge").textContent = "异常";
    $("#diskStatusBadge").className = "status-badge status-off";
    const result = $("#storageResult");
    result.className = "feedback-box is-error";
    result.textContent = message;
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2800);
  }

  function routeTo(route) {
    const target = titles[route] ? route : "home";
    $$("[data-page]").forEach(page => page.classList.toggle("is-active", page.dataset.page === target));
    $$(".nav-item[data-route]").forEach(item => item.classList.toggle("is-active", item.dataset.route === target));
    $("#pageEyebrow").textContent = titles[target][0];
    $("#pageTitle").textContent = titles[target][1];
    $(".sidebar").classList.remove("is-open");
    history.replaceState(null, "", `#${target}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function calculateStreak() {
    const dates = [...new Set(state.activityDates)].sort().reverse();
    if (!dates.length) return 0;
    let cursor = new Date();
    const newest = new Date(`${dates[0]}T00:00:00`);
    const diff = Math.floor((new Date(cursor.toDateString()) - newest) / 86400000);
    if (diff > 1) return 0;
    if (diff === 1) cursor = newest;
    let streak = 0;
    for (const date of dates) {
      const expected = new Date(cursor);
      expected.setHours(0, 0, 0, 0);
      if (date !== expected.toISOString().slice(0, 10)) break;
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function renderMetrics() {
    const total = state.writings.length + state.speaking.length;
    $("#metricTotal").textContent = total;
    $("#metricWriting").textContent = state.writings.length;
    $("#metricImports").textContent = state.listening.length + state.reading.length + resourceCatalog.listening.length + resourceCatalog.reading.length;
    $("#metricStreak").textContent = calculateStreak();
  }

  async function importJson(file, type) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      if (!items.length) throw new Error("文件中没有材料");
      const validated = items.map(item => type === "listening" ? validateListening(item) : validateReading(item));
      state[type].push(...validated);
      saveState();
      type === "listening" ? renderListeningLibrary() : renderReadingLibrary();
      showToast(`已导入 ${validated.length} 份${type === "listening" ? "听力" : "阅读"}材料`);
    } catch (error) {
      showToast(`导入失败：${error.message}`);
    }
  }

  function validateListening(item) {
    if (!item || typeof item.title !== "string" || !Array.isArray(item.questions)) throw new Error("听力材料需要 title 和 questions");
    return {
      id: uid(),
      title: item.title.trim() || "未命名听力材料",
      description: String(item.description || ""),
      source: String(item.source || "用户导入"),
      questions: item.questions.map((q, index) => ({
        prompt: String(q.prompt || `Question ${index + 1}`),
        answer: String(q.answer ?? ""),
        explanation: String(q.explanation || "")
      }))
    };
  }

  function validateReading(item) {
    if (!item || typeof item.title !== "string" || !Array.isArray(item.paragraphs)) throw new Error("阅读材料需要 title 和 paragraphs");
    return {
      id: uid(),
      title: item.title.trim() || "Untitled passage",
      description: String(item.description || ""),
      source: String(item.source || "用户导入"),
      paragraphs: item.paragraphs.map((p, index) => ({
        label: String(p.label || String.fromCharCode(65 + index)),
        text: String(p.text || ""),
        translation: String(p.translation || ""),
        summary: String(p.summary || "")
      })),
      questions: Array.isArray(item.questions) ? item.questions.map((q, index) => ({
        prompt: String(q.prompt || `Question ${index + 1}`),
        answer: String(q.answer ?? ""),
        explanation: String(q.explanation || "")
      })) : []
    };
  }

  const listeningExample = {
    title: "A Quiet Community Garden",
    description: "原创结构示例。请自行准备或录制与文本相符的音频。",
    source: "English Learning Path 原创示例",
    questions: [
      { prompt: "The garden opens at ______ on Saturday mornings.", answer: "eight", explanation: "示例答案用于演示核对流程；真实练习请配合你自己的音频。" },
      { prompt: "Volunteers should bring a pair of ______.", answer: "gloves", explanation: "填入一个复数名词。" }
    ]
  };

  const readingExample = {
    title: "Why Small Routines Matter",
    description: "English Learning Path 原创短文，用于演示翻译、段意和解析的直接展示方式。",
    source: "English Learning Path 原创示例",
    paragraphs: [
      { label: "A", text: "People often imagine that progress arrives through dramatic decisions. In practice, modest routines can be more powerful because they reduce the effort needed to begin.", translation: "人们常以为进步来自重大的决定。实际上，微小的日常习惯可能更有力量，因为它们降低了开始行动所需的精力。", summary: "小习惯通过降低启动成本，往往比重大决定更能推动进步。" },
      { label: "B", text: "A learner who reads for ten minutes every evening may cover more material over a year than someone who waits for an entirely free weekend. Consistency turns a small action into a reliable system.", translation: "一个每天晚上阅读十分钟的学习者，一年下来可能比总在等待完整空闲周末的人读得更多。持续性会把一个微小行动变成可靠的系统。", summary: "长期的一致性能够把短时间投入累积成稳定成果。" }
    ],
    questions: [
      { prompt: "According to paragraph A, why can modest routines be powerful?", answer: "They reduce the effort needed to begin.", explanation: "定位 paragraph A 的 because 从句。题干中的 powerful 与原文一致，why 对应原因。" },
      { prompt: "What does consistency turn a small action into?", answer: "A reliable system.", explanation: "定位 paragraph B 最后一句，turn A into B 的 B 即为答案。" }
    ]
  };

  async function loadResourceCatalog(force = false) {
    const buttons = [$("#rescanListening"), $("#rescanReading")];
    if (force) {
      buttons.forEach(button => { button.disabled = true; button.textContent = "正在解压并扫描……"; });
    }
    try {
      const response = await fetch(force ? "/api/resources/rescan" : "/api/resources", { method: force ? "POST" : "GET", cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "资源扫描失败");
      resourceCatalog = {
        listening: Array.isArray(result.listening) ? result.listening : [],
        reading: Array.isArray(result.reading) ? result.reading : [],
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
        listeningFolder: result.listeningFolder || "",
        readingFolder: result.readingFolder || ""
      };
      renderResourceLibraries();
      if (force) showToast(`扫描完成：虾滑听力 ${resourceCatalog.listening.length} 份，ZYZ 阅读 ${resourceCatalog.reading.length} 份`);
      if (resourceCatalog.warnings.length) showToast(`扫描完成，但有 ${resourceCatalog.warnings.length} 个文件需要检查`);
    } catch (error) {
      showToast(`本地资源不可用：${error.message}`);
    } finally {
      buttons.forEach(button => { button.disabled = false; button.textContent = "重新扫描"; });
    }
  }

  async function importResourceArchives(kind) {
    if (!diskReady) {
      routeTo("settings");
      return showToast("请先选择永久数据文件夹");
    }
    const button = kind === "listening" ? $("#importListeningArchives") : $("#importReadingArchives");
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "请选择 ZIP……";
    try {
      const response = await fetch(`/api/resources/import?kind=${encodeURIComponent(kind)}`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "题库导入失败");
      if (result.canceled) return;
      const catalog = result.catalog || {};
      resourceCatalog = {
        listening: Array.isArray(catalog.listening) ? catalog.listening : [],
        reading: Array.isArray(catalog.reading) ? catalog.reading : [],
        warnings: Array.isArray(catalog.warnings) ? catalog.warnings : [],
        listeningFolder: catalog.listeningFolder || "",
        readingFolder: catalog.readingFolder || ""
      };
      renderResourceLibraries();
      showToast(`已导入 ${result.imported || 0} 个新压缩包${result.skipped ? `，跳过 ${result.skipped} 个重复包` : ""}`);
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function renderResourceLibraries() {
    renderResourceList("listening", resourceCatalog.listening, "#listeningResourceLibrary", "#listeningResourceCount");
    renderResourceList("reading", resourceCatalog.reading, "#readingResourceLibrary", "#readingResourceCount");
    $("#listeningFolderPath").textContent = resourceCatalog.listeningFolder || "固定目录尚未就绪";
    $("#readingFolderPath").textContent = resourceCatalog.readingFolder || "固定目录尚未就绪";
    $("#settingsListeningPath").textContent = resourceCatalog.listeningFolder || "连接后显示";
    $("#settingsReadingPath").textContent = resourceCatalog.readingFolder || "连接后显示";
    renderMetrics();
  }

  function renderResourceList(kind, items, rootSelector, countSelector) {
    const root = $(rootSelector);
    $(countSelector).textContent = items.length;
    if (!items.length) {
      root.className = "library-list empty-state resource-list";
      root.textContent = kind === "listening" ? "把虾滑 ZIP 或解压文件夹放入固定目录后点击扫描" : "把 ZYZ ZIP 或解压文件夹放入固定目录后点击扫描";
      return;
    }
    root.className = "library-list resource-list";
    root.innerHTML = items.map(item => `<button class="library-item" data-resource-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.relativePath)}</small><span class="resource-item-badge">${escapeHtml(item.format)}</span></button>`).join("");
    $$('[data-resource-id]', root).forEach(button => button.addEventListener("click", () => openLocalResource(button.dataset.resourceId)));
  }

  async function openLocalResource(id) {
    try {
      const response = await fetch("/api/resources/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "无法打开资源");
      showToast("已使用本机默认程序打开资源");
    } catch (error) {
      showToast(error.message);
    }
  }

  async function openResourceFolder(kind) {
    try {
      const response = await fetch(`/api/resources/open-directory?kind=${encodeURIComponent(kind)}`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "无法打开固定目录");
    } catch (error) {
      showToast(error.message);
    }
  }

  function renderListeningLibrary() {
    const root = $("#listeningLibrary");
    $("#listeningCount").textContent = state.listening.length;
    if (!state.listening.length) {
      root.className = "library-list empty-state";
      root.textContent = "尚未导入听力材料";
      showListening(null);
      return;
    }
    root.className = "library-list";
    root.innerHTML = state.listening.map(item => `<button class="library-item ${item.id === activeListeningId ? "is-active" : ""}" data-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><small>${item.questions.length} 道题 · ${escapeHtml(item.source)}</small></button>`).join("");
    $$(".library-item", root).forEach(button => button.addEventListener("click", () => showListening(button.dataset.id)));
  }

  function showListening(id) {
    activeListeningId = id;
    const item = state.listening.find(entry => entry.id === id);
    $("#listeningEmpty").classList.toggle("hidden", Boolean(item));
    $("#listeningPractice").classList.toggle("hidden", !item);
    if (!item) return;
    $("#listeningTitle").textContent = item.title;
    $("#listeningDescription").textContent = item.description;
    $("#listeningQuestions").innerHTML = item.questions.map((q, index) => `<div class="question-card" data-answer="${escapeHtml(q.answer)}"><label>${index + 1}. ${escapeHtml(q.prompt)}</label><input name="answer-${index}" autocomplete="off" aria-label="第 ${index + 1} 题答案"><div class="answer-detail hidden"></div></div>`).join("");
    $("#listeningResult").classList.add("hidden");
    renderListeningLibrary();
  }

  function checkListening() {
    const item = state.listening.find(entry => entry.id === activeListeningId);
    if (!item) return;
    let correct = 0;
    $$(".question-card", $("#listeningQuestions")).forEach((card, index) => {
      const input = $("input", card);
      const detail = $(".answer-detail", card);
      const matched = normalized(input.value) === normalized(item.questions[index].answer);
      if (matched) correct += 1;
      detail.className = `answer-detail ${matched ? "" : "is-wrong"}`;
      detail.textContent = `${matched ? "✓ 正确" : "✗ 参考答案：" + item.questions[index].answer}${item.questions[index].explanation ? "\n解析：" + item.questions[index].explanation : ""}`;
    });
    const result = $("#listeningResult");
    result.textContent = `本次答对 ${correct} / ${item.questions.length} 题。答案与解析已显示在每道题下方。`;
    result.classList.remove("hidden");
    saveState(true);
  }

  function renderReadingLibrary() {
    const root = $("#readingLibrary");
    $("#readingCount").textContent = state.reading.length;
    if (!state.reading.length) {
      root.className = "library-list empty-state";
      root.textContent = "尚未导入阅读材料";
      showReading(null);
      return;
    }
    root.className = "library-list";
    root.innerHTML = state.reading.map(item => `<button class="library-item ${item.id === activeReadingId ? "is-active" : ""}" data-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><small>${item.paragraphs.length} 段 · ${item.questions.length} 道题</small></button>`).join("");
    $$(".library-item", root).forEach(button => button.addEventListener("click", () => showReading(button.dataset.id)));
  }

  function showReading(id) {
    activeReadingId = id;
    const item = state.reading.find(entry => entry.id === id);
    $("#readingEmpty").classList.toggle("hidden", Boolean(item));
    const root = $("#readingPractice");
    root.classList.toggle("hidden", !item);
    if (!item) return;
    root.innerHTML = `
      <header class="reading-header"><span class="kicker">${escapeHtml(item.source)}</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.description)}</p><div class="reading-actions"><button id="deleteReading" class="button button-danger-quiet">移除文章</button></div></header>
      <div>${item.paragraphs.map(p => `<section class="passage-block"><span class="passage-label">${escapeHtml(p.label)}</span><p class="passage-en">${escapeHtml(p.text)}</p>${p.translation ? `<p class="passage-zh"><strong>翻译：</strong>${escapeHtml(p.translation)}</p>` : ""}${p.summary ? `<div class="paragraph-summary"><strong>段落大意：</strong>${escapeHtml(p.summary)}</div>` : ""}</section>`).join("")}</div>
      <section class="reading-questions"><h3>题目答案与逐题解析</h3>${item.questions.length ? item.questions.map((q, index) => `<article class="reading-question"><h4>${index + 1}. ${escapeHtml(q.prompt)}</h4><div class="answer">答案：${escapeHtml(q.answer)}</div><div class="explanation"><strong>解析：</strong>${escapeHtml(q.explanation || "暂无解析")}</div></article>`).join("") : `<p>该材料未包含题目。</p>`}</section>`;
    $("#deleteReading").addEventListener("click", () => {
      if (!confirm("确定从本机移除这篇文章吗？")) return;
      state.reading = state.reading.filter(entry => entry.id !== activeReadingId);
      activeReadingId = null;
      saveState();
      renderReadingLibrary();
    });
    saveState(true);
    renderReadingLibrary();
  }

  function renderWritingHistory() {
    const root = $("#writingHistory");
    $("#writingCount").textContent = state.writings.length;
    if (!state.writings.length) {
      root.className = "library-list empty-state";
      root.textContent = "还没有写作记录";
      return;
    }
    root.className = "library-list";
    root.innerHTML = [...state.writings].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => `<button class="library-item ${item.id === activeWritingId ? "is-active" : ""}" data-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.type)}</strong><small>${escapeHtml(item.updatedAt.slice(0, 10))} · ${countWords(item.essay)} words</small></button>`).join("");
    $$(".library-item", root).forEach(button => button.addEventListener("click", () => loadWriting(button.dataset.id)));
  }

  function countWords(value) {
    const matches = String(value || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g);
    return matches ? matches.length : 0;
  }

  function newWriting() {
    activeWritingId = null;
    $("#writingType").value = "Task 2";
    $("#writingMinutes").value = "40";
    $("#writingPrompt").value = "";
    $("#writingEssay").value = "";
    $("#writingReview").classList.add("hidden");
    $("#deleteWriting").classList.add("hidden");
    $("#saveStatus").textContent = "尚未保存";
    resetWritingTimer();
    updateWordCount();
    renderWritingHistory();
    $("#writingPrompt").focus();
  }

  function loadWriting(id) {
    const item = state.writings.find(entry => entry.id === id);
    if (!item) return;
    activeWritingId = id;
    $("#writingType").value = item.type;
    $("#writingMinutes").value = String(item.minutes);
    $("#writingPrompt").value = item.prompt;
    $("#writingEssay").value = item.essay;
    $("#deleteWriting").classList.remove("hidden");
    $("#saveStatus").textContent = `上次保存 ${new Date(item.updatedAt).toLocaleString()}`;
    $("#writingReview").classList.add("hidden");
    resetWritingTimer();
    updateWordCount();
    renderWritingHistory();
  }

  async function saveWriting() {
    const prompt = $("#writingPrompt").value.trim();
    const essay = $("#writingEssay").value.trim();
    if (!prompt && !essay) return showToast("请先输入题目或正文");
    const record = {
      id: activeWritingId || uid(),
      type: $("#writingType").value,
      minutes: Number($("#writingMinutes").value),
      prompt,
      essay,
      updatedAt: new Date().toISOString()
    };
    const index = state.writings.findIndex(entry => entry.id === record.id);
    if (index >= 0) state.writings[index] = record; else state.writings.push(record);
    activeWritingId = record.id;
    try {
      await saveState(true);
    } catch {
      return showToast("写作未能写入本地文件，请检查数据目录");
    }
    $("#deleteWriting").classList.remove("hidden");
    $("#saveStatus").textContent = `已保存 ${new Date().toLocaleTimeString()}`;
    renderWritingHistory();
    showToast("写作已保存在本机");
  }

  function updateWordCount() {
    $("#wordCount").textContent = countWords($("#writingEssay").value);
    $("#saveStatus").textContent = activeWritingId ? "有未保存的修改" : "尚未保存";
  }

  function formatClock(seconds) {
    const safe = Math.max(0, seconds);
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  function resetWritingTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerSeconds = Number($("#writingMinutes").value) * 60;
    $("#writingTimer").textContent = Number($("#writingMinutes").value) ? formatClock(timerSeconds) : "∞";
    $("#toggleTimer").textContent = "开始计时";
  }

  function toggleWritingTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
      $("#toggleTimer").textContent = "继续计时";
      return;
    }
    if (!Number($("#writingMinutes").value)) return showToast("当前选择了不计时");
    if (timerSeconds <= 0) resetWritingTimer();
    $("#toggleTimer").textContent = "暂停计时";
    timerInterval = setInterval(() => {
      timerSeconds -= 1;
      $("#writingTimer").textContent = formatClock(timerSeconds);
      if (timerSeconds <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        $("#toggleTimer").textContent = "重新计时";
        showToast("计时结束，记得保存并复盘");
      }
    }, 1000);
  }

  async function refreshAiStatus() {
    try {
      const response = await fetch("/api/ai/status", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setAiConnected(Boolean(data.connected), data.model || "");
    } catch {
      setAiConnected(false);
    }
  }

  function setAiConnected(connected, model = "") {
    aiConnected = connected;
    const label = connected ? `AI 已连接${model ? ` · ${model}` : ""}` : "AI 未连接";
    for (const badge of [$("#aiStatusBadge"), $("#settingsAiBadge")]) {
      badge.textContent = connected ? (badge.id === "settingsAiBadge" ? "已连接" : label) : "未连接";
      badge.className = `status-badge ${connected ? "status-on" : "status-off"}`;
    }
    $$(".ai-required").forEach(button => {
      button.disabled = !connected;
      button.title = connected ? "" : "请先在设置中完成 AI 连接测试";
    });
  }

  async function configureAi(event) {
    event.preventDefault();
    const result = $("#aiTestResult");
    result.className = "feedback-box";
    result.textContent = "正在连接并测试模型……";
    const submit = $("#aiSettings button[type='submit']");
    submit.disabled = true;
    try {
      const response = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: $("#aiBaseUrl").value.trim(), apiKey: $("#aiApiKey").value, model: $("#aiModel").value.trim() })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "连接测试失败");
      $("#aiApiKey").value = "";
      result.textContent = `连接成功：${data.model || "模型已就绪"}。Key 只保存在本次启动器进程的内存中。`;
      setAiConnected(true, data.model);
      showToast("AI 高级功能已启用");
    } catch (error) {
      result.classList.add("is-error");
      result.textContent = `连接失败：${error.message}`;
      setAiConnected(false);
    } finally {
      submit.disabled = false;
    }
  }

  async function disconnectAi() {
    try { await fetch("/api/ai/disconnect", { method: "POST" }); } catch { /* launcher unavailable */ }
    setAiConnected(false);
    $("#aiTestResult").className = "feedback-box";
    $("#aiTestResult").textContent = "已断开连接并清除本次启动期间保存的接口信息。";
  }

  async function askAi(messages, output) {
    if (!aiConnected) return routeTo("settings");
    output.classList.remove("hidden");
    output.textContent = "正在生成反馈……";
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, temperature: 0.3, max_tokens: 1800 })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "请求失败");
      output.textContent = data.content || "模型没有返回文字内容。";
    } catch (error) {
      output.textContent = `AI 反馈失败：${error.message}\n\n请到设置页重新测试连接。`;
      output.classList.add("is-error");
    }
  }

  function reviewWriting() {
    const prompt = $("#writingPrompt").value.trim();
    const essay = $("#writingEssay").value.trim();
    if (!essay) return showToast("请先完成一段写作");
    askAi([
      { role: "system", content: "你是一名严谨、鼓励性的英语写作教练。请使用中文反馈，不虚构官方分数。按以下结构回答：1. 核心思路与论证链；2. 任务回应；3. 结构衔接；4. 词汇语法；5. 三个最优先修改点；6. 在不改变观点的前提下给出一版优化后的英文示例。明确区分原文问题与改写建议。" },
      { role: "user", content: `写作类型：${$("#writingType").value}\n题目：${prompt || "未提供"}\n\n我的正文：\n${essay}` }
    ], $("#writingReview"));
  }

  function reviewSpeaking() {
    const prompt = $("#speakingPrompt").value.trim();
    const transcript = $("#speakingTranscript").value.trim();
    if (!transcript) return showToast("请先粘贴或整理本次口语文字稿");
    askAi([
      { role: "system", content: "你是一名英语口语教练。请用中文反馈，分析表达是否自然、逻辑是否清晰、词汇语法问题和可扩展细节。给出更自然的口语表达，但不要捏造发音评价，因为你没有收到音频。按：亮点、主要问题、逐句优化、可补充内容、自然版示范回答 的结构输出。" },
      { role: "user", content: `话题：${prompt || "自由表达"}\n\n文字稿：\n${transcript}` }
    ], $("#speakingReview"));
  }

  async function toggleRecording() {
    if (recorder?.state === "recording") {
      recorder.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return showToast("当前浏览器不支持录音，请换用新版 Edge 或 Chrome");
    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(recordingStream);
      recordingChunks = [];
      recorder.ondataavailable = event => { if (event.data.size) recordingChunks.push(event.data); };
      recorder.onstop = finishRecording;
      recorder.start();
      recordSeconds = 0;
      $("#recordPulse").classList.add("is-recording");
      $("#recordButton").textContent = "结束录音";
      $("#recordHint").textContent = "正在录音，内容不会自动上传";
      clearInterval(recordInterval);
      recordInterval = setInterval(() => {
        recordSeconds += 1;
        $("#recordPulse span").textContent = formatClock(recordSeconds);
      }, 1000);
    } catch (error) {
      showToast(`无法开始录音：${error.message}`);
    }
  }

  function finishRecording() {
    clearInterval(recordInterval);
    recordingStream?.getTracks().forEach(track => track.stop());
    recordingBlob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" });
    const url = URL.createObjectURL(recordingBlob);
    $("#speakingPlayback").src = url;
    $("#speakingPlayback").classList.remove("hidden");
    $("#downloadRecording").classList.remove("hidden");
    $("#recordPulse").classList.remove("is-recording");
    $("#recordButton").textContent = "重新录音";
    $("#recordHint").textContent = "录音只在当前页面中保留，请按需下载保存";
  }

  function saveSpeaking() {
    const prompt = $("#speakingPrompt").value.trim();
    const transcript = $("#speakingTranscript").value.trim();
    if (!prompt && !transcript && !recordingBlob) return showToast("请先输入话题、录音或整理文字稿");
    state.speaking.push({ id: uid(), prompt, transcript, duration: recordSeconds, createdAt: new Date().toISOString() });
    saveState(true);
    showToast("口语练习记录已保存（录音文件请单独下载）");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportData() {
    downloadBlob(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2)], { type: "application/json" }), `EnglishLearnPath-backup-${today()}.json`);
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = parsed.data || parsed;
      if (!incoming || !Array.isArray(incoming.writings) || !Array.isArray(incoming.listening)) throw new Error("不是有效的 EnglishLearnPath 备份");
      if (!confirm("导入备份会覆盖当前本机数据，是否继续？")) return;
      state = { ...DEFAULT_STATE, ...incoming };
      await saveState();
      renderAll();
      showToast("备份已导入");
    } catch (error) {
      showToast(`导入备份失败：${error.message}`);
    }
  }

  async function selectDataDirectory() {
    const resultBox = $("#storageResult");
    resultBox.className = "feedback-box";
    resultBox.textContent = "请在弹出的系统窗口中选择长期保存数据的文件夹……";
    $("#selectDataDirectory").disabled = true;
    $("#onboardingSelectDirectory").disabled = true;
    try {
      const response = await fetch("/api/data/select-directory", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "无法绑定文件夹");
      if (result.canceled) {
        resultBox.textContent = "已取消选择，原数据目录保持不变。";
        return;
      }
      state = normalizeState(result.data);
      updateDiskStatus(result.storage);
      renderAll();
      newWriting();
      await loadResourceCatalog(false);
      resultBox.textContent = result.loadedExisting
        ? "已绑定文件夹，并加载其中已有的 EnglishLearnPath 数据。原目录内容未删除。"
        : "已绑定新文件夹，当前学习数据已复制到该目录。原目录内容仍保留。";
      showToast("永久数据文件夹已绑定");
    } catch (error) {
      resultBox.classList.add("is-error");
      resultBox.textContent = error.message;
    } finally {
      $("#selectDataDirectory").disabled = false;
      $("#onboardingSelectDirectory").disabled = false;
    }
  }

  async function openDataDirectory() {
    try {
      const response = await fetch("/api/data/open-directory", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "无法打开数据目录");
    } catch (error) {
      showToast(error.message);
    }
  }

  async function writeDataNow() {
    try {
      await saveState();
      const result = $("#storageResult");
      result.className = "feedback-box";
      result.textContent = `写入成功：${diskStatus?.dataFile || "本地数据文件"}`;
      showToast("全部学习数据已写入磁盘");
    } catch {
      showToast("写入失败，请检查数据目录");
    }
  }

  function renderAll() {
    renderMetrics();
    renderListeningLibrary();
    renderReadingLibrary();
    renderWritingHistory();
    renderResourceLibraries();
  }

  function bindEvents() {
    $$('[data-route]').forEach(item => item.addEventListener("click", event => {
      if (item.tagName === "A") event.preventDefault();
      routeTo(item.dataset.route);
    }));
    $("#menuButton").addEventListener("click", () => $(".sidebar").classList.toggle("is-open"));
    $("#exitApp").addEventListener("click", async () => {
      if (!confirm("确定退出 English Learning Path 吗？已保存的本地记录不会丢失。")) return;
      try {
        await fetch("/api/app/shutdown", { method: "POST" });
        document.body.innerHTML = '<main style="max-width:680px;margin:15vh auto;padding:40px;font-family:Segoe UI,sans-serif;color:#18332d"><h1>English Learning Path 已退出</h1><p>现在可以关闭这个浏览器标签页。</p></main>';
      } catch {
        showToast("当前不是通过便携启动器运行，无需退出服务");
      }
    });
    $("#listeningImport").addEventListener("change", event => importJson(event.target.files[0], "listening"));
    $("#readingImport").addEventListener("change", event => importJson(event.target.files[0], "reading"));
    $("#openListeningFolder").addEventListener("click", () => openResourceFolder("listening"));
    $("#openReadingFolder").addEventListener("click", () => openResourceFolder("reading"));
    $("#importListeningArchives").addEventListener("click", () => importResourceArchives("listening"));
    $("#importReadingArchives").addEventListener("click", () => importResourceArchives("reading"));
    $("#rescanListening").addEventListener("click", () => loadResourceCatalog(true));
    $("#rescanReading").addEventListener("click", () => loadResourceCatalog(true));
    $("#listeningExample").addEventListener("click", () => {
      const item = validateListening(listeningExample);
      state.listening.push(item); saveState(); renderListeningLibrary(); showListening(item.id);
    });
    $("#readingExample").addEventListener("click", () => {
      const item = validateReading(readingExample);
      state.reading.push(item); saveState(); renderReadingLibrary(); showReading(item.id);
    });
    $("#listeningAudio").addEventListener("change", event => {
      const file = event.target.files[0];
      if (file) $("#audioPlayer").src = URL.createObjectURL(file);
    });
    $("#checkListening").addEventListener("click", checkListening);
    $("#resetListening").addEventListener("click", () => {
      $$("input", $("#listeningQuestions")).forEach(input => input.value = "");
      $$(".answer-detail", $("#listeningQuestions")).forEach(detail => detail.classList.add("hidden"));
      $("#listeningResult").classList.add("hidden");
    });
    $("#deleteListening").addEventListener("click", () => {
      if (!activeListeningId || !confirm("确定从本机移除这份听力材料吗？")) return;
      state.listening = state.listening.filter(entry => entry.id !== activeListeningId);
      activeListeningId = null; saveState(); renderListeningLibrary();
    });
    $("#newWriting").addEventListener("click", newWriting);
    $("#saveWriting").addEventListener("click", saveWriting);
    $("#deleteWriting").addEventListener("click", () => {
      if (!activeWritingId || !confirm("确定删除这篇写作记录吗？")) return;
      state.writings = state.writings.filter(entry => entry.id !== activeWritingId); saveState(); newWriting(); showToast("记录已删除");
    });
    $("#writingEssay").addEventListener("input", updateWordCount);
    $("#writingPrompt").addEventListener("input", () => $("#saveStatus").textContent = "有未保存的修改");
    $("#writingMinutes").addEventListener("change", resetWritingTimer);
    $("#toggleTimer").addEventListener("click", toggleWritingTimer);
    $("#reviewWriting").addEventListener("click", reviewWriting);
    $("#recordButton").addEventListener("click", toggleRecording);
    $("#downloadRecording").addEventListener("click", () => recordingBlob && downloadBlob(recordingBlob, `EnglishLearnPath-speaking-${Date.now()}.webm`));
    $("#saveSpeaking").addEventListener("click", saveSpeaking);
    $("#reviewSpeaking").addEventListener("click", reviewSpeaking);
    $("#aiSettings").addEventListener("submit", configureAi);
    $("#disconnectAi").addEventListener("click", disconnectAi);
    $("#exportData").addEventListener("click", exportData);
    $("#importData").addEventListener("change", event => importBackup(event.target.files[0]));
    $("#selectDataDirectory").addEventListener("click", selectDataDirectory);
    $("#onboardingSelectDirectory").addEventListener("click", selectDataDirectory);
    $("#openDataDirectory").addEventListener("click", openDataDirectory);
    $("#writeDataNow").addEventListener("click", writeDataNow);
    $("#clearData").addEventListener("click", async () => {
      if (!confirm("这会清空当前永久数据文件中的所有学习记录。程序会保留最近备份，但仍建议先导出。确定继续吗？")) return;
      state = structuredClone(DEFAULT_STATE);
      activeListeningId = activeReadingId = activeWritingId = null;
      try {
        await saveState();
        renderAll(); newWriting(); showToast("永久数据文件已清空，滚动备份已保留");
      } catch {
        showToast("清空失败，原数据文件未被确认覆盖");
      }
    });
    window.addEventListener("hashchange", () => routeTo(location.hash.slice(1)));
  }

  async function initialize() {
    bindEvents();
    setAiConnected(false);
    await loadStateFromDisk();
    renderAll();
    newWriting();
    await Promise.all([refreshAiStatus(), loadResourceCatalog(false)]);
    routeTo(location.hash.slice(1) || "home");
  }

  initialize();
})();
