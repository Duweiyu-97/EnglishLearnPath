(() => {
  "use strict";

  const DEFAULT_STATE = {
    listening: [],
    reading: [],
    writings: [],
    speaking: [],
    activityDates: [],
    studyPlan: null,
    planProgress: {},
    mistakes: [],
    preferences: { aiProvider: "deepseek", aiBaseUrl: "https://api.deepseek.com", aiModel: "deepseek-v4-flash", speechLanguage: "en-GB" }
  };

  const titles = {
    home: ["TODAY'S PATH", "学习概览"],
    listening: ["LISTENING LAB", "听力练习"],
    reading: ["READING DESK", "阅读练习"],
    writing: ["WRITING STUDIO", "写作工坊"],
    speaking: ["SPEAKING ROOM", "口语练习"],
    plan: ["GOAL TO ACTION", "学习计划"],
    mistakes: ["REVIEW & IMPROVE", "错题与复盘"],
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
  let activeSpeakingId = null;
  let mistakeFilter = "all";
  let pendingMistakeImages = [];
  let pendingMistakeRelated = null;
  let pendingMistakeImageJob = Promise.resolve();
  let todayTaskActions = new Map();
  let aiConnected = false;
  let timerInterval = null;
  let timerSeconds = 40 * 60;
  let recorder = null;
  let speechRecognizer = null;
  let speechRecognitionActive = false;
  let recordingStream = null;
  let recordingChunks = [];
  let recordingBlob = null;
  let recordSeconds = 0;
  let recordInterval = null;
  let toastTimer = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const normalized = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  function normalizeState(value) {
    const candidate = value && typeof value === "object" ? value : {};
    return {
      listening: Array.isArray(candidate.listening) ? candidate.listening : [],
      reading: Array.isArray(candidate.reading) ? candidate.reading : [],
      writings: Array.isArray(candidate.writings) ? candidate.writings : [],
      speaking: Array.isArray(candidate.speaking) ? candidate.speaking : [],
      activityDates: Array.isArray(candidate.activityDates) ? candidate.activityDates : [],
      studyPlan: candidate.studyPlan && typeof candidate.studyPlan === "object" ? candidate.studyPlan : null,
      planProgress: candidate.planProgress && typeof candidate.planProgress === "object" ? candidate.planProgress : {},
      mistakes: Array.isArray(candidate.mistakes) ? candidate.mistakes : [],
      preferences: candidate.preferences && typeof candidate.preferences === "object" ? { ...DEFAULT_STATE.preferences, ...candidate.preferences } : { ...DEFAULT_STATE.preferences }
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

  const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const moduleNames = { listening: "听力", reading: "阅读", writing: "写作", speaking: "口语" };

  function clampCount(value, max = 10) {
    return Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
  }

  function readPlanProfile() {
    return {
      examDate: $("#planExamDate").value,
      dailyMinutes: clampCount($("#planDailyMinutes").value, 720),
      currentLevel: $("#planCurrentLevel").value.trim(),
      targetLevel: $("#planTargetLevel").value.trim(),
      focus: $("#planFocus").value.trim()
    };
  }

  function validatePlanProfile(profile) {
    if (!profile.examDate || !profile.currentLevel || !profile.targetLevel) throw new Error("请填写考试日期、现有水平和目标水平");
    if (new Date(`${profile.examDate}T23:59:59`) < new Date()) throw new Error("考试日期不能早于今天");
    if (profile.dailyMinutes < 15) throw new Error("每日学习时间至少填写 15 分钟");
  }

  function readManualTargets() {
    return {
      listening: clampCount($("#manualListening").value),
      reading: clampCount($("#manualReading").value),
      writing: clampCount($("#manualWriting").value, 5),
      speaking: clampCount($("#manualSpeaking").value),
      reviewMinutes: clampCount($("#manualReview").value, 240),
      note: "按手动设置执行；可根据当天状态适当调整。"
    };
  }

  function normalizePlanDay(value = {}) {
    return {
      listening: clampCount(value.listening),
      reading: clampCount(value.reading),
      writing: clampCount(value.writing, 5),
      speaking: clampCount(value.speaking),
      reviewMinutes: clampCount(value.reviewMinutes, 240),
      note: String(value.note || "").slice(0, 240)
    };
  }

  function saveManualPlan() {
    try {
      const profile = readPlanProfile();
      validatePlanProfile(profile);
      const targets = readManualTargets();
      state.studyPlan = {
        source: "manual",
        createdAt: new Date().toISOString(),
        profile,
        summary: `从 ${profile.currentLevel} 向 ${profile.targetLevel} 推进；每天约 ${profile.dailyMinutes} 分钟。`,
        priorities: profile.focus ? [profile.focus] : [],
        weekly: dayNames.map(() => ({ ...targets }))
      };
      state.planProgress = {};
      saveState();
      renderStudyPlan();
      renderTodayPlan();
      showToast("手动学习计划已保存到本地");
    } catch (error) {
      showToast(error.message);
    }
  }

  function parseAiJson(content) {
    const cleaned = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI 没有返回可读取的计划 JSON");
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  async function generateAiPlan() {
    if (!aiConnected) return routeTo("settings");
    const result = $("#planResult");
    const button = $("#generateAiPlan");
    try {
      const profile = readPlanProfile();
      validatePlanProfile(profile);
      result.className = "feedback-box";
      result.textContent = "AI 正在生成七日循环计划……";
      button.disabled = true;
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "你是英语考试学习规划师。只输出一个 JSON 对象，不要 Markdown。结构必须为 {summary:string, priorities:string[], weekly:[7项]}。weekly 顺序必须是周一到周日；每项必须含 listening、reading、writing、speaking、reviewMinutes 五个非负整数和 note 字符串。篇数务实，符合每日可用时间；复盘必须纳入计划。不要虚构用户没有提供的诊断。" },
            { role: "user", content: `预计考试日期：${profile.examDate}\n现有水平：${profile.currentLevel}\n目标水平：${profile.targetLevel}\n每日时间：${profile.dailyMinutes} 分钟\n重点与限制：${profile.focus || "未补充"}\n请生成可循环执行的一周计划。` }
          ],
          temperature: 0.2,
          max_tokens: 1800
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AI 计划生成失败");
      const parsed = parseAiJson(data.content);
      if (!Array.isArray(parsed.weekly) || parsed.weekly.length !== 7) throw new Error("AI 返回的 weekly 不是完整七天");
      state.studyPlan = {
        source: "ai",
        createdAt: new Date().toISOString(),
        profile,
        summary: String(parsed.summary || "AI 已生成七日循环计划").slice(0, 1200),
        priorities: Array.isArray(parsed.priorities) ? parsed.priorities.map(item => String(item).slice(0, 240)).slice(0, 8) : [],
        weekly: parsed.weekly.map(normalizePlanDay)
      };
      state.planProgress = {};
      await saveState();
      renderStudyPlan();
      renderTodayPlan();
      result.textContent = "AI 计划已生成并永久写入本地数据文件。";
      showToast("七日学习计划已生成");
    } catch (error) {
      result.className = "feedback-box is-error";
      result.textContent = `生成失败：${error.message}`;
    } finally {
      button.disabled = !aiConnected;
    }
  }

  function populatePlanForm() {
    const plan = state.studyPlan;
    if (!plan?.profile) return;
    $("#planExamDate").value = plan.profile.examDate || "";
    $("#planDailyMinutes").value = plan.profile.dailyMinutes || 180;
    $("#planCurrentLevel").value = plan.profile.currentLevel || "";
    $("#planTargetLevel").value = plan.profile.targetLevel || "";
    $("#planFocus").value = plan.profile.focus || "";
    if (plan.source === "manual" && plan.weekly?.[0]) {
      const day = plan.weekly[0];
      $("#manualListening").value = day.listening;
      $("#manualReading").value = day.reading;
      $("#manualWriting").value = day.writing;
      $("#manualSpeaking").value = day.speaking;
      $("#manualReview").value = day.reviewMinutes;
    }
  }

  function renderStudyPlan() {
    const plan = state.studyPlan;
    const badge = $("#planSourceBadge");
    const summary = $("#planSummary");
    const weekly = $("#weeklyPlan");
    if (!plan?.weekly?.length) {
      badge.textContent = "未创建";
      badge.className = "status-badge status-off";
      summary.className = "plan-summary empty-state";
      summary.textContent = "先在左侧填写目标，然后手动保存或让 AI 生成。";
      weekly.innerHTML = "";
      $("#deletePlan").classList.add("hidden");
      return;
    }
    badge.textContent = plan.source === "ai" ? "AI 计划" : "手动计划";
    badge.className = "status-badge status-on";
    $("#deletePlan").classList.remove("hidden");
    summary.className = "plan-summary";
    summary.textContent = [plan.summary, ...(plan.priorities || []).map(item => `重点：${item}`)].filter(Boolean).join("\n");
    weekly.innerHTML = plan.weekly.map((day, index) => `<article class="weekly-day"><strong>${dayNames[index]}</strong><p>听 ${day.listening} · 读 ${day.reading} · 写 ${day.writing} · 说 ${day.speaking} · 复盘 ${day.reviewMinutes} 分钟${day.note ? `<br>${escapeHtml(day.note)}` : ""}</p></article>`).join("");
  }

  function mondayIndex(date = new Date()) {
    return (date.getDay() + 6) % 7;
  }

  function stableDayOffset(dateString) {
    return [...dateString].reduce((total, char) => total + char.charCodeAt(0), 0);
  }

  function buildSkillTasks(kind, count, dateString) {
    const own = state[kind].map(item => ({ source: "json", id: item.id, title: item.title }));
    const local = (resourceCatalog[kind] || []).map(item => ({ source: "resource", id: item.id, title: item.title }));
    const materials = [...own, ...local];
    return Array.from({ length: count }, (_, index) => {
      const material = materials.length ? materials[(stableDayOffset(dateString) + index) % materials.length] : null;
      return {
        id: `${kind}-${index}`,
        kind,
        title: material?.title || `${moduleNames[kind]}练习 ${index + 1}`,
        detail: material ? `今日第 ${index + 1} 项 · 点击打开材料` : "尚未导入材料，点击进入模块",
        material
      };
    });
  }

  function todayPlanTasks() {
    const plan = state.studyPlan;
    if (!plan?.weekly?.length) return [];
    const dateString = today();
    const target = normalizePlanDay(plan.weekly[mondayIndex()] || {});
    const tasks = [
      ...buildSkillTasks("listening", target.listening, dateString),
      ...buildSkillTasks("reading", target.reading, dateString),
      ...Array.from({ length: target.writing }, (_, index) => ({ id: `writing-${index}`, kind: "writing", title: `写作练习 ${index + 1}`, detail: "进入写作工坊，完成并保存" })),
      ...Array.from({ length: target.speaking }, (_, index) => ({ id: `speaking-${index}`, kind: "speaking", title: `口语练习 ${index + 1}`, detail: "浏览器转写，保存文字稿后按需 AI 评价" }))
    ];
    if (target.reviewMinutes) tasks.push({ id: "review-0", kind: "review", title: `错题复盘 ${target.reviewMinutes} 分钟`, detail: "进入四科错题本，记录原因和下次优化" });
    return tasks;
  }

  function renderTodayPlan() {
    const root = $("#todayPlanList");
    const meta = $("#todayPlanMeta");
    const plan = state.studyPlan;
    const tasks = todayPlanTasks();
    todayTaskActions = new Map(tasks.map(task => [task.id, task]));
    if (!plan || !tasks.length) {
      root.className = "today-task-list empty-state";
      root.textContent = plan ? "今天安排为休息或自由复盘。" : "尚未创建学习计划";
      meta.textContent = plan ? "今日计划没有设置固定数量。" : "配置考试目标后，这里会生成可执行任务。";
      return;
    }
    const exam = new Date(`${plan.profile.examDate}T23:59:59`);
    const daysLeft = Math.max(0, Math.ceil((exam - new Date()) / 86400000));
    const progress = state.planProgress[today()] || {};
    const done = tasks.filter(task => progress[task.id]).length;
    meta.textContent = `距预计考试 ${daysLeft} 天 · 今日 ${done}/${tasks.length} 已完成`;
    root.className = "today-task-list";
    root.innerHTML = tasks.map(task => `<article class="today-task ${progress[task.id] ? "is-done" : ""}"><input type="checkbox" data-plan-check="${task.id}" ${progress[task.id] ? "checked" : ""} aria-label="标记完成"><div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.detail)}</small></div><button class="button button-secondary" data-plan-start="${task.id}">开始</button></article>`).join("");
    $$('[data-plan-check]', root).forEach(box => box.addEventListener("change", () => {
      state.planProgress[today()] ||= {};
      state.planProgress[today()][box.dataset.planCheck] = box.checked;
      saveState(box.checked);
      renderTodayPlan();
    }));
    $$('[data-plan-start]', root).forEach(button => button.addEventListener("click", () => startTodayTask(button.dataset.planStart)));
  }

  function startTodayTask(id) {
    const task = todayTaskActions.get(id);
    if (!task) return;
    if (task.kind === "review") return routeTo("mistakes");
    routeTo(task.kind);
    if (task.kind === "listening") {
      if (task.material?.source === "json") showListening(task.material.id);
      if (task.material?.source === "resource") openLocalResource(task.material.id);
    } else if (task.kind === "reading") {
      if (task.material?.source === "json") showReading(task.material.id);
      if (task.material?.source === "resource") openLocalResource(task.material.id);
    } else if (task.kind === "writing") newWriting();
    else if (task.kind === "speaking") newSpeaking();
  }

  function resetMistakeComposer() {
    $("#mistakeTitle").value = "";
    $("#mistakeText").value = "";
    pendingMistakeImages = [];
    pendingMistakeRelated = null;
    renderMistakeImagePreview();
  }

  function openMistakeComposer(module, title = "", text = "", related = null) {
    routeTo("mistakes");
    pendingMistakeImages = [];
    renderMistakeImagePreview();
    $("#mistakeModule").value = module;
    $("#mistakeTitle").value = title;
    $("#mistakeText").value = text;
    pendingMistakeRelated = related;
    $("#mistakeText").focus();
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!file?.type?.startsWith("image/")) return reject(new Error("只能添加图片"));
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/webp", 0.84));
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("无法读取图片")); };
      image.src = url;
    });
  }

  async function addMistakeImages(files) {
    const images = [...files].filter(file => file.type.startsWith("image/"));
    if (!images.length) return;
    if (pendingMistakeImages.length + images.length > 6) return showToast("每条记录最多添加 6 张图片");
    try {
      for (const file of images) pendingMistakeImages.push(await compressImage(file));
      renderMistakeImagePreview();
      showToast(`已添加 ${images.length} 张图片`);
    } catch (error) {
      showToast(error.message);
    }
  }

  function queueMistakeImages(files) {
    const snapshot = [...files];
    pendingMistakeImageJob = pendingMistakeImageJob.then(() => addMistakeImages(snapshot));
    return pendingMistakeImageJob;
  }

  function renderMistakeImagePreview() {
    const root = $("#mistakeImagePreview");
    if (!pendingMistakeImages.length) {
      root.className = "mistake-image-preview empty-state";
      root.textContent = "尚未添加图片";
      return;
    }
    root.className = "mistake-image-preview";
    root.innerHTML = pendingMistakeImages.map((src, index) => `<div class="mistake-preview-item"><img src="${src}" alt="待保存图片 ${index + 1}"><button type="button" data-remove-mistake-image="${index}">移除</button></div>`).join("");
    $$('[data-remove-mistake-image]', root).forEach(button => button.addEventListener("click", () => {
      pendingMistakeImages.splice(Number(button.dataset.removeMistakeImage), 1);
      renderMistakeImagePreview();
    }));
  }

  async function saveMistake(event) {
    event.preventDefault();
    await pendingMistakeImageJob;
    const module = $("#mistakeModule").value;
    const title = $("#mistakeTitle").value.trim();
    const text = $("#mistakeText").value.trim();
    if (!title && !text && !pendingMistakeImages.length) return showToast("请先填写内容或粘贴图片");
    state.mistakes.push({ id: uid(), module, title: title || `${moduleNames[module]}复盘`, text, images: [...pendingMistakeImages], related: pendingMistakeRelated, createdAt: new Date().toISOString() });
    saveState(true);
    mistakeFilter = module;
    resetMistakeComposer();
    renderMistakes();
    showToast("已保存到本地错题本");
  }

  function renderMistakes() {
    const items = state.mistakes.filter(item => mistakeFilter === "all" || item.module === mistakeFilter).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    $("#mistakeCount").textContent = state.mistakes.length;
    $$('[data-mistake-filter]').forEach(button => {
      const active = button.dataset.mistakeFilter === mistakeFilter;
      button.classList.toggle("is-active", active);
      button.classList.toggle("button-secondary", active);
      button.classList.toggle("button-quiet", !active);
    });
    const root = $("#mistakeList");
    if (!items.length) {
      root.className = "mistake-list empty-state";
      root.textContent = "这个分类还没有错题或复盘记录";
      return;
    }
    root.className = "mistake-list";
    root.innerHTML = items.map(item => {
      const safeImages = (item.images || []).filter(src => typeof src === "string" && src.startsWith("data:image/"));
      return `<article class="mistake-entry"><header><div><span class="mistake-module">${moduleNames[item.module] || "复盘"}</span><h4>${escapeHtml(item.title || "未命名记录")}</h4><small>${escapeHtml(new Date(item.createdAt).toLocaleString())}</small></div><button class="button button-danger-quiet" data-delete-mistake="${escapeHtml(item.id)}">删除</button></header>${item.text ? `<p>${escapeHtml(item.text)}</p>` : ""}${safeImages.length ? `<div class="mistake-images">${safeImages.map((src, index) => `<img src="${src}" alt="错题图片 ${index + 1}">`).join("")}</div>` : ""}${item.related ? `<div class="button-row"><button class="button button-secondary" data-jump-mistake="${escapeHtml(item.id)}">返回相关练习</button></div>` : ""}</article>`;
    }).join("");
    $$('[data-delete-mistake]', root).forEach(button => button.addEventListener("click", () => {
      if (!confirm("确定删除这条错题/复盘记录吗？")) return;
      state.mistakes = state.mistakes.filter(item => item.id !== button.dataset.deleteMistake);
      saveState();
      renderMistakes();
    }));
    $$('[data-jump-mistake]', root).forEach(button => button.addEventListener("click", () => jumpToMistake(button.dataset.jumpMistake)));
  }

  function jumpToMistake(id) {
    const related = state.mistakes.find(item => item.id === id)?.related;
    if (!related) return;
    routeTo(related.module);
    if (related.module === "listening" && related.id) showListening(related.id);
    else if (related.module === "reading" && related.id) showReading(related.id);
    else if (related.module === "writing" && related.id) loadWriting(related.id);
    else if (related.module === "speaking" && related.id) loadSpeaking(related.id);
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
      renderTodayPlan();
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
    renderTodayPlan();
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
      if (!matched) {
        const addButton = document.createElement("button");
        addButton.type = "button";
        addButton.className = "button button-quiet";
        addButton.textContent = "加入听力错题本";
        addButton.addEventListener("click", () => openMistakeComposer("listening", `${item.title} · 第 ${index + 1} 题`, `题目：${item.questions[index].prompt}\n我的答案：${input.value || "未作答"}\n参考答案：${item.questions[index].answer}\n解析：${item.questions[index].explanation || "暂无"}\n\n错误原因：\n下次优化：`, { module: "listening", id: item.id }));
        detail.append(addButton);
      }
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
      <section class="reading-questions"><h3>题目答案与逐题解析</h3>${item.questions.length ? item.questions.map((q, index) => `<article class="reading-question"><h4>${index + 1}. ${escapeHtml(q.prompt)}</h4><div class="answer">答案：${escapeHtml(q.answer)}</div><div class="explanation"><strong>解析：</strong>${escapeHtml(q.explanation || "暂无解析")}</div><button class="button button-quiet" data-reading-mistake="${index}">加入阅读错题本</button></article>`).join("") : `<p>该材料未包含题目。</p>`}</section>`;
    $("#deleteReading").addEventListener("click", () => {
      if (!confirm("确定从本机移除这篇文章吗？")) return;
      state.reading = state.reading.filter(entry => entry.id !== activeReadingId);
      activeReadingId = null;
      saveState();
      renderReadingLibrary();
    });
    $$('[data-reading-mistake]', root).forEach(button => button.addEventListener("click", () => {
      const index = Number(button.dataset.readingMistake);
      const question = item.questions[index];
      openMistakeComposer("reading", `${item.title} · 第 ${index + 1} 题`, `题目：${question.prompt}\n参考答案：${question.answer}\n解析：${question.explanation || "暂无"}\n\n我的错误：\n错误原因：\n下次优化：`, { module: "reading", id: item.id });
    }));
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
    root.innerHTML = [...state.writings].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => `<div class="record-list-item"><button class="library-item ${item.id === activeWritingId ? "is-active" : ""}" data-writing-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.type)}</strong><small>${escapeHtml(item.updatedAt.slice(0, 10))} · ${countWords(item.essay)} words</small></button><button class="record-delete" data-delete-writing-id="${escapeHtml(item.id)}" aria-label="删除这篇写作">删除</button></div>`).join("");
    $$('[data-writing-id]', root).forEach(button => button.addEventListener("click", () => loadWriting(button.dataset.writingId)));
    $$('[data-delete-writing-id]', root).forEach(button => button.addEventListener("click", () => deleteWritingRecord(button.dataset.deleteWritingId)));
  }

  function deleteWritingRecord(id) {
    if (!id || !confirm("确定删除这篇写作记录吗？")) return;
    state.writings = state.writings.filter(entry => entry.id !== id);
    saveState();
    if (activeWritingId === id) newWriting(); else renderWritingHistory();
    showToast("写作记录已删除");
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
    $("#writingReview").textContent = "";
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
    $("#writingReview").textContent = item.review || "";
    $("#writingReview").classList.toggle("hidden", !item.review);
    resetWritingTimer();
    updateWordCount();
    renderWritingHistory();
  }

  async function saveWriting() {
    const prompt = $("#writingPrompt").value.trim();
    const essay = $("#writingEssay").value.trim();
    if (!prompt && !essay) return showToast("请先输入题目或正文");
    const existing = state.writings.find(entry => entry.id === activeWritingId);
    const record = {
      id: activeWritingId || uid(),
      type: $("#writingType").value,
      minutes: Number($("#writingMinutes").value),
      prompt,
      essay,
      updatedAt: new Date().toISOString(),
      review: existing?.review || "",
      reviewedAt: existing?.reviewedAt || ""
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

  function applyAiPreset() {
    const preset = $("#aiProvider").value;
    const values = {
      deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", help: "DeepSeek 官方 OpenAI 兼容地址；建议先使用 deepseek-v4-flash。" },
      openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", help: "OpenAI 官方 API 地址；请填写 OpenAI 平台创建的 API Key。" },
      ollama: { baseUrl: "http://127.0.0.1:11434/v1", model: "", help: "本地模型服务必须已由使用者安装并启动；模型名填写本机已安装的名称。" }
    };
    const selected = values[preset];
    if (selected) {
      $("#aiBaseUrl").value = selected.baseUrl;
      $("#aiModel").value = selected.model;
      $("#aiProviderHelp").textContent = selected.help;
    } else {
      $("#aiProviderHelp").textContent = "填写服务商提供的 OpenAI Chat Completions 兼容基础地址。";
    }
    state.preferences.aiProvider = preset;
    state.preferences.aiBaseUrl = $("#aiBaseUrl").value;
    state.preferences.aiModel = $("#aiModel").value;
    if (diskReady) saveState();
  }

  function populatePreferences() {
    const preferences = state.preferences || DEFAULT_STATE.preferences;
    $("#aiProvider").value = preferences.aiProvider || "custom";
    $("#aiBaseUrl").value = preferences.aiBaseUrl || "";
    $("#aiModel").value = preferences.aiModel || "";
    $("#speechLanguage").value = preferences.speechLanguage || "en-GB";
  }

  function persistAiPreferences() {
    state.preferences.aiProvider = $("#aiProvider").value;
    state.preferences.aiBaseUrl = $("#aiBaseUrl").value.trim();
    state.preferences.aiModel = $("#aiModel").value.trim();
    if (diskReady) saveState();
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
      state.preferences.aiProvider = $("#aiProvider").value;
      state.preferences.aiBaseUrl = $("#aiBaseUrl").value.trim();
      state.preferences.aiModel = $("#aiModel").value.trim();
      saveState();
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

  async function askAi(messages, output, onSuccess) {
    if (!aiConnected) return routeTo("settings");
    output.classList.remove("hidden");
    output.textContent = "正在生成反馈……";
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, temperature: 0.25, max_tokens: 3500 })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "请求失败");
      output.textContent = data.content || "模型没有返回文字内容。";
      if (data.content && typeof onSuccess === "function") onSuccess(data.content);
    } catch (error) {
      output.textContent = `AI 反馈失败：${error.message}\n\n请到设置页重新测试连接。`;
      output.classList.add("is-error");
    }
  }

  async function reviewWriting() {
    const prompt = $("#writingPrompt").value.trim();
    const essay = $("#writingEssay").value.trim();
    if (!essay) return showToast("请先完成一段写作");
    if (!activeWritingId) await saveWriting();
    if (!activeWritingId) return;
    const recordId = activeWritingId;
    const targetLevel = state.studyPlan?.profile?.targetLevel || "6.0–6.5";
    askAi([
      { role: "system", content: `你是一名严谨的 IELTS 写作教练。目标水平参考：${targetLevel}。只依据用户提供的题目和原文；缺少关键信息时说明不确定性，不虚构官方成绩。反馈固定按以下顺序：\n1. 题型与主题判断；\n2. 非官方预估总分及合理区间；\n3. 四项标准（Task 1 用 TA/CC/LR/GRA，Task 2 用 TR/CC/LR/GRA）及限制分数的证据；\n4. 任务完成、段落结构与论证/数据概括；\n5. 逐句纠错：列出原文精确片段、局部修改、错误类型和简短原因；\n6. 只选 3–5 个最优先问题，并给短练习；\n7. 在保留原意的前提下给一版可模仿的目标水平英文修改稿，不堆砌生词；\n8. 按段给出准确自然的中文翻译；\n9. 只补充 2–3 条本题可直接复用的表达。\nTask 1 先核对比较对象、时间、单位和图表结构，再提取 2–3 个主特征，解释 Overview 和两个细节段为什么这样分组；如果没有图表信息，明确无法核对数据。Task 2 检查是否答全问题、立场是否直接、每段是否形成观点—解释—例子/结果。不要照搬私人模板或课程资料。` },
      { role: "user", content: `写作类型：${$("#writingType").value}\n题目：${prompt || "未提供"}\n\n我的正文：\n${essay}` }
    ], $("#writingReview"), content => {
      const record = state.writings.find(entry => entry.id === recordId);
      if (!record) return;
      record.review = content;
      record.reviewedAt = new Date().toISOString();
      saveState();
      renderWritingHistory();
    });
  }

  function reviewSpeaking() {
    const prompt = $("#speakingPrompt").value.trim();
    const transcript = $("#speakingTranscript").value.trim();
    if (!transcript) return showToast("请先粘贴或整理本次口语文字稿");
    if (!activeSpeakingId) saveSpeaking();
    if (!activeSpeakingId) return;
    const recordId = activeSpeakingId;
    const part = $("#speakingPart").value;
    const targetLevel = state.studyPlan?.profile?.targetLevel || "6.0–6.5";
    askAi([
      { role: "system", content: `你是一名谨慎的 IELTS 口语教练。目标水平参考：${targetLevel}。你只收到浏览器转写文本，没有音频，因此绝对不能评价具体发音、重音、语调或真实停顿；Pronunciation 必须标为“无法仅凭文字判断”。自动转写可能缺少标点或含识别错误，不要把明显 ASR 痕迹当成语法错误。\n反馈固定顺序：1. 一句话总体表现与低置信度的非官方文字表现区间；2. FC（只评价答案展开与文本连贯线索）、LR、GRA，P 标记不可评；3. 最多 3 个优先改进项；4. 逐句列出原片段、最小修改和中文原因；5. 保留用户原观点、经历、理由与口语风格，给一版可真实复述的 6.0–6.5 版本；6. 4–8 条本题可复用表达；7. 2–4 个 3–10 分钟专项练习并建议重说同题。不要编造新人物、经历、数据或观点，不要把答案改成书面论文。Part 1 目标约 3–5 个自然句、40–65 词；Part 2 覆盖题卡并形成清晰故事线；Part 3 使用直接回答—原因—例子/对比—影响/小结，通常 70–100 词。` },
      { role: "user", content: `题型：${part}\n话题：${prompt || "自由表达"}\n\n浏览器转写文字稿：\n${transcript}` }
    ], $("#speakingReview"), content => {
      const record = state.speaking.find(entry => entry.id === recordId);
      if (!record) return;
      record.review = content;
      record.reviewedAt = new Date().toISOString();
      saveState();
      renderSpeakingHistory();
    });
  }

  function setTranscriptionButton(active, label) {
    speechRecognitionActive = active;
    $("#browserTranscribe").textContent = label || (active ? "停止浏览器转写" : "开始浏览器转写");
    $("#browserTranscribe").classList.toggle("button-primary", active);
    $("#browserTranscribe").classList.toggle("button-secondary", !active);
  }

  function toggleBrowserTranscription() {
    if (speechRecognitionActive) {
      speechRecognizer?.stop();
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return showToast("当前浏览器不支持语音转写，请使用新版 Chrome 或 Edge");

    const startingText = $("#speakingTranscript").value.trim();
    let finalText = "";
    speechRecognizer = new Recognition();
    speechRecognizer.continuous = true;
    speechRecognizer.interimResults = true;
    speechRecognizer.lang = $("#speechLanguage").value;
    speechRecognizer.onresult = event => {
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = event.results[index][0]?.transcript || "";
        if (event.results[index].isFinal) finalText += `${text.trim()} `; else interimText += text;
      }
      $("#speakingTranscript").value = [startingText, finalText.trim(), interimText.trim()].filter(Boolean).join(startingText ? "\n" : " ");
    };
    speechRecognizer.onerror = event => {
      if (event.error !== "aborted" && event.error !== "no-speech") showToast(`浏览器转写失败：${event.error}`);
    };
    speechRecognizer.onend = () => {
      setTranscriptionButton(false);
      speechRecognizer = null;
    };
    try {
      speechRecognizer.start();
      setTranscriptionButton(true);
      showToast("浏览器转写已开始，请允许麦克风权限");
    } catch (error) {
      setTranscriptionButton(false);
      showToast(`无法开始浏览器转写：${error.message}`);
    }
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

  function renderSpeakingHistory() {
    const root = $("#speakingHistory");
    $("#speakingCount").textContent = state.speaking.length;
    if (!state.speaking.length) {
      root.className = "library-list empty-state";
      root.textContent = "还没有口语练习记录";
      return;
    }
    root.className = "library-list";
    root.innerHTML = [...state.speaking].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))).map(item => `<div class="record-list-item"><button class="library-item ${item.id === activeSpeakingId ? "is-active" : ""}" data-speaking-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.prompt || "自由表达")}</strong><small>${escapeHtml(String(item.updatedAt || item.createdAt || "").slice(0, 10))} · ${Number(item.duration || 0)} 秒${item.transcript ? ` · ${countWords(item.transcript)} words` : ""}</small></button><button class="record-delete" data-delete-speaking-id="${escapeHtml(item.id)}" aria-label="删除这条口语记录">删除</button></div>`).join("");
    $$('[data-speaking-id]', root).forEach(button => button.addEventListener("click", () => loadSpeaking(button.dataset.speakingId)));
    $$('[data-delete-speaking-id]', root).forEach(button => button.addEventListener("click", () => deleteSpeakingRecord(button.dataset.deleteSpeakingId)));
  }

  function newSpeaking() {
    activeSpeakingId = null;
    $("#speakingPrompt").value = "";
    $("#speakingTranscript").value = "";
    $("#speakingPart").value = "p1";
    $("#speakingReview").textContent = "";
    $("#speakingReview").classList.add("hidden");
    $("#deleteSpeaking").classList.add("hidden");
    $("#saveSpeaking").textContent = "保存练习";
    recordSeconds = 0;
    $("#recordPulse span").textContent = "00:00";
    renderSpeakingHistory();
  }

  function loadSpeaking(id) {
    const item = state.speaking.find(entry => entry.id === id);
    if (!item) return;
    activeSpeakingId = id;
    $("#speakingPrompt").value = item.prompt || "";
    $("#speakingTranscript").value = item.transcript || "";
    $("#speakingPart").value = item.part || "p1";
    recordSeconds = Number(item.duration || 0);
    $("#recordPulse span").textContent = formatClock(recordSeconds);
    $("#speakingReview").textContent = item.review || "";
    $("#speakingReview").classList.toggle("hidden", !item.review);
    $("#deleteSpeaking").classList.remove("hidden");
    $("#saveSpeaking").textContent = "更新记录";
    renderSpeakingHistory();
  }

  function deleteSpeakingRecord(id) {
    if (!id || !confirm("确定删除这条口语练习记录吗？录音下载文件不会被删除。")) return;
    state.speaking = state.speaking.filter(entry => entry.id !== id);
    saveState();
    if (activeSpeakingId === id) newSpeaking(); else renderSpeakingHistory();
    showToast("口语记录已删除");
  }

  function saveSpeaking() {
    const prompt = $("#speakingPrompt").value.trim();
    const transcript = $("#speakingTranscript").value.trim();
    if (!prompt && !transcript && !recordingBlob) return showToast("请先输入话题、录音或整理文字稿");
    const existing = state.speaking.find(entry => entry.id === activeSpeakingId);
    const record = { id: activeSpeakingId || uid(), part: $("#speakingPart").value, prompt, transcript, duration: recordSeconds, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), review: existing?.review || "", reviewedAt: existing?.reviewedAt || "" };
    const index = state.speaking.findIndex(entry => entry.id === record.id);
    if (index >= 0) state.speaking[index] = record; else state.speaking.push(record);
    activeSpeakingId = record.id;
    saveState(true);
    $("#deleteSpeaking").classList.remove("hidden");
    $("#saveSpeaking").textContent = "更新记录";
    renderSpeakingHistory();
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
    renderSpeakingHistory();
    renderResourceLibraries();
    renderStudyPlan();
    renderTodayPlan();
    renderMistakes();
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
    $("#deleteWriting").addEventListener("click", () => deleteWritingRecord(activeWritingId));
    $("#writingEssay").addEventListener("input", updateWordCount);
    $("#writingPrompt").addEventListener("input", () => $("#saveStatus").textContent = "有未保存的修改");
    $("#writingMinutes").addEventListener("change", resetWritingTimer);
    $("#toggleTimer").addEventListener("click", toggleWritingTimer);
    $("#reviewWriting").addEventListener("click", reviewWriting);
    $("#addWritingMistake").addEventListener("click", () => openMistakeComposer("writing", `写作复盘 · ${$("#writingType").value}`, `题目：${$("#writingPrompt").value.trim() || "未填写"}\n\n需要复盘的问题：\n下次修改：`, activeWritingId ? { module: "writing", id: activeWritingId } : null));
    $("#recordButton").addEventListener("click", toggleRecording);
    $("#downloadRecording").addEventListener("click", () => recordingBlob && downloadBlob(recordingBlob, `EnglishLearnPath-speaking-${Date.now()}.webm`));
    $("#browserTranscribe").addEventListener("click", toggleBrowserTranscription);
    $("#speechLanguage").addEventListener("change", () => { state.preferences.speechLanguage = $("#speechLanguage").value; saveState(); });
    $("#newSpeaking").addEventListener("click", newSpeaking);
    $("#saveSpeaking").addEventListener("click", saveSpeaking);
    $("#deleteSpeaking").addEventListener("click", () => deleteSpeakingRecord(activeSpeakingId));
    $("#reviewSpeaking").addEventListener("click", reviewSpeaking);
    $("#addSpeakingMistake").addEventListener("click", () => openMistakeComposer("speaking", `口语复盘 · ${$("#speakingPrompt").value.trim() || "自由表达"}`, `文字稿：${$("#speakingTranscript").value.trim() || "未填写"}\n\n表达问题：\n下次优化：`, activeSpeakingId ? { module: "speaking", id: activeSpeakingId } : null));
    $("#saveManualPlan").addEventListener("click", saveManualPlan);
    $("#generateAiPlan").addEventListener("click", generateAiPlan);
    $("#deletePlan").addEventListener("click", () => {
      if (!confirm("确定删除当前学习计划和全部计划打卡吗？练习记录与错题本不会删除。")) return;
      state.studyPlan = null;
      state.planProgress = {};
      saveState();
      renderStudyPlan();
      renderTodayPlan();
      showToast("学习计划已删除");
    });
    $("#mistakeForm").addEventListener("submit", saveMistake);
    $("#resetMistakeForm").addEventListener("click", resetMistakeComposer);
    $("#mistakeImageInput").addEventListener("change", event => {
      const input = event.target;
      queueMistakeImages(input.files).finally(() => { input.value = ""; });
    });
    $("#mistakeText").addEventListener("paste", event => {
      const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === "file" && item.type.startsWith("image/")).map(item => item.getAsFile()).filter(Boolean);
      if (files.length) queueMistakeImages(files);
    });
    $$('[data-mistake-filter]').forEach(button => button.addEventListener("click", () => { mistakeFilter = button.dataset.mistakeFilter; renderMistakes(); }));
    $("#aiProvider").addEventListener("change", applyAiPreset);
    $("#aiBaseUrl").addEventListener("change", persistAiPreferences);
    $("#aiModel").addEventListener("change", persistAiPreferences);
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
      activeListeningId = activeReadingId = activeWritingId = activeSpeakingId = null;
      try {
        await saveState();
        renderAll(); newWriting(); newSpeaking(); showToast("永久数据文件已清空，滚动备份已保留");
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
    populatePreferences();
    renderAll();
    populatePlanForm();
    renderMistakeImagePreview();
    newWriting();
    newSpeaking();
    await Promise.all([refreshAiStatus(), loadResourceCatalog(false)]);
    routeTo(location.hash.slice(1) || "home");
  }

  initialize();
})();
