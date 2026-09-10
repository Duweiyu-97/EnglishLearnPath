// Developer-only browser regression. Uses synthetic empty data, never user files.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
let bound = true;
let data = { writings: [], speaking: [], mistakes: [] };
let planAttempts = 0;
let failNotebookSave = false;
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/data') {
      if (req.method === 'PUT') {
        if (failNotebookSave) { res.statusCode = 503; res.end(JSON.stringify({error:'Synthetic disk unavailable'})); return; }
        let body = ''; for await (const chunk of req) body += chunk;
        data = JSON.parse(body).data;
      }
      res.end(JSON.stringify({ data, storage: { bound, ready: bound, fileExists: false } }));
    } else if (req.url === '/api/ai/status') res.end(JSON.stringify({ connected: true, model: 'synthetic-deepseek' }));
    else if (req.url === '/api/ai/chat' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);
      if (request.output_contract !== 'study-plan-json-v1') { res.statusCode = 400; res.end(JSON.stringify({error:'unexpected synthetic contract'})); return; }
      planAttempts += 1;
      if (planAttempts === 1) { res.statusCode = 502; res.end(JSON.stringify({error:'模型服务暂时不可用'})); return; }
      const day = {writing:1,speaking:1,writingReview:1,writingRewrite:1,speakingReview:1,languageMinutes:15,reviewMinutes:30,note:'synthetic day'};
      const phases = ['重点强化','冲刺与调整'].map(name => ({name,focus:'synthetic focus',days:Array.from({length:7},()=>({...day}))}));
      res.end(JSON.stringify({content:JSON.stringify({summary:'synthetic retried plan',priorities:['review'],phases})}));
    }
    else { res.statusCode = 404; res.end('{}'); }
    return;
  }
  const file = path.join(root, 'app', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!file.startsWith(path.join(root, 'app') + path.sep)) { res.statusCode = 403; res.end(); return; }
  try {
    res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base);
    await page.locator('#storageOnboarding.hidden').waitFor({state:'attached'});
    assert.equal(await page.locator('[data-route="listening"], [data-route="reading"]').count(), 0);
    assert.equal(await page.locator('.skill-card').count(), 0, 'home must not repeat the writing and speaking launch cards');
    await page.locator('#sidebarCollapse').click();
    assert.equal(await page.locator('.app-shell').evaluate(node => node.classList.contains('is-sidebar-collapsed')), true);
    const collapsedControls = await page.evaluate(() => {
      const arrow = document.querySelector('#sidebarCollapse').getBoundingClientRect();
      const mark = document.querySelector('.brand-mark').getBoundingClientRect();
      return { arrowBottom: arrow.bottom, markTop: mark.top };
    });
    assert.ok(collapsedControls.arrowBottom < collapsedControls.markTop, 'collapsed sidebar arrow must not overlap the EL mark');
    await page.locator('#sidebarCollapse').click();
    await page.locator('.nav-item[data-route="language"]').click();
    assert.match(await page.locator('#generateLanguageBank').textContent(), /生成.*更新.*语料库/);
    assert.equal(await page.locator('#languageBankStatus').isVisible(), false, 'idle language generation status must not occupy a permanent card');
    data.languageBank = {
      summary:'Synthetic reusable language', generatedAt:'2026-09-09T08:00:00Z', sourceCounts:{speaking:2,writing:1},
      speaking:[
        {title:'Cycling with friends',personalCore:'I cycle with close friends on weekends.',reusableTopics:['hobbies','friends'],expressions:['clear my mind｜放松头脑','stay connected｜保持联系'],answerFrames:['I enjoy..., because...｜回答后说明原因']},
        {title:'A familiar park',personalCore:'The park near my home is quiet.',reusableTopics:['places'],expressions:['within walking distance｜步行可达'],answerFrames:['I would describe it as...｜描述这个地方']}
      ],
      writing:[
        {domain:'Education',collocations:['increase earning potential｜提高收入潜力','reduce crime rates｜降低犯罪率','drive technological progress｜推动科技进步','equal access to education｜平等接受教育的机会','practical skills｜实用技能','lifelong learning｜终身学习'],sentencePatterns:['It is important to ensure that...｜确保……十分重要','Education can play a central role in...｜教育可以在……中发挥核心作用','This investment enables people to...｜这项投入使人们能够……','A fourth pattern should rotate.｜第四个句式用于轮换']},
        {domain:'General linking',collocations:[{english:'however',translation:'然而'},{unexpected:{nested:true}},'such as｜例如','more importantly｜更重要的是','as a result｜因此','in contrast｜相比之下','for instance｜例如'],sentencePatterns:['While this view is understandable, ...｜尽管这种观点可以理解，……','A more important consideration is that...｜更重要的考虑是……','This is particularly evident when...｜这一点在……时尤为明显','A fourth general pattern should rotate.｜第四个通用句式用于轮换']}
      ]
    };
    await page.reload();
    assert.equal(await page.locator('[data-language-index]').count(),2);
    assert.equal(await page.locator('#languageBankDetail > h3').textContent(),'Cycling with friends');
    await page.locator('[data-language-index="1"]').click();
    assert.equal(await page.locator('#languageBankDetail > h3').textContent(),'A familiar park');
    await page.locator('#languageTabWriting').click();
    assert.equal(await page.locator('[data-language-index]').count(),2);
    assert.equal(await page.locator('#languageBankDetail > h3').textContent(),'教育');
    assert.equal(await page.locator('#languageBankDetail li').count(),8,'writing shows a recall-sized daily set without deleting saved entries');
    assert.equal(await page.locator('#languageBankDetail .language-translation').count(),8,'every visible writing expression includes a Chinese translation');
    assert.match(await page.locator('.language-memory-note').textContent(),/本类共保存 10 条/);
    await page.locator('[data-language-index="1"]').click();
    assert.equal(await page.locator('#languageBankDetail > h3').textContent(),'通用表达');
    assert.equal(await page.locator('.language-bank-detail').count(),1,'only the selected language card may be expanded');
    assert.match(await page.locator('#languageBankDetail').textContent(),/however.*然而/s,'known object-shaped language is normalized');
    assert.doesNotMatch(await page.locator('#languageBankDetail').textContent(),/\[object Object\]|unexpected|nested/,'unknown object-shaped language is discarded');
    await page.locator('.nav-item[data-route="home"]').click();
    await page.screenshot({path:path.join(process.env.TEMP || root, 'elp-home.png'), fullPage:true, animations:'disabled'});
    data.writings = [
      {id:'task-one',type:'Task 1 Academic',minutes:20,prompt:'Describe a chart.',essay:'A chart response.',review:'Reviewed',status:'completed',updatedAt:'2026-09-08T10:00:00Z'},
      {id:'task-two',type:'Task 2',minutes:40,prompt:'Discuss public transport.',essay:'An essay response.',status:'completed',updatedAt:'2026-09-09T10:00:00Z'}
    ];
    data.speaking = [
      {id:'part-one',part:'p1',prompt:'Do you enjoy cycling?',transcript:'Yes I do.',review:'Reviewed',duration:24,createdAt:'2026-09-08T10:00:00Z',updatedAt:'2026-09-08T10:00:00Z'},
      {id:'part-two',part:'p2',prompt:'Describe a useful object.',transcript:'I would like to describe my laptop.',duration:82,createdAt:'2026-09-09T10:00:00Z',updatedAt:'2026-09-09T10:00:00Z'}
    ];
    await page.reload();
    await page.locator('.nav-item[data-route="writing"]').click();
    assert.equal(await page.locator('#writingOverviewView').isVisible(), true, 'writing opens on its overview');
    assert.equal(await page.locator('#writingSetupView').isVisible(), false, 'writing setup opens only after New Practice');
    assert.equal(await page.locator('#dailyWritingLanguage article').count(), 3, 'writing overview keeps the daily recall set small');
    assert.equal(await page.locator('#dailyWritingLanguage .daily-language-translation').count(), 3, 'daily writing prompts include Chinese translations');
    assert.equal(await page.locator('#saveWriting').count(), 0);
    assert.equal(await page.locator('#openWritingReview').count(), 0, 'reviewed history opens reports directly without a separate button');
    assert.deepEqual(await page.locator('#writingHistory .history-group-heading span').allTextContents(), ['Task 1 · 小作文','Task 2 · 大作文']);
    await page.locator('[data-writing-filter="task1"]').click();
    assert.equal(await page.locator('#writingHistory [data-writing-id]').count(),1);
    assert.equal(await page.locator('#writingHistory [data-writing-id]').first().getAttribute('data-writing-id'),'task-one');
    await page.locator('[data-writing-filter="task2"]').click();
    assert.equal(await page.locator('#writingHistory [data-writing-id]').count(),1);
    await page.locator('[data-writing-filter="all"]').click();
    await page.locator('#newWriting').click();
    assert.equal(await page.locator('#writingSetupView').isVisible(), true);
    await page.locator('[data-writing-type="Task 1 Academic"]').click();
    assert.equal(await page.locator('#writingMinutes').inputValue(), '20');
    assert.equal(await page.locator('#writingTimer').textContent(), '20:00');
    await page.screenshot({path:path.join(process.env.TEMP || root, 'elp-writing.png'), fullPage:true, animations:'disabled'});
    await page.locator('[data-writing-type="Task 2"]').click();
    assert.equal(await page.locator('#writingMinutes').inputValue(), '40');
    await page.locator('#writingPrompt').fill('Discuss whether public transport should be free.');
    await page.locator('#startWritingSession').click();
    await page.locator('#writingSessionView').waitFor({state:'visible'});
    assert.equal(await page.locator('#writingSetupView').isVisible(), false);
    assert.equal(await page.locator('#writingSessionView').isVisible(), true);
    assert.match(await page.locator('#writingSessionQuestion').textContent(), /public transport/);
    await page.locator('#writingEssay').fill("One, two! 2026 7.5 don't well-known.");
    assert.equal(await page.locator('#wordCount').textContent(), '4', 'letters count as words while numbers and punctuation do not');
    await page.screenshot({path:path.join(process.env.TEMP || root, 'elp-writing-session.png'), fullPage:true, animations:'disabled'});
    await page.locator('#toggleTimer').click();
    assert.equal(await page.locator('#writingEssay').evaluate(node => node.readOnly), true, 'pausing locks answer editing');
    const pausedAnswer = await page.locator('#writingEssay').inputValue();
    await page.locator('#writingEssay').focus();
    await page.keyboard.type('Must not be inserted while paused');
    assert.equal(await page.locator('#writingEssay').inputValue(), pausedAnswer);
    assert.match(await page.locator('#writingAnswerHint').textContent(), /已暂停/);
    await page.locator('#toggleTimer').click();
    assert.equal(await page.locator('#writingEssay').evaluate(node => node.readOnly), false, 'resuming unlocks the original answer');
    assert.equal(await page.locator('#writingEssay').inputValue(), pausedAnswer);
    await page.locator('#toggleTimer').click();
    assert.equal(await page.locator('body').getAttribute('class'), 'practice-focus');
    assert.equal(await page.locator('#writingFocusMode').isVisible(), false, 'focus entry must disappear after focus mode starts');
    assert.equal(await page.locator('#exitFocusMode').isVisible(), true);
    assert.equal(await page.locator('#exitFocusMode').evaluate(node => node.classList.contains('button-secondary')), true, 'exit focus uses the same secondary button system as the timer action');
    const focusActionStyles = await page.evaluate(() => {
      const pause = getComputedStyle(document.querySelector('#toggleTimer'));
      const exit = getComputedStyle(document.querySelector('#exitFocusMode'));
      return {pauseHeight:pause.height, exitHeight:exit.height, pauseRadius:pause.borderRadius, exitRadius:exit.borderRadius};
    });
    assert.deepEqual(focusActionStyles, {pauseHeight:focusActionStyles.pauseHeight,exitHeight:focusActionStyles.pauseHeight,pauseRadius:focusActionStyles.pauseRadius,exitRadius:focusActionStyles.pauseRadius});
    assert.equal(await page.locator('.writing-session-footer').isVisible(), false, 'post-answer actions must stay out of the focused writing flow');
    await page.locator('#exitFocusMode').click();
    await page.locator('.nav-item[data-route="speaking"]').click();
    assert.equal(await page.locator('#speakingOverviewView').isVisible(), true, 'speaking opens on its overview');
    assert.equal(await page.locator('#speakingPracticeView').isVisible(), false, 'speaking recorder opens only after New Practice');
    assert.equal(await page.locator('#dailySpeakingLanguage article').count(), 3, 'speaking overview offers three optional fluency expressions');
    assert.equal(await page.locator('#dailySpeakingLanguage .daily-language-translation').count(), 3, 'shared fluency expressions retain Chinese translations');
    assert.doesNotMatch(await page.locator('#dailySpeakingLanguage').textContent(),/however|highest rating|dissatisfaction rate|account for/i,'speaking overview must never source writing language');
    assert.equal(await page.locator('#saveSpeaking').count(), 0);
    assert.equal(await page.locator('#browserTranscribe').count(), 0);
    assert.equal(await page.locator('#transcriptionEngine').count(), 0);
    assert.equal(await page.locator('#speakingFocusMode').count(), 0, 'speaking must not expose a focus mode');
    assert.equal(await page.locator('#openSpeakingReview').count(), 0, 'speaking reports open from reviewed history only');
    assert.deepEqual(await page.locator('[data-speaking-filter]').allTextContents(), ['全部','Part 1','Part 2','Part 3','自由']);
    assert.deepEqual(await page.locator('#speakingHistory .history-group-heading span').allTextContents(), ['Part 1 · 简短问答','Part 2 · 个人陈述']);
    await page.locator('[data-speaking-filter="p1"]').click();
    assert.equal(await page.locator('#speakingHistory [data-speaking-id]').count(),1);
    await page.locator('[data-speaking-filter="p2"]').click();
    assert.equal(await page.locator('#speakingHistory [data-speaking-id]').count(),1);
    await page.locator('[data-speaking-filter="all"]').click();
    await page.locator('#newSpeaking').click();
    assert.equal(await page.locator('#speakingPracticeView .speaking-grid.panel').count(), 1, 'speaking practice uses one unified panel');
    assert.equal(await page.locator('#speakingPracticeView .speaking-recorder.panel, #speakingPracticeView .transcript-panel.panel').count(), 0, 'speaking columns are not separate cards');
    assert.equal(await page.locator('#recordButton').textContent(), '开始录音并转写');
    const timerTypography = await page.evaluate(() => {
      const writing = getComputedStyle(document.querySelector('#writingTimer'));
      const speaking = getComputedStyle(document.querySelector('#recordPulse span'));
      return { writingSize: writing.fontSize, speakingSize: speaking.fontSize, writingFamily: writing.fontFamily, speakingFamily: speaking.fontFamily };
    });
    assert.equal(timerTypography.speakingSize, timerTypography.writingSize, 'speaking and writing timers use the same digit size');
    assert.equal(timerTypography.speakingFamily, timerTypography.writingFamily, 'speaking and writing timers use the same typeface');
    await page.locator('#speakingPart').selectOption('p2');
    assert.equal(await page.locator('#recordButton').textContent(), '开始 1 分钟准备');
    assert.match(await page.locator('#speakingPartGuide').textContent(), /准备 1 分钟.*2 分钟/);
    await page.locator('#speakingPart').selectOption('p1');
    await page.screenshot({path:path.join(process.env.TEMP || root, 'elp-speaking.png'), fullPage:true, animations:'disabled'});
    await page.locator('.nav-item[data-route="plan"]').click();
    assert.equal(await page.locator('#manualListening, #manualReading').count(), 0);
    assert.equal(await page.locator('.manual-targets input').count(), 7);
    assert.equal(await page.locator('#manualWriting').getAttribute('max'), '1');
    assert.equal(await page.locator('#manualSpeaking').getAttribute('max'), '2');
    assert.equal(await page.locator('.plan-layout').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length),1,'plan editor and result must stack vertically');
    const exam = new Date(); exam.setDate(exam.getDate() + 20);
    const examDate = `${exam.getFullYear()}-${String(exam.getMonth() + 1).padStart(2,'0')}-${String(exam.getDate()).padStart(2,'0')}`;
    await page.locator('#planExamDate').fill(examDate);
    await page.locator('#planCurrentLevel').fill('写作 6.0，口语 5.5');
    await page.locator('#planTargetLevel').fill('写作 7.0，口语 6.5');
    await page.locator('#manualWriting').fill('1');
    await page.locator('#manualSpeaking').fill('2');
    await page.locator('#manualWritingReview').fill('1');
    await page.locator('#manualWritingRewrite').fill('0');
    await page.locator('#manualSpeakingReview').fill('1');
    await page.locator('#manualLanguage').fill('12');
    await page.locator('#manualReview').fill('25');
    await page.locator('#saveManualPlan').click();
    assert.deepEqual(await page.locator('.manual-plan-values span').allTextContents(), ['新写作 1 篇','新口语 2 次','写作精改 1 次','重写 0 篇','口语回听 1 次','语料记忆 12 分钟','错题与单词 25 分钟']);
    await page.locator('#generateAiPlan').click();
    await page.waitForFunction(() => document.querySelector('#planResult').textContent.includes('AI 已生成覆盖'));
    assert.equal(planAttempts,2,'one plan action retries one transient DeepSeek response automatically');
    assert.equal(data.studyPlan.source,'ai');
    assert.equal(data.studyPlan.summary,'synthetic retried plan');
    await page.locator('#saveManualPlan').click();
    assert.equal(data.studyPlan.source,'manual','manual fixture is restored for the remaining plan interaction checks');
    await page.screenshot({path:path.join(process.env.TEMP || root, 'elp-plan.png'), fullPage:true, animations:'disabled'});
    await page.locator('.nav-item[data-route="writing"]').click();
    const writingPlanCheck = page.locator('#writingOverviewPlan [data-overview-plan-check]').first();
    await writingPlanCheck.check();
    assert.equal(await writingPlanCheck.isChecked(), true, 'writing overview tasks can be completed in place');
    await page.locator('.nav-item[data-route="speaking"]').click();
    const speakingPlanCheck = page.locator('#speakingOverviewPlan [data-overview-plan-check]').first();
    await speakingPlanCheck.check();
    assert.equal(await speakingPlanCheck.isChecked(), true, 'speaking overview uses the same completion interaction');
    await page.locator('.nav-item[data-route="home"]').click();
    assert.equal(await page.locator('#todayPlanSummary .today-module-summary').count(), 2, 'home shows only writing and speaking completion summaries');
    assert.deepEqual(await page.locator('#todayPlanSummary .today-module-summary strong').allTextContents(), ['1/2','1/3'], 'module completion clicks update the home summary');
    assert.equal(await page.locator('#todayPlanDetails').getAttribute('open'), null, 'task details stay collapsed by default');
    await page.screenshot({path:path.join(process.env.TEMP || root, 'elp-home-with-plan.png'), fullPage:true, animations:'disabled'});
    await page.locator('.nav-item[data-route="mistakes"]').click();
    assert.equal(await page.locator('select#mistakeModule').count(), 0);
    assert.deepEqual(await page.locator('[data-mistake-module]').evaluateAll(buttons => buttons.map(b => b.dataset.mistakeModule)), ['writing','speaking','vocabulary']);
    for (const module of ['speaking','vocabulary','writing']) {
      const before = (data.mistakes || []).length;
      await page.locator(`[data-mistake-module="${module}"]`).click();
      assert.equal(await page.locator('#mistakeModule').inputValue(), module);
      assert.equal(await page.locator('[data-mistake-module][aria-pressed="true"]').count(), 1);
      assert.equal(await page.locator(`[data-mistake-module="${module}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal((data.mistakes || []).length, before, 'category buttons must not submit the form');
      await page.locator('#mistakeTitle').fill('UI test');
      await page.locator('#mistakeText').fill('Synthetic note');
      await page.locator('#mistakeImageInput').setInputFiles({name:'note.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
      await page.locator('#mistakeImagePreview .notebook-image-preview').click();
      assert.equal(await page.locator('#reviewImageLightbox').isVisible(), true);
      assert.equal((data.mistakes || []).length, before, 'preview must not submit the notebook form');
      await page.keyboard.press('Escape');
      await page.locator('#mistakeForm button[type="submit"]').click();
      await page.waitForFunction(count => document.querySelector('#mistakeCount').textContent === String(count), before + 1);
      assert.equal(data.mistakes.at(-1).module, module);
      await page.locator('#mistakeList .notebook-image-preview').first().focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#reviewImageLightbox').isVisible(), true);
      assert.equal(await page.locator('#reviewImageLightboxImage').getAttribute('src'), data.mistakes.at(-1).images[0]);
      await page.locator('#closeReviewImageLightbox').click();
      assert.equal(await page.locator('#reviewImageLightbox').isVisible(), false);
    }
    await page.locator('[data-mistake-filter="vocabulary"]').click();
    assert.equal(await page.locator('#vocabularyStudy').isVisible(), true);
    await page.locator('#startVocabularyStudy').click();
    assert.equal(await page.locator('#mistakeList').isVisible(), false, 'hide saved definitions during recall');
    assert.equal(await page.locator('#vocabularyStudyAnswer').isVisible(), false);
    assert.equal(await page.locator('#vocabularyStudyRating').isVisible(), false);
    await page.locator('#revealVocabularyAnswer').click();
    assert.match(await page.locator('#vocabularyStudyAnswer').textContent(), /Synthetic note/);
    await page.locator('#vocabularyStudyAnswer .notebook-image-preview').click();
    assert.equal(await page.locator('#reviewImageLightbox').isVisible(), true);
    await page.keyboard.press('Escape');
    failNotebookSave = true;
    await page.locator('#vocabularyKnown').click();
    await page.waitForFunction(() => document.querySelector('#vocabularyStudyStatus').textContent.includes('保存失败'));
    assert.equal(data.mistakes.find(item => item.module === 'vocabulary').vocabularyReview, undefined);
    assert.equal(await page.locator('#vocabularyStudyAnswer').isVisible(), true, 'failed save keeps the revealed card for retry');
    failNotebookSave = false;
    await page.locator('#vocabularyAgain').click();
    await page.locator('#vocabularyStudyAnswer').waitFor({state:'hidden'});
    assert.equal(data.mistakes.find(item => item.module === 'vocabulary').vocabularyReview.level, 0);
    for (const width of [1440, 390]) {
      await page.setViewportSize({width,height:1050});
      assert.equal(await page.locator('#vocabularyStudy').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    }
    await page.setViewportSize({width:1440,height:1050});
    await page.locator('#revealVocabularyAnswer').click();
    await page.screenshot({path:path.join(process.env.TEMP || root,'elp-vocabulary-study.png'),fullPage:true,animations:'disabled'});
    await page.locator('#vocabularyKnown').click();
    await page.waitForFunction(() => document.querySelector('#vocabularyStudyStatus').textContent.includes('本轮完成'));
    const learned = data.mistakes.find(item => item.module === 'vocabulary').vocabularyReview;
    assert.equal(learned.level, 1);
    assert.ok(learned.dueDate > learned.lastReviewedDate);
    assert.equal(await page.locator('#startVocabularyStudy').isDisabled(), true);
    await page.reload();
    await page.locator('[data-mistake-filter="vocabulary"]').click();
    assert.equal(await page.locator('#startVocabularyStudy').isDisabled(), true, 'persisted next-review date survives reload');
    assert.match(await page.locator('#vocabularyStudySummary').textContent(), /今日已练 1/);
    await page.locator('#mistakeList .notebook-image-preview').first().click();
    assert.equal(await page.locator('#reviewImageLightbox').isVisible(), true, 'saved notebook images still zoom after reload');
    await page.keyboard.press('Escape');
    for (const width of [1440, 780, 390]) {
      await page.setViewportSize({width, height:1050});
      const card = page.locator('.mistake-entry').first();
      const {box, button} = await card.evaluate(node => ({box:node.getBoundingClientRect().toJSON(),button:node.querySelector('[data-delete-mistake]').getBoundingClientRect().toJSON()}));
      assert.ok(button.height <= 32 && button.width <= 50, 'notebook delete must remain compact');
      assert.ok(button.x > box.x && button.x + button.width < box.x + box.width, 'delete stays inside card');
      assert.ok(button.y >= box.y && button.y - box.y < 24, 'delete stays at top-right');
    }
    await page.screenshot({path:path.join(root, 'dist/notebook-delete-check.png'), fullPage:true, animations:'disabled'});
    await page.setViewportSize({width:1440,height:1050});
    await page.locator('[data-mistake-filter="all"]').click();
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    const shortPageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    data.mistakes.push(...Array.from({length:40}, (_, index) => ({id:`long-note-${index}`,module:'writing',title:`Practice ${index}`,text:'Review the original answer and explain the correction.\n'.repeat(12),createdAt:'2026-09-10T10:00:00Z'})));
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#mistakeCount').textContent === '43');
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight) <= shortPageHeight, 'adding notebook records must not extend the page');
    for (const width of [1440,780,390]) {
      await page.setViewportSize({width,height:1050});
      const layout = await page.evaluate(() => {
        const composer = document.querySelector('.mistake-composer');
        const library = document.querySelector('.mistake-library');
        const scroll = document.querySelector('.mistake-library-scroll');
        scroll.scrollTop = scroll.scrollHeight;
        return {left:composer.getBoundingClientRect().height,right:library.getBoundingClientRect().height,scrolls:scroll.scrollHeight>scroll.clientHeight,reachedEnd:Math.abs(scroll.scrollTop+scroll.clientHeight-scroll.scrollHeight)<2,fits:scroll.scrollWidth<=scroll.clientWidth+1};
      });
      if (width > 1100) assert.equal(layout.left, layout.right, 'library follows the full composer height on desktop');
      assert.equal(await page.locator('.mistake-composer').evaluate(el => el.scrollHeight <= el.clientHeight + 1), true, 'all composer fields and save controls fit without panel scrolling');
      assert.ok(layout.scrolls && layout.reachedEnd && layout.fits, 'long notes remain accessible with internal vertical scrolling');
    }
    await page.setViewportSize({width:1440,height:1050});
    await page.evaluate(() => { document.querySelector('.mistake-library-scroll').scrollTop=0; window.scrollTo(0,0); });
    await page.screenshot({path:path.join(process.env.TEMP || root,'elp-notebook-scroll.png'),fullPage:true,animations:'disabled'});
    bound = false;
    await page.reload();
    await page.locator('#storageOnboarding').waitFor({state:'visible'});
    await page.screenshot({path:path.join(process.env.TEMP || root, 'elp-storage.png'), fullPage:true, animations:'disabled'});
    assert.deepEqual(errors, []);
    console.log('UI regression passed; refreshed screenshots contain no user records or paths.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
