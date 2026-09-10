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
  let writingHistoryFilter = "all";
  let speakingHistoryFilter = "all";
  let reviewWorkspaceSelection = null;
  let reviewWorkspaceAudioUrl = null;
  let mistakeFilter = "all";
  let vocabularySession = null;
  let vocabularySaving = false;
  let correctionSession = null;
  let correctionSaving = false;
  const correctionSaveJobs = new Map();
  let pendingMistakeImages = [];
  let pendingMistakeRelated = null;
  let pendingMistakeImageJob = Promise.resolve();
  let pendingWritingPromptImages = [];
  let pendingWritingPromptImageJob = Promise.resolve();
  let writingPromptImageSession = 0;
  let todayTaskActions = new Map();
  let aiConnected = false;
  let timerInterval = null;
  let writingTimerPaused = false;
  let timerSeconds = 40 * 60;
  let writingScreenMode = "overview";
  let speakingScreenMode = "overview";
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
  let languageBankTab = "speaking";
  const languageBankSelection = { speaking: 0, writing: 0 };
  let toastTimer = null;

  const SPEAKING_PARTS = {
    p1: { label: "Part 1", title: "简短问答", guide: "直接回答问题，再补充一个理由或细节。单题通常回答 20–30 秒，不需要准备时间。", preparation: 0, answerLimit: 0 },
    p2: { label: "Part 2", title: "个人陈述", guide: "先准备 1 分钟，再连续回答最多 2 分钟。准备阶段不会被录音，倒计时结束后自动开始。", preparation: 60, answerLimit: 120 },
    p3: { label: "Part 3", title: "深入讨论", guide: "先直接表明观点，再说明原因，并用例子、对比或影响展开。通常每题回答 40–60 秒。", preparation: 0, answerLimit: 0 },
    free: { label: "自由表达", title: "自由练习", guide: "按自己的节奏组织答案；录音结束后会自动转写并保存。", preparation: 0, answerLimit: 0 }
  };

  const IELTS_WRITING_SCORING_GUIDE = `评分必须依据 IELTS 官方公开 Writing Band Descriptors（Task 1 使用 Task Achievement；Task 2 使用 Task Response；两者都使用 Coherence & Cohesion、Lexical Resource、Grammatical Range & Accuracy），不得凭“感觉不错”笼统给分。
四项分别独立判断，分数只用 0.5 递进。只有原稿充分符合某一整数档的正向特征时才给到该档；介于相邻档时给半分。单篇暂定总分取四项平均并按 0.5 档呈现，不把用户目标分当作评分依据。
分档校准：5 分通常是任务覆盖或观点发展不充分、组织不完全顺畅、词汇和结构范围有限且错误可能影响阅读；6 分能回应主要要求并有总体连贯性，词汇基本够用，能混用简单和复杂结构，错误存在但通常不妨碍理解；7 分覆盖任务要求，Task 1 有清楚 Overview 和恰当分组或 Task 2 有清晰且有发展的立场，逻辑推进明确，词汇有一定灵活与准确度，复杂结构有变化且无错句较常见；8 分回应充分且发展良好，信息易于跟随，词汇宽广而精确，多数句子无错；9 分只用于完全、深入、自然且几乎无失误的作答。不得仅因使用生僻词或长句抬高 LR/GRA。
字数不足没有独立的固定扣分值：只在它实际导致任务覆盖、展开或语言证据不足时反映到对应项目，并在证据中明确指出。`;

  const IELTS_SPEAKING_SCORING_GUIDE = `评分必须依据 IELTS 官方公开 Speaking Band Descriptors：Fluency & Coherence、Lexical Resource、Grammatical Range & Accuracy、Pronunciation。分数只用 0.5 递进；只有回答充分符合某整数档的正向特征时才给到该档，介于相邻档时给半分。
分档校准：5 分通常能继续表达但依赖重复、自我修正或慢速，词汇灵活度有限，复杂结构范围有限且错误多；6 分愿意并能够作较长表达，偶有停顿、重复或自我修正导致连贯受损，词汇足以展开并通常能改述，简单和复杂结构混用且错误通常不妨碍交流；7 分能较自然地持续表达，少量犹豫不破坏连贯，能灵活讨论多种话题并有效改述，复杂结构较灵活且无错句较常见；8 分表达流畅，重复或自我修正很少，话题展开连贯，词汇宽广灵活且含义精确，结构广泛并且多数句子无错；9 分只用于全程自然、精确、灵活且几乎无失误的表现。
官方口语分数依据三个 Part 的整体表现。当前只有一条文字转写，因此只能给非官方、基于转写的暂定估分；没有音频绝不能臆测 Pronunciation，也不能把 ASR 标点和大小写当作错误。`;

  function writingTaskAssessment(type) {
    if (type === "Task 1 Academic") return "Task 1 Academic：建议 20 分钟，至少 150 个英文词。重点核对是否准确选择并突出关键特征，是否有清楚 Overview，是否合理分组并用题目中的数据、单位和比较支持描述；不得要求个人观点或结论。";
    if (type === "Task 1 General") return "Task 1 General Training：建议 20 分钟，至少 150 个英文词。重点核对写信目的是否清楚、所有 bullet points 是否覆盖并展开、格式与语气是否符合收件人和情境。";
    if (type === "Task 2") return "Task 2：建议 40 分钟，至少 250 个英文词；正式考试中权重为 Task 1 的两倍。重点核对是否回答题目所有部分、立场是否清晰且贯穿全文、主要观点是否充分解释并用相关例子或结果支持。";
    return "自由写作：不套用 Task 1 或 Task 2 的字数和任务完成要求；如需给分，只能按语言、组织和用户明确目的谨慎评价。";
  }

  function speakingPartAssessment(part, duration) {
    const durationText = Number(duration) > 0 ? `本次录音 ${Number(duration)} 秒。` : "本次录音时长未记录，不能判断是否达到时长要求。";
    if (part === "p1") return `Part 1：正式环节约 4–5 分钟并包含多个熟悉话题；当前按单题练习评价。检查是否直接回答日常或个人问题并自然补充理由或细节，不因答案不够长篇而扣分。${durationText}`;
    if (part === "p2") return `Part 2：1 分钟准备后进行 1–2 分钟个人长陈述。逐项核对题卡提示，检查能否持续展开、按逻辑组织并在接近 2 分钟内完成；少于 60 秒必须明确提示展开不足，超过 120 秒提示正式考试会被考官叫停。${durationText}`;
    if (part === "p3") return `Part 3：正式环节约 4–5 分钟，围绕 Part 2 相关的更一般、抽象问题深入讨论。当前按单题练习评价，检查是否解释和论证观点，并能分析、比较、推测或讨论影响。${durationText}`;
    return `自由表达：不套用 Part 1、2、3 的任务时长，只按表达目的和可观察到的语言证据谨慎反馈。${durationText}`;
  }

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
    $("#recordPhaseLabel").textContent = "等待开始";
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
    if (target !== "writing") setPracticeFocus(false);
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
      note: typeof value.note === "string" ? value.note.slice(0, 240) : ""
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
      const payload = {
        messages: [
          { role: "system", content: "你是写作与口语学习规划师。只规划写作、口语及相关错题、词汇和语料复盘，不安排其他科目或外部题库任务。计划会分层展示：首页只汇总当天写作与口语是否完成；写作页和口语页分别展示各自细则。因此任务说明必须简短、可直接执行，不要把两个模块混成一个长段落。只输出一个 JSON 对象，不要 Markdown。结构必须为 {summary:string, priorities:string[], phases:[阶段项]}。summary 不超过 120 个汉字，priorities 最多 4 条。phases 数量和顺序必须与用户提供的阶段窗口完全一致。每个阶段项只含 name、focus、days；days 必须是周一到周日顺序的 7 项数组，每项必须含 writing、speaking、writingReview、writingRewrite、speakingReview、languageMinutes、reviewMinutes 七个非负整数和 note 字符串，note 不超过 50 个汉字。writing 每天只能为 0 或 1，speaking 每天最多 2；writingReview、writingRewrite、speakingReview 每项最多 1。至少 40% 的可用时间安排给复盘、重写或重说、语料记忆和错题回收，并安排轻量日或休息日。写作闭环是完成写作、核对批改、记录确定语法错误与可复用表达、重写、对照检查；口语闭环是录音转写、回听校对、核对批改、整理表达、重说同题。整体计划覆盖全部阶段直到考试日，任务量必须符合每日可用时间。不要虚构用户没有提供的诊断。" },
          { role: "user", content: `今天：${today()}\n预计考试日期：${profile.examDate}\n计划总天数：${totalDays}\n现有水平：${profile.currentLevel}\n目标水平：${profile.targetLevel}\n每日时间：${profile.dailyMinutes} 分钟\n重点与限制：${profile.focus || "未补充"}\n固定阶段窗口：${JSON.stringify(blueprints)}\n请为每个阶段安排不同的训练重点和周一至周日执行节奏。` }
        ],
        temperature: 0,
        max_tokens: 3500,
        output_contract: "study-plan-json-v1"
      };
      let parsed, phases;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          let response;
          try {
            response = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          } catch (error) {
            error.retryableAiFailure = true;
            throw error;
          }
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            const failure = new Error(data.error || `AI 计划生成失败（HTTP ${response.status}）`);
            const authFailure = /(?:API\s*Key|鉴权|认证|未授权|unauthori[sz]ed|forbidden|余额|quota)/i.test(failure.message);
            failure.retryableAiFailure = !authFailure && [408, 425, 429, 500, 502, 503, 504].includes(response.status);
            throw failure;
          }
          parsed = parseAiJson(data.content);
          if (!Array.isArray(parsed.phases) || parsed.phases.length !== blueprints.length) throw new Error("AI 返回的阶段数量与考试日期安排不一致");
          phases = blueprints.map((blueprint, index) => {
            const generated = parsed.phases[index] || {};
            if (!Array.isArray(generated.days) || generated.days.length !== 7) throw new Error(`AI 返回的“${blueprint.name}”阶段没有完整七天执行节奏`);
            const requiredDayFields = ["writing", "speaking", "writingReview", "writingRewrite", "speakingReview", "languageMinutes", "reviewMinutes", "note"];
            if (generated.days.some(day => !day || typeof day !== "object" || Array.isArray(day) || requiredDayFields.some(field => !Object.hasOwn(day, field)))) throw new Error(`AI 返回的“${blueprint.name}”阶段缺少每日必需字段`);
            return {
              ...blueprint,
              name: typeof generated.name === "string" ? generated.name.slice(0, 80) : blueprint.name,
              focus: typeof generated.focus === "string" ? generated.focus.slice(0, 600) : blueprint.focus,
              days: generated.days.map(normalizeAiPlanDay)
            };
          });
          break;
        } catch (error) {
          const formatFailure = /(?:JSON|格式|字段|数组|阶段|七天|执行节奏|网页报告)/i.test(error.message);
          if (attempt || (!formatFailure && !error.retryableAiFailure)) throw error;
          result.textContent = formatFailure ? "AI 首次返回的计划结构不完整，正在自动重试一次……" : "AI 服务首次响应不稳定，正在自动重试一次……";
          if (!formatFailure) await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      state.studyPlan = {
        source: "ai",
        createdAt: new Date().toISOString(),
        profile,
        summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.slice(0, 1200) : `AI 已生成从今天到 ${profile.examDate} 的考前计划`,
        priorities: Array.isArray(parsed.priorities) ? parsed.priorities.filter(item => typeof item === "string" && item.trim()).map(item => item.slice(0, 240)).slice(0, 8) : [],
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
    if (plan.source === "manual") {
      const day = normalizePlanDay(phases[0]?.days?.[0]);
      const details = [
        `新写作 ${day.writing} 篇`, `新口语 ${day.speaking} 次`, `写作精改 ${day.writingReview} 次`, `重写 ${day.writingRewrite} 篇`,
        `口语回听 ${day.speakingReview} 次`, `语料记忆 ${day.languageMinutes} 分钟`, `错题与单词 ${day.reviewMinutes} 分钟`
      ];
      phasePlan.innerHTML = `<article class="plan-phase manual-plan-summary"><header><div><strong>每天按你的设置执行</strong><span>${escapeHtml(phases[0].startDate)} — ${escapeHtml(phases[0].endDate)}</span></div><p>以下数量完全来自手动设置；写作页和口语页会分别显示当天细则。</p></header><div class="manual-plan-values">${details.map(text => `<span>${escapeHtml(text)}</span>`).join("")}</div></article>`;
    } else {
      phasePlan.innerHTML = phases.map(phase => `<article class="plan-phase"><header><div><strong>${escapeHtml(phase.name)}</strong><span>${escapeHtml(phase.startDate)} — ${escapeHtml(phase.endDate)} · ${planDaysInclusive(phase.startDate, phase.endDate)} 天</span></div><p>${escapeHtml(phase.focus || "按阶段目标稳定执行并及时复盘。")}</p></header><small class="plan-detail-location">每日写作与口语细则分别显示在对应模块首页。</small></article>`).join("");
    }
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
    const summaryRoot = $("#todayPlanSummary");
    const details = $("#todayPlanDetails");
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
      summaryRoot.className = "today-plan-summary empty-state";
      summaryRoot.textContent = root.textContent;
      details.classList.add("hidden");
      details.open = false;
      meta.textContent = plan ? `${target?.phaseName || "当前阶段"} · 今日没有设置固定数量。` : "配置考试目标后，这里会生成可执行任务。";
      renderPracticeOverviewPlans();
      return;
    }
    const daysLeft = Math.max(0, planDaysInclusive(today(), plan.profile.examDate) - 1);
    const done = tasks.filter(task => progress[task.id]).length;
    meta.textContent = `距预计考试 ${daysLeft} 天 · ${target?.phaseName || "当前阶段"} · 今日${done === tasks.length ? "全部完成" : `${done}/${tasks.length} 已完成`}`;
    const moduleSummary = (label, kinds) => {
      const moduleTasks = tasks.filter(task => kinds.includes(task.kind));
      const moduleDone = moduleTasks.filter(task => progress[task.id]).length;
      const status = !moduleTasks.length ? "今日未安排" : moduleDone === moduleTasks.length ? "今日已完成" : `待完成 ${moduleTasks.length - moduleDone} 项`;
      return `<article class="today-module-summary ${moduleTasks.length && moduleDone === moduleTasks.length ? "is-complete" : ""}"><div><span>${escapeHtml(label)}</span><strong>${moduleDone}/${moduleTasks.length}</strong></div><small>${escapeHtml(status)}</small></article>`;
    };
    summaryRoot.className = "today-plan-summary";
    summaryRoot.innerHTML = moduleSummary("写作任务", ["writing", "writing-review", "writing-rewrite"]) + moduleSummary("口语任务", ["speaking", "speaking-review"]);
    details.classList.remove("hidden");
    root.className = "today-task-list";
    root.innerHTML = tasks.map(task => `<article class="today-task ${progress[task.id] ? "is-done" : ""}"><input type="checkbox" data-plan-check="${task.id}" ${progress[task.id] ? "checked" : ""} aria-label="标记完成"><div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.detail)}</small></div><button class="button button-secondary" data-plan-start="${task.id}">开始</button></article>`).join("");
    $$('[data-plan-check]', root).forEach(box => box.addEventListener("change", () => {
      state.planProgress[today()] ||= {};
      state.planProgress[today()][box.dataset.planCheck] = box.checked;
      saveState(box.checked);
      renderTodayPlan();
    }));
    $$('[data-plan-start]', root).forEach(button => button.addEventListener("click", () => startTodayTask(button.dataset.planStart)));
    renderPracticeOverviewPlans();
  }

  function renderPracticeOverviewPlans() {
    const tasks = todayPlanTasks();
    const progress = state.planProgress[today()] || {};
    const target = planDayForDate(state.studyPlan, today());
    const render = (selector, kinds, fallback) => {
      const root = $(selector);
      if (!root) return;
      const selected = tasks.filter(task => kinds.includes(task.kind));
      if (!selected.length) {
        root.className = "overview-plan-list empty-state";
        root.innerHTML = `<p>${escapeHtml(state.studyPlan ? fallback : "尚未创建学习计划，可先自由练习或前往学习计划设置。")}</p>`;
        return;
      }
      root.className = "overview-plan-list";
      root.innerHTML = `${target?.phaseName ? `<p class="overview-phase-note"><strong>${escapeHtml(target.phaseName)}</strong>${escapeHtml(target.note || "按今天的数量完成练习，并为复盘留出时间。")}</p>` : ""}${selected.map(task => `<label class="overview-plan-item ${progress[task.id] ? "is-complete" : ""}"><input type="checkbox" data-overview-plan-check="${escapeHtml(task.id)}" ${progress[task.id] ? "checked" : ""}><div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.detail)}</small></div></label>`).join("")}`;
      $$('[data-overview-plan-check]', root).forEach(box => box.addEventListener("change", () => {
        state.planProgress[today()] ||= {};
        state.planProgress[today()][box.dataset.overviewPlanCheck] = box.checked;
        saveState(box.checked);
        renderTodayPlan();
      }));
    };
    render("#writingOverviewPlan", ["writing", "writing-review", "writing-rewrite"], "今天没有安排写作任务；可复盘旧作文或休息。");
    render("#speakingOverviewPlan", ["speaking", "speaking-review"], "今天没有安排口语任务；可回听旧录音或自由热身。");
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
    bindNotebookImageZoom(root);
    $$('[data-remove-mistake-image]', root).forEach(button => button.addEventListener("click", () => {
      pendingMistakeImages.splice(Number(button.dataset.removeMistakeImage), 1);
      renderMistakeImagePreview();
    }));
  }

  function bindNotebookImageZoom(root) {
    $$("img", root).forEach(image => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "review-image-preview notebook-image-preview";
      button.setAttribute("aria-label", `放大查看${image.alt}`);
      const zoom = document.createElement("span");
      zoom.className = "review-image-zoom-icon";
      zoom.setAttribute("aria-hidden", "true");
      zoom.textContent = "＋";
      image.replaceWith(button);
      button.append(image, zoom);
      button.addEventListener("click", () => openReviewImageLightbox(image.src, image.alt));
    });
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
      renderNotebookPractice();
      return;
    }
    root.className = "mistake-list";
    root.innerHTML = items.map(item => {
      const safeImages = notebookImages(item);
      return `<article class="mistake-entry"><header><div><span class="mistake-module">${moduleNames[item.module] || "复盘"}</span><h4>${escapeHtml(item.title || "未命名记录")}</h4><small>${escapeHtml(new Date(item.createdAt).toLocaleString())}</small></div><button class="button button-danger-quiet" data-delete-mistake="${escapeHtml(item.id)}">删除</button></header>${item.text ? `<p>${escapeHtml(item.text)}</p>` : ""}${safeImages.length ? `<div class="mistake-images">${safeImages.map((src, index) => `<img src="${src}" alt="错题图片 ${index + 1}">`).join("")}</div>` : ""}${item.related ? `<div class="button-row"><button class="button button-secondary" data-jump-mistake="${escapeHtml(item.id)}">返回相关练习</button></div>` : ""}</article>`;
    }).join("");
    bindNotebookImageZoom(root);
    items.forEach((item, index) => { if (isCorrectionNote(item)) renderCorrectionNote(item, root.children[index]); });
    $$('[data-delete-mistake]', root).forEach(button => button.addEventListener("click", () => {
      if (!confirm("确定删除这条错题/复盘记录吗？")) return;
      state.mistakes = state.mistakes.filter(item => item.id !== button.dataset.deleteMistake);
      saveState();
      renderMistakes();
    }));
    $$('[data-jump-mistake]', root).forEach(button => button.addEventListener("click", () => jumpToMistake(button.dataset.jumpMistake)));
    renderNotebookPractice();
  }

  function jumpToMistake(id) {
    const note = state.mistakes.find(item => item.id === id);
    const related = note?.related;
    if (!related) return;
    if (isCorrectionNote(note)) {
      const source = (related.module === "writing" ? state.writings : state.speaking).find(item => item.id === related.id);
      if (!source?.review) return showToast("原批改记录已不存在，已收藏的错句仍可复习");
      return openReviewWorkspace(related.module, related.id);
    }
    routeTo(related.module);
    if (related.module === "writing" && related.id) loadWriting(related.id);
    else if (related.module === "speaking" && related.id) loadSpeaking(related.id);
  }

  function vocabularyWords() {
    return state.mistakes.filter(item => item?.module === "vocabulary" && typeof item.title === "string" && item.title.trim() && item.title !== "未命名单词" &&
      ((typeof item.text === "string" && item.text.trim()) || notebookImages(item).length));
  }

  function notebookImages(item) {
    return (Array.isArray(item.images) ? item.images : []).filter(src => typeof src === "string" && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src));
  }

  function correctionKey(module, id, correction) {
    return JSON.stringify([module, id, correction.original, correction.corrected]);
  }

  function isCorrectionNote(item) {
    const value = item?.correction;
    return item?.kind === "correction" && ["writing", "speaking"].includes(item.module) && value &&
      typeof value.original === "string" && value.original.trim() && typeof value.corrected === "string" && value.corrected.trim() && value.original !== value.corrected;
  }

  function saveReviewCorrection(module, source, correction) {
    const key = correctionKey(module, source.id, correction);
    if (correctionSaveJobs.has(key)) return correctionSaveJobs.get(key);
    if (state.mistakes.some(item => item.correctionKey === key)) return Promise.resolve();
    const note = { id: uid(), module, kind: "correction", title: correction.original, text: "", images: [],
      correction: { original: correction.original, corrected: correction.corrected, type: correction.type, explanation: correction.explanation },
      correctionKey: key, related: { module, id: source.id }, sourceTitle: practiceTitle(source), createdAt: new Date().toISOString() };
    const job = (async () => {
      state.mistakes.push(note);
      try {
        await saveState(true);
        renderMistakes();
        showToast("已将这条错句加入错题本");
      } catch (error) {
        state.mistakes = state.mistakes.filter(item => item.id !== note.id);
        throw error;
      } finally { correctionSaveJobs.delete(key); }
    })();
    correctionSaveJobs.set(key, job);
    return job;
  }

  function renderCorrectionNote(item, article) {
    article.classList.add("correction-note");
    const headingBlock = article.querySelector("header > div");
    headingBlock.querySelector("small")?.remove();
    const status = document.createElement("span");
    status.className = "note-due";
    status.textContent = item.correctionReview?.dueDate ? `复习 ${item.correctionReview.dueDate.slice(5).replace('-', '/')}` : "待复习";
    const meta = document.createElement("div"); meta.className = "note-meta";
    meta.append(headingBlock.querySelector(".mistake-module"), status);
    headingBlock.prepend(meta);
    const reference = document.createElement("div"); reference.className = "note-reference hidden";
    reference.id = `note-reference-${item.id}`;
    const toggle = document.createElement("button");
    toggle.type = "button"; toggle.className = "button button-quiet note-reference-toggle";
    toggle.textContent = "查看解析";
    toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", reference.id);
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") !== "true";
      reference.classList.toggle("hidden", !expanded);
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.textContent = expanded ? "收起解析" : "查看解析";
    });
    const answer = document.createElement("p"); answer.textContent = item.correction.corrected;
    answer.className = "note-reference-answer";
    const reason = document.createElement("p"); reason.textContent = item.correction.explanation || "这条批改未提供原因。";
    reference.append(answer, reason);
    const practice = document.createElement("button");
    practice.type = "button";
    practice.className = "button button-secondary note-practice";
    practice.dataset.practiceCorrection = item.id;
    practice.textContent = "练习";
    practice.setAttribute("aria-label", `练习纠错：${item.correction.original}`);
    practice.addEventListener("click", () => startCorrectionStudy(item.id));
    const actions = document.createElement("div"); actions.className = "note-actions";
    actions.append(toggle);
    const source = article.querySelector('[data-jump-mistake]');
    if (source) {
      const oldRow = source.parentElement;
      source.className = "button button-quiet"; source.textContent = "原批改";
      actions.append(source); oldRow.remove();
    }
    actions.append(practice);
    article.append(actions, reference);
  }

  function correctionNotes() {
    return state.mistakes.filter(item => isCorrectionNote(item) && (mistakeFilter === "all" || mistakeFilter === item.module));
  }

  function correctionDue(item) {
    const date = item.correctionReview?.dueDate;
    return typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= today();
  }

  function renderNotebookPractice() {
    renderVocabularyStudy();
    renderCorrectionStudy();
  }

  function renderCorrectionStudy() {
    const root = $("#correctionStudy");
    if (!root) return;
    root.classList.toggle("hidden", mistakeFilter === "vocabulary");
    if (mistakeFilter === "vocabulary") return;
    const notes = correctionNotes();
    const session = correctionSession?.filter === mistakeFilter ? correctionSession : null;
    if (session) session.queue = session.queue.filter(id => notes.some(item => item.id === id));
    const item = session && notes.find(item => item.id === session.queue[0]);
    const active = Boolean(item);
    root.classList.toggle("is-practicing", active);
    $("#mistakeList").classList.toggle("hidden", active);
    const dueCount = notes.filter(correctionDue).length;
    $("#correctionStudySummary").textContent = active ? "纠错练习" : session ? `本轮已完成 ${session.completed} 条` : dueCount ? `待复习 ${dueCount} 条 · 共 ${notes.length} 条` : notes.length ? `今日已完成 · 共 ${notes.length} 条` : "错句复习";
    $("#startCorrectionStudy").classList.toggle("hidden", active || !dueCount);
    $("#startCorrectionStudy").disabled = correctionSaving || !notes.some(correctionDue);
    $("#stopCorrectionStudy").classList.toggle("hidden", !active);
    $("#stopCorrectionStudy").disabled = correctionSaving;
    $("#correctionStudyCard").classList.toggle("hidden", !active);
    $("#correctionStudyStatus").textContent = session?.error || (!notes.length ? "在批改页收藏错句，即可开始复习。" : "");
    if (!active) return;
    $("#correctionStudyProgress").textContent = `本轮已完成 ${session.completed} 条 · 剩余 ${session.queue.length} 条`;
    $("#correctionStudySource").textContent = `${moduleNames[item.module]} · ${item.sourceTitle || "已收藏的错句"}`;
    $("#correctionStudyOriginal").textContent = item.correction.original;
    $("#correctionStudyAttempt").value = session.draft;
    $("#correctionStudyAttempt").readOnly = session.revealed || correctionSaving;
    $("#revealCorrectionAnswer").classList.toggle("hidden", session.revealed);
    $("#correctionStudyAnswer").classList.toggle("hidden", !session.revealed);
    $("#correctionStudyReference").textContent = session.revealed ? item.correction.corrected : "";
    $("#correctionStudyReason").textContent = session.revealed ? item.correction.explanation || "这条批改未提供原因。" : "";
    $("#correctionStudyRating").classList.toggle("hidden", !session.revealed);
    $$('[data-correction-rating]').forEach(button => { button.disabled = correctionSaving; });
  }

  function startCorrectionStudy(id) {
    if (correctionSaving) return;
    const notes = correctionNotes();
    const queue = id ? notes.filter(item => item.id === id) : notes.filter(correctionDue).sort((a, b) => String(a.correctionReview?.dueDate || "9999").localeCompare(String(b.correctionReview?.dueDate || "9999"))).slice(0, 20);
    if (!queue.length) return;
    correctionSession = { filter: mistakeFilter, queue: queue.map(item => item.id), completed: 0, draft: "", revealed: false, error: "" };
    renderCorrectionStudy();
    $("#correctionStudyAttempt").focus();
  }

  async function rateCorrection(performance) {
    const session = correctionSession;
    if (correctionSaving || !session?.revealed || !["again", "hard", "good"].includes(performance)) return;
    const item = state.mistakes.find(item => item.id === session.queue[0] && isCorrectionNote(item));
    if (!item) return renderCorrectionStudy();
    correctionSaving = true;
    session.error = "";
    const previous = item.correctionReview;
    const oldLevel = Number.isInteger(previous?.level) ? Math.max(0, Math.min(5, previous.level)) : 0;
    const level = performance === "good" ? Math.min(5, oldLevel + 1) : 0;
    const days = performance === "good" ? [1, 3, 7, 14, 30][level - 1] : performance === "hard" ? 1 : 0;
    const next = new Date(`${today()}T12:00:00`);
    next.setDate(next.getDate() + days);
    const dueDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    item.correctionReview = { level, dueDate, lastReviewedDate: today(), performance, lastAttempt: session.draft, reviewedAt: new Date().toISOString() };
    renderCorrectionStudy();
    try {
      await saveState(true);
      session.queue.shift();
      if (performance === "again") session.queue.push(item.id);
      else session.completed += 1;
      session.draft = "";
      session.revealed = false;
    } catch {
      if (previous === undefined) delete item.correctionReview;
      else item.correctionReview = previous;
      session.error = "复习进度保存失败，当前作答已保留，请检查本地数据服务后重试。";
    } finally {
      correctionSaving = false;
      renderMistakes();
    }
    if (!session.error && session.queue.length && mistakeFilter === session.filter) $("#correctionStudyAttempt").focus();
  }

  function vocabularyDue(item) {
    const due = item.vocabularyReview?.dueDate;
    return typeof due !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(due) || due <= today();
  }

  function renderVocabularyStudy() {
    const root = $("#vocabularyStudy");
    if (!root) return;
    root.classList.toggle("hidden", mistakeFilter !== "vocabulary");
    // Keep the study controls before the notebook so saved answers cannot spoil recall.
    const list = $("#mistakeList");
    list.before?.(root);
    const words = vocabularyWords();
    const due = words.filter(vocabularyDue);
    const reviewed = words.filter(item => item.vocabularyReview?.lastReviewedDate === today()).length;
    $("#vocabularyStudySummary").textContent = `待背 ${due.length} 个 · 今日已练 ${reviewed} 个`;
    if (vocabularySession) vocabularySession.queue = vocabularySession.queue.filter(id => words.some(item => item.id === id));
    const item = vocabularySession && words.find(word => word.id === vocabularySession.queue[0]);
    const active = Boolean(item);
    list.classList.toggle("hidden", mistakeFilter === "vocabulary" && active);
    $("#startVocabularyStudy").classList.toggle("hidden", active || !due.length);
    $("#startVocabularyStudy").disabled = !due.length || vocabularySaving;
    $("#stopVocabularyStudy").classList.toggle("hidden", !active);
    $("#stopVocabularyStudy").disabled = vocabularySaving;
    $("#vocabularyStudyCard").classList.toggle("hidden", !active);
    if (!active) {
      $("#vocabularyStudyStatus").textContent = vocabularySession ? `本轮完成，已记住 ${vocabularySession.completed} 个单词。` : words.length ? "" : "添加单词和释义后即可开始背词。";
      return;
    }
    $("#vocabularyStudyStatus").textContent = "";
    $("#vocabularyStudyProgress").textContent = `已记住 ${vocabularySession.completed} 个 · 本轮还剩 ${vocabularySession.queue.length} 个`;
    $("#vocabularyStudyWord").textContent = item.title;
    const answer = $("#vocabularyStudyAnswer");
    answer.replaceChildren();
    if (typeof item.text === "string" && item.text.trim()) {
      const text = document.createElement("p");
      text.textContent = item.text;
      answer.append(text);
    }
    const images = document.createElement("div");
    images.className = "mistake-images";
    notebookImages(item).forEach((src, index) => {
      const image = document.createElement("img");
      image.src = src;
      image.alt = `单词释义图片 ${index + 1}`;
      images.append(image);
    });
    answer.append(images);
    bindNotebookImageZoom(answer);
    answer.classList.toggle("hidden", !vocabularySession.revealed);
    $("#revealVocabularyAnswer").classList.toggle("hidden", vocabularySession.revealed);
    $("#vocabularyStudyRating").classList.toggle("hidden", !vocabularySession.revealed);
    $("#vocabularyAgain").disabled = $("#vocabularyKnown").disabled = vocabularySaving;
  }

  function startVocabularyStudy() {
    if (vocabularySaving) return;
    const words = vocabularyWords().filter(vocabularyDue).sort((a, b) => {
      const aDue = a.vocabularyReview?.dueDate || "9999";
      const bDue = b.vocabularyReview?.dueDate || "9999";
      return String(aDue).localeCompare(String(bDue));
    }).slice(0, 20);
    if (!words.length) return;
    vocabularySession = { queue: words.map(item => item.id), completed: 0, revealed: false };
    renderVocabularyStudy();
    $("#revealVocabularyAnswer").focus();
  }

  async function rateVocabulary(known) {
    if (vocabularySaving || !vocabularySession?.revealed) return;
    const session = vocabularySession;
    const item = vocabularyWords().find(word => word.id === session.queue[0]);
    if (!item) return renderVocabularyStudy();
    vocabularySaving = true;
    const previous = item.vocabularyReview;
    const intervals = [1, 3, 7, 14, 30];
    const oldLevel = Number.isInteger(previous?.level) ? Math.max(0, Math.min(5, previous.level)) : 0;
    const level = known ? Math.min(5, oldLevel + 1) : 0;
    const next = new Date(`${today()}T12:00:00`);
    next.setDate(next.getDate() + (known ? intervals[level - 1] : 0));
    const dueDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    item.vocabularyReview = { level, dueDate, lastReviewedDate: today() };
    renderVocabularyStudy();
    try {
      await saveState(true);
      session.queue.shift();
      if (known) session.completed += 1;
      else session.queue.push(item.id);
      session.revealed = false;
    } catch {
      if (previous === undefined) delete item.vocabularyReview;
      else item.vocabularyReview = previous;
      vocabularySaving = false;
      renderVocabularyStudy();
      $("#vocabularyStudyStatus").textContent = "复习进度保存失败，请检查本地数据服务后重试；当前单词已保留。";
      return;
    }
    vocabularySaving = false;
    renderVocabularyStudy();
    if (session.queue.length) $("#revealVocabularyAnswer").focus();
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
    const groupKey = item => item.type?.startsWith("Task 1") ? "task1" : item.type === "Task 2" ? "task2" : "free";
    const labels = { task1: "Task 1 · 小作文", task2: "Task 2 · 大作文", free: "自由写作" };
    const records = [...state.writings]
      .filter(item => writingHistoryFilter === "all" || groupKey(item) === writingHistoryFilter)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if (!records.length) {
      root.className = "library-list empty-state";
      root.textContent = "这个分类还没有写作记录";
      return;
    }
    const card = item => {
      const status = item.review ? "已批改" : item.status === "completed" ? "已完成" : "写作中";
      return `<div class="record-list-item"><button class="library-item ${item.id === activeWritingId ? "is-active" : ""}" data-writing-id="${escapeHtml(item.id)}"><span class="record-title-row"><strong>${escapeHtml(practiceTitle(item))}</strong><em class="record-status ${item.review ? "is-reviewed" : ""}">${status}</em></span><small>${escapeHtml(item.type)} · 第 ${writingAttempt(item)} 次</small><small>${escapeHtml(String(item.updatedAt || "").slice(0, 10))} · ${countWords(item.essay)} words${item.promptImages?.length ? ` · ${item.promptImages.length} 图` : ""}</small></button><button class="record-delete" data-delete-writing-id="${escapeHtml(item.id)}" aria-label="删除这篇写作">删除</button></div>`;
    };
    const groupMarkup = (key, items) => `<section class="history-group"><div class="history-group-heading"><span>${labels[key]}</span><b>${items.length}</b></div>${items.map(card).join("")}</section>`;
    root.className = "library-list grouped-history";
    root.innerHTML = writingHistoryFilter === "all"
      ? ["task1", "task2", "free"].map(key => [key, records.filter(item => groupKey(item) === key)]).filter(([, items]) => items.length).map(([key, items]) => groupMarkup(key, items)).join("")
      : records.map(card).join("");
    $$('[data-writing-id]', root).forEach(button => button.addEventListener("click", () => {
      const id = button.dataset.writingId;
      if (state.writings.find(item => item.id === id)?.review) openReviewWorkspace("writing", id);
      else loadWriting(id);
    }));
    $$('[data-delete-writing-id]', root).forEach(button => button.addEventListener("click", () => deleteWritingRecord(button.dataset.deleteWritingId)));
  }

  function writingAttempt(item) {
    const value = Number(item?.attemptNumber);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function setWritingScreen(mode) {
    writingScreenMode = ["overview", "setup", "session"].includes(mode) ? mode : "overview";
    $("#writingOverviewView").classList.toggle("hidden", writingScreenMode !== "overview");
    $("#writingSetupView").classList.toggle("hidden", writingScreenMode !== "setup");
    $("#writingSessionView").classList.toggle("hidden", writingScreenMode !== "session");
    if (writingScreenMode === "session") renderWritingSession();
    else setPracticeFocus(false);
  }

  function setSpeakingScreen(mode) {
    speakingScreenMode = mode === "practice" ? "practice" : "overview";
    $("#speakingOverviewView").classList.toggle("hidden", speakingScreenMode !== "overview");
    $("#speakingPracticeView").classList.toggle("hidden", speakingScreenMode !== "practice");
  }

  function syncWritingTaskOptions() {
    $$('[data-writing-type]').forEach(button => button.classList.toggle("is-selected", button.dataset.writingType === $("#writingType").value));
    const minutes = Number($("#writingMinutes").value);
    $("#startWritingSession").innerHTML = `开始 ${minutes ? `${minutes} 分钟` : "自由"}练习 <span>→</span>`;
  }

  function renderWritingSession() {
    $("#writingEssay").readOnly = writingTimerPaused;
    const item = state.writings.find(entry => entry.id === activeWritingId);
    if (!item) return;
    const typeLabel = item.type === "Task 2" ? "TASK 2" : item.type.startsWith("Task 1") ? "TASK 1" : "FREE WRITING";
    $("#writingSessionBadge").textContent = `${typeLabel} · 第 ${writingAttempt(item)} 次`;
    $("#writingSessionState").textContent = item.status === "completed" ? "已完成 · 可继续修改或提交批改" : "写作中 · 自动保存已开启";
    $("#writingAnswerHint").textContent = item.type === "Task 2" ? "建议至少 250 英文词（数字与标点不计）" : item.type.startsWith("Task 1") ? "建议至少 150 英文词（数字与标点不计）" : "按自己的目标完成写作";
    if (writingTimerPaused) {
      $("#writingSessionState").textContent = "计时已暂停 · 答题框已锁定";
      $("#writingAnswerHint").textContent = "已暂停，继续计时后可编辑答案";
    }
    const question = $("#writingSessionQuestion");
    question.innerHTML = `${item.prompt ? `<div class="writing-question-text">${escapeHtml(item.prompt)}</div>` : ""}${(item.promptImages || []).map((src, index) => `<img src="${src}" alt="题目图片 ${index + 1}">`).join("")}` || '<p class="empty-state">本题只有空白题目</p>';
  }

  function deleteWritingRecord(id) {
    if (!id || !confirm("确定删除这篇写作记录吗？")) return;
    state.writings = state.writings.filter(entry => entry.id !== id);
    saveState();
    if (activeWritingId === id) newWriting(true); else renderWritingHistory();
    showToast("写作记录已删除");
  }

  function countWords(value) {
    const matches = String(value || "").match(/\p{L}+(?:['’\u2011–—-]\p{L}+)*/gu);
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
    syncWritingTaskOptions();
    setWritingScreen("setup");
    renderWritingHistory();
    refreshPracticeTextareas();
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
    syncWritingTaskOptions();
    setWritingScreen("session");
    renderWritingHistory();
    refreshPracticeTextareas();
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
      ,status: existing?.status || "draft"
      ,startedAt: existing?.startedAt || ""
      ,rootSessionId: existing?.rootSessionId || existing?.id || activeWritingId || ""
      ,parentSessionId: existing?.parentSessionId || null
      ,attemptNumber: existing?.attemptNumber || 1
    };
    const index = state.writings.findIndex(entry => entry.id === record.id);
    if (index >= 0) state.writings[index] = record; else state.writings.push(record);
    activeWritingId = record.id;
    if (!record.rootSessionId) record.rootSessionId = record.id;
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
    if (writingScreenMode === "session") renderWritingSession();
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
    writingTimerPaused = false;
    $("#writingEssay").readOnly = false;
    timerSeconds = Number($("#writingMinutes").value) * 60;
    const countUp = !Number($("#writingMinutes").value);
    $("#writingTimerLabel").textContent = countUp ? "已用时间" : "剩余时间";
    $("#writingTimer").textContent = formatClock(timerSeconds);
    $("#toggleTimer").textContent = countUp ? "开始正计时" : "开始倒计时";
  }

  function toggleWritingTimer() {
    const countUp = !Number($("#writingMinutes").value);
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
      $("#toggleTimer").textContent = countUp ? "继续正计时" : "继续倒计时";
      writingTimerPaused = true;
      renderWritingSession();
      return;
    }
    if (!countUp && timerSeconds <= 0) resetWritingTimer();
    writingTimerPaused = false;
    renderWritingSession();
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

  async function startWritingSession() {
    await pendingWritingPromptImageJob;
    if (!$("#writingPrompt").value.trim() && !pendingWritingPromptImages.length) return showToast("请先输入题目文字，或添加题目图片");
    const now = new Date().toISOString();
    if (!await saveWriting({ silent: true })) return;
    const item = state.writings.find(entry => entry.id === activeWritingId);
    if (!item) return;
    item.status = "running";
    item.startedAt ||= now;
    item.rootSessionId ||= item.id;
    await saveState(true);
    setWritingScreen("session");
    resetWritingTimer();
    toggleWritingTimer();
    setTimeout(() => $("#writingEssay").focus(), 80);
  }

  async function finishWritingSession() {
    writingTimerPaused = false;
    $("#writingEssay").readOnly = false;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    await saveWriting({ silent: true });
    const item = state.writings.find(entry => entry.id === activeWritingId);
    if (!item) return;
    item.status = "completed";
    item.finishedAt = new Date().toISOString();
    await saveState(true);
    setPracticeFocus(false);
    renderWritingSession();
    renderWritingHistory();
    showToast("本次写作已完成并自动保存；需要时可提交 AI 批改");
  }

  async function retryWritingFromReview() {
    const sourceId = reviewWorkspaceSelection?.module === "writing" ? reviewWorkspaceSelection.id : null;
    const source = state.writings.find(entry => entry.id === sourceId);
    if (!source) return showToast("找不到原写作记录");
    await flushWritingAutosave();
    const related = state.writings.filter(item => (item.rootSessionId || item.id) === (source.rootSessionId || source.id));
    const nextAttempt = Math.max(1, ...related.map(writingAttempt)) + 1;
    const now = new Date().toISOString();
    const record = {
      id: uid(), type: source.type, minutes: Number(source.minutes), prompt: source.prompt,
      promptImages: [...(source.promptImages || [])], essay: "", updatedAt: now, review: "", reviewInput: null,
      topicTitle: source.topicTitle || "", reviewedAt: "", status: "running", startedAt: now,
      rootSessionId: source.rootSessionId || source.id, parentSessionId: source.id, attemptNumber: nextAttempt
    };
    state.writings.push(record);
    await saveState(true);
    await loadWriting(record.id);
    routeTo("writing");
    resetWritingTimer();
    toggleWritingTimer();
    setTimeout(() => $("#writingEssay").focus(), 80);
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

  function recoverEmbeddedWritingPrompt(text) {
    const source = String(text || "");
    const answerMarker = source.search(/\n\s*(?:sample\s+writing\s+answer|my\s+answer|writing\s+answer|answer)\s*:?[ \t]*\n/i);
    if (answerMarker < 0) return "";
    const candidate = source.slice(0, answerMarker).trim();
    return /(?:TASK\s*[12]|write\s+(?:about|at\s+least)|summari[sz]e\s+the\s+information)/i.test(candidate) ? candidate : "";
  }

  function closeReviewImageLightbox() {
    const lightbox = $("#reviewImageLightbox");
    lightbox.classList.add("hidden");
    $("#reviewImageLightboxImage").removeAttribute("src");
    document.body.classList.remove("has-image-lightbox");
  }

  function openReviewImageLightbox(src, alt) {
    const image = $("#reviewImageLightboxImage");
    image.src = src;
    image.alt = alt;
    $("#reviewImageLightbox").classList.remove("hidden");
    document.body.classList.add("has-image-lightbox");
    $("#closeReviewImageLightbox").focus();
  }

  function populateReviewWorkspace() {
    if (!reviewWorkspaceSelection) return;
    const { module, id } = reviewWorkspaceSelection;
    const writing = module === "writing";
    const item = (writing ? state.writings : state.speaking).find(entry => entry.id === id);
    const snapshot = item?.reviewInput;
    // The review is tied to its submitted text, not a later edit in the editor.
    const original = snapshot?.original || (item?.review ? (writing ? item.essay : item.transcript) : $(writing ? "#writingEssay" : "#speakingTranscript").value);
    const storedPrompt = String(snapshot?.prompt || item?.prompt || "").trim();
    const recoveredPrompt = writing && !storedPrompt ? recoverEmbeddedWritingPrompt(original) : "";
    const prompt = storedPrompt || recoveredPrompt || (!item?.review ? $(writing ? "#writingPrompt" : "#speakingPrompt").value : "");
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
    $("#retryReviewSource").textContent = writing ? "根据本次批改再练此题" : "再次练习本题";
    $("#reviewWorkspacePrompt").textContent = prompt || "尚未填写题目 / 话题";
    $("#reviewWorkspaceOriginal").textContent = original || "尚无原始回答";
    $("#reviewWorkspaceNotice").textContent = recoveredPrompt
      ? "这条旧记录没有单独保存原题，已从提交原稿中识别并补充到原题板块；提交原稿仍完整保留，不做删改。"
      : snapshot ? "展示批改时提交的原稿。标注来自 AI 已返回的修改，不改变你的原文。" : item?.review ? "历史报告：原文取自该记录保存的答案，旧记录没有独立的提交快照。" : "本题预览，不会自动请求 AI 或覆盖编辑区。";
    $("#editReviewSource").disabled = !item;
    const snapshotImages = Array.isArray(snapshot?.promptImages) && snapshot.promptImages.length ? snapshot.promptImages : null;
    const images = writing ? snapshotImages || (item?.review ? item.promptImages : pendingWritingPromptImages) || [] : [];
    const imageRoot = $("#reviewWorkspaceImages");
    imageRoot.replaceChildren();
    images.forEach((src, index) => {
      if (typeof src !== "string" || !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) return;
      const preview = document.createElement("button");
      preview.type = "button";
      preview.className = "review-image-preview";
      preview.setAttribute("aria-label", `全屏查看题目图片 ${index + 1}`);
      const image = document.createElement("img");
      image.src = src;
      image.alt = `题目图片 ${index + 1}`;
      const zoom = document.createElement("span");
      zoom.className = "review-image-zoom-icon";
      zoom.setAttribute("aria-hidden", "true");
      zoom.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6"></path></svg>';
      preview.append(image, zoom);
      preview.addEventListener("click", () => openReviewImageLightbox(src, image.alt));
      imageRoot.append(preview);
    });
    $("#reviewQuestionPanel").classList.toggle("has-images", imageRoot.childElementCount > 0);
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
      ,notebookOriginal: original || ""
      ,onSaveCorrection: item?.review ? correction => saveReviewCorrection(module, item, correction) : undefined
      ,isCorrectionSaved: correction => state.mistakes.some(note => note.correctionKey === correctionKey(module, id, correction))
    });
    if (!writing && !punctuated) $("#reviewAnnotationNotice").textContent = "生成整理稿后，修改标注将显示在这里。原始转写和下方修改建议保持不变。";
    if (window.renderReviewReport) window.renderReviewReport($("#reviewWorkspaceFeedback"), feedback, null, {
      dedupeCorrections: true,
      hideTranscript: !writing,
      strictSections: true,
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
    return `你返回的内容会被不同服务商的 OpenAI 兼容 API 直接填入固定网页组件。必须只输出 Markdown，不要寒暄、前言、HTML、代码块或额外章节。第一行固定为“主题：8–20 个汉字的具体主题短标题”。之后只允许按以下顺序各出现一次三级标题：\n### 评分与小分\n### 总体评价\n${speaking ? "### 转写整理稿\n" : ""}### 确定语法错误\n### 原文优化建议\n### 目标水平范文\n### 最终值得记忆的语料\n“评分与小分”必须在第一行给出醒目的非官方总分或暂定总分，再用 Markdown 表格列出各项小分与证据；每项证据控制在 70 个汉字以内，直说最重要的优缺点，不要堆砌长解释。${speaking ? "第一行严格写成‘基于转写的暂定总分：X（合理区间：Y–Z；真实总分会受发音影响）’。FC、LR、GRA 给出分数；P 写‘不可仅凭转写判断’。‘转写整理稿’只能补标点、大小写和分段，不得增删替换词。" : "第一行严格写成‘非官方总分：X’。Task 1 列 TA、CC、LR、GRA；Task 2 列 TR、CC、LR、GRA；不得混用 TA 与 TR。"}“确定语法错误”只能使用四列表格，表头严格为“原文｜修改｜类型｜原因”；原文逐字引用、修改尽量小，没有确定错误就写明没有，不得制造错误。ASCII 连字符、en dash、em dash、直引号与弯引号之间的排版偏好不属于确定语法错误，应放到可选优化或省略。“原文优化建议”只放正确但可提升的内容，不得使用纠错表。“目标水平范文”包含英文范文和必要的中文说明或翻译。“最终值得记忆的语料”禁止使用表格，必须严格使用两个四级标题“#### 核心搭配”和“#### 实用句式”，标题下只使用项目符号；每条严格写成“英文｜简洁中文释义或用途”，核心搭配最多 5 条，实用句式最多 3 条。所有评价必须针对用户提供的完整题目、题型和回答。`;
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
          temperature: 0,
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
    const writingType = $("#writingType").value;
    const wordCount = countWords(essay);
    const reviewInput = { prompt, original: essay, type: writingType, wordCount, promptImages: [...pendingWritingPromptImages] };
    const learnerContext = reviewLearnerContext("写作");
    const imageNotice = pendingWritingPromptImages.length ? `\n题目另附 ${pendingWritingPromptImages.length} 张图片。图片是题目的一部分，请先直接读取图片中的图表、流程、地图、数字、单位和标签，再结合文字题目核对正文；不要声称无法看到图片。` : "";
    askAi([
      { role: "system", content: `你是一名严谨、克制的 IELTS 写作教练。用户消息包含现有水平、目标水平和明确的 Task 类型。必须只使用该题型对应的评分标准，不能把 Task 1 Academic、Task 1 General Training 和 Task 2 混为一谈。先按当前能力选择最易掌握、最有收益的修改，再按目标水平生成可模仿的答案。优先参考本模块单项水平；只有总分时不要自行推定单项分数。现有水平只是学习背景，原稿评分必须独立依据实际文本，不得因目标分抬分。缺少关键信息时说明不确定性，不虚构官方成绩。评分与小分放在最前面，随后给简明总体评价。\n\n${IELTS_WRITING_SCORING_GUIDE}\n\n纠错边界必须严格遵守：只有客观、明确、在当前语境下无合理争议的语法、拼写、词形、主谓一致、时态、冠词、单复数、介词或句法错误，才放入“确定语法错误”，并使用原文｜修改｜类型｜原因四列表格；修改必须尽量小。措辞更自然、词汇更高级、表达更简洁、段落更流畅、论证更充分等都只是可选优化，只能放在“原文优化建议（可选优化建议）”，不得标红原文或写入纠错表。正确但不够漂亮的句子绝不能判错；证据不足时宁可不改；没有确定错误就明确写没有。范文保留原意并贴近目标水平，不堆砌生词；最后只保留真正值得主动记忆的领域搭配和常用句式。不要照搬私人模板或课程资料。` },
      { role: "system", content: `本次题型的专用要求：${writingTaskAssessment(writingType)}` },
      { role: "user", content: `${learnerContext}\n\n写作类型：${writingType}\n界面统计英文词数：${wordCount}${imageNotice}\n题目：${prompt || "未提供文字题目"}\n\n我的正文：\n${essay}` }
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
    const record = state.speaking.find(entry => entry.id === recordId);
    const duration = Number(record?.duration || recordSeconds || 0);
    const reviewInput = { prompt, original: transcript, type: partConfig.label, part, duration };
    const learnerContext = reviewLearnerContext("口语");
    askAi([
      { role: "system", content: `你是一名谨慎的 IELTS 口语教练。用户消息包含现有水平、目标水平、明确的口语 Part、完整题目、本次录音时长和本地 Whisper 转写。必须同时依据题目、该 Part 的专用要求和回答批改，不能把 Part 1、Part 2、Part 3 混为一谈。先按当前能力选择最易掌握、最有收益的修改，再按目标水平生成可真实复述的答案。原稿评分独立依据文本证据，不得因目标分抬分。\n\n${IELTS_SPEAKING_SCORING_GUIDE}\n\n你没有音频，因此不能评价具体发音、重音、语调或真实停顿；Pronunciation 标为不可仅凭转写判断。仍须给一个醒目的“基于转写的暂定总分”和合理区间，FC、LR、GRA 给直接小分，并说明真实总分会受发音影响。标点、大小写和分段问题可能来自 ASR，不得据此扣分或判为口语错误。句界或词语存在歧义时标记“转写待核对”，不得猜测。确定语法错误只收录有充分文本依据的问题，正确但不够自然的表达只能进入优化建议。不要修改或覆盖页面上的原始转写。保留用户的观点、经历、理由和口语风格，不编造人物、经历、数据或观点，不改成书面论文。` },
      { role: "system", content: `本次题型的专用要求：${speakingPartAssessment(part, duration)}` },
      { role: "system", content: "页面展示要求：不要寒暄。增加独立三级标题‘转写整理稿’，其正文只放补充基础标点、大小写和分段后的转写，不得增删替换原始转写中的词语，不得修复语法或猜测识别错误。逐句修改仍单独列出，原片段逐字引用用户的原始转写，页面会将修改定位到整理稿。不要在其他章节重复整理稿。" },
      { role: "user", content: `${learnerContext}\n\nIELTS 口语题型：${partConfig.label}（${partConfig.title}）\n本次录音时长：${duration > 0 ? `${duration} 秒` : "未记录"}\n该 Part 的界面练习说明：${partConfig.guide}\n完整题目 / 题卡：\n${prompt || "未提供具体题目，仅作自由表达"}\n\n本地 Whisper 转写文字稿：\n${transcript}` }
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
    $("#recordPhaseLabel").textContent = "回答时间";
    $("#recordPulse span").textContent = "00:00";
    $("#speakingSaveStatus").textContent = "正在录音，结束转写后自动保存…";
    $("#recordPulse").classList.remove("is-preparing");
    $("#recordPulse").classList.add("is-recording");
    $("#recordButton").textContent = "结束录音与转写";
    const config = speakingPartConfig();
    $("#recordHint").textContent = config.answerLimit
      ? `${config.label} 回答已开始；到 ${formatClock(config.answerLimit)} 时自动结束，也可以提前结束。`
      : "正在录音；结束后由 Whisper 在本机一次性转写，不会上传音频。";
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
    $("#recordPhaseLabel").textContent = "准备时间";
    $("#recordPulse span").textContent = formatClock(preparationSeconds);
    $("#recordPulse").classList.add("is-preparing");
    $("#recordButton").textContent = "立即开始 2 分钟回答";
    $("#recordHint").textContent = "准备中：整理关键词和顺序，不会录音；倒计时结束后自动开始回答。";
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
    $("#recordPhaseLabel").textContent = "正在转写";
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
    const groupKey = item => ["p1", "p2", "p3"].includes(item.part) ? item.part : "free";
    const labels = { p1: "Part 1 · 简短问答", p2: "Part 2 · 个人陈述", p3: "Part 3 · 深入讨论", free: "自由表达" };
    const records = [...state.speaking]
      .filter(item => speakingHistoryFilter === "all" || groupKey(item) === speakingHistoryFilter)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    if (!records.length) {
      root.className = "library-list empty-state";
      root.textContent = "这个分类还没有口语记录";
      return;
    }
    const card = item => `<div class="record-list-item"><button class="library-item ${item.id === activeSpeakingId ? "is-active" : ""}" data-speaking-id="${escapeHtml(item.id)}"><span class="record-title-row"><strong>${escapeHtml(item.prompt || "自由表达")}</strong>${item.review ? '<em class="record-status is-reviewed">已批改</em>' : ""}</span><small>${labels[groupKey(item)]}</small><small>${escapeHtml(String(item.updatedAt || item.createdAt || "").slice(0, 10))} · ${Number(item.duration || 0)} 秒${item.transcript ? ` · ${countWords(item.transcript)} words` : ""}</small></button><button class="record-delete" data-delete-speaking-id="${escapeHtml(item.id)}" aria-label="删除这条口语记录">删除</button></div>`;
    const groupMarkup = (key, items) => `<section class="history-group"><div class="history-group-heading"><span>${labels[key]}</span><b>${items.length}</b></div>${items.map(card).join("")}</section>`;
    root.className = "library-list grouped-history";
    root.innerHTML = speakingHistoryFilter === "all"
      ? ["p1", "p2", "p3", "free"].map(key => [key, records.filter(item => groupKey(item) === key)]).filter(([, items]) => items.length).map(([key, items]) => groupMarkup(key, items)).join("")
      : records.map(card).join("");
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
    setSpeakingScreen("practice");
    renderSpeakingHistory();
    refreshPracticeTextareas();
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
    setSpeakingScreen("practice");
    renderSpeakingHistory();
    refreshPracticeTextareas();
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

  const languageText = (value, limit = Infinity) => {
    const scalar = candidate => typeof candidate === "string" ? candidate.trim() : "";
    let text = scalar(value);
    if (!text && value && typeof value === "object" && !Array.isArray(value)) {
      const english = ["english", "expression", "phrase", "pattern", "text", "value", "label", "title", "domain"].map(key => scalar(value[key])).find(Boolean) || "";
      const chinese = ["chinese", "translation", "meaning", "detail", "definition", "explanation"].map(key => scalar(value[key])).find(Boolean) || "";
      text = english ? `${english}${chinese ? `｜${chinese}` : ""}` : "";
    }
    return text.slice(0, limit);
  };
  const languageList = (value, limit = Infinity) => Array.isArray(value) ? value.map(item => languageText(item)).filter(Boolean).slice(0, limit) : [];

  const SPEAKING_THEME_CONCEPTS = [
    ["家乡", /家乡|故乡|老家|hometown|home town|home city/i],
    ["食物", /食物|饮食|美食|饭菜|菜肴|饺子|面条|烹饪|food|dish|meal|cook|dumpling|noodle/i],
    ["家庭", /家庭|家人|父母|亲人|团聚|团圆|family|parent|relative|reunion/i],
    ["节日", /节日|春节|庆祝|传统|festival|holiday|celebrat|tradition/i],
    ["记忆", /记忆|回忆|童年|难忘|memory|memories|childhood|memorable/i],
    ["学习", /学习|学校|大学|教育|课程|老师|学生|study|school|university|education|course|teacher|student/i],
    ["工作", /工作|职业|同事|公司|就业|事业|work|job|career|colleague|company|employment/i],
    ["科技", /科技|技术|手机|电脑|网络|人工智能|technology|phone|computer|internet|artificial intelligence|\bai\b/i],
    ["旅行", /旅行|旅游|度假|景点|城市|乡村|travel|trip|tour|holiday|city|countryside/i],
    ["运动", /运动|锻炼|骑行|跑步|游泳|球类|sport|exercise|cycling|bicycle|running|swimming/i],
    ["爱好", /爱好|兴趣|休闲|音乐|电影|阅读|hobby|interest|leisure|music|film|movie|reading/i],
    ["人物", /朋友|老师|同事|邻居|人物|榜样|friend|teacher|colleague|neighbour|person|role model/i],
    ["环境", /环境|气候|污染|自然|公园|environment|climate|pollution|nature|park/i],
    ["灵活性", /灵活|多样|定制|flexib|versatil|customiz/i]
  ];

  const SPEAKING_TOPIC_TRANSLATIONS = new Map(Object.entries({
    "hobby": "兴趣爱好",
    "hobbies": "兴趣爱好",
    "pets and animals": "宠物与动物",
    "daily routine": "日常生活",
    "relaxation and stress relief": "放松与减压",
    "family and home life": "家庭与居家生活",
    "responsibility and care": "责任与照料",
    "hometown": "家乡",
    "food and cooking": "食物与烹饪",
    "festivals and traditions": "节日与传统",
    "childhood memories": "童年记忆",
    "travel and holidays": "旅行与度假",
    "technology": "科技",
    "work and study": "工作与学习",
    "health and exercise": "健康与运动",
    "friends and relationships": "朋友与人际关系",
    "environment": "环境"
  }));

  function speakingTopicLabel(value) {
    const text = languageText(value);
    return SPEAKING_TOPIC_TRANSLATIONS.get(text.toLocaleLowerCase().replace(/\s+/g, " ")) || text;
  }

  function speakingConceptsFromText(value) {
    return new Set(SPEAKING_THEME_CONCEPTS.filter(([, pattern]) => pattern.test(String(value || ""))).map(([name]) => name));
  }

  function speakingThemeConcepts(item) {
    const text = [item?.title, ...languageList(item?.reusableTopics)].join(" ");
    return speakingConceptsFromText(text);
  }

  function normalizedThemeText(value) {
    return languageText(value).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  }

  function textBigrams(value) {
    const text = normalizedThemeText(value);
    if (text.length < 2) return new Set(text ? [text] : []);
    return new Set(Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2)));
  }

  function setSimilarity(left, right) {
    if (!left.size || !right.size) return 0;
    const overlap = [...left].filter(value => right.has(value)).length;
    return overlap / (left.size + right.size - overlap);
  }

  function speakingThemesSimilar(left, right) {
    const leftTitle = normalizedThemeText(left?.title);
    const rightTitle = normalizedThemeText(right?.title);
    if (!leftTitle || !rightTitle) return false;
    if (leftTitle === rightTitle || leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle)) return true;
    const leftConcepts = speakingThemeConcepts(left);
    const rightConcepts = speakingThemeConcepts(right);
    const conceptOverlap = [...leftConcepts].filter(value => rightConcepts.has(value)).length;
    const conceptCoverage = conceptOverlap / Math.max(1, Math.min(leftConcepts.size, rightConcepts.size));
    if (conceptOverlap >= 3 || (conceptOverlap >= 2 && conceptCoverage >= .66)) return true;
    return setSimilarity(textBigrams(leftTitle), textBigrams(rightTitle)) >= .42;
  }

  function spokenLanguageKey(value) {
    return languageText(value).split(/[｜|]/, 1)[0].toLocaleLowerCase()
      .replace(/\bdish(?:es)?\b/g, "food")
      .replace(/\bmemories\b/g, "memory")
      .replace(/\bbrings\b/g, "bring")
      .replace(/\b(?:a|an|the|in|from|of|my|warm|beautiful)\b/g, " ")
      .replace(/[\s\p{P}\p{S}]+/gu, "");
  }

  function uniqueSpeakingLanguage(values) {
    const entries = new Map();
    for (const value of values || []) {
      const key = spokenLanguageKey(value);
      if (!key) continue;
      const existing = entries.get(key);
      const incoming = languageText(value);
      if (!existing || (!bilingualLanguage(existing).chinese && bilingualLanguage(incoming).chinese)) entries.set(key, incoming);
    }
    return [...entries.values()];
  }

  function mergePersonalCore(left, right) {
    const current = languageText(left);
    const incoming = languageText(right);
    if (!incoming) return current;
    if (!current) return incoming;
    const currentKey = normalizedThemeText(current);
    const incomingKey = normalizedThemeText(incoming);
    if (currentKey.includes(incomingKey)) return current;
    if (incomingKey.includes(currentKey)) return incoming;
    if (setSimilarity(textBigrams(currentKey), textBigrams(incomingKey)) >= .3) return incoming.length > current.length ? incoming : current;
    return `${current}\n\n${incoming}`;
  }

  function compactPersonalCore(value) {
    const parts = languageText(value).split(/\n\s*\n+/).map(part => part.trim()).filter(Boolean);
    const kept = [];
    for (const part of parts) {
      const partConcepts = speakingConceptsFromText(part);
      const duplicateIndex = kept.findIndex(current => {
        const currentConcepts = speakingConceptsFromText(current);
        const overlap = [...partConcepts].filter(concept => currentConcepts.has(concept)).length;
        const coverage = overlap / Math.max(1, Math.min(partConcepts.size, currentConcepts.size));
        return setSimilarity(textBigrams(current), textBigrams(part)) >= .3 || (overlap >= 3 && coverage >= .75);
      });
      if (duplicateIndex < 0) kept.push(part);
      else if (part.length > kept[duplicateIndex].length) kept[duplicateIndex] = part;
    }
    return kept.join("\n\n");
  }

  function uniqueSpeakingTopics(values) {
    const kept = [];
    for (const value of uniqueLanguage((values || []).map(speakingTopicLabel))) {
      const concepts = speakingConceptsFromText(value);
      const duplicate = kept.some(current => {
        const currentConcepts = speakingConceptsFromText(current);
        const overlap = [...concepts].filter(concept => currentConcepts.has(concept)).length;
        return overlap >= 2 && overlap / Math.max(1, Math.min(concepts.size, currentConcepts.size)) >= .75;
      });
      if (!duplicate) kept.push(value);
    }
    return kept;
  }

  function consolidateSpeakingThemes(items) {
    const consolidated = [];
    for (const source of items || []) {
      const item = structuredClone(source);
      const match = consolidated.find(existing => speakingThemesSimilar(existing, item));
      if (!match) {
        item.reusableTopics = uniqueSpeakingTopics(item.reusableTopics || []);
        item.expressions = uniqueSpeakingLanguage(item.expressions || []);
        item.answerFrames = uniqueSpeakingLanguage(item.answerFrames || []);
        item.sourceKeys = uniqueLanguage(item.sourceKeys || []);
        consolidated.push(item);
        continue;
      }
      match.personalCore = mergePersonalCore(match.personalCore, item.personalCore);
      match.reusableTopics = uniqueSpeakingTopics([...match.reusableTopics, ...item.reusableTopics]);
      match.expressions = uniqueSpeakingLanguage([...match.expressions, ...item.expressions]);
      match.answerFrames = uniqueSpeakingLanguage([...match.answerFrames, ...item.answerFrames]);
      match.sourceKeys = uniqueLanguage([...match.sourceKeys, ...item.sourceKeys]);
    }
    return consolidated;
  }

  function isWritingDerivedSpeakingTheme(item, writing) {
    const core = languageText(item?.personalCore);
    const hasPersonalVoice = /(?:^|[^A-Za-z])I(?:[^A-Za-z]|$)|\bmy\b|我来自|我喜欢|我曾|我会|我的|我们家/i.test(core);
    const abstractPosition = /用户|本文|文章|该观点|认为|认同|主张|应当|应该|利弊|优缺点/.test(core);
    const academicTitle = /教育|学习方式|课程|科技|犯罪|法律|商业|经济|公共政策|社会问题|环境|education|curriculum|technology|crime|business|economy|policy/i.test(item?.title || "");
    const writingKeys = new Set((writing || []).flatMap(entry => [...languageList(entry.collocations), ...languageList(entry.sentencePatterns)]).map(spokenLanguageKey));
    const overlap = [...languageList(item?.expressions), ...languageList(item?.answerFrames)].map(spokenLanguageKey).filter(key => key && writingKeys.has(key)).length;
    return overlap >= 2 || (!hasPersonalVoice && abstractPosition && academicTitle);
  }

  function normalizeLanguageBank(value) {
    const source = value && typeof value === "object" ? value : {};
    const rawWriting = (Array.isArray(source.writing) ? source.writing : []).map(item => ({
      domain: languageText(item?.domain),
      collocations: languageList(item?.collocations),
      sentencePatterns: languageList(item?.sentencePatterns),
      sourceKeys: languageList(item?.sourceKeys)
    })).filter(item => item.domain && (item.collocations.length || item.sentencePatterns.length));
    const rawSpeaking = (Array.isArray(source.speaking) ? source.speaking : []).map(item => ({
      title: languageText(item?.title),
      personalCore: compactPersonalCore(item?.personalCore),
      reusableTopics: languageList(item?.reusableTopics),
      expressions: languageList(item?.expressions),
      answerFrames: languageList(item?.answerFrames),
      sourceKeys: languageList(item?.sourceKeys)
    })).filter(item => item.title && (item.personalCore || item.expressions.length));
    const speaking = consolidateSpeakingThemes(rawSpeaking);
    const misplaced = speaking.filter(item => isWritingDerivedSpeakingTheme(item, rawWriting));
    const writing = writingLanguageCategories([
      ...rawWriting,
      ...misplaced.map(item => ({
        domain: writingDomainCategory(item.title),
        collocations: item.expressions,
        sentencePatterns: item.answerFrames,
        sourceKeys: item.sourceKeys
      }))
    ]);
    return {
      summary: languageText(source.summary),
      speaking: speaking.filter(item => !misplaced.includes(item)),
      writing
    };
  }

  function uniqueLanguage(values) {
    const seen = new Set();
    return values.filter(value => {
      const key = String(value || "").trim().toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function bilingualLanguage(value) {
    const text = languageText(value);
    const divider = text.match(/\s*[｜|]\s*/);
    if (!divider || divider.index === undefined) return { english: text, chinese: "" };
    return { english: text.slice(0, divider.index).trim(), chinese: text.slice(divider.index + divider[0].length).trim() };
  }

  function uniqueWritingLanguage(values) {
    const entries = new Map();
    for (const value of values || []) {
      const parts = bilingualLanguage(value);
      const key = parts.english.toLocaleLowerCase();
      if (!key) continue;
      const existing = entries.get(key);
      if (!existing || (!bilingualLanguage(existing).chinese && parts.chinese)) entries.set(key, languageText(value));
    }
    return [...entries.values()];
  }

  function writingLanguageNeedsTranslation(bank = state.languageBank) {
    return normalizeLanguageBank(bank).writing.some(item => [...item.collocations, ...item.sentencePatterns].some(value => {
      const parts = bilingualLanguage(value);
      return parts.english && !parts.chinese;
    }));
  }

  function speakingLanguageNeedsTranslation(bank = state.languageBank) {
    return normalizeLanguageBank(bank).speaking.some(item => [...item.expressions, ...item.answerFrames].some(value => {
      const parts = bilingualLanguage(value);
      return parts.english && !parts.chinese;
    }));
  }

  const WRITING_DOMAIN_ORDER = ["教育", "科技", "犯罪与法律", "商业与经济", "环境", "健康", "社会与公共政策", "交通与城市", "文化与媒体", "通用表达"];
  const WRITING_MEMORY_LIMITS = { collocations: 5, sentencePatterns: 3 };

  function writingDomainCategory(value) {
    const original = languageText(value) || "其他领域";
    const key = original.toLocaleLowerCase();
    const groups = [
      ["通用表达", /通用|衔接|连接|逻辑|cohesion|connector|general|universal|linking/],
      ["教育", /教育|学校|大学|学生|教师|education|school|university|student|teacher/],
      ["科技", /科技|技术|数字|人工智能|互联网|technology|digital|artificial intelligence|internet/],
      ["犯罪与法律", /犯罪|法律|司法|惩罚|crime|criminal|law|legal|justice|punish/],
      ["商业与经济", /商业|经济|就业|工作|企业|收入|business|econom|employment|work|company|income/],
      ["环境", /环境|气候|污染|能源|environment|climate|pollution|energy/],
      ["健康", /健康|医疗|运动|饮食|health|medical|exercise|diet/],
      ["交通与城市", /交通|城市|住房|基础设施|transport|traffic|urban|city|housing|infrastructure/],
      ["文化与媒体", /文化|媒体|广告|传统|旅游|culture|media|advertis|tradition|tourism/],
      ["社会与公共政策", /社会|政府|公共|人口|平等|society|social|government|public|population|equality/]
    ];
    return groups.find(([, pattern]) => pattern.test(key))?.[0] || original;
  }

  function writingLanguageCategories(items) {
    const grouped = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const domain = writingDomainCategory(item.domain);
      const current = grouped.get(domain) || { domain, collocations: [], sentencePatterns: [], sourceKeys: [] };
      current.collocations = uniqueWritingLanguage([...current.collocations, ...languageList(item.collocations)]);
      current.sentencePatterns = uniqueWritingLanguage([...current.sentencePatterns, ...languageList(item.sentencePatterns)]);
      current.sourceKeys = uniqueLanguage([...current.sourceKeys, ...languageList(item.sourceKeys)]);
      grouped.set(domain, current);
    }
    return [...grouped.values()].sort((a, b) => {
      const ai = WRITING_DOMAIN_ORDER.indexOf(a.domain);
      const bi = WRITING_DOMAIN_ORDER.indexOf(b.domain);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.domain.localeCompare(b.domain, "zh-CN");
    });
  }

  function dailyLanguageSlice(values, limit, seed = "") {
    const list = uniqueLanguage(values || []);
    if (list.length <= limit) return list;
    const day = Math.floor(new Date().setHours(0, 0, 0, 0) / 86400000);
    const seedValue = [...seed].reduce((total, character) => total + character.codePointAt(0), 0);
    const start = Math.abs(day + seedValue) % list.length;
    return Array.from({ length: limit }, (_, index) => list[(start + index) % list.length]);
  }

  function mergeLanguageBanks(previous, incoming) {
    const base = normalizeLanguageBank(previous);
    const next = normalizeLanguageBank(incoming);
    const speaking = consolidateSpeakingThemes([...base.speaking, ...next.speaking]);
    const writing = base.writing.map(item => structuredClone(item));
    for (const item of next.writing) {
      const itemDomain = writingDomainCategory(item.domain);
      const match = writing.find(existing => writingDomainCategory(existing.domain) === itemDomain);
      if (!match) writing.push(structuredClone(item));
      else {
        match.collocations = uniqueWritingLanguage([...match.collocations, ...item.collocations]);
        match.sentencePatterns = uniqueWritingLanguage([...match.sentencePatterns, ...item.sentencePatterns]);
        match.sourceKeys = uniqueLanguage([...match.sourceKeys, ...item.sourceKeys]);
      }
    }
    return { summary: uniqueLanguage([base.summary, next.summary]).join("；"), speaking, writing };
  }

  function languageSourceFingerprint(id, value) {
    let hash = 2166136261;
    for (const character of JSON.stringify(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `${id}:content:${(hash >>> 0).toString(36)}`;
  }

  function languageBankSource() {
    const newest = items => [...items].sort((a, b) => String(b.reviewedAt || b.updatedAt || "").localeCompare(String(a.reviewedAt || a.updatedAt || "")));
    const fullText = value => String(value || "").trim();
    const speaking = newest(state.speaking).map(item => {
      const content = { part: SPEAKING_PARTS[item.part]?.label || item.part || "自由表达", question: fullText(item.prompt), answer: fullText(item.reviewInput?.original || item.transcript), feedback: fullText(item.review) };
      return { recordId: item.id, sourceKey: languageSourceFingerprint(item.id, content), legacySourceKey: `${item.id}:${item.updatedAt || ""}:${item.reviewedAt || ""}`, ...content };
    }).filter(item => item.question || item.answer);
    const writing = newest(state.writings).map(item => {
      const content = { type: fullText(item.type), question: fullText(item.prompt), answer: fullText(item.reviewInput?.original || item.essay), feedback: fullText(item.review) };
      return { recordId: item.id, sourceKey: languageSourceFingerprint(item.id, content), legacySourceKey: `${item.id}:${item.updatedAt || ""}:${item.reviewedAt || ""}`, ...content };
    }).filter(item => item.question || item.answer);
    return { speaking, writing };
  }

  function languageItemSourceRecords(kind, item) {
    const source = languageBankSource()[kind] || [];
    const savedKeys = new Set(languageList(item?.sourceKeys));
    if (savedKeys.size) {
      const exact = source.filter(record => savedKeys.has(record.sourceKey) || savedKeys.has(record.legacySourceKey));
      if (exact.length) return exact;
    }
    if (kind === "speaking") {
      const related = source.filter(record => speakingThemesSimilar(item, { title: `${record.question} ${record.answer}`, reusableTopics: [] }));
      if (related.length) return related;
    } else {
      const domain = writingDomainCategory(item?.domain);
      if (domain === "通用表达") return source;
      const related = source.filter(record => writingDomainCategory(record.question || record.answer) === domain);
      if (related.length) return related;
    }
    return source.length === 1 ? source : [];
  }

  async function deleteLanguageBankItem(kind, index) {
    const bank = normalizeLanguageBank(state.languageBank);
    const items = kind === "writing" ? bank.writing : bank.speaking;
    const item = items[index];
    if (!item || !confirm(`删除“${kind === "writing" ? item.domain : item.title}”语料？对应练习会重置为尚未处理，下次可重新生成。`)) return;
    const previous = structuredClone(state.languageBank);
    const related = languageItemSourceRecords(kind, item);
    const recordIds = new Set(related.map(record => String(record.recordId)));
    const keysToReset = new Set([
      ...languageList(item.sourceKeys),
      ...related.flatMap(record => [record.sourceKey, record.legacySourceKey])
    ]);
    items.splice(index, 1);
    const retainedKeys = languageList(state.languageBank?.sourceKeys).filter(key => {
      if (keysToReset.has(key)) return false;
      return ![...recordIds].some(id => key.startsWith(`${id}:`));
    });
    state.languageBank = { ...state.languageBank, speaking: bank.speaking, writing: bank.writing, sourceKeys: retainedKeys };
    languageBankSelection[kind] = Math.max(0, Math.min(index, items.length - 1));
    try {
      await saveState();
      renderLanguageBank();
      renderDailyWritingLanguage();
      renderDailySpeakingLanguage();
      showToast("语料已从本地文件删除；对应练习已恢复为可处理");
    } catch {
      state.languageBank = previous;
      renderLanguageBank();
      showToast("本地文件写入失败，未删除语料");
    }
  }

  function selectLanguageBankTab(kind) {
    languageBankTab = kind === "writing" ? "writing" : "speaking";
    $$('[data-language-tab]').forEach(button => {
      const active = button.dataset.languageTab === languageBankTab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    renderLanguageBankWorkspace();
  }

  function bilingualLanguageListMarkup(values) {
    return values.map(value => {
      const parts = bilingualLanguage(value);
      const translation = parts.chinese || "中文释义待补充；下次更新语料库时会自动完善";
      return `<li><span class="language-english">${escapeHtml(parts.english)}</span><small class="language-translation ${parts.chinese ? "" : "is-missing"}">${escapeHtml(translation)}</small></li>`;
    }).join("");
  }

  function renderLanguageBankWorkspace(bank = state.languageBank ? normalizeLanguageBank(state.languageBank) : null) {
    const menu = $("#languageBankMenu");
    const detail = $("#languageBankDetail");
    const items = languageBankTab === "speaking" ? (bank?.speaking || []) : writingLanguageCategories(bank?.writing || []);
    $("#languageTabSpeakingCount").textContent = bank?.speaking.length || 0;
    $("#languageTabWritingCount").textContent = writingLanguageCategories(bank?.writing || []).length;
    if (!items.length) {
      menu.className = "language-bank-menu empty-state";
      menu.textContent = languageBankTab === "speaking" ? "尚无个人口语素材" : "尚无写作语料";
      detail.className = "language-bank-detail empty-state";
      detail.textContent = "更新语料库后，可从左侧小卡片中选择一项查看。";
      return;
    }
    const selected = Math.min(languageBankSelection[languageBankTab] || 0, items.length - 1);
    languageBankSelection[languageBankTab] = selected;
    menu.className = "language-bank-menu";
    menu.innerHTML = items.map((item, index) => {
      const title = languageBankTab === "speaking" ? item.title : item.domain;
      const meta = languageBankTab === "speaking"
        ? `${item.reusableTopics.length} 个迁移话题 · ${item.expressions.length} 条表达`
        : `${item.collocations.length} 条搭配 · ${item.sentencePatterns.length} 个句式（每日少量轮换）`;
      return `<div class="language-menu-row"><button class="language-menu-card ${index === selected ? "is-active" : ""}" type="button" data-language-index="${index}" aria-pressed="${index === selected}"><span>${escapeHtml(title)}</span><small>${escapeHtml(meta)}</small></button><button class="language-card-delete" type="button" data-language-delete="${index}" aria-label="删除${escapeHtml(title)}语料">删除</button></div>`;
    }).join("");
    $$('[data-language-index]', menu).forEach(button => button.addEventListener("click", () => {
      languageBankSelection[languageBankTab] = Number(button.dataset.languageIndex);
      renderLanguageBankWorkspace(bank);
    }));
    $$('[data-language-delete]', menu).forEach(button => button.addEventListener("click", () => {
      deleteLanguageBankItem(languageBankTab, Number(button.dataset.languageDelete));
    }));
    const item = items[selected];
    detail.className = "language-bank-detail";
    if (languageBankTab === "speaking") detail.innerHTML =
      `<span class="kicker">PERSONAL SPEAKING MATERIAL</span><h3>${escapeHtml(item.title)}</h3><section class="language-detail-block language-personal-core"><h4>我的核心素材</h4><p>${escapeHtml(item.personalCore)}</p></section><section class="language-detail-block"><h4>可迁移话题</h4><div class="language-tags">${item.reusableTopics.map(text => `<span>${escapeHtml(text)}</span>`).join("")}</div></section><section class="language-detail-block"><h4>可复用表达</h4><ul class="bilingual-language-list">${bilingualLanguageListMarkup(item.expressions)}</ul></section><section class="language-detail-block"><h4>灵活答题骨架</h4><ul class="bilingual-language-list">${bilingualLanguageListMarkup(item.answerFrames)}</ul></section>`
    else {
      const collocations = dailyLanguageSlice(item.collocations, WRITING_MEMORY_LIMITS.collocations, `${item.domain}:collocations`);
      const sentencePatterns = dailyLanguageSlice(item.sentencePatterns, WRITING_MEMORY_LIMITS.sentencePatterns, `${item.domain}:patterns`);
      const savedCount = item.collocations.length + item.sentencePatterns.length;
      const visibleCount = collocations.length + sentencePatterns.length;
      const missingTranslations = [...item.collocations, ...item.sentencePatterns].filter(value => !bilingualLanguage(value).chinese).length;
      detail.innerHTML = `<span class="kicker">WRITING LANGUAGE</span><h3>${escapeHtml(item.domain)}</h3><div class="language-memory-note"><span>今天先记 ${visibleCount} 条；本类共保存 ${savedCount} 条，系统会每日轮换，不会删除原有内容。</span>${missingTranslations ? `<button type="button" data-enrich-language>补充中文释义</button>` : ""}</div>${collocations.length ? `<section class="language-detail-block"><h4>${item.domain === "通用表达" ? "通用衔接表达" : "领域核心搭配"}</h4><ul class="bilingual-language-list">${bilingualLanguageListMarkup(collocations)}</ul></section>` : ""}${sentencePatterns.length ? `<section class="language-detail-block"><h4>${item.domain === "通用表达" ? "提升流畅度的句式" : "可复用论证句式"}</h4><ul class="bilingual-language-list">${bilingualLanguageListMarkup(sentencePatterns)}</ul></section>` : ""}`;
      detail.querySelector('[data-enrich-language]')?.addEventListener("click", generateLanguageBank);
    }
  }

  function renderLanguageBank() {
    const bank = state.languageBank ? normalizeLanguageBank(state.languageBank) : null;
    const status = $("#languageBankStatus");
    status.replaceChildren();
    status.classList.add("hidden");
    if (!bank) {
      renderLanguageBankWorkspace(null);
      return;
    }
    const meta = state.languageBank;
    const migratedKeys = new Set(languageList(meta.sourceKeys));
    const currentSources = languageBankSource();
    [...currentSources.speaking, ...currentSources.writing].forEach(item => {
      if (migratedKeys.has(item.legacySourceKey)) migratedKeys.add(item.sourceKey);
    });
    const normalizedContent = JSON.stringify({ speaking: bank.speaking, writing: bank.writing });
    const storedContent = JSON.stringify({ speaking: Array.isArray(meta.speaking) ? meta.speaking : [], writing: Array.isArray(meta.writing) ? meta.writing : [] });
    const normalizedKeys = [...migratedKeys];
    if (normalizedContent !== storedContent || JSON.stringify(normalizedKeys) !== JSON.stringify(languageList(meta.sourceKeys))) {
      state.languageBank = { ...meta, speaking: bank.speaking, writing: bank.writing, sourceKeys: normalizedKeys };
      saveState().catch(() => undefined);
    }
    if (!bank[languageBankTab].length && bank[languageBankTab === "speaking" ? "writing" : "speaking"].length) languageBankTab = languageBankTab === "speaking" ? "writing" : "speaking";
    selectLanguageBankTab(languageBankTab);
  }

  function renderDailyWritingLanguage() {
    const root = $("#dailyWritingLanguage");
    if (!root) return;
    const bank = state.languageBank ? normalizeLanguageBank(state.languageBank) : null;
    const entries = writingLanguageCategories(bank?.writing || []).flatMap(item => [
      ...item.collocations.map(text => ({ domain: item.domain, kind: "词组与搭配", text })),
      ...item.sentencePatterns.map(text => ({ domain: item.domain, kind: "常用句式", text }))
    ]);
    if (!entries.length) {
      root.className = "daily-language-cards empty-state";
      root.textContent = "生成个人写作语料库后，这里会每天推荐少量搭配与句式。";
      return;
    }
    const dayIndex = Math.floor(new Date().setHours(0, 0, 0, 0) / 86400000);
    const count = Math.min(3, entries.length);
    const selected = Array.from({ length: count }, (_, index) => entries[(dayIndex * count + index) % entries.length]);
    root.className = "daily-language-cards";
    root.innerHTML = selected.map((item, index) => { const parts = bilingualLanguage(item.text); return `<article><span>${String(index + 1).padStart(2, "0")} · ${escapeHtml(item.domain)}</span><strong>${escapeHtml(parts.english)}</strong>${parts.chinese ? `<small class="daily-language-translation">${escapeHtml(parts.chinese)}</small>` : ""}<small>${escapeHtml(item.kind)} · 写完后检查是否自然准确</small></article>`; }).join("");
  }

  function renderDailySpeakingLanguage() {
    const root = $("#dailySpeakingLanguage");
    if (!root) return;
    const bank = state.languageBank ? normalizeLanguageBank(state.languageBank) : null;
    const saved = uniqueSpeakingLanguage((bank?.speaking || []).flatMap(item => [...item.expressions, ...item.answerFrames]));
    if (!saved.length) {
      root.className = "daily-language-cards empty-state";
      root.textContent = "生成个人口语语料后，这里会从真实口语记录中轮换少量表达。";
      return;
    }
    const selected = dailyLanguageSlice(saved, 3, "daily-speaking-fluency");
    root.className = "daily-language-cards";
    root.innerHTML = selected.map((text, index) => { const parts = bilingualLanguage(text); return `<article><span>${String(index + 1).padStart(2, "0")} · 可选</span><strong>${escapeHtml(parts.english)}</strong>${parts.chinese ? `<small class="daily-language-translation">${escapeHtml(parts.chinese)}</small>` : ""}<small>需要时自然带入，不必每题都用</small></article>`; }).join("");
  }

  function resizePracticeTextarea(element, minimum, maximum = 620) {
    if (!element?.style) return;
    element.style.height = "auto";
    const contentHeight = Number(element.scrollHeight) || minimum;
    element.style.height = `${Math.min(maximum, Math.max(minimum, contentHeight))}px`;
  }

  function refreshPracticeTextareas() {
    resizePracticeTextarea($("#writingPrompt"), 120);
    resizePracticeTextarea($("#speakingPrompt"), 88, 320);
    resizePracticeTextarea($("#speakingTranscript"), 210);
  }

  function languageBankBatches(source, maxChars = 18000) {
    const batches = [];
    for (const kind of ["speaking", "writing"]) {
      let batch = { speaking: [], writing: [] };
      let size = 0;
      for (const value of source[kind]) {
        const rowSize = JSON.stringify(value).length + 40;
        if (size && size + rowSize > maxChars) {
          batches.push(batch);
          batch = { speaking: [], writing: [] };
          size = 0;
        }
        batch[kind].push(value);
        size += rowSize;
      }
      if (batch[kind].length) batches.push(batch);
    }
    return batches;
  }

  function languagePayloadHasKind(payload, kind) {
    if (Array.isArray(payload?.[kind]) && payload[kind].length) return true;
    return Array.isArray(payload?.batches) && payload.batches.some(batch => languagePayloadHasKind(batch, kind));
  }

  function languagePayloadSourceKeys(payload, kind) {
    const direct = Array.isArray(payload?.[kind]) ? payload[kind].flatMap(item => languageList(item?.sourceKeys?.length ? item.sourceKeys : [item?.sourceKey])) : [];
    const nested = Array.isArray(payload?.batches) ? payload.batches.flatMap(batch => languagePayloadSourceKeys(batch, kind)) : [];
    return uniqueLanguage([...direct, ...nested]);
  }

  function languageTranslationBatches(bank, maxChars = 12000) {
    const normalizedBank = normalizeLanguageBank(bank);
    const speaking = normalizedBank.speaking.filter(item => [...item.expressions, ...item.answerFrames].some(value => !bilingualLanguage(value).chinese));
    const writing = writingLanguageCategories(normalizedBank.writing).filter(item => [...item.collocations, ...item.sentencePatterns].some(value => !bilingualLanguage(value).chinese));
    return languageBankBatches({ speaking, writing }, maxChars);
  }

  async function requestLanguageBank(payload, merge = false) {
    const system = `你是个人英语语料整理助手。${merge ? "输入是若干批次的结构化提炼结果；先识别语义相近的主题并合并，同义项只保留一次，补齐缺失的中文释义，并保留来源中具体、自然且易复用的表达。" : "只依据用户真实答题记录归纳，不补造经历、观点、身份或事实。"}输入只有口语记录时 speaking 才能有内容且 writing 必须为空；输入只有写作记录时 writing 才能有内容且 speaking 必须为空，绝对禁止把议论文观点、书面论证搭配或写作范文整理成口语个人素材。每一项的 sourceKeys 必须只填写实际使用过的输入 sourceKey。口语优先把同一个人的真实经历、偏好、人物、地点和物品整理成可跨陌生题目迁移的素材，同时保留自然、可说出口的英文表达和灵活答题骨架；reusableTopics 必须全部使用简短中文标签，不得输出英文标签；expressions 和 answerFrames 的每一个字符串都必须使用“英文｜简洁准确的中文翻译”格式，必须包含全角分隔符“｜”和中文释义；合并旧内容时也要为原来只有英文的项目补齐翻译；不要生成死板整段背诵答案。相似口语主题必须合并为一个主题，例如家乡食物、饺子、节日团聚和家庭记忆应在同一张主题卡中补充，不得仅因标题措辞不同而新建重复卡片。写作必须少而精，按“教育、科技、犯罪与法律、商业与经济、环境、健康、社会与公共政策、交通与城市、文化与媒体、通用表达”归类，没有内容的分类不要输出；相近小领域合并到最接近的大类。每个领域每次最多给 5 条短搭配和 3 个短句式，优先选择能表达原因、影响和解决方案的内容。另设“通用表达”一类，整理 however、such as、more importantly、in contrast、as a result 等提升衔接与流畅度的表达，不要在各领域重复。writing 中 collocations 和 sentencePatterns 的每一个字符串也必须使用“英文｜简洁准确的中文翻译”格式；合并旧内容时补齐翻译。只返回一个 JSON 对象，禁止 Markdown、代码块和额外文字。结构严格为 {summary:string,speaking:[{title:string,personalCore:string,reusableTopics:string[],expressions:string[],answerFrames:string[],sourceKeys:string[]}],writing:[{domain:string,collocations:string[],sentencePatterns:string[],sourceKeys:string[]}]}。所有键必须存在，数组无内容时返回空数组。`;
    const response = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      messages: [
        { role: "system", content: system },
        { role: "user", content: `${reviewLearnerContext("个人语料库")}\n\n${merge ? "待合并的分批结果" : "本批练习记录（不含录音与图片）"}：\n${JSON.stringify(payload)}` }
      ], temperature: 0, max_tokens: 6000, output_contract: "personal-language-bank-json-v1"
    }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "请求失败");
    const normalized = normalizeLanguageBank(parseAiJson(data.content));
    const speakingKeys = languagePayloadSourceKeys(payload, "speaking");
    const writingKeys = languagePayloadSourceKeys(payload, "writing");
    const attachKeys = (items, allowed) => items.map(item => {
      const accepted = languageList(item.sourceKeys).filter(key => allowed.includes(key));
      return { ...item, sourceKeys: accepted.length ? accepted : [...allowed] };
    });
    return {
      ...normalized,
      speaking: languagePayloadHasKind(payload, "speaking") ? attachKeys(normalized.speaking, speakingKeys) : [],
      writing: languagePayloadHasKind(payload, "writing") ? attachKeys(normalized.writing, writingKeys) : []
    };
  }

  async function generateLanguageBank() {
    if (!aiConnected) return routeTo("settings");
    const allSource = languageBankSource();
    const needsTranslation = writingLanguageNeedsTranslation() || speakingLanguageNeedsTranslation();
    if (!allSource.speaking.length && !allSource.writing.length && !needsTranslation) return showToast("先完成并保存至少一次口语或写作练习");
    const processed = new Set(Array.isArray(state.languageBank?.sourceKeys) ? state.languageBank.sourceKeys : []);
    [...allSource.speaking, ...allSource.writing].forEach(item => {
      if (processed.has(item.legacySourceKey)) processed.add(item.sourceKey);
    });
    const source = {
      speaking: allSource.speaking.filter(item => !processed.has(item.sourceKey)),
      writing: allSource.writing.filter(item => !processed.has(item.sourceKey))
    };
    const hasNewSource = source.speaking.length || source.writing.length;
    if (!hasNewSource && !needsTranslation) return showToast("当前没有尚未汇总或后来修改的答题记录");
    const button = $("#generateLanguageBank");
    button.disabled = true;
    const batches = languageBankBatches(source);
    $("#languageBankStatus").classList.remove("hidden");
    $("#languageBankStatus").innerHTML = hasNewSource
      ? `<div><strong>准备分批汇总 ${batches.length} 组记录…</strong><span>每批都控制在安全的上下文预算内；不发送录音或题目图片。</span></div>`
      : `<div><strong>准备补充中文释义…</strong><span>只完善已有写作语料的中文翻译，不删除原有英文内容。</span></div>`;
    try {
      const partials = [];
      for (let index = 0; index < batches.length; index += 1) {
        $("#languageBankStatus").innerHTML = `<div><strong>正在提炼第 ${index + 1} / ${batches.length} 批…</strong><span>长记录已按完整题目分组，不会把几十篇原文塞进一次请求。</span></div>`;
        partials.push(await requestLanguageBank(batches[index]));
      }
      $("#languageBankStatus").innerHTML = `<div><strong>正在合并并去重…</strong><span>最终请求只包含各批次的精简结果，不重复上传全部原文。</span></div>`;
      const extractedBank = partials.reduce((bank, partial) => mergeLanguageBanks(bank, partial), { summary: "", speaking: [], writing: [] });
      const newBank = extractedBank;
      let normalizedBank = mergeLanguageBanks(state.languageBank, newBank);
      const translationBatches = languageTranslationBatches(normalizedBank);
      for (let index = 0; index < translationBatches.length; index += 1) {
        $("#languageBankStatus").innerHTML = `<div><strong>正在补充中文释义 ${index + 1} / ${translationBatches.length}…</strong><span>旧英文会原样保留，只增加对应的简洁中文翻译。</span></div>`;
        normalizedBank = mergeLanguageBanks(normalizedBank, await requestLanguageBank({ batches: [translationBatches[index]] }, true));
      }
      if (!normalizedBank.speaking.length && !normalizedBank.writing.length) throw new Error("AI 返回的 JSON 没有可用语料，请重试或更换模型");
      state.languageBank = { ...normalizedBank, generatedAt: new Date().toISOString(), sourceCounts: { speaking: allSource.speaking.length, writing: allSource.writing.length }, sourceKeys: uniqueLanguage([...processed, ...source.speaking.map(item => item.sourceKey), ...source.writing.map(item => item.sourceKey)]) };
      await saveState(true);
      renderLanguageBank();
      renderDailyWritingLanguage();
      renderDailySpeakingLanguage();
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
    renderDailyWritingLanguage();
    renderDailySpeakingLanguage();
    renderPracticeOverviewPlans();
  }

  function bindEvents() {
    $("#sidebarCollapse").addEventListener("click", () => setSidebarCollapsed(!$(".app-shell").classList.contains("is-sidebar-collapsed")));
    $("#writingFocusMode").addEventListener("click", () => setPracticeFocus(true));
    $("#exitFocusMode").addEventListener("click", () => setPracticeFocus(false));
    $("#cancelLocalTranscription").addEventListener("click", () => localTranscriptionController?.abort());
    $("#retryLocalTranscription").addEventListener("click", () => {
      if (recordingBusy || recorder?.state === "recording") return;
      if ($("#speakingTranscript").value.trim() && !confirm("重新转写会替换编辑区文字。已保存的批改快照不变，是否继续？")) return;
      transcribeLocalRecording();
    });
    $("#closeReviewWorkspace").addEventListener("click", () => {
      const module = reviewWorkspaceSelection?.module || "writing";
      if (module === "writing") setWritingScreen("overview"); else setSpeakingScreen("overview");
      routeTo(module);
    });
    $("#closeReviewImageLightbox").addEventListener("click", closeReviewImageLightbox);
    $("#reviewImageLightbox").addEventListener("click", event => {
      if (event.target === event.currentTarget) closeReviewImageLightbox();
    });
    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && !$("#reviewImageLightbox").classList.contains("hidden")) closeReviewImageLightbox();
    });
    $("#retryReviewSource").addEventListener("click", async () => {
      if (reviewWorkspaceSelection?.module === "writing") return retryWritingFromReview();
      const id = reviewWorkspaceSelection?.id;
      if (id) await loadSpeaking(id);
      routeTo("speaking");
    });
    $("#newReviewSource").addEventListener("click", async () => {
      if (reviewWorkspaceSelection?.module === "speaking") { await newSpeaking(); routeTo("speaking"); }
      else { await newWriting(); routeTo("writing"); }
    });
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
      if (item.dataset.route === "writing") setWritingScreen("overview");
      if (item.dataset.route === "speaking") setSpeakingScreen("overview");
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
    $("#closeWritingSetup").addEventListener("click", async () => { await flushWritingAutosave(); setWritingScreen("overview"); });
    $$('[data-writing-filter]').forEach(button => button.addEventListener("click", () => {
      writingHistoryFilter = button.dataset.writingFilter;
      $$('[data-writing-filter]').forEach(item => item.classList.toggle("is-selected", item === button));
      renderWritingHistory();
    }));
    $("#startWritingSession").addEventListener("click", startWritingSession);
    $("#finishWritingSession").addEventListener("click", finishWritingSession);
    $$('[data-writing-type]').forEach(button => button.addEventListener("click", () => {
      $("#writingType").value = button.dataset.writingType;
      $("#writingMinutes").value = button.dataset.writingMinutes;
      resetWritingTimer();
      syncWritingTaskOptions();
    }));
    $$('[data-prompt-mode]').forEach(button => button.addEventListener("click", () => {
      const mode = button.dataset.promptMode;
      $$('[data-prompt-mode]').forEach(item => item.classList.toggle("is-selected", item === button));
      $("#writingPromptPanel").classList.toggle("hidden", mode === "image");
      $("#writingImagePanel").classList.toggle("hidden", mode === "text");
    }));
    $("#deleteWriting").addEventListener("click", () => deleteWritingRecord(activeWritingId));
    $("#writingEssay").addEventListener("input", updateWordCount);
    $("#writingPrompt").addEventListener("input", () => { refreshPracticeTextareas(); scheduleWritingAutosave(); });
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
    $("#recordButton").addEventListener("click", toggleRecording);
    $("#downloadRecording").addEventListener("click", () => recordingBlob && downloadBlob(recordingBlob, `EnglishLearnPath-speaking-${Date.now()}.webm`));
    $("#speechLanguage").addEventListener("change", () => { state.preferences.speechLanguage = $("#speechLanguage").value; saveState(); });
    $("#newSpeaking").addEventListener("click", () => newSpeaking());
    $("#closeSpeakingPractice").addEventListener("click", async () => { await flushSpeakingAutosave(); setSpeakingScreen("overview"); });
    $$('[data-speaking-filter]').forEach(button => button.addEventListener("click", () => {
      speakingHistoryFilter = button.dataset.speakingFilter;
      $$('[data-speaking-filter]').forEach(item => item.classList.toggle("is-selected", item === button));
      renderSpeakingHistory();
    }));
    $("#speakingPrompt").addEventListener("input", () => { refreshPracticeTextareas(); scheduleSpeakingAutosave(); });
    $("#speakingTranscript").addEventListener("input", () => { refreshPracticeTextareas(); scheduleSpeakingAutosave(); });
    $("#speakingPart").addEventListener("change", () => {
      if (speakingPhase !== "idle") return showToast("请先结束当前准备或录音，再切换题型");
      updateSpeakingPartGuide();
      scheduleSpeakingAutosave();
    });
    $("#deleteSpeaking").addEventListener("click", () => deleteSpeakingRecord(activeSpeakingId));
    $("#reviewSpeaking").addEventListener("click", reviewSpeaking);
    $("#generateLanguageBank").addEventListener("click", generateLanguageBank);
    $$('[data-language-tab]').forEach(button => button.addEventListener("click", () => selectLanguageBankTab(button.dataset.languageTab)));
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
    $("#startCorrectionStudy").addEventListener("click", () => startCorrectionStudy());
    $("#stopCorrectionStudy").addEventListener("click", () => {
      if (correctionSaving) return;
      correctionSession = null;
      renderNotebookPractice();
    });
    $("#correctionStudyAttempt").addEventListener("input", event => {
      if (correctionSession && !correctionSession.revealed && !correctionSaving) correctionSession.draft = event.target.value;
    });
    $("#revealCorrectionAnswer").addEventListener("click", () => {
      if (!correctionSession || correctionSaving) return;
      if (!correctionSession.draft.trim()) {
        correctionSession.error = "先填写你的修改；如果暂时不会，也可以写下疑问后查看参考。";
        renderCorrectionStudy();
        return;
      }
      correctionSession.error = "";
      correctionSession.revealed = true;
      renderCorrectionStudy();
    });
    $$('[data-correction-rating]').forEach(button => button.addEventListener("click", () => rateCorrection(button.dataset.correctionRating)));
    $("#startVocabularyStudy").addEventListener("click", startVocabularyStudy);
    $("#stopVocabularyStudy").addEventListener("click", () => { if (!vocabularySaving) { vocabularySession = null; renderVocabularyStudy(); } });
    $("#revealVocabularyAnswer").addEventListener("click", () => { if (vocabularySession) { vocabularySession.revealed = true; renderVocabularyStudy(); $("#vocabularyAgain").focus(); } });
    $("#vocabularyAgain").addEventListener("click", () => rateVocabulary(false));
    $("#vocabularyKnown").addEventListener("click", () => rateVocabulary(true));
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
      renderAll(); await newWriting(true); await newSpeaking(true); setWritingScreen("overview"); setSpeakingScreen("overview"); showToast("永久数据文件已清空，滚动备份已保留");
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
    await newWriting();
    await newSpeaking();
    setWritingScreen("overview");
    setSpeakingScreen("overview");
    refreshPracticeTextareas();
    await refreshAiStatus();
    await refreshTranscriptionStatus();
    routeTo(location.hash.slice(1) || "home");
  }

  initialize();
})();
