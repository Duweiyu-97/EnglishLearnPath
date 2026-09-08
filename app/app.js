(() => {
  "use strict";

  const DEFAULT_STATE = {
    writings: [],
    speaking: [],
    languageBank: null,
    activityDates: [],
    studyPlan: null,
    planProgress: {},
    mistakes: [],
    preferences: { aiProvider: "deepseek", aiBaseUrl: "https://api.deepseek.com", aiModel: "deepseek-v4-flash", speechLanguage: "en-GB", sidebarCollapsed: false }
  };

  const titles = {
    home: ["TODAY'S PATH", "学习概览"],
    writing: ["WRITING STUDIO", "写作工坊"],
    speaking: ["SPEAKING ROOM", "口语练习"],
    language: ["YOUR REUSABLE LANGUAGE", "个人语料库"],
    plan: ["GOAL TO ACTION", "学习计划"],
    mistakes: ["REVIEW & IMPROVE", "错题与单词"],
    settings: ["PRIVATE BY DEFAULT", "AI 与数据设置"],
    guide: ["START HERE", "使用指南"],
    review: ["QUESTION REVIEW", "批改报告"]
  };

  let state = structuredClone(DEFAULT_STATE);
  let diskReady = false;
  let diskStatus = null;
  let saveQueue = Promise.resolve();
  let activeWritingId = null;
  let activeSpeakingId = null;
  let reviewWorkspaceSelection = null;
  let reviewWorkspaceAudioUrl = null;
  let mistakeFilter = "all";
  let pendingMistakeImages = [];
  let pendingMistakeRelated = null;
  let pendingMistakeImageJob = Promise.resolve();
  let pendingWritingPromptImages = [];
  let pendingWritingPromptImageJob = Promise.resolve();
  let writingPromptImageSession = 0;
  let todayTaskActions = new Map();
  let aiConnected = false;
  let timerInterval = null;
  let timerSeconds = 40 * 60;
  let writingAutosaveTimer = null;
  let speakingAutosaveTimer = null;
  let recorder = null;
  let recordingStream = null;
  let recordingChunks = [];
  let recordingBlob = null;
  let recordingBlobDirty = false;
  let recordingSession = 0;
  let recordingBusy = false;
  let localTranscriptionReady = false;
  let localTranscriptionController = null;
  let recordSeconds = 0;
  let recordInterval = null;
  let speakingPhase = "idle";
  let preparationSeconds = 0;
  let preparationInterval = null;
  let toastTimer = null;

  const SPEAKING_PARTS = {
    p1: { label: "Part 1", title: "简短问答", guide: "直接回答问题，再补充一个理由或细节。单题通常回答 20–30 秒，不需要准备时间。", preparation: 0, answerLimit: 0 },
    p2: { label: "Part 2", title: "个人陈述", guide: "先准备 1 分钟，再连续回答最多 2 分钟。准备阶段不会被录音，倒计时结束后自动开始。", preparation: 60, answerLimit: 120 },
    p3: { label: "Part 3", title: "深入讨论", guide: "先直接表明观点，再说明原因，并用例子、对比或影响展开。通常每题回答 40–60 秒。", preparation: 0, answerLimit: 0 },
    free: { label: "自由表达", title: "自由练习", guide: "按自己的节奏组织答案；录音结束后会自动转写并保存。", preparation: 0, answerLimit: 0 }
  };

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
      // Preserve opaque legacy fields on disk without rendering retired modules.
      ...candidate,
      writings: Array.isArray(candidate.writings) ? candidate.writings : [],
      speaking: Array.isArray(candidate.speaking) ? candidate.speaking : [],
      languageBank: candidate.languageBank && typeof candidate.languageBank === "object" ? candidate.languageBank : null,
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

  function setSidebarCollapsed(collapsed, persist = true) {
    const shell = $(".app-shell");
    shell.classList.toggle("is-sidebar-collapsed", Boolean(collapsed));
    const button = $("#sidebarCollapse");
    button.setAttribute?.("aria-label", collapsed ? "展开导航栏" : "收起导航栏");
    button.title = collapsed ? "展开导航栏" : "收起导航栏";
    if (persist) {
      state.preferences.sidebarCollapsed = Boolean(collapsed);
      if (diskReady) saveState();
    }
  }

  function setPracticeFocus(enabled) {
    document.body?.classList.toggle("practice-focus", Boolean(enabled));
    $("#exitFocusMode").classList.toggle("hidden", !enabled);
  }

  function speakingPartConfig() {
    return SPEAKING_PARTS[$("#speakingPart").value] || SPEAKING_PARTS.free;
  }

  function updateSpeakingPartGuide() {
    const config = speakingPartConfig();
    $("#speakingPartGuide").innerHTML = `<strong>${config.label} · ${config.title}</strong>${config.guide}`;
    if (speakingPhase !== "idle") return;
    $("#recordButton").textContent = config.preparation ? "开始 1 分钟准备" : "开始录音并转写";
    $("#recordHint").textContent = config.preparation
      ? "点击后先授权麦克风并开始准备倒计时；准备内容不会被录音。"
      : "首次使用需允许麦克风；录音结束后由本地 Whisper 自动生成文字稿。";
  }

  function routeTo(route) {
    const match = /^review\/(writing|speaking)\/([^/]+)$/.exec(route);
    let target = titles[route] ? route : "home";
    if (match) {
      let id;
      try { id = decodeURIComponent(match[2]); } catch { id = null; }
      const records = match[1] === "writing" ? state.writings : state.speaking;
      if (id === "draft" || records.some(item => item.id === id)) {
        reviewWorkspaceSelection = { module: match[1], id: id === "draft" ? null : id };
        target = "review";
        populateReviewWorkspace();
      } else { target = match[1]; showToast("这条练习不存在或已删除"); }
    }
    if (target === "review" && !reviewWorkspaceSelection) target = "writing";
    if (target !== "review") releaseReviewAudio();
    if (!['writing', 'speaking'].includes(target)) setPracticeFocus(false);
    $$("[data-page]").forEach(page => page.classList.toggle("is-active", page.dataset.page === target));
    $$(".nav-item[data-route]").forEach(item => item.classList.toggle("is-active", item.dataset.route === target));
    $("#pageEyebrow").textContent = titles[target][0];
    $("#pageTitle").textContent = titles[target][1];
    $(".sidebar").classList.remove("is-open");
    const hash = target === "review" ? `#review/${reviewWorkspaceSelection.module}/${encodeURIComponent(reviewWorkspaceSelection.id || "draft")}` : `#${target}`;
    if (location.hash !== hash) history.pushState(null, "", hash);
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
    $("#metricSpeaking").textContent = state.speaking.length;
    $("#metricStreak").textContent = calculateStreak();
  }

  const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const moduleNames = { writing: "写作", speaking: "口语", vocabulary: "单词" };

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
      writing: clampCount($("#manualWriting").value, 1),
      speaking: clampCount($("#manualSpeaking").value, 2),
      writingReview: clampCount($("#manualWritingReview").value, 1),
      writingRewrite: clampCount($("#manualWritingRewrite").value, 1),
      speakingReview: clampCount($("#manualSpeakingReview").value, 1),
      languageMinutes: clampCount($("#manualLanguage").value, 60),
      reviewMinutes: clampCount($("#manualReview").value, 120),
      note: "少量输出，优先完成反馈核对、语料整理和重练。"
    };
  }

  function normalizePlanDay(value = {}) {
    return {
      writing: clampCount(value.writing, 1),
      speaking: clampCount(value.speaking, 2),
      writingReview: clampCount(value.writingReview, 1),
      writingRewrite: clampCount(value.writingRewrite, 1),
      speakingReview: clampCount(value.speakingReview, 1),
      languageMinutes: clampCount(value.languageMinutes, 60),
      reviewMinutes: clampCount(value.reviewMinutes, 240),
      note: String(value.note || "").slice(0, 240)
    };
  }

  function normalizeAiPlanDay(value = {}) {
    const day = normalizePlanDay(value);
    if (day.writing) {
      day.writingReview = 1;
      day.writingRewrite = 1;
    }
    if (day.speaking) day.speakingReview = 1;
    if ((day.writing || day.speaking) && day.languageMinutes < 10) day.languageMinutes = 10;
    return day;
  }

  function parsePlanDate(value) {
    const [year, month, day] = String(value || "").split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function formatPlanDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function addPlanDays(value, amount) {
    const date = value instanceof Date ? new Date(value) : parsePlanDate(value);
    date.setDate(date.getDate() + amount);
    return date;
  }

  function planDaysInclusive(start, end) {
    return Math.max(1, Math.round((parsePlanDate(end) - parsePlanDate(start)) / 86400000) + 1);
  }

  function buildPhaseBlueprints(examDate) {
    const startDate = today();
    const totalDays = planDaysInclusive(startDate, examDate);
    const templates = totalDays <= 10
      ? [{ name: "考前冲刺", ratio: 1, focus: "保持手感、回看错题、稳定作息，不再大量引入新方法。" }]
      : totalDays <= 30
        ? [
            { name: "重点强化", ratio: 0.62, focus: "围绕当前短板完成专项训练，并建立稳定的复盘闭环。" },
            { name: "冲刺与调整", ratio: 0.38, focus: "增加计时练习与模考，回收错题，逐步调整到考试节奏。" }
          ]
        : totalDays <= 90
          ? [
              { name: "基础补弱", ratio: 0.38, focus: "校准方法和基础能力，优先处理影响分数最大的薄弱项。" },
              { name: "专项强化", ratio: 0.37, focus: "增加弱项训练密度，同时保持写作与口语持续练习。" },
              { name: "模考冲刺", ratio: 0.25, focus: "转向计时套题、整套输出、错题回收和状态调整。" }
            ]
          : [
              { name: "基础校准", ratio: 0.3, focus: "建立可持续节奏，补齐基础并确认各科真实薄弱点。" },
              { name: "专项提升", ratio: 0.3, focus: "围绕目标差距做专项训练，积累可复用的方法和语料。" },
              { name: "套题整合", ratio: 0.25, focus: "提高计时完成度，把单项能力整合到完整考试任务中。" },
              { name: "冲刺调整", ratio: 0.15, focus: "以模考、错题回收和稳定发挥为主，减少无效新增。" }
            ];
    const phases = [];
    let cursor = parsePlanDate(startDate);
    let remaining = totalDays;
    templates.forEach((template, index) => {
      const phasesLeft = templates.length - index - 1;
      const length = index === templates.length - 1
        ? remaining
        : Math.min(Math.max(1, Math.round(totalDays * template.ratio)), remaining - phasesLeft);
      const end = addPlanDays(cursor, length - 1);
      phases.push({ name: template.name, focus: template.focus, startDate: formatPlanDate(cursor), endDate: formatPlanDate(end) });
      cursor = addPlanDays(end, 1);
      remaining -= length;
    });
    return phases;
  }

  function phasesForPlan(plan) {
    if (!plan) return [];
    if (Array.isArray(plan.phases) && plan.phases.length) {
      return plan.phases.map(phase => ({
        name: String(phase.name || "学习阶段"),
        focus: String(phase.focus || ""),
        startDate: phase.startDate || today(),
        endDate: phase.endDate || plan.profile?.examDate || today(),
        days: Array.isArray(phase.days) ? phase.days.slice(0, 7).map(normalizePlanDay) : []
      })).filter(phase => phase.days.length === 7);
    }
    if (Array.isArray(plan.weekly) && plan.weekly.length === 7) {
      return [{
        name: "原计划（已按考试日期延展）",
        focus: "旧版七日计划已自动兼容；重新保存或生成后会升级为阶段计划。",
        startDate: String(plan.createdAt || "").slice(0, 10) || today(),
        endDate: plan.profile?.examDate || today(),
        days: plan.weekly.map(normalizePlanDay)
      }];
    }
    return [];
  }

  function saveManualPlan() {
    try {
      const profile = readPlanProfile();
      validatePlanProfile(profile);
      const targets = readManualTargets();
      const startDate = today();
      const totalDays = planDaysInclusive(startDate, profile.examDate);
      state.studyPlan = {
        source: "manual",
        createdAt: new Date().toISOString(),
        profile,
        summary: `从 ${startDate} 执行到 ${profile.examDate}，共 ${totalDays} 天；从 ${profile.currentLevel} 向 ${profile.targetLevel} 推进，每天约 ${profile.dailyMinutes} 分钟。`,
        priorities: profile.focus ? [profile.focus] : [],
        phases: [{
          name: "手动执行期",
          focus: profile.focus || "按设定数量稳定执行，并根据错题复盘结果动态调整。",
          startDate,
          endDate: profile.examDate,
          days: dayNames.map(() => ({ ...targets }))
        }]
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
    if (start < 0 || end <= start) throw new Error("AI 没有返回可读取的 JSON");
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  async function generateAiPlan() {
    if (!aiConnected) return routeTo("settings");
    const result = $("#planResult");
    const button = $("#generateAiPlan");
    try {
      const profile = readPlanProfile();
      validatePlanProfile(profile);
      const blueprints = buildPhaseBlueprints(profile.examDate);
      const totalDays = planDaysInclusive(today(), profile.examDate);
      result.className = "feedback-box";
      result.textContent = `AI 正在安排从今天到考试日的 ${totalDays} 天计划……`;
      button.disabled = true;
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "你是写作与口语学习规划师。只规划写作、口语及相关错题、词汇和语料复盘，不安排其他科目或外部题库任务。学习的核心是完成少量输出后的复盘闭环，不是堆积新题：核对反馈、确认确定错误、整理可复用语料、重写或重说，必须比疯狂刷题更优先。只输出一个 JSON 对象，不要 Markdown。结构必须为 {summary:string, priorities:string[], phases:[阶段项]}。phases 数量和顺序必须与用户提供的阶段窗口完全一致。每个阶段项只含 name、focus、days；days 必须是周一到周日顺序的 7 项数组，每项必须含 writing、speaking、writingReview、writingRewrite、speakingReview、languageMinutes、reviewMinutes 七个非负整数和 note 字符串。writing 每天只能为 0 或 1，speaking 每天最多 2；writingReview、writingRewrite、speakingReview 每项最多 1。至少 40% 的可用时间安排给复盘、重写/重说、语料记忆和错题回收，并安排轻量日或休息日。写作任务的完整闭环是：完成写作→核对批改→记录确定语法错误与可复用表达→重写关键段落或全文→对照检查。口语任务的完整闭环是：录音转写→回听校对→核对批改→整理表达→重说同题。这里的 7 项只是该阶段内不同星期的执行节奏，整体计划必须覆盖用户给出的全部阶段直到考试日。任务量必须符合每日可用时间；临近考试逐步增加计时练习、整套输出、错题回收和状态调整。不要虚构用户没有提供的诊断。" },
            { role: "user", content: `今天：${today()}\n预计考试日期：${profile.examDate}\n计划总天数：${totalDays}\n现有水平：${profile.currentLevel}\n目标水平：${profile.targetLevel}\n每日时间：${profile.dailyMinutes} 分钟\n重点与限制：${profile.focus || "未补充"}\n固定阶段窗口：${JSON.stringify(blueprints)}\n请为每个阶段安排不同的训练重点和周一至周日执行节奏。` }
          ],
          temperature: 0.2,
          max_tokens: 3500,
          output_contract: "study-plan-json-v1"
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AI 计划生成失败");
      const parsed = parseAiJson(data.content);
      if (!Array.isArray(parsed.phases) || parsed.phases.length !== blueprints.length) throw new Error("AI 返回的阶段数量与考试日期安排不一致");
      const phases = blueprints.map((blueprint, index) => {
        const generated = parsed.phases[index] || {};
        if (!Array.isArray(generated.days) || generated.days.length !== 7) throw new Error(`AI 返回的“${blueprint.name}”阶段没有完整七天执行节奏`);
        return {
          ...blueprint,
          name: String(generated.name || blueprint.name).slice(0, 80),
          focus: String(generated.focus || blueprint.focus).slice(0, 600),
          days: generated.days.map(normalizeAiPlanDay)
        };
      });
      state.studyPlan = {
        source: "ai",
        createdAt: new Date().toISOString(),
        profile,
        summary: String(parsed.summary || `AI 已生成从今天到 ${profile.examDate} 的考前计划`).slice(0, 1200),
        priorities: Array.isArray(parsed.priorities) ? parsed.priorities.map(item => String(item).slice(0, 240)).slice(0, 8) : [],
        phases
      };
      state.planProgress = {};
      await saveState();
      renderStudyPlan();
      renderTodayPlan();
      result.textContent = `AI 已生成覆盖 ${totalDays} 天、共 ${phases.length} 个阶段的考前计划，并永久写入本地数据文件。`;
      showToast("考前学习计划已生成");
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
    const manualDay = phasesForPlan(plan)[0]?.days?.[0];
    if (plan.source === "manual" && manualDay) {
      const day = manualDay;
      $("#manualWriting").value = day.writing;
      $("#manualSpeaking").value = day.speaking;
      $("#manualWritingReview").value = day.writingReview;
      $("#manualWritingRewrite").value = day.writingRewrite;
      $("#manualSpeakingReview").value = day.speakingReview;
      $("#manualLanguage").value = day.languageMinutes;
      $("#manualReview").value = day.reviewMinutes;
    }
  }

  function renderStudyPlan() {
    const plan = state.studyPlan;
    const phases = phasesForPlan(plan);
    const badge = $("#planSourceBadge");
    const summary = $("#planSummary");
    const phasePlan = $("#phasePlan");
    if (!phases.length) {
      badge.textContent = "未创建";
      badge.className = "status-badge status-off";
      summary.className = "plan-summary empty-state";
      summary.textContent = "先在左侧填写目标，然后手动保存或让 AI 生成。";
      phasePlan.innerHTML = "";
      $("#deletePlan").classList.add("hidden");
      return;
    }
    badge.textContent = plan.source === "ai" ? `AI · ${phases.length} 阶段` : "手动计划";
    badge.className = "status-badge status-on";
    $("#deletePlan").classList.remove("hidden");
    summary.className = "plan-summary";
    summary.textContent = [plan.summary, ...(plan.priorities || []).map(item => `重点：${item}`)].filter(Boolean).join("\n");
    phasePlan.innerHTML = phases.map(phase => {
      const signatures = phase.days.map(day => JSON.stringify(normalizePlanDay(day)));
      const allSame = signatures.every(signature => signature === signatures[0]);
      const days = allSame ? [{ label: "每天", value: phase.days[0] }] : phase.days.map((value, index) => ({ label: dayNames[index], value }));
      return `<article class="plan-phase"><header><div><strong>${escapeHtml(phase.name)}</strong><span>${escapeHtml(phase.startDate)} — ${escapeHtml(phase.endDate)} · ${planDaysInclusive(phase.startDate, phase.endDate)} 天</span></div><p>${escapeHtml(phase.focus || "按阶段目标稳定执行并及时复盘。")}</p></header><div class="phase-days">${days.map(item => { const day = normalizePlanDay(item.value); const details = [`新写作 ${day.writing}`, `新口语 ${day.speaking}`, day.writingReview ? `写作精改 ${day.writingReview}` : "", day.writingRewrite ? `重写 ${day.writingRewrite}` : "", day.speakingReview ? `口语回听 ${day.speakingReview}` : "", day.languageMinutes ? `语料 ${day.languageMinutes} 分钟` : "", day.reviewMinutes ? `错题/单词 ${day.reviewMinutes} 分钟` : ""].filter(Boolean).join(" · "); return `<div><b>${item.label}</b><span>${details || "休息或自由复盘"}${day.note ? ` · ${escapeHtml(day.note)}` : ""}</span></div>`; }).join("")}</div></article>`;
    }).join("");
  }

  function mondayIndex(date = new Date()) {
    return (date.getDay() + 6) % 7;
  }

  function planDayForDate(plan, dateString) {
    if (!plan?.profile?.examDate || dateString > plan.profile.examDate) return null;
    if (dateString === plan.profile.examDate) {
      return { ...normalizePlanDay({ note: "考试日：只做必要热身，带好证件并保持稳定状态。" }), phaseName: "考试日" };
    }
    const phase = phasesForPlan(plan).find(item => dateString >= item.startDate && dateString <= item.endDate);
    if (!phase) return null;
    const day = normalizePlanDay(phase.days[mondayIndex(parsePlanDate(dateString))] || {});
    return { ...day, phaseName: phase.name };
  }

  function todayPlanTasks() {
    const plan = state.studyPlan;
    const dateString = today();
    const target = planDayForDate(plan, dateString);
    if (!target) return [];
    const tasks = [
      ...Array.from({ length: target.writing }, (_, index) => ({ id: `writing-${index}`, kind: "writing", title: `新写作 ${index + 1}`, detail: "完成一篇，系统自动保存；新输出保持少量，给后续复盘留时间" })),
      ...Array.from({ length: target.speaking }, (_, index) => ({ id: `speaking-${index}`, kind: "speaking", title: `新口语 ${index + 1}`, detail: "一次录音，自动离线转写并写入本机" })),
      ...Array.from({ length: target.writingReview }, (_, index) => ({ id: `writing-review-${index}`, kind: "writing-review", title: "写作反馈核对", detail: "只记录确定语法错误；把可选表达优化单独整理" })),
      ...Array.from({ length: target.writingRewrite }, (_, index) => ({ id: `writing-rewrite-${index}`, kind: "writing-rewrite", title: "写作重写与对照", detail: "根据复盘重写关键段落或全文，再与原稿对照" })),
      ...Array.from({ length: target.speakingReview }, (_, index) => ({ id: `speaking-review-${index}`, kind: "speaking-review", title: "口语回听与重说", detail: "回听核对转写、整理表达，再重说同一话题" }))
    ];
    if (target.languageMinutes) tasks.push({ id: "language-0", kind: "review", title: `常用语料记忆 ${target.languageMinutes} 分钟`, detail: "整理并主动回忆本题可复用的搭配、句型和例子" });
    if (target.reviewMinutes) tasks.push({ id: "review-0", kind: "review", title: `错题与单词复盘 ${target.reviewMinutes} 分钟`, detail: "回看旧错误，完成一次主动回忆和改正" });
    return tasks;
  }

  function renderTodayPlan() {
    const root = $("#todayPlanList");
    const meta = $("#todayPlanMeta");
    const plan = state.studyPlan;
    const tasks = todayPlanTasks();
    const target = planDayForDate(plan, today());
    const progress = state.planProgress[today()] || {};
    todayTaskActions = new Map(tasks.map(task => [task.id, task]));
    updateHeroPrimaryAction(plan, tasks, progress);
    if (!plan || !tasks.length) {
      root.className = "today-task-list empty-state";
      root.textContent = plan ? (today() === plan.profile?.examDate ? "今天是预计考试日，按计划只做必要热身。" : "今天安排为休息或自由复盘。") : "尚未创建学习计划";
      meta.textContent = plan ? `${target?.phaseName || "当前阶段"} · 今日没有设置固定数量。` : "配置考试目标后，这里会生成可执行任务。";
      return;
    }
    const daysLeft = Math.max(0, planDaysInclusive(today(), plan.profile.examDate) - 1);
    const done = tasks.filter(task => progress[task.id]).length;
    meta.textContent = `距预计考试 ${daysLeft} 天 · ${target?.phaseName || "当前阶段"} · 今日 ${done}/${tasks.length} 已完成`;
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

  function updateHeroPrimaryAction(plan, tasks, progress) {
    const button = $("#heroPrimaryAction");
    if (!plan) {
      button.textContent = "配置学习计划";
      button.title = "先设置考试日期、目标水平和每日安排";
      return;
    }
    if (!tasks.length) {
      button.textContent = "查看学习计划";
      button.title = "今天没有固定任务，可查看或调整计划";
      return;
    }
    const nextTask = tasks.find(task => !progress[task.id]);
    button.textContent = nextTask ? (tasks.some(task => progress[task.id]) ? "继续今日任务" : "开始今日任务") : "查看今日完成情况";
    button.title = nextTask ? `下一项：${nextTask.title}` : "今天的固定任务已经全部完成";
  }

  function startHeroPrimaryAction() {
    const plan = state.studyPlan;
    const tasks = todayPlanTasks();
    if (!plan || !tasks.length) return routeTo("plan");
    const progress = state.planProgress[today()] || {};
    const nextTask = tasks.find(task => !progress[task.id]);
    if (nextTask) return startTodayTask(nextTask.id);
    $(".today-plan").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startTodayTask(id) {
    const task = todayTaskActions.get(id);
    if (!task) return;
    if (task.kind === "review") return routeTo("mistakes");
    if (task.kind === "writing-review" || task.kind === "writing-rewrite") return routeTo("writing");
    if (task.kind === "speaking-review") return routeTo("speaking");
    routeTo(task.kind);
    if (task.kind === "writing") newWriting();
    else if (task.kind === "speaking") newSpeaking();
  }

  function resetMistakeComposer() {
    $("#mistakeTitle").value = "";
    $("#mistakeText").value = "";
    pendingMistakeImages = [];
    pendingMistakeRelated = null;
    renderMistakeImagePreview();
  }

  function selectMistakeModule(module) {
    const selected = Object.hasOwn(moduleNames, module) ? module : "writing";
    $("#mistakeModule").value = selected;
    $$('[data-mistake-module]').forEach(button => {
      const active = button.dataset.mistakeModule === selected;
      button.classList.toggle("is-active", active);
      button.classList.toggle("button-secondary", active);
      button.classList.toggle("button-quiet", !active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (pendingMistakeRelated && pendingMistakeRelated.module !== selected) pendingMistakeRelated = null;
  }

  function openMistakeComposer(module, title = "", text = "", related = null) {
    routeTo("mistakes");
    pendingMistakeImages = [];
    renderMistakeImagePreview();
    selectMistakeModule(module);
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
    const defaultTitle = module === "vocabulary" ? "未命名单词" : `${moduleNames[module]}复盘`;
    state.mistakes.push({ id: uid(), module, title: title || defaultTitle, text, images: [...pendingMistakeImages], related: pendingMistakeRelated, createdAt: new Date().toISOString() });
    saveState(true);
    mistakeFilter = module;
    resetMistakeComposer();
    renderMistakes();
    showToast("已保存到本地错题本");
  }

  function renderMistakes() {
    const visible = state.mistakes.filter(item => Object.hasOwn(moduleNames, item.module));
    const items = visible.filter(item => mistakeFilter === "all" || item.module === mistakeFilter).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    $("#mistakeCount").textContent = visible.length;
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
    if (related.module === "writing" && related.id) loadWriting(related.id);
    else if (related.module === "speaking" && related.id) loadSpeaking(related.id);
  }

  function reviewTopicTitle(review) {
    const plain = String(review || "").replace(/[*_`]/g, "");
    const match = plain.match(/^\s*(?:#{1,6}\s*)?(?:[-+]\s*)?(?:本题)?(?:主题|话题)(?:名称)?\s*[:：]\s*(.+)$/m);
    return match ? match[1].split(/[，。；\n]/)[0].trim().slice(0, 64) : "";
  }

  function practiceTitle(item) {
    const title = item.topicTitle || reviewTopicTitle(item.review) || String(item.prompt || "").replace(/\s+/g, " ").trim();
    if (!title) return item.promptImages?.length ? "图片题目（主题待补充）" : "未命名练习";
    return title.length > 64 ? `${title.slice(0, 64)}…` : title;
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
    root.innerHTML = [...state.writings].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => `<div class="record-list-item"><button class="library-item ${item.id === activeWritingId ? "is-active" : ""}" data-writing-id="${escapeHtml(item.id)}"><strong>${escapeHtml(practiceTitle(item))}</strong><small>${escapeHtml(item.type)} · ${escapeHtml(item.updatedAt.slice(0, 10))} · ${countWords(item.essay)} words${item.promptImages?.length ? ` · ${item.promptImages.length} 图` : ""}</small></button>${item.review ? `<button class="record-review button button-quiet" data-writing-report="${escapeHtml(item.id)}">查看批改报告</button>` : ""}<button class="record-delete" data-delete-writing-id="${escapeHtml(item.id)}" aria-label="删除这篇写作">删除</button></div>`).join("");
    $$('[data-writing-id]', root).forEach(button => button.addEventListener("click", () => {
      const id = button.dataset.writingId;
      if (state.writings.find(item => item.id === id)?.review) openReviewWorkspace("writing", id);
      else loadWriting(id);
    }));
    $$('[data-writing-report]', root).forEach(button => button.addEventListener("click", () => openReviewWorkspace("writing", button.dataset.writingReport)));
    $$('[data-delete-writing-id]', root).forEach(button => button.addEventListener("click", () => deleteWritingRecord(button.dataset.deleteWritingId)));
  }

  function deleteWritingRecord(id) {
    if (!id || !confirm("确定删除这篇写作记录吗？")) return;
    state.writings = state.writings.filter(entry => entry.id !== id);
    saveState();
    if (activeWritingId === id) newWriting(true); else renderWritingHistory();
    showToast("写作记录已删除");
  }

  function countWords(value) {
    const matches = String(value || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g);
    return matches ? matches.length : 0;
  }

  async function addWritingPromptImages(files, session) {
    const images = [...files].filter(file => file?.type?.startsWith("image/"));
    if (!images.length) return;
    if (session !== writingPromptImageSession) return;
    if (pendingWritingPromptImages.length + images.length > 6) return showToast("每篇作文最多添加 6 张题目图片");
    try {
      for (const file of images) {
        const compressed = await compressImage(file);
        if (session !== writingPromptImageSession) return;
        pendingWritingPromptImages.push(compressed);
      }
      renderWritingPromptImages();
      scheduleWritingAutosave();
      showToast(`已添加 ${images.length} 张题目图片`);
    } catch (error) {
      showToast(error.message);
    }
  }

  function queueWritingPromptImages(files) {
    const snapshot = [...files];
    const session = writingPromptImageSession;
    pendingWritingPromptImageJob = pendingWritingPromptImageJob.then(() => addWritingPromptImages(snapshot, session));
    return pendingWritingPromptImageJob;
  }

  function renderWritingPromptImages() {
    const root = $("#writingPromptImagePreview");
    if (!pendingWritingPromptImages.length) {
      root.className = "writing-prompt-images empty-state";
      root.textContent = "尚未添加题目图片";
      return;
    }
    root.className = "writing-prompt-images";
    root.innerHTML = pendingWritingPromptImages.map((src, index) => `<div class="writing-prompt-image"><img src="${src}" alt="题目图片 ${index + 1}"><button type="button" data-remove-writing-prompt-image="${index}">移除</button></div>`).join("");
    $$('[data-remove-writing-prompt-image]', root).forEach(button => button.addEventListener("click", () => {
      pendingWritingPromptImages.splice(Number(button.dataset.removeWritingPromptImage), 1);
      renderWritingPromptImages();
      scheduleWritingAutosave();
    }));
  }

  async function newWriting(skipAutosave = false) {
    if (skipAutosave) clearTimeout(writingAutosaveTimer); else await flushWritingAutosave();
    writingAutosaveTimer = null;
    activeWritingId = null;
    $("#writingType").value = "Task 2";
    $("#writingMinutes").value = "40";
    $("#writingPrompt").value = "";
    writingPromptImageSession += 1;
    pendingWritingPromptImages = [];
    pendingWritingPromptImageJob = Promise.resolve();
    renderWritingPromptImages();
    $("#writingEssay").value = "";
    $("#writingReview").textContent = "";
    $("#writingReview").classList.add("hidden");
    $("#deleteWriting").classList.add("hidden");
    $("#saveStatus").textContent = "内容会自动保存到本机";
    resetWritingTimer();
    updateWordCount(false);
    renderWritingHistory();
    $("#writingPrompt").focus();
  }

  async function loadWriting(id) {
    await flushWritingAutosave();
    const item = state.writings.find(entry => entry.id === id);
    if (!item) return;
    activeWritingId = id;
    $("#writingType").value = item.type;
    $("#writingMinutes").value = String(item.minutes);
    $("#writingPrompt").value = item.prompt;
    writingPromptImageSession += 1;
    pendingWritingPromptImages = Array.isArray(item.promptImages) ? [...item.promptImages] : [];
    pendingWritingPromptImageJob = Promise.resolve();
    renderWritingPromptImages();
    $("#writingEssay").value = item.essay;
    $("#deleteWriting").classList.remove("hidden");
    $("#saveStatus").textContent = `上次自动保存 ${new Date(item.updatedAt).toLocaleString()}`;
    $("#writingReview").textContent = "";
    $("#writingReview").classList.add("hidden");
    resetWritingTimer();
    updateWordCount(false);
    renderWritingHistory();
  }

  async function saveWriting({ silent = false } = {}) {
    await pendingWritingPromptImageJob;
    const prompt = $("#writingPrompt").value.trim();
    const essay = $("#writingEssay").value.trim();
    if (!prompt && !essay && !pendingWritingPromptImages.length) return false;
    const existing = state.writings.find(entry => entry.id === activeWritingId);
    const record = {
      id: activeWritingId || uid(),
      type: $("#writingType").value,
      minutes: Number($("#writingMinutes").value),
      prompt,
      promptImages: [...pendingWritingPromptImages],
      essay,
      updatedAt: new Date().toISOString(),
      review: existing?.review || "",
      reviewInput: existing?.reviewInput || null,
      topicTitle: existing?.topicTitle || reviewTopicTitle(existing?.review),
      reviewedAt: existing?.reviewedAt || ""
    };
    const index = state.writings.findIndex(entry => entry.id === record.id);
    if (index >= 0) state.writings[index] = record; else state.writings.push(record);
    activeWritingId = record.id;
    try {
      await saveState(true);
    } catch {
      $("#saveStatus").textContent = "自动保存失败，请检查数据目录";
      if (!silent) showToast("写作未能写入本地文件，请检查数据目录");
      return false;
    }
    $("#deleteWriting").classList.remove("hidden");
    $("#saveStatus").textContent = `已自动保存 ${new Date().toLocaleTimeString()}`;
    renderWritingHistory();
    if (!silent) showToast("写作已保存在本机");
    return true;
  }

  function updateWordCount(markDirty = true) {
    $("#wordCount").textContent = countWords($("#writingEssay").value);
    if (markDirty) scheduleWritingAutosave();
  }

  function scheduleWritingAutosave() {
    $("#saveStatus").textContent = "正在等待自动保存…";
    clearTimeout(writingAutosaveTimer);
    writingAutosaveTimer = setTimeout(() => {
      writingAutosaveTimer = null;
      saveWriting({ silent: true });
    }, 700);
  }

  async function flushWritingAutosave() {
    if (!writingAutosaveTimer) return true;
    clearTimeout(writingAutosaveTimer);
    writingAutosaveTimer = null;
    return saveWriting({ silent: true });
  }

  function formatClock(seconds) {
    const safe = Math.max(0, seconds);
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  function resetWritingTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerSeconds = Number($("#writingMinutes").value) * 60;
    const countUp = !Number($("#writingMinutes").value);
    $("#writingTimer").textContent = formatClock(timerSeconds);
    $("#toggleTimer").textContent = countUp ? "开始正计时" : "开始倒计时";
  }

  function toggleWritingTimer() {
    const countUp = !Number($("#writingMinutes").value);
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
      $("#toggleTimer").textContent = countUp ? "继续正计时" : "继续倒计时";
      return;
    }
    if (!countUp && timerSeconds <= 0) resetWritingTimer();
    setPracticeFocus(true);
    $("#toggleTimer").textContent = "暂停计时";
    timerInterval = setInterval(() => {
      timerSeconds += countUp ? 1 : -1;
      $("#writingTimer").textContent = formatClock(timerSeconds);
      if (!countUp && timerSeconds <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        $("#toggleTimer").textContent = "重新倒计时";
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
      if (data.saved) {
        $("#aiApiKey").placeholder = "已在本机加密保存；留空可继续使用，填写可替换";
        $("#aiBaseUrl").value = data.baseUrl || $("#aiBaseUrl").value;
        $("#aiModel").value = data.model || $("#aiModel").value;
      }
      if (data.restored || data.storageError) {
        $("#aiTestResult").className = "feedback-box";
        $("#aiTestResult").textContent = data.storageError || "已从本机加密文件恢复接口配置，无需重新输入 Key。本次启动尚未重新测试网络连接。";
        if (data.restored) {
          $("#settingsAiBadge").textContent = "配置已恢复";
          $("#aiStatusBadge").textContent = "AI 配置已恢复";
        }
      }
    } catch {
      setAiConnected(false);
    }
  }

  function applyAiPreset() {
    const preset = $("#aiProvider").value;
    const values = {
      deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", help: "普通文字使用 deepseek-v4-flash；写作带题图时自动切换官方视觉模型。" },
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
    setSidebarCollapsed(Boolean(preferences.sidebarCollapsed), false);
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
      result.textContent = `连接成功：${data.model || "模型已就绪"}。${data.saved ? "接口配置已在本机加密保存，重启后自动恢复。" : "当前启动器仅在内存中保存，请使用更新版启用本地记忆。"}`;
      if (data.saved) $("#aiApiKey").placeholder = "已在本机加密保存；留空可继续使用，填写可替换";
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
    if (!confirm("断开并删除此程序副本在本机加密保存的接口配置？下次需要重新输入 Key。学习记录不会删除。")) return;
    try {
      const response = await fetch("/api/ai/disconnect", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "删除已保存配置失败");
      setAiConnected(false);
      $("#aiApiKey").value = "";
      $("#aiApiKey").placeholder = "填写后在本机加密保存";
      $("#aiTestResult").className = "feedback-box";
      $("#aiTestResult").textContent = "已断开，并删除本机保存的接口配置。";
    } catch (error) { showToast(error.message); }
  }

  function renderAiFeedback(output, content) {
    if (window.renderReviewMarkdown) window.renderReviewMarkdown(output, content);
    else { output.classList.remove("is-error"); output.textContent = content; }
  }

  function openReviewWorkspace(module, recordId) {
    const writing = module === "writing";
    const id = recordId || (writing ? activeWritingId : activeSpeakingId);
    reviewWorkspaceSelection = { module, id };
    routeTo(`review/${module}/${encodeURIComponent(id || "draft")}`);
  }

  function populateReviewWorkspace() {
    if (!reviewWorkspaceSelection) return;
    const { module, id } = reviewWorkspaceSelection;
    const writing = module === "writing";
    const item = (writing ? state.writings : state.speaking).find(entry => entry.id === id);
    const snapshot = item?.reviewInput;
    // The review is tied to its submitted text, not a later edit in the editor.
    const prompt = snapshot ? snapshot.prompt : item?.review ? item.prompt : $(writing ? "#writingPrompt" : "#speakingPrompt").value;
    const original = snapshot ? snapshot.original : item?.review ? (writing ? item.essay : item.transcript) : $(writing ? "#writingEssay" : "#speakingTranscript").value;
    const punctuated = !writing && item?.punctuationSource === original && window.isPunctuationOnlyRevision?.(original, item.punctuatedTranscript) ? item.punctuatedTranscript : "";
    $("#reviewRawTranscriptPanel").classList.toggle("hidden", writing);
    $("#reviewRawTranscript").textContent = writing ? "" : original || "";
    $("#reviewAnnotatedTitle").textContent = writing ? "原文与修改标注" : "标点与大小写整理稿 · 修改标注";
    $("#reviewPunctuationTools").classList.toggle("hidden", writing);
    $("#generatePunctuation").classList.toggle("hidden", Boolean(punctuated));
    $("#generatePunctuation").disabled = !aiConnected || !item || !original;
    $("#punctuationStatus").textContent = punctuated ? "仅整理标点、大小写和分段，保留原词句；以下标注对应 AI 已给出的修改。" : "当前报告尚无通过校验的整理稿。生成会调用已配置的 AI，仅补标点与大小写，不重新批改。";
    $("#reviewWorkspaceTitle").textContent = practiceTitle(item || { prompt });
    const type = snapshot?.type || item?.type || ({p1:"Part 1",p2:"Part 2",p3:"Part 3",free:"自由表达"}[item?.part]) || (writing ? "写作" : "口语");
    $("#reviewWorkspaceMeta").textContent = `${writing ? "写作" : "口语"}批改报告 · ${type}${item?.reviewedAt ? ` · ${new Date(item.reviewedAt).toLocaleString()}` : ""}`;
    $("#reviewWorkspacePrompt").textContent = prompt || "尚未填写题目 / 话题";
    $("#reviewWorkspaceOriginal").textContent = original || "尚无原始回答";
    $("#reviewWorkspaceNotice").textContent = snapshot ? "展示批改时提交的原稿。标注来自 AI 已返回的修改，不改变你的原文。" : item?.review ? "历史报告：原文取自该记录保存的答案，旧记录没有独立的提交快照。" : "本题预览，不会自动请求 AI 或覆盖编辑区。";
    $("#editReviewSource").disabled = !item;
    const images = writing ? snapshot?.promptImages || (item?.review ? item.promptImages : pendingWritingPromptImages) || [] : [];
    const imageRoot = $("#reviewWorkspaceImages");
    imageRoot.replaceChildren();
    images.forEach((src, index) => {
      if (typeof src !== "string" || !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) return;
      const image = document.createElement("img");
      image.src = src;
      image.alt = `题目图片 ${index + 1}`;
      imageRoot.append(image);
    });
    const audio = $("#reviewWorkspaceAudio");
    audio.pause();
    audio.removeAttribute("src");
    if (reviewWorkspaceAudioUrl) URL.revokeObjectURL(reviewWorkspaceAudioUrl);
    reviewWorkspaceAudioUrl = null;
    audio.classList.add("hidden");
    if (!writing && item?.transcript === original && /^data:audio\/[\w.+-]+(?:;codecs=[\w.-]+)?;base64,/.test(item?.audio || "")) {
      try {
        const [header, encoded] = item.audio.split(",");
        const blob = new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], { type: header.slice(5).replace(/;base64$/, "") });
        reviewWorkspaceAudioUrl = URL.createObjectURL(blob);
        audio.src = reviewWorkspaceAudioUrl;
        audio.classList.remove("hidden");
      } catch { showToast("录音无法读取，原始文字和 AI 反馈仍可查看"); }
    }
    const feedback = item?.review || "尚未生成 AI 反馈。原稿和录音无需 AI 即可保存与复习。";
    const annotations = window.renderReviewAnnotations?.({
      original: writing ? original || "" : punctuated, markdown: item?.review || "", punctuationOnly: !writing,
      definiteOnly: writing,
      originalElement: $("#reviewWorkspaceOriginal"), correctionsElement: $("#reviewCorrections"),
      countElement: $("#reviewAnnotationCount"), noticeElement: $("#reviewAnnotationNotice")
    });
    if (!writing && !punctuated) $("#reviewAnnotationNotice").textContent = "生成整理稿后，修改标注将显示在这里。原始转写和下方修改建议保持不变。";
    if (window.renderReviewReport) window.renderReviewReport($("#reviewWorkspaceFeedback"), feedback, $("#reviewWorkspaceNavigation"), {
      dedupeCorrections: annotations?.count > 0,
      hideTranscript: !writing,
      scoreElement: $("#reviewScoreSummary"),
      overviewElement: $("#reviewOverviewSummary")
    });
    else renderAiFeedback($("#reviewWorkspaceFeedback"), feedback);
  }

  function refreshReviewWorkspace(module, id) {
    if (reviewWorkspaceSelection?.module === module && reviewWorkspaceSelection.id === id) populateReviewWorkspace();
  }

  function releaseReviewAudio() {
    $("#reviewWorkspaceAudio").pause();
    $("#reviewWorkspaceAudio").removeAttribute("src");
    if (reviewWorkspaceAudioUrl) URL.revokeObjectURL(reviewWorkspaceAudioUrl);
    reviewWorkspaceAudioUrl = null;
  }

  async function generatePunctuation() {
    const id = reviewWorkspaceSelection?.module === "speaking" && reviewWorkspaceSelection.id;
    const record = state.speaking.find(item => item.id === id);
    const source = record?.reviewInput?.original || record?.transcript;
    if (!record || !source || !aiConnected) return;
    const button = $("#generatePunctuation");
    button.disabled = true;
    $("#punctuationStatus").textContent = "正在整理标点与大小写，原始转写不会被覆盖……";
    try {
      const response = await fetch("/api/ai/chat", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({messages:[
        {role:"system",content:"只为用户提供的英语转写补充基础标点、大小写和分段。不得增删替换任何词语，不修复语法，不猜测识别错误，不改写表达。只输出整理后的文本，不输出标题、说明或 Markdown 代码块。"},
        {role:"user",content:source}
      ],temperature:0,max_tokens:4000})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "请求失败");
      const revised = String(result.content || "").trim();
      if (!window.isPunctuationOnlyRevision(source, revised)) throw new Error("模型改动了原词句，已拒绝采用；原始转写未改动，请重试。");
      const current = state.speaking.find(item => item.id === id);
      if (!current || (current.reviewInput?.original || current.transcript) !== source) return;
      current.punctuatedTranscript = revised;
      current.punctuationSource = source;
      saveState();
      refreshReviewWorkspace("speaking", id);
    } catch (error) {
      if (reviewWorkspaceSelection?.id === id) $("#punctuationStatus").textContent = `整理失败：${error.message}`;
    } finally {
      if (reviewWorkspaceSelection?.id === id) button.disabled = !aiConnected;
    }
  }


  function reviewFormatContract(kind) {
    const speaking = kind === "speaking";
    return `你返回的内容会被不同服务商的 OpenAI 兼容 API 直接填入固定网页组件。必须只输出 Markdown，不要寒暄、前言、HTML、代码块或额外章节。第一行固定为“主题：8–20 个汉字的具体主题短标题”。之后只允许按以下顺序各出现一次三级标题：\n### 评分与小分\n### 总体评价\n${speaking ? "### 转写整理稿\n" : ""}### 确定语法错误\n### 原文优化建议\n### 目标水平范文\n### 最终值得记忆的语料\n“评分与小分”必须在第一行给出醒目的非官方总分或暂定总分，再用 Markdown 表格列出各项小分与证据。${speaking ? "口语总分必须给出一个基于转写的暂定分和合理区间，FC、LR、GRA 给出分数；P 写‘不可仅凭转写判断’，并明确总分会受真实发音影响。‘转写整理稿’只能补标点、大小写和分段，不得增删替换词。" : "写作按题型给出 TR/TA、CC、LR、GRA 四项分数。"}“确定语法错误”只能使用四列表格，表头严格为“原文｜修改｜类型｜原因”；原文逐字引用、修改尽量小，没有确定错误就写明没有，不得制造错误。“原文优化建议”只放正确但可提升的内容，不得使用纠错表。“目标水平范文”包含英文范文和必要的中文说明或翻译。“最终值得记忆的语料”只保留最值得主动记忆的表达。所有评价必须针对用户提供的完整题目、题型和回答。`;
  }

  async function askAi(messages, output, onSuccess, isCurrent = () => true, images = [], reportKind = "") {
    if (!aiConnected) return routeTo("settings");
    messages = [{role:"system", content:messages.filter(message => message.role === "system").map(message => message.content).join("\n\n")}, ...messages.filter(message => message.role !== "system")];
    const safeImages = images.filter(src => typeof src === "string" && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src));
    if (safeImages.length) {
      const userIndex = messages.findLastIndex(message => message.role === "user");
      if (userIndex >= 0) messages[userIndex] = {
        ...messages[userIndex],
        content: [
          { type: "text", text: messages[userIndex].content },
          ...safeImages.map(src => ({ type: "image_url", image_url: { url: src, detail: "original" } }))
        ]
      };
    }
    output.classList.remove("hidden");
    output.classList.remove("is-error", "markdown-body");
    output.textContent = "正在生成反馈……";
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.map(message => message.role === "system" && reportKind ? { ...message, content: message.content + "\n\n" + reviewFormatContract(reportKind) } : message),
          temperature: 0.25,
          max_tokens: 6000,
          output_contract: reportKind ? `review-markdown-v1-${reportKind}` : "text"
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "请求失败");
      if (isCurrent()) {
        output.textContent = "";
        output.classList.add("hidden");
      }
      if (data.content && typeof onSuccess === "function") onSuccess(data.content);
    } catch (error) {
      if (!isCurrent()) return;
      output.classList.remove("markdown-body");
      output.textContent = `AI 反馈失败：${error.message}\n\n原稿与录音不会因此丢失。若提示长度上限或思考内容，请使用最新启动器或检查模型模式；只有鉴权失败才需要检查 Key。`;
      output.classList.add("is-error");
    }
  }

  function reviewLearnerContext(skill) {
    const profile = state.studyPlan?.profile || {};
    return `本次批改模块：${skill}\n现有水平（用户自述）：${String(profile.currentLevel || "").trim() || "未提供"}\n目标水平（用户设定）：${String(profile.targetLevel || "").trim() || "未提供"}\n重点与限制：${String(profile.focus || "").trim() || "未提供"}`;
  }

  async function reviewWriting() {
    const prompt = $("#writingPrompt").value.trim();
    const essay = $("#writingEssay").value.trim();
    if (!essay) return showToast("请先完成一段写作");
    if (!await saveWriting({ silent: true }) || !activeWritingId) return;
    const recordId = activeWritingId;
    const reviewInput = { prompt, original: essay, type: $("#writingType").value, promptImages: [...pendingWritingPromptImages] };
    const learnerContext = reviewLearnerContext("写作");
    const imageNotice = pendingWritingPromptImages.length ? `\n题目另附 ${pendingWritingPromptImages.length} 张图片。图片是题目的一部分，请先直接读取图片中的图表、流程、地图、数字、单位和标签，再结合文字题目核对正文；不要声称无法看到图片。` : "";
    askAi([
      { role: "system", content: `你是一名严谨、克制的 IELTS 写作教练。用户消息包含现有水平和目标水平。先按当前能力选择最易掌握、最有收益的修改，再按目标水平生成可模仿的答案。优先参考本模块单项水平；只有总分时不要自行推定单项分数。现有水平只是学习背景，原稿评分必须独立依据实际文本，不得因目标分抬分。缺少关键信息时说明不确定性，不虚构官方成绩。评分与小分放在最前面，随后给简明总体评价。\n\n纠错边界必须严格遵守：只有客观、明确、在当前语境下无合理争议的语法、拼写、词形、主谓一致、时态、冠词、单复数、介词或句法错误，才放入“确定语法错误”，并使用原文｜修改｜类型｜原因四列表格；修改必须尽量小。措辞更自然、词汇更高级、表达更简洁、段落更流畅、论证更充分等都只是可选优化，只能放在“原文优化建议（可选优化建议）”，不得标红原文或写入纠错表。正确但不够漂亮的句子绝不能判错；证据不足时宁可不改；没有确定错误就明确写没有。范文保留原意并贴近目标水平，不堆砌生词；最后只保留真正值得主动记忆的领域搭配和常用句式。\n\nTask 1 先核对比较对象、时间、单位和图表结构，再提取 2–3 个主特征，解释 Overview 和细节段的分组；如果没有足够图表信息，明确无法核对数据。Task 2 检查是否答全问题、立场是否直接、每段是否形成观点—解释—例子或结果。不要照搬私人模板或课程资料。` },
      { role: "user", content: `${learnerContext}\n\n写作类型：${$("#writingType").value}${imageNotice}\n题目：${prompt || "未提供文字题目"}\n\n我的正文：\n${essay}` }
    ], $("#writingReview"), content => {
      const record = state.writings.find(entry => entry.id === recordId);
      if (!record) return;
      record.review = content;
      record.reviewInput = reviewInput;
      record.topicTitle = reviewTopicTitle(content) || practiceTitle({ prompt });
      record.reviewedAt = new Date().toISOString();
      saveState();
      renderWritingHistory();
      refreshReviewWorkspace("writing", recordId);
      if (activeWritingId === recordId && location.hash === "#writing") openReviewWorkspace("writing", recordId);
    }, () => activeWritingId === recordId, reviewInput.promptImages, "writing");
  }

  async function reviewSpeaking() {
    const prompt = $("#speakingPrompt").value.trim();
    const transcript = $("#speakingTranscript").value.trim();
    if (!transcript) return showToast("请先粘贴或整理本次口语文字稿");
    if (!await saveSpeaking({ silent: true })) return;
    const recordId = activeSpeakingId;
    const part = $("#speakingPart").value;
    const partConfig = SPEAKING_PARTS[part] || SPEAKING_PARTS.free;
    const reviewInput = { prompt, original: transcript, type: partConfig.label };
    const learnerContext = reviewLearnerContext("口语");
    askAi([
      { role: "system", content: `你是一名谨慎的 IELTS 口语教练。用户消息包含现有水平、目标水平、明确的口语 Part、完整题目和本地 Whisper 转写。必须同时依据题目、Part 规则和回答批改，不得只看文字稿。先按当前能力选择最易掌握、最有收益的修改，再按目标水平生成可真实复述的答案。原稿评分独立依据文本证据，不得因目标分抬分。你没有音频，因此不能评价具体发音、重音、语调或真实停顿；Pronunciation 标为不可仅凭转写判断。仍须给一个醒目的“基于转写的暂定总分”和合理区间，FC、LR、GRA 给直接小分，并说明真实总分会受发音影响。标点、大小写和分段问题可能来自 ASR，不得据此扣分或判为口语错误。句界或词语存在歧义时标记“转写待核对”，不得猜测。确定语法错误只收录有充分文本依据的问题，正确但不够自然的表达只能进入优化建议。不要修改或覆盖页面上的原始转写。保留用户的观点、经历、理由和口语风格，不编造人物、经历、数据或观点，不改成书面论文。\n\nPart 1：针对当前具体问题，检查是否直接回答并用 1–2 个自然细节展开，避免背诵式长篇。Part 2：把用户输入视为完整题卡，逐项核对覆盖度、1–2 分钟独白的故事线、时序与细节；不能只按普通问答评。Part 3：检查是否形成直接回答—原因—例子或对比—影响/小结的深入讨论，不要求机械套模板。自由表达：按用户给出的目的和内容评价。` },
      { role: "system", content: "页面展示要求：不要寒暄。增加独立三级标题‘转写整理稿’，其正文只放补充基础标点、大小写和分段后的转写，不得增删替换原始转写中的词语，不得修复语法或猜测识别错误。逐句修改仍单独列出，原片段逐字引用用户的原始转写，页面会将修改定位到整理稿。不要在其他章节重复整理稿。" },
      { role: "user", content: `${learnerContext}\n\nIELTS 口语题型：${partConfig.label}（${partConfig.title}）\n该 Part 的答题要求：${partConfig.guide}\n完整题目 / 题卡：\n${prompt || "未提供具体题目，仅作自由表达"}\n\n本地 Whisper 转写文字稿：\n${transcript}` }
    ], $("#speakingReview"), content => {
      const record = state.speaking.find(entry => entry.id === recordId);
      if (!record) return;
      record.review = content;
      record.reviewInput = reviewInput;
      record.topicTitle = reviewTopicTitle(content) || practiceTitle({ prompt });
      record.reviewedAt = new Date().toISOString();
      saveState();
      renderSpeakingHistory();
      const revised = window.extractTranscriptPunctuation?.(content);
      if (revised && window.isPunctuationOnlyRevision?.(transcript, revised)) {
        record.punctuatedTranscript = revised;
        record.punctuationSource = transcript;
        saveState();
      }
      refreshReviewWorkspace("speaking", recordId);
      if (activeSpeakingId === recordId && location.hash === "#speaking") openReviewWorkspace("speaking", recordId);
    }, () => activeSpeakingId === recordId, [], "speaking");
  }

  async function refreshTranscriptionStatus() {
    try { localTranscriptionReady = Boolean((await window.localWhisper?.status())?.ready); } catch { localTranscriptionReady = false; }
    $("#retryLocalTranscription").disabled = !localTranscriptionReady;
    $("#recordButton").disabled = !localTranscriptionReady;
    $("#transcriptionStatus").textContent = localTranscriptionReady ? "已内置 whisper.cpp + small.en。结束录音后会自动在本机转写，不上传音频，也不需要 API Key。" : "未检测到本地语音组件。请使用包含 Whisper 的完整离线包；浏览器转写已停用。";
  }

  async function transcribeLocalRecording(session = recordingSession) {
    if (!localTranscriptionReady || !recordingBlob) { showToast("需要完整离线包和一段已结束的录音"); return; }
    const blob = recordingBlob;
    recordingBusy = true;
    const controller = new AbortController();
    localTranscriptionController = controller;
    $("#cancelLocalTranscription").classList.remove("hidden");
    $("#retryLocalTranscription").disabled = true;
    $("#speakingTranscript").disabled = true;
    $("#recordHint").textContent = "Whisper 正在本机处理录音……长录音可能需要几分钟，可取消；录音不会上传。";
    try {
      const text = await window.localWhisper.transcribe(blob,controller.signal);
      if (session !== recordingSession) return;
      $("#speakingTranscript").value = text;
      $("#recordHint").textContent = "本地转写完成并自动保存。请回听核对；手动修改也会继续自动保存。";
    } catch (error) {
      if (session === recordingSession) $("#recordHint").textContent = error.name === "AbortError" ? "已取消转写，录音和已有文字会自动保留，也可重新转写。" : `本地转写失败：${error.message}。录音会自动保留，可重新转写。`;
    } finally {
      if (session === recordingSession) {
        recordingBusy = false; localTranscriptionController = null;
        $("#retryLocalTranscription").disabled = !localTranscriptionReady;
        $("#speakingTranscript").disabled = false;
        $("#cancelLocalTranscription").classList.add("hidden");
      }
    }
    if (session === recordingSession && recordingBlob) await saveSpeaking({ silent: true });
  }

  function beginSpeakingRecording(session) {
    if (session !== recordingSession || !recordingStream) return;
    clearInterval(preparationInterval);
    preparationInterval = null;
    speakingPhase = "recording";
    $("#speakingPart").disabled = true;
    recorder = new MediaRecorder(recordingStream);
    recordingChunks = [];
    recorder.ondataavailable = event => { if (event.data.size) recordingChunks.push(event.data); };
    recorder.onstop = finishRecording;
    recorder.start();
    recordSeconds = 0;
    $("#recordPulse span").textContent = "00:00";
    $("#speakingSaveStatus").textContent = "正在录音，结束转写后自动保存…";
    $("#recordPulse").classList.remove("is-preparing");
    $("#recordPulse").classList.add("is-recording");
    $("#recordButton").textContent = "结束录音与转写";
    const config = speakingPartConfig();
    $("#recordHint").textContent = config.answerLimit
      ? `${config.label} 回答已开始；到 ${formatClock(config.answerLimit)} 时自动结束，也可以提前结束。`
      : "正在录音；结束后由 Whisper 在本机一次性转写，不会上传音频。";
    setPracticeFocus(true);
    clearInterval(recordInterval);
    recordInterval = setInterval(() => {
      recordSeconds += 1;
      $("#recordPulse span").textContent = formatClock(recordSeconds);
      const limit = config.answerLimit || 480;
      if (recordSeconds >= limit && recorder?.state === "recording") recorder.stop();
    }, 1000);
  }

  function beginSpeakingPreparation(session) {
    speakingPhase = "preparing";
    $("#speakingPart").disabled = true;
    preparationSeconds = speakingPartConfig().preparation;
    $("#recordPulse span").textContent = formatClock(preparationSeconds);
    $("#recordPulse").classList.add("is-preparing");
    $("#recordButton").textContent = "立即开始 2 分钟回答";
    $("#recordHint").textContent = "准备中：整理关键词和顺序，不会录音；倒计时结束后自动开始回答。";
    setPracticeFocus(true);
    clearInterval(preparationInterval);
    preparationInterval = setInterval(() => {
      preparationSeconds -= 1;
      $("#recordPulse span").textContent = formatClock(preparationSeconds);
      if (preparationSeconds <= 0) beginSpeakingRecording(session);
    }, 1000);
  }

  async function toggleRecording() {
    if (speakingPhase === "preparing") {
      beginSpeakingRecording(recordingSession);
      return;
    }
    if (recordingBusy) return;
    if (recorder?.state === "recording") {
      recorder.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return showToast("当前浏览器不支持录音，请换用新版 Edge 或 Chrome");
    if (!localTranscriptionReady) return showToast("本地 Whisper 组件缺失，请使用完整离线包");
    if ((recordingBlob || $("#speakingTranscript").value.trim()) && !confirm("重新录音会替换当前编辑区的录音与文字稿。已保存的历史记录会保留到你再次保存为止，是否继续？")) return;
    recordingBusy = true;
    const session = ++recordingSession;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session !== recordingSession) { stream.getTracks().forEach(track => track.stop()); return; }
      recordingStream = stream;
      recordingBlob = null;
      recordingBlobDirty = false;
      $("#speakingTranscript").value = "";
      const playback = $("#speakingPlayback");
      if (playback.src?.startsWith("blob:")) URL.revokeObjectURL(playback.src);
      playback.pause();
      playback.removeAttribute("src");
      playback.load();
      playback.classList.add("hidden");
      $("#downloadRecording").classList.add("hidden");
      if (speakingPartConfig().preparation) beginSpeakingPreparation(session);
      else beginSpeakingRecording(session);
    } catch (error) {
      recordingStream?.getTracks().forEach(track => track.stop());
      recordingStream = null;
      showToast(`无法开始录音：${error.message}`);
    } finally {
      if (session === recordingSession) recordingBusy = false;
    }
  }

  async function finishRecording() {
    const session = recordingSession;
    recordingBusy = true;
    speakingPhase = "transcribing";
    clearInterval(recordInterval);
    recordingStream?.getTracks().forEach(track => track.stop());
    recordingBlob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" });
    recordingBlobDirty = true;
    const url = URL.createObjectURL(recordingBlob);
    $("#speakingPlayback").src = url;
    $("#speakingPlayback").classList.remove("hidden");
    $("#downloadRecording").classList.remove("hidden");
    $("#recordPulse").classList.remove("is-recording");
    $("#recordButton").textContent = "重新录音并转写";
    $("#recordHint").textContent = "录音已结束，正在启动本地 Whisper 转写……";
    if (session !== recordingSession) return;
    await transcribeLocalRecording(session);
    if (session === recordingSession) {
      speakingPhase = "idle";
      $("#speakingPart").disabled = false;
      updateSpeakingPartGuide();
    }
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
    $$('[data-speaking-id]', root).forEach(button => button.addEventListener("click", () => {
      const id = button.dataset.speakingId;
      if (state.speaking.find(item => item.id === id)?.review) openReviewWorkspace("speaking", id);
      else loadSpeaking(id);
    }));
    $$('[data-delete-speaking-id]', root).forEach(button => button.addEventListener("click", () => deleteSpeakingRecord(button.dataset.deleteSpeakingId)));
  }

  function resetSpeakingMedia() {
    localTranscriptionController?.abort(); localTranscriptionController = null;
    $("#cancelLocalTranscription").classList.add("hidden");
    $("#retryLocalTranscription").disabled = !localTranscriptionReady;
    $("#speakingTranscript").disabled = false;
    $("#speakingPart").disabled = false;
    recordingSession += 1;
    recordingBusy = false;
    clearInterval(recordInterval);
    clearInterval(preparationInterval);
    preparationInterval = null;
    preparationSeconds = 0;
    speakingPhase = "idle";
    if (recorder?.state === "recording") {
      recorder.onstop = null;
      try { recorder.stop(); } catch { /* recorder already stopped */ }
    }
    recordingStream?.getTracks().forEach(track => track.stop());
    recordingStream = null;
    recorder = null;
    recordingChunks = [];
    recordingBlob = null;
    recordingBlobDirty = false;
    const playback = $("#speakingPlayback");
    if (playback.src?.startsWith("blob:")) URL.revokeObjectURL(playback.src);
    playback.pause();
    playback.removeAttribute("src");
    playback.load();
    playback.classList.add("hidden");
    $("#downloadRecording").classList.add("hidden");
    $("#recordButton").disabled = !localTranscriptionReady;
    $("#recordPulse").classList.remove("is-recording");
    $("#recordPulse").classList.remove("is-preparing");
    updateSpeakingPartGuide();
  }

  async function newSpeaking(skipAutosave = false) {
    if (skipAutosave) clearTimeout(speakingAutosaveTimer); else await flushSpeakingAutosave();
    speakingAutosaveTimer = null;
    resetSpeakingMedia();
    activeSpeakingId = null;
    $("#speakingPrompt").value = "";
    $("#speakingTranscript").value = "";
    $("#speakingPart").value = "p1";
    updateSpeakingPartGuide();
    $("#speakingReview").textContent = "";
    $("#speakingReview").classList.add("hidden");
    $("#deleteSpeaking").classList.add("hidden");
    $("#speakingSaveStatus").textContent = "录音、文字稿与修改会自动保存到本机";
    recordSeconds = 0;
    $("#recordPulse span").textContent = "00:00";
    renderSpeakingHistory();
  }

  async function loadSpeaking(id) {
    await flushSpeakingAutosave();
    const item = state.speaking.find(entry => entry.id === id);
    if (!item) return;
    resetSpeakingMedia();
    activeSpeakingId = id;
    $("#speakingPrompt").value = item.prompt || "";
    $("#speakingTranscript").value = item.transcript || "";
    $("#speakingPart").value = item.part || "p1";
    updateSpeakingPartGuide();
    if (typeof item.audio === "string" && /^data:audio\/[\w.+-]+(?:;codecs=[\w.-]+)?;base64,/.test(item.audio)) {
      const [header, encoded] = item.audio.split(",");
      try {
        recordingBlob = new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], { type: header.slice(5).replace(/;base64$/, "") });
        recordingBlobDirty = false;
        $("#speakingPlayback").src = URL.createObjectURL(recordingBlob);
        $("#speakingPlayback").classList.remove("hidden");
        $("#downloadRecording").classList.remove("hidden");
        $("#recordHint").textContent = "已从本地历史恢复这次练习的录音和文字稿";
      } catch { showToast("该记录的音频无法读取，文字稿仍可使用"); }
    }
    recordSeconds = Number(item.duration || 0);
    $("#recordPulse span").textContent = formatClock(recordSeconds);
    $("#speakingReview").textContent = "";
    $("#speakingReview").classList.add("hidden");
    $("#deleteSpeaking").classList.remove("hidden");
    $("#speakingSaveStatus").textContent = `上次自动保存 ${new Date(item.updatedAt).toLocaleString()}`;
    renderSpeakingHistory();
  }

  function deleteSpeakingRecord(id) {
    if (!id || !confirm("确定删除这条口语练习及其内嵌录音吗？另行下载的副本和历史备份不受影响。")) return;
    state.speaking = state.speaking.filter(entry => entry.id !== id);
    saveState();
    if (activeSpeakingId === id) newSpeaking(true); else renderSpeakingHistory();
    showToast("口语记录已删除");
  }

  function audioBlobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("无法读取本次录音"));
      reader.readAsDataURL(blob);
    });
  }

  async function saveSpeaking({ silent = false } = {}) {
    if (recordingBusy || recorder?.state === "recording") return false;
    const session = recordingSession;
    const prompt = $("#speakingPrompt").value.trim();
    const transcript = $("#speakingTranscript").value.trim();
    if (!prompt && !transcript && !recordingBlob) return false;
    const existing = state.speaking.find(entry => entry.id === activeSpeakingId);
    try {
      if (recordingBlob?.size > 16 * 1024 * 1024) throw new Error("单次录音超过 16 MB，请先下载备份并分段录制");
      const audio = recordingBlob ? (recordingBlobDirty || !existing?.audio ? await audioBlobToDataUrl(recordingBlob) : existing.audio) : existing?.audio || "";
      if (session !== recordingSession) return false;
      const record = { id: activeSpeakingId || uid(), part: $("#speakingPart").value, prompt, transcript, audio, duration: recordSeconds, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), review: existing?.review || "", reviewInput: existing?.reviewInput || null, topicTitle: existing?.topicTitle || reviewTopicTitle(existing?.review), reviewedAt: existing?.reviewedAt || "" };
      record.punctuatedTranscript = existing?.punctuatedTranscript || "";
      record.punctuationSource = existing?.punctuationSource || "";
      const index = state.speaking.findIndex(entry => entry.id === record.id);
      if (index >= 0) state.speaking[index] = record; else state.speaking.push(record);
      activeSpeakingId = record.id;
      await saveState(true);
      recordingBlobDirty = false;
      $("#deleteSpeaking").classList.remove("hidden");
      $("#speakingSaveStatus").textContent = `已自动保存 ${new Date().toLocaleTimeString()}`;
      renderSpeakingHistory();
      if (!silent) showToast(audio ? "录音与文字稿已一起永久保存到本地" : "文字稿已永久保存到本地");
      return true;
    } catch (error) {
      $("#speakingSaveStatus").textContent = `自动保存失败：${error.message}`;
      if (!silent) showToast(`口语保存失败：${error.message}。请保留页面并重试或下载录音备份。`);
      return false;
    }
  }

  function scheduleSpeakingAutosave() {
    $("#speakingSaveStatus").textContent = "正在等待自动保存…";
    clearTimeout(speakingAutosaveTimer);
    speakingAutosaveTimer = setTimeout(() => {
      speakingAutosaveTimer = null;
      saveSpeaking({ silent: true });
    }, 700);
  }

  async function flushSpeakingAutosave() {
    if (!speakingAutosaveTimer) return true;
    clearTimeout(speakingAutosaveTimer);
    speakingAutosaveTimer = null;
    return saveSpeaking({ silent: true });
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
      if (!incoming || !Array.isArray(incoming.writings) || !Array.isArray(incoming.speaking)) throw new Error("不是有效的 EnglishLearnPath 备份");
      if (!confirm("导入备份会覆盖当前本机数据，是否继续？")) return;
      state = normalizeState(incoming);
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

  const languageText = (value, limit = 600) => String(value || "").trim().slice(0, limit);
  const languageList = (value, limit = 8) => Array.isArray(value) ? value.map(item => languageText(item, 360)).filter(Boolean).slice(0, limit) : [];

  function normalizeLanguageBank(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      summary: languageText(source.summary, 1000),
      speaking: (Array.isArray(source.speaking) ? source.speaking : []).slice(0, 30).map(item => ({
        title: languageText(item?.title, 100),
        personalCore: languageText(item?.personalCore, 800),
        reusableTopics: languageList(item?.reusableTopics, 10),
        expressions: languageList(item?.expressions, 12),
        answerFrames: languageList(item?.answerFrames, 6)
      })).filter(item => item.title && (item.personalCore || item.expressions.length)),
      writing: (Array.isArray(source.writing) ? source.writing : []).slice(0, 24).map(item => ({
        domain: languageText(item?.domain, 100),
        collocations: languageList(item?.collocations, 14),
        sentencePatterns: languageList(item?.sentencePatterns, 8)
      })).filter(item => item.domain && (item.collocations.length || item.sentencePatterns.length))
    };
  }

  function languageBankSource() {
    const newest = items => [...items].sort((a, b) => String(b.reviewedAt || b.updatedAt || "").localeCompare(String(a.reviewedAt || a.updatedAt || "")));
    const speaking = newest(state.speaking).slice(0, 40).map(item => ({
      part: SPEAKING_PARTS[item.part]?.label || item.part || "自由表达",
      question: languageText(item.prompt, 1200),
      answer: languageText(item.reviewInput?.original || item.transcript, 3000),
      feedback: languageText(item.review, 1800)
    })).filter(item => item.question || item.answer);
    const writing = newest(state.writings).slice(0, 30).map(item => ({
      type: languageText(item.type, 50),
      question: languageText(item.prompt, 1200),
      answer: languageText(item.reviewInput?.original || item.essay, 3500),
      feedback: languageText(item.review, 1800)
    })).filter(item => item.question || item.answer);
    // Keep the newest useful records while staying comfortably below the
    // launcher's request-size limit, even when both practice libraries are full.
    const serializedLength = () => JSON.stringify({ speaking, writing }).length;
    while (serializedLength() > 85000 && (speaking.length || writing.length)) {
      if (!writing.length || speaking.length >= writing.length) speaking.pop();
      else writing.pop();
    }
    return { speaking, writing };
  }

  function renderLanguageList(root, items, kind) {
    if (!items.length) {
      root.className = "language-bank-list empty-state";
      root.textContent = kind === "speaking" ? "尚无个人口语素材" : "尚无写作语料";
      return;
    }
    root.className = "language-bank-list";
    root.innerHTML = items.map(item => kind === "speaking"
      ? `<article class="language-card"><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.personalCore)}</p><div><strong>可迁移话题</strong><div class="language-tags">${item.reusableTopics.map(text => `<span>${escapeHtml(text)}</span>`).join("")}</div></div><div><strong>可复用表达</strong><ul>${item.expressions.map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul></div><div><strong>答题骨架</strong><ul>${item.answerFrames.map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul></div></article>`
      : `<article class="language-card"><h4>${escapeHtml(item.domain)}</h4><div><strong>词组与搭配</strong><ul>${item.collocations.map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul></div><div><strong>常用句式</strong><ul>${item.sentencePatterns.map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul></div></article>`).join("");
  }

  function renderLanguageBank() {
    const bank = state.languageBank ? normalizeLanguageBank(state.languageBank) : null;
    const status = $("#languageBankStatus");
    if (!bank) {
      status.innerHTML = "<div><strong>尚未生成</strong><span>完成一些口语或写作练习后，可按需汇总；系统不会每次练习都自动调用 AI。</span></div>";
      renderLanguageList($("#speakingLanguageBank"), [], "speaking");
      renderLanguageList($("#writingLanguageBank"), [], "writing");
      return;
    }
    const meta = state.languageBank;
    status.innerHTML = `<div><strong>${escapeHtml(bank.summary || "个人语料库已生成")}</strong><span>更新于 ${escapeHtml(new Date(meta.generatedAt).toLocaleString())} · 汇总 ${Number(meta.sourceCounts?.speaking || 0)} 条口语、${Number(meta.sourceCounts?.writing || 0)} 篇写作</span></div>`;
    renderLanguageList($("#speakingLanguageBank"), bank.speaking, "speaking");
    renderLanguageList($("#writingLanguageBank"), bank.writing, "writing");
  }

  async function generateLanguageBank() {
    if (!aiConnected) return routeTo("settings");
    const source = languageBankSource();
    if (!source.speaking.length && !source.writing.length) return showToast("先完成并保存至少一次口语或写作练习");
    const button = $("#generateLanguageBank");
    button.disabled = true;
    $("#languageBankStatus").innerHTML = "<div><strong>正在汇总现有与新增记录…</strong><span>只发送题目、回答和已有批改文字，不发送录音或题目图片。</span></div>";
    try {
      const response = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        messages: [
          { role: "system", content: "你是个人英语语料整理助手。只依据用户真实答题记录归纳，不补造经历、观点、身份或事实。口语优先把同一个人的经历、偏好、人物、地点、物品和观点整理成可跨陌生题目迁移的素材，同时保留自然、可说出口的英文表达和灵活答题骨架；不要生成死板整段背诵答案。写作只按领域汇总可靠的词组、搭配和通用句式。只返回一个 JSON 对象，禁止 Markdown、代码块和额外文字。结构严格为 {summary:string,speaking:[{title:string,personalCore:string,reusableTopics:string[],expressions:string[],answerFrames:string[]}],writing:[{domain:string,collocations:string[],sentencePatterns:string[]}]}。所有键必须存在，数组无内容时返回空数组。去重并优先保留高频、真实、容易复用的内容。" },
          { role: "user", content: `${reviewLearnerContext("个人语料库")}\n\n以下 JSON 是本机已保存的现有和新增练习记录（不含录音与图片）：\n${JSON.stringify(source)}` }
        ], temperature: 0.15, max_tokens: 6000, output_contract: "personal-language-bank-json-v1"
      }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "请求失败");
      const normalizedBank = normalizeLanguageBank(parseAiJson(data.content));
      if (!normalizedBank.speaking.length && !normalizedBank.writing.length) throw new Error("AI 返回的 JSON 没有可用语料，请重试或更换模型");
      state.languageBank = { ...normalizedBank, generatedAt: new Date().toISOString(), sourceCounts: { speaking: source.speaking.length, writing: source.writing.length } };
      await saveState(true);
      renderLanguageBank();
      showToast("个人语料库已更新并保存到本地");
    } catch (error) {
      $("#languageBankStatus").innerHTML = `<div><strong>语料库生成失败</strong><span>${escapeHtml(error.message)}。原有语料库不会被覆盖。</span></div>`;
    } finally {
      button.disabled = !aiConnected;
    }
  }

  function renderAll() {
    renderMetrics();
    renderWritingHistory();
    renderSpeakingHistory();
    renderStudyPlan();
    renderTodayPlan();
    renderMistakes();
    renderLanguageBank();
  }

  function bindEvents() {
    $("#sidebarCollapse").addEventListener("click", () => setSidebarCollapsed(!$(".app-shell").classList.contains("is-sidebar-collapsed")));
    $("#writingFocusMode").addEventListener("click", () => setPracticeFocus(true));
    $("#speakingFocusMode").addEventListener("click", () => setPracticeFocus(true));
    $("#exitFocusMode").addEventListener("click", () => setPracticeFocus(false));
    $("#cancelLocalTranscription").addEventListener("click", () => localTranscriptionController?.abort());
    $("#retryLocalTranscription").addEventListener("click", () => {
      if (recordingBusy || recorder?.state === "recording") return;
      if ($("#speakingTranscript").value.trim() && !confirm("重新转写会替换编辑区文字。已保存的批改快照不变，是否继续？")) return;
      transcribeLocalRecording();
    });
    $("#openWritingReview").addEventListener("click", () => openReviewWorkspace("writing"));
    $("#openSpeakingReview").addEventListener("click", () => openReviewWorkspace("speaking"));
    $("#closeReviewWorkspace").addEventListener("click", () => routeTo(reviewWorkspaceSelection?.module || "writing"));
    $("#editReviewSource").addEventListener("click", async () => {
      const { module, id } = reviewWorkspaceSelection || {};
      if (!id) return;
      const hasDraft = module === "writing" ? $("#writingEssay").value.trim() || $("#writingPrompt").value.trim() : $("#speakingTranscript").value.trim() || recordingBlob;
      if (hasDraft && !confirm("打开这条记录会替换当前编辑区。请确认当前草稿已保存，是否继续？")) return;
      if (module === "writing") await loadWriting(id); else await loadSpeaking(id);
      routeTo(module);
    });
    $("#generatePunctuation").addEventListener("click", generatePunctuation);
    $$('[data-route]').forEach(item => item.addEventListener("click", event => {
      if (item.tagName === "A") event.preventDefault();
      routeTo(item.dataset.route);
    }));
    $("#heroPrimaryAction").addEventListener("click", startHeroPrimaryAction);
    $("#menuButton").addEventListener("click", () => $(".sidebar").classList.toggle("is-open"));
    $("#exitApp").addEventListener("click", async () => {
      if (!confirm("确定退出 English Learning Path 吗？已保存的本地记录不会丢失。")) return;
      try {
        await Promise.all([flushWritingAutosave(), flushSpeakingAutosave()]);
        await fetch("/api/app/shutdown", { method: "POST" });
        document.body.innerHTML = '<main style="max-width:680px;margin:15vh auto;padding:40px;font-family:Segoe UI,sans-serif;color:#18332d"><h1>English Learning Path 已退出</h1><p>现在可以关闭这个浏览器标签页。</p></main>';
      } catch {
        showToast("当前不是通过便携启动器运行，无需退出服务");
      }
    });
    $("#newWriting").addEventListener("click", () => newWriting());
    $("#deleteWriting").addEventListener("click", () => deleteWritingRecord(activeWritingId));
    $("#writingEssay").addEventListener("input", updateWordCount);
    $("#writingPrompt").addEventListener("input", scheduleWritingAutosave);
    $("#writingPromptImageInput").addEventListener("change", event => {
      const input = event.target;
      queueWritingPromptImages(input.files).finally(() => { input.value = ""; });
    });
    $("#writingPrompt").addEventListener("paste", event => {
      const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === "file" && item.type.startsWith("image/")).map(item => item.getAsFile()).filter(Boolean);
      if (files.length) queueWritingPromptImages(files);
    });
    $("#writingMinutes").addEventListener("change", () => { resetWritingTimer(); scheduleWritingAutosave(); });
    $("#writingType").addEventListener("change", () => {
      const type = $("#writingType").value;
      if (type.startsWith("Task 1")) $("#writingMinutes").value = "20";
      else if (type === "Task 2") $("#writingMinutes").value = "40";
      else if (type === "自由写作") $("#writingMinutes").value = "0";
      resetWritingTimer();
      scheduleWritingAutosave();
    });
    $("#toggleTimer").addEventListener("click", toggleWritingTimer);
    $("#reviewWriting").addEventListener("click", reviewWriting);
    $("#addWritingMistake").addEventListener("click", () => openMistakeComposer("writing", `写作复盘 · ${$("#writingType").value}`, `题目：${$("#writingPrompt").value.trim() || "未填写"}\n\n确定语法错误：\n可选优化建议：\n可复用语料：\n重写后的变化：`, activeWritingId ? { module: "writing", id: activeWritingId } : null));
    $("#recordButton").addEventListener("click", toggleRecording);
    $("#downloadRecording").addEventListener("click", () => recordingBlob && downloadBlob(recordingBlob, `EnglishLearnPath-speaking-${Date.now()}.webm`));
    $("#speechLanguage").addEventListener("change", () => { state.preferences.speechLanguage = $("#speechLanguage").value; saveState(); });
    $("#newSpeaking").addEventListener("click", () => newSpeaking());
    $("#speakingPrompt").addEventListener("input", scheduleSpeakingAutosave);
    $("#speakingTranscript").addEventListener("input", scheduleSpeakingAutosave);
    $("#speakingPart").addEventListener("change", () => {
      if (speakingPhase !== "idle") return showToast("请先结束当前准备或录音，再切换题型");
      updateSpeakingPartGuide();
      scheduleSpeakingAutosave();
    });
    $("#deleteSpeaking").addEventListener("click", () => deleteSpeakingRecord(activeSpeakingId));
    $("#reviewSpeaking").addEventListener("click", reviewSpeaking);
    $("#addSpeakingMistake").addEventListener("click", () => openMistakeComposer("speaking", `口语复盘 · ${$("#speakingPrompt").value.trim() || "自由表达"}`, `文字稿：${$("#speakingTranscript").value.trim() || "未填写"}\n\n回听与转写核对：\n确定问题：\n可复用表达：\n重说后的变化：`, activeSpeakingId ? { module: "speaking", id: activeSpeakingId } : null));
    $("#generateLanguageBank").addEventListener("click", generateLanguageBank);
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
    $$('[data-mistake-module]').forEach(button => button.addEventListener("click", () => selectMistakeModule(button.dataset.mistakeModule)));
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
      activeWritingId = activeSpeakingId = null;
      try {
        await saveState();
        renderAll(); newWriting(true); newSpeaking(true); showToast("永久数据文件已清空，滚动备份已保留");
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
    await refreshAiStatus();
    await refreshTranscriptionStatus();
    routeTo(location.hash.slice(1) || "home");
  }

  initialize();
})();
