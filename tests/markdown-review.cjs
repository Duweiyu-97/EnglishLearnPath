// Synthetic records only: no real API calls, keys, audio or user data.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const markdown = '### 总体表现\n\n**重点**与 *表达*\n\n- 第一项\n- 第二项\n\n---\n\n> 建议\n\n| 原文 | 修改 |\n| --- | --- |\n| a | b |\n\n```text\n<script>unsafe()</script>\n```\n\n[官方链接](https://example.com)\n\n<img src="https://tracking.invalid/pixel" onerror="window.pwned=1"><script>window.pwned=1</script>[坏链接](javascript:alert(1))';
let data = {
  writings: [{ id: 'w1', type: 'Task 2', minutes: 40, prompt: 'Writing question', essay: 'Original essay', review: markdown, updatedAt: '2026-09-01T10:00:00Z' }],
  speaking: [{ id: 's1', part: 'p1', prompt: 'Do you enjoy cycling?', transcript: 'I like cycling.', punctuationSource:'I like cycling.', punctuatedTranscript:'I like cycling.', review: markdown, updatedAt: '2026-09-01T10:00:00Z', audio: 'data:audio/webm;base64,dGVzdA==' }],
  mistakes: []
};
let chatCalls = 0;
let punctuationResponse = 'I like cycling.';
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  if (req.url.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/data') {
      if (req.method === 'PUT') { let body=''; for await(const chunk of req) body+=chunk; data=JSON.parse(body).data; }
      res.end(JSON.stringify({ data, storage: { bound: true, ready: true } }));
    } else if (req.url === '/api/ai/status') res.end(JSON.stringify({ connected: true, model: 'synthetic' }));
    else if (req.url === '/api/ai/chat') { chatCalls++; let body=''; for await (const chunk of req) body+=chunk; const request=JSON.parse(body); res.end(JSON.stringify({ content:request.messages[0].content.startsWith('只为用户提供') ? punctuationResponse : markdown })); }
    else { res.statusCode=404; res.end('{}'); }
    return;
  }
  const file=path.join(root,'app',req.url==='/'?'index.html':req.url.split('?')[0]);
  if (!file.startsWith(path.join(root,'app')+path.sep)) { res.statusCode=403; return res.end(); }
  try {
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.statusCode=404; res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[], external=[];
    page.on('pageerror',err=>errors.push(err.message));
    page.on('request',request=>{ if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:')) external.push(request.url()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/#speaking`);
    await page.locator('[data-speaking-id="s1"]').click();
    async function checkMarkdown(selector) {
      assert.equal(await page.locator(`${selector} strong`).textContent(),'重点');
      assert.equal(await page.locator(`${selector} ul li`).count(),2);
      assert.equal(await page.locator(`${selector} .markdown-table-scroll table`).count(),1);
      assert.equal(await page.locator(`${selector} hr`).count(),1);
      assert.equal(await page.locator(`${selector} script, ${selector} img, ${selector} [onerror], ${selector} a[href^="javascript:"]`).count(),0);
      assert.equal(await page.locator(`${selector} a[href="https://example.com"]`).getAttribute('rel'),'noopener noreferrer');
    }
    assert.match(page.url(), /#review\/speaking\/s1$/);
    await checkMarkdown('#reviewOverviewSummary');
    assert.equal(await page.locator('#reviewWorkspacePrompt').textContent(),'Do you enjoy cycling?');
    assert.equal(await page.locator('#reviewWorkspaceOriginal').textContent(),'I like cycling.');
    assert.equal(await page.locator('#reviewWorkspaceAudio').isVisible(),true);
    assert.match(await page.locator('#reviewWorkspaceAudio').getAttribute('src'), /^blob:/, 'audio must comply with the launcher CSP');
    assert.equal(chatCalls,0,'opening a review must not call AI');
    await page.locator('#editReviewSource').click();
    assert.equal(await page.locator('#reviewWorkspace').isVisible(),false);
    assert.equal(await page.locator('#speakingTranscript').inputValue(),'I like cycling.');
    assert.equal(await page.locator('#speakingReview').isVisible(),false,'editor must not display the old report');
    await page.locator('#reviewSpeaking').click();
    await page.waitForURL('**/#review/speaking/s1');
    await page.waitForTimeout(100);
    assert.equal(data.speaking[0].review,markdown,'persist the original Markdown');
    assert.equal(data.speaking[0].reviewInput.original,'I like cycling.');
    assert.equal(await page.locator('#reviewWorkspace').isVisible(),true,'finished feedback opens the dedicated report');
    await page.locator('#closeReviewWorkspace').click();
    await page.locator('#speakingTranscript').fill('A later edit.');
    await page.locator('#openSpeakingReview').click();
    assert.equal(await page.locator('#reviewWorkspaceOriginal').textContent(),'I like cycling.');
    await page.locator('#closeReviewWorkspace').click();
    assert.equal(await page.locator('#speakingTranscript').inputValue(),'A later edit.');
    await page.locator('.nav-item[data-route="writing"]').click();
    await page.locator('[data-writing-id="w1"]').click();
    assert.match(page.url(), /#review\/writing\/w1$/);
    await page.locator('#editReviewSource').click();
    assert.equal(await page.locator('#writingReview').isVisible(),false,'editor must not display the old report');
    await page.locator('#reviewWriting').click();
    await page.waitForURL('**/#review/writing/w1');
    await page.waitForTimeout(100);
    assert.equal(data.writings[0].reviewInput.original,'Original essay');
    assert.equal(await page.locator('#reviewWorkspace').isVisible(),true);
    await checkMarkdown('#reviewOverviewSummary');
    assert.equal(await page.locator('#reviewWorkspacePrompt').textContent(),'Writing question');
    assert.equal(await page.locator('#reviewWorkspaceAudio').isVisible(),false);
    assert.equal(await page.locator('#reviewWorkspaceNavigation button').count(),1);
    assert.equal(await page.locator('#reviewWorkspaceFeedback .review-report-card').count(),0);
    const orderedReport = await page.evaluate(() => {
      const source = '主题：城市交通\n\n### 评分与小分\n\n**总分：6.5**\n\n| 小分 | 分数 |\n|---|---|\n| TR | 6.5 |\n\n### 总体评价\n\n任务完成清晰。\n\n### 确定语法错误\n\n没有确定错误。\n\n### 原文优化建议\n\n可补充例证。\n\n### 目标水平范文\n\nModel answer.\n\n### 最终值得记忆的语料\n\npublic transport';
      window.renderReviewReport(document.querySelector('#reviewWorkspaceFeedback'), source, document.querySelector('#reviewWorkspaceNavigation'), {scoreElement:document.querySelector('#reviewScoreSummary'),overviewElement:document.querySelector('#reviewOverviewSummary')});
      return {
        score:document.querySelector('#reviewScoreSummary').textContent,
        overview:document.querySelector('#reviewOverviewSummary').textContent,
        report:document.querySelector('#reviewWorkspaceFeedback').textContent,
        headings:[...document.querySelectorAll('#reviewWorkspaceFeedback h3')].map(node=>node.textContent)
      };
    });
    assert.match(orderedReport.score,/总分：6.5/);
    assert.match(orderedReport.overview,/任务完成清晰/);
    assert.doesNotMatch(orderedReport.report,/主题：城市交通|评分与小分|总体评价/);
    assert.deepEqual(orderedReport.headings,['确定语法错误','原文优化建议','目标水平范文','最终值得记忆的语料']);
    const annotated = await page.evaluate(() => {
      const original = 'I likes cycling. It make me happy. Same. Same.';
      const markdown = '### 逐句纠错\n\n| 原文 | 修改 | 类型 | 原因 |\n| --- | --- | --- | --- |\n| I likes | I like | 语法 | 主谓一致 |\n| Same. | Different. | 表达 | 重复片段 |\n| not present | other | 表达 | 不匹配 |\n| likes cycling | like cycling | 语法 | 重叠 |\n\n- **原文**: `...It make me happy....`\n  - **局部修改**: `It makes me happy.`\n  - **错误类型**: 语法\n  - **原因**: 主谓一致';
      window.renderReviewAnnotations({ original, markdown, originalElement:document.querySelector('#reviewWorkspaceOriginal'), correctionsElement:document.querySelector('#reviewCorrections'), countElement:document.querySelector('#reviewAnnotationCount'), noticeElement:document.querySelector('#reviewAnnotationNotice') });
      window.renderReviewReport(document.querySelector('#reviewWorkspaceFeedback'), markdown, document.querySelector('#reviewWorkspaceNavigation'));
      return { original:document.querySelector('#reviewWorkspaceOriginal').textContent, marks:document.querySelectorAll('.annotation-mark').length, cards:document.querySelectorAll('.correction-card').length };
    });
    assert.equal(annotated.original,'I likes cycling. It make me happy. Same. Same.');
    assert.equal(annotated.marks,2);
    assert.equal(annotated.cards,5);
    await page.locator('.annotation-mark').first().click();
    assert.equal(await page.locator('#review-correction-0').getAttribute('class'),'correction-card is-selected');
    assert.equal(await page.locator('.correction-return').count(),2,'only exactly located corrections offer return navigation');
    await page.locator('#review-correction-0 .correction-return').click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'review-original-0');
    assert.equal(await page.locator('#review-original-0').evaluate(el=>el.classList.contains('is-returned')),true);
    await page.locator('#review-original-4').press('Enter');
    await page.locator('#review-correction-4 .correction-return').click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'review-original-4');
    assert.equal(await page.locator('.annotation-mark.is-returned').count(),1,'return highlights only the corresponding original');
    const strictWriting = await page.evaluate(() => {
      const markdown = '### 确定语法错误\n\n| 原文 | 修改 | 类型 | 原因 |\n|---|---|---|---|\n| I likes cycling. | I like cycling. | 主谓一致 | 动词形式错误 |\n| It is good. | It is beneficial. | 表达优化 | 可选升级 |\n\n### 可选优化建议\n\n- “good” 可以按需换成 “beneficial”。';
      const result = window.renderReviewAnnotations({original:'I likes cycling. It is good.',markdown,definiteOnly:true,originalElement:document.querySelector('#reviewWorkspaceOriginal'),correctionsElement:document.querySelector('#reviewCorrections'),countElement:document.querySelector('#reviewAnnotationCount'),noticeElement:document.querySelector('#reviewAnnotationNotice')});
      return {count:result.count,marks:document.querySelectorAll('.annotation-mark').length,text:document.querySelector('#reviewCorrections').textContent};
    });
    assert.equal(strictWriting.count,1,'writing annotations must exclude optional style improvements');
    assert.equal(strictWriting.marks,1);
    assert.doesNotMatch(strictWriting.text,/beneficial/);
    assert.equal(await page.locator('.review-workspace-header').evaluate(el=>getComputedStyle(el).position),'static');
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(root,'docs/images/question-review.png'),fullPage:false});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#reviewWorkspace').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'page must fit narrow screens');
    await page.locator('#closeReviewWorkspace').click();
    await page.reload();
    await page.locator('[data-writing-id="w1"]').click();
    await checkMarkdown('#reviewOverviewSummary');
    await page.reload();
    assert.equal(await page.locator('#reviewWorkspace').isVisible(),true,'direct report route must restore on reload');
    assert.equal(await page.locator('#reviewWorkspaceOriginal').textContent(),'Original essay');
    const legacySpeaking = await page.evaluate(() => {
      const markdown = '好的，很高兴为你批改。以下是反馈。\n\n### 总体表现\n\n保留这段具体评价。\n\n### 4. 逐句修改建议\n\n| 原片段 | 最小修改 | 中文原因 |\n|---|---|---|\n| I started cycling from 2022 | I started cycling **in** 2022 | 年份前用 in。 |\n\n### 示范版本\n\nI started cycling in 2022.';
      const result = window.renderReviewAnnotations({ original:'okay I started cycling from 2022', markdown, originalElement:document.querySelector('#reviewWorkspaceOriginal'), correctionsElement:document.querySelector('#reviewCorrections'), countElement:document.querySelector('#reviewAnnotationCount'), noticeElement:document.querySelector('#reviewAnnotationNotice') });
      window.renderReviewReport(document.querySelector('#reviewWorkspaceFeedback'), markdown, document.querySelector('#reviewWorkspaceNavigation'), {dedupeCorrections:result.count > 0});
      return {count:result.count, marks:document.querySelectorAll('.annotation-mark').length, report:document.querySelector('#reviewWorkspaceFeedback').textContent, reason:document.querySelector('.correction-card').textContent};
    });
    assert.equal(legacySpeaking.count,1);
    assert.equal(legacySpeaking.marks,1);
    assert.match(legacySpeaking.reason,/年份前用 in/);
    assert.doesNotMatch(legacySpeaking.report,/很高兴|逐句修改建议|年份前用 in/);
    assert.match(legacySpeaking.report,/保留这段具体评价/);
    assert.match(legacySpeaking.report,/示范版本/);
    const normalized = await page.evaluate(() => {
      const markdown = '### 转写整理稿\n\nOkay, I started cycling from 2022.\n\n### 逐句修改\n\n| 原片段 | 最小修改 | 中文原因 |\n|---|---|---|\n| i started cycling from 2022 | I started cycling in 2022 | 介词 |';
      const revised = window.extractTranscriptPunctuation(markdown);
      window.renderReviewAnnotations({ original:revised, punctuationOnly:true, markdown, originalElement:document.querySelector('#reviewWorkspaceOriginal'), correctionsElement:document.querySelector('#reviewCorrections'), countElement:document.querySelector('#reviewAnnotationCount'), noticeElement:document.querySelector('#reviewAnnotationNotice') });
      return {valid:window.isPunctuationOnlyRevision('okay i started cycling from 2022',revised), rejects:window.isPunctuationOnlyRevision('I likes it','I like it.'), revised, mark:document.querySelector('.annotation-mark')?.textContent};
    });
    assert.equal(normalized.valid,true);
    assert.equal(normalized.rejects,false);
    assert.equal(normalized.mark,'I started cycling from 2022');
    assert.equal(normalized.revised,'Okay, I started cycling from 2022.');
    const typography = await page.evaluate(() => {
      const original = 'High‑quality schools. Job‑related training. Closely‑knit groups. Children’s “real” needs. More\u00a0 \nspace. Same-word. Same‑word.';
      const markdown = '| 原文 | 修改 |\n|---|---|\n| High-quality schools. | Better schools. |\n| Job-related training. | Career training. |\n| Closely-knit groups. | Close-knit groups. |\n| Children\'s "real" needs. | Children\'s needs. |\n| More space. | More room. |\n| Same-word. | Other word. |\n| Completely absent. | Another sentence. |';
      window.renderReviewAnnotations({original,markdown,originalElement:document.querySelector('#reviewWorkspaceOriginal'),correctionsElement:document.querySelector('#reviewCorrections'),countElement:document.querySelector('#reviewAnnotationCount'),noticeElement:document.querySelector('#reviewAnnotationNotice')});
      return {original,rendered:document.querySelector('#reviewWorkspaceOriginal').textContent,marks:[...document.querySelectorAll('.annotation-mark')].map(el=>el.textContent),buttons:document.querySelectorAll('.correction-return').length};
    });
    assert.equal(typography.rendered,typography.original,'typography matching must not rewrite the source');
    assert.deepEqual(typography.marks,['High‑quality schools.','Job‑related training.','Closely‑knit groups.','Children’s “real” needs.','More\u00a0 \nspace.']);
    assert.equal(typography.buttons,5,'ambiguous typography variants and absent quotes remain unlinked');
    await page.locator('#review-correction-4 .correction-return').click();
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'More\u00a0 \nspace.');
    delete data.speaking[0].punctuatedTranscript;
    delete data.speaking[0].punctuationSource;
    await page.goto(`http://127.0.0.1:${server.address().port}/#review/speaking/s1`);
    await page.reload();
    assert.equal(await page.locator('#reviewRawTranscript').textContent(),'I like cycling.');
    assert.equal(await page.locator('#reviewRawTranscript mark').count(),0);
    punctuationResponse = 'I enjoy cycling.';
    await page.locator('#generatePunctuation').click();
    await page.waitForFunction(()=>document.querySelector('#punctuationStatus').textContent.includes('整理失败'));
    assert.equal(data.speaking[0].punctuatedTranscript,undefined,'reject changes to words');
    punctuationResponse = 'I like cycling.';
    await page.locator('#generatePunctuation').click();
    await page.waitForFunction(()=>document.querySelector('#generatePunctuation').classList.contains('hidden'));
    await page.reload();
    assert.equal(await page.locator('#reviewWorkspaceOriginal').textContent(),'I like cycling.');
    assert.equal(data.speaking[0].transcript,'A later edit.','edited practice text must autosave while the report keeps its submitted snapshot');
    assert.equal(data.speaking[0].punctuatedTranscript,'I like cycling.');
    await page.locator('#menuButton').click();
    await page.locator('.nav-item[data-route="writing"]').click();
    const layout = await page.locator('.record-list-item').first().evaluate(el=>{
      const card=el.querySelector('.library-item').getBoundingClientRect(), button=el.querySelector('.record-delete').getBoundingClientRect(), title=el.querySelector('strong').getBoundingClientRect();
      return {inside:button.right<=card.right && button.left>=card.left && button.top>=card.top && button.bottom<=card.bottom, reserved:parseFloat(getComputedStyle(el.querySelector('strong')).paddingRight), font:parseFloat(getComputedStyle(el.querySelector('.record-delete')).fontSize)};
    });
    assert.equal(layout.inside,true);
    assert.ok(layout.reserved>=38 && layout.font<=12);
    assert.equal(await page.evaluate(()=>window.pwned),undefined);
    assert.deepEqual(external,[],'rendering feedback must not load remote media');
    assert.deepEqual(errors,[]);
    console.log('Dedicated routes, exact annotations, legacy list corrections, Markdown safety, snapshots, audio, draft preservation and responsive layout passed.');
  } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
