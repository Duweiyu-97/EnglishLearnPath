// Runs in an isolated headless browser with synthetic data and no real AI calls.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..', 'app');
let stored = { writings: [{id:'keep-writing',essay:'preserved'}], speaking: [], mistakes: [], studyPlan: {summary:'old plan'}, planProgress: {old:true} };
let mode = 'recover', calls = [], writes = 0;
const server = http.createServer(async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  if(req.url.startsWith('/api/')) {
    res.setHeader('Content-Type','application/json');
    if(req.url === '/api/data') {
      if(req.method === 'PUT') {let body='';for await(const part of req)body+=part;stored=JSON.parse(body).data;writes++;}
      return res.end(JSON.stringify({data:stored,storage:{bound:true,ready:true,fileExists:true}}));
    }
    if(req.url === '/api/ai/status')return res.end(JSON.stringify({connected:true,model:'isolated-test'}));
    if(req.url === '/api/ai/chat') {
      let body='';for await(const part of req)body+=part;
      const request=JSON.parse(body), input=JSON.parse(request.messages.at(-1).content);calls.push(input);
      assert.equal(request.output_contract,'study-plan-json-v1');
      if(mode === 'recover' && calls.length === 2 && input.requestedDays.length>3){res.statusCode=502;return res.end(JSON.stringify({code:'AI_OUTPUT_LENGTH',error:'输出达到长度上限'}));}
      const days=input.requestedDays.map(({date,dayIndex,calendarWeekday})=>({date,dayIndex,weekday:calendarWeekday,writing:0,speaking:0,writingReview:0,writingRewrite:0,speakingReview:0,languageMinutes:date===input.profile.examDate?0:10,reviewMinutes:0,note:`day ${dayIndex}`}));
      if(mode === 'reject' || calls.length === 1)days[0].date='2000-01-01';
      else if(input.precedingDays.length)days.forEach(d=>{delete d.date;delete d.weekday;});
      else days.reverse();
      return res.end(JSON.stringify({content:JSON.stringify({summary:'test',priorities:[],phases:[{days}]})}));
    }
    return res.end('{}');
  }
  const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);
  if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  try{res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:process.env.ELP_BROWSER_CHANNEL === 'bundled' ? undefined : 'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'});
    await page.addInitScript(()=>{const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-12-29T12:00:00+08:00']));}static now(){return new RealDate('2026-12-29T12:00:00+08:00').getTime();}};});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#plan`);
    await page.locator('#generateAiPlan').waitFor({state:'visible'});
    await page.locator('#planExamDate').fill('2027-01-05');
    await page.locator('#planCurrentLevel').fill('6.5');
    await page.locator('#planTargetLevel').fill('7');
    await page.locator('#planDailyMinutes').fill('90');
    await page.locator('#generateAiPlan').click();
    await page.waitForFunction(()=>document.querySelector('#planResult').textContent.includes('AI 已生成'),{},{timeout:30000});
    const dates=stored.studyPlan.phases.flatMap(p=>p.days.map(d=>d.date));
    assert.deepEqual(dates,['2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03','2027-01-04','2027-01-05']);
    assert.match(calls[1].formatFeedback,/2000-01-01/);
    assert.ok(calls.some(c=>c.precedingDays.length>0),'split continuation must have confirmed prior days');
    assert.equal(stored.writings[0].essay,'preserved');assert.equal(writes,1);
    await page.reload();
    await page.locator('#planSummary').waitFor({state:'visible'});
    assert.match(await page.locator('#planSummary').innerText(),/2027-01-05/,'saved plan must survive reload');
    const before=JSON.stringify(stored.studyPlan);mode='reject';calls=[];
    await page.locator('#generateAiPlan').click();
    await page.waitForFunction(()=>document.querySelector('#planResult').textContent.includes('生成失败'),{},{timeout:30000});
    assert.match(await page.locator('#planResult').innerText(),/2000-01-01/);
    assert.equal(JSON.stringify(stored.studyPlan),before,'invalid dates must not overwrite saved plan');
    assert.equal(writes,1);assert.equal(calls.length,2,'format retry must be bounded');
    assert.equal(await page.locator('#generateAiPlan').isEnabled(),true);
    assert.deepEqual(errors,[]);
    console.log('Headless plan UI passed: midweek start, year boundary, explicit/calendar/legacy dates, format feedback, split continuation, save/reload, invalid-date rollback.');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
