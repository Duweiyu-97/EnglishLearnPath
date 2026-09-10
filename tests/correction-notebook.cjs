// Synthetic records and local mock API only; never contacts an AI provider.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..', 'app');
const writing = 'I likes cycling. He go home. UNRELATED FULL PARAGRAPH.';
const report = rows => `主题：练习\n\n### 评分与小分\n非官方总分：6\n\n### 总体评价\n继续练习。\n\n### 确定语法错误\n\n| 原文 | 修改 | 类型 | 原因 |\n|---|---|---|---|\n${rows}\n\n### 原文优化建议\n可以展开理由。`;
const legacy = {id:'legacy',module:'writing',title:'Legacy note',text:'Preserve this whole old note.',createdAt:'2026-09-01'};
let data = {
  writings:[{id:'w1',type:'Task 2',essay:writing,prompt:'Discuss cycling.',reviewInput:{original:writing},review:report('| I likes cycling. | I like cycling. | 语法 | 主谓一致 |\n| He go home. | He goes home. | 语法 | 第三人称单数 |\n| Not in the answer | Changed | 语法 | Unmatched |\n| like | love | 语法 | Word fragment must not match likes |'),updatedAt:'2026-09-01'}],
  speaking:[{id:'s1',part:'p1',transcript:'She go home.',prompt:'Where does she go?',review:report('| She go home. | She goes home. | 语法 | 第三人称单数 |'),updatedAt:'2026-09-01'}],
  mistakes:[{...legacy}]
};
let failWrites = false, aiCalls = 0;
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.url.startsWith('/api/')) {
    res.setHeader('Content-Type','application/json');
    if (req.url === '/api/data') {
      if (req.method === 'PUT') {
        let body=''; for await (const chunk of req) body += chunk;
        if (failWrites) { res.statusCode=503; return res.end(JSON.stringify({error:'Synthetic disk failure'})); }
        data=JSON.parse(body).data;
      }
      return res.end(JSON.stringify({data,storage:{bound:true,ready:true}}));
    }
    if (req.url === '/api/ai/chat') aiCalls++;
    if (req.url === '/api/ai/status') return res.end(JSON.stringify({connected:false}));
    res.statusCode=404; return res.end('{}');
  }
  const file=path.resolve(root, '.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));
  if (!file.startsWith(root+path.sep)) { res.statusCode=403; return res.end(); }
  try {
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css'})[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.statusCode=404; res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[], external=[];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:')) external.push(request.url()); });
    const base=`http://127.0.0.1:${server.address().port}`;
    await page.goto(base+'/#review/writing/w1');
    await page.locator('.correction-save').first().waitFor();
    assert.equal(await page.locator('#addWritingMistake, #addSpeakingMistake').count(),0);
    assert.equal(await page.locator('.correction-save').count(),2,'only source-matched corrections can be collected');
    await page.locator('#reviewCorrectionsSection').screenshot({path:path.join(process.env.TEMP,'elp-corrections-compact.png'),animations:'disabled'});
    failWrites=true;
    await page.locator('.correction-save').first().click();
    await page.waitForFunction(() => document.querySelector('.correction-save').textContent.includes('重试'));
    assert.equal(data.mistakes.length,1);
    failWrites=false;
    await page.locator('.correction-save').first().click();
    await page.waitForFunction(() => document.querySelector('.correction-save').textContent==='已加入错题本');
    assert.equal(data.mistakes.length,2,'collect just the selected correction');
    const writingNote=data.mistakes.find(item=>item.kind==='correction');
    assert.equal(writingNote.correction.original,'I likes cycling.');
    assert.equal(writingNote.correction.corrected,'I like cycling.');
    assert.equal(writingNote.related.id,'w1');
    assert.doesNotMatch(JSON.stringify(writingNote),/UNRELATED FULL PARAGRAPH|He go home/);
    await page.reload();
    await page.locator('.correction-save').first().waitFor();
    assert.equal(await page.locator('.correction-save').first().isDisabled(),true,'prevent duplicate collection across reloads');
    await page.goto(base+'/#review/speaking/s1');
    await page.locator('.correction-save').click();
    await page.waitForFunction(() => document.querySelector('.correction-save').textContent==='已加入错题本');
    const speakingNote=data.mistakes.find(item=>item.module==='speaking');
    assert.equal(speakingNote.correction.original,'She go home.','speaking collection works without generating a punctuated transcript');
    assert.equal(aiCalls,0);
    await page.locator('.nav-item[data-route="mistakes"]').click();
    await page.locator('#startCorrectionStudy').click();
    assert.equal(await page.locator('#mistakeList').isVisible(),false);
    assert.equal(await page.locator('#correctionStudyAnswer').isVisible(),false);
    assert.equal(await page.locator('#correctionStudyReference').textContent(),'');
    await page.locator('#revealCorrectionAnswer').click();
    assert.match(await page.locator('#correctionStudyStatus').textContent(),/先填写/);
    await page.locator('#correctionStudyAttempt').fill('I like cycling.');
    await page.locator('#revealCorrectionAnswer').click();
    assert.equal(await page.locator('#correctionStudyReference').textContent(),'I like cycling.');
    failWrites=true;
    await page.locator('[data-correction-rating="hard"]').click();
    await page.waitForFunction(() => document.querySelector('#correctionStudyStatus').textContent.includes('保存失败'));
    assert.equal(data.mistakes.find(item=>item.id===writingNote.id).correctionReview,undefined);
    assert.equal(await page.locator('#correctionStudyAttempt').inputValue(),'I like cycling.');
    failWrites=false;
    await page.locator('[data-correction-rating="hard"]').click();
    await page.waitForFunction(() => document.querySelector('#correctionStudyOriginal').textContent==='She go home.');
    assert.equal(data.mistakes.find(item=>item.id===writingNote.id).correctionReview.performance,'hard');
    await page.locator('#correctionStudyAttempt').fill('She go home?');
    await page.locator('#revealCorrectionAnswer').click();
    await page.locator('[data-correction-rating="again"]').click();
    await page.locator('#correctionStudyAnswer').waitFor({state:'hidden'});
    assert.equal(await page.locator('#correctionStudyOriginal').textContent(),'She go home.');
    assert.equal(await page.locator('#correctionStudyAttempt').inputValue(),'');
    await page.locator('#correctionStudyAttempt').fill('She goes home.');
    await page.locator('#revealCorrectionAnswer').click();
    await page.screenshot({path:path.join(process.env.TEMP,'elp-correction-study.png'),fullPage:true,animations:'disabled'});
    await page.locator('[data-correction-rating="good"]').click();
    await page.waitForFunction(() => document.querySelector('#correctionStudySummary').textContent.includes('本轮已完成 2'));
    assert.equal(data.mistakes.find(item=>item.id===speakingNote.id).correctionReview.level,1);
    await page.reload();
    await page.locator('#startCorrectionStudy').waitFor({state:'attached'});
    assert.equal(await page.locator('#startCorrectionStudy').isDisabled(),true);
    assert.deepEqual(data.mistakes.find(item=>item.id==='legacy'),legacy,'legacy notes remain untouched');
    await page.locator('[data-mistake-filter="speaking"]').click();
    assert.equal(await page.locator('#startCorrectionStudy').isVisible(),false,'hide unavailable review action when everything is scheduled for later');
    await page.locator('.note-reference-toggle').click();
    assert.equal(await page.locator('.note-reference').isVisible(),true);
    await page.locator('.note-reference-toggle').click();
    await page.locator('.mistake-library').screenshot({path:path.join(process.env.TEMP,'elp-notebook-compact.png'),animations:'disabled'});
    await page.locator('[data-mistake-filter="all"]').click();
    await page.locator(`[data-practice-correction="${speakingNote.id}"]`).click();
    await page.locator('#correctionStudyAttempt').fill('She goes home.');
    await page.locator('#revealCorrectionAnswer').click();
    await page.locator('[data-correction-rating="good"]').click();
    await page.locator('#correctionStudyCard').waitFor({state:'hidden'});
    const reviewed=data.mistakes.find(item=>item.id===speakingNote.id).correctionReview;
    assert.equal(reviewed.level,2);
    assert.equal((Date.parse(reviewed.dueDate)-Date.parse(reviewed.lastReviewedDate))/86400000,3);
    assert.equal(reviewed.lastAttempt,'She goes home.');
    page.on('dialog', dialog => dialog.accept());
    await page.locator(`[data-delete-mistake="${writingNote.id}"]`).click();
    await page.waitForFunction(() => document.querySelector('#mistakeCount').textContent==='2');
    await page.goto(base+'/#review/writing/w1');
    assert.equal(await page.locator('.correction-save').first().isDisabled(),false,'deleted corrections can be collected again');
    assert.equal(aiCalls,0);
    assert.deepEqual(external,[]);
    assert.deepEqual(errors,[]);
    console.log('Selective writing/speaking collection, deduplication, self-correction, schedules, persistence, failures and legacy notes passed.');
  } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
