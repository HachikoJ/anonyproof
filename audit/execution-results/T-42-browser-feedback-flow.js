// Evidence flow copied from output/playwright/T-42-feedback-flow.js.
// Password literal replaced with process.env.T42_BROWSER_ADMIN_PASSWORD; no value stored.
async (page) => {
 page.setDefaultTimeout(10000);const checks=[];const ok=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw new Error(name)};
 const state=async()=>await (await page.request.get('http://127.0.0.1:3044/__fixture/state')).json();
 const compose=async()=>{await page.getByRole('button',{name:'提交线索',exact:true}).click();await page.getByRole('button',{name:/^01 建议/}).click();await page.getByRole('textbox',{name:'提交内容',exact:true}).waitFor();};
 await page.getByRole('button',{name:/^01 建议/}).click();
 const privacy=await page.locator('.privacy-panel').innerText();ok('T33 notice before submit',privacy.includes('运营者可关联本机记录')&&privacy.includes('获授权管理员可读取内容')&&privacy.includes('来源 IP 7 天')&&privacy.includes('不保存完整浏览器信息'));
 await page.screenshot({path:'output/playwright/T-33-before-submit-notice.png',fullPage:true});
 const original='T42 browser synthetic feedback one committed lost response',edited=original+' edited';
 await page.getByRole('textbox',{name:'提交内容',exact:true}).fill(original);const before=await state();
 ok('drop armed',(await page.request.post('http://127.0.0.1:3044/__fixture/drop-next/feedback')).status()===200);
 await page.getByRole('button',{name:'提交线索',exact:true}).click();await page.locator('.form-error').waitFor();
 const dropped=await state();const first=dropped.requests.filter(r=>r.action==='feedback')[0];ok('real committed lost response',first.dropped&&first.databaseCommitted&&dropped.counts.feedbacks===before.counts.feedbacks+1);
 ok('failure keeps draft',await page.getByRole('textbox',{name:'提交内容',exact:true}).inputValue()===original);
 const storage=await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('anonyproof:pending:')).map(k=>JSON.parse(sessionStorage.getItem(k))));
 ok('pending storage only key/action/target',storage.length===1&&Object.keys(storage[0]).sort().join(',')==='action,key,target'&&!JSON.stringify(storage).includes('T42 browser'));
 await page.getByRole('textbox',{name:'提交内容',exact:true}).fill(edited);await page.getByRole('button',{name:'提交线索',exact:true}).click();await page.locator('.form-error').getByText(/当前内容已改变/).waitFor();
 const afterEdit=await state();ok('edited failure no mutation/no new key',JSON.stringify(afterEdit.counts)===JSON.stringify(dropped.counts)&&afterEdit.requests.filter(r=>r.action==='feedback').length===1);
 await page.reload();await compose();ok('reload does not preserve draft',await page.getByRole('textbox',{name:'提交内容',exact:true}).inputValue()==='');
 await page.getByRole('textbox',{name:'提交内容',exact:true}).fill(edited);await page.getByRole('button',{name:'提交线索',exact:true}).click();await page.locator('.form-error').waitFor();
 const conflict=await state();const events=conflict.requests.filter(r=>r.action==='feedback');ok('reload changed body conflict409 same key',events.length===2&&events[1].status===409&&events[1].keyHash===first.keyHash&&JSON.stringify(conflict.counts)===JSON.stringify(dropped.counts));
 await page.reload();await compose();await page.getByRole('textbox',{name:'提交内容',exact:true}).fill(original);await page.getByRole('button',{name:'提交线索',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'提交已收到',exact:true}).waitFor();
 const replay=await state();const last=replay.requests.filter(r=>r.action==='feedback').at(-1);ok('reload unchanged retry same record/counts',last.status===200&&last.acceptedId===first.acceptedId&&last.keyHash===first.keyHash&&JSON.stringify(replay.counts)===JSON.stringify(dropped.counts));
 ok('dialog shows original ID',await page.getByRole('dialog').locator('code').innerText()===first.acceptedId);
 ok('success removes pending key',await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('anonyproof:pending:')).length)===0);
 await page.screenshot({path:'output/playwright/T-42-feedback-replay-success.png',fullPage:true});await page.getByRole('button',{name:'查看处理进度',exact:true}).click();
 return {task:'T-42',action:'feedback',fixtureOnly:true,checks,before:before.counts,after:replay.counts,acceptedId:first.acceptedId,privacyNotice:privacy};
}
