async (page) => {
 page.setDefaultTimeout(10000);
 const checks=[];const ok=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw new Error(name)};
 await page.getByRole('button',{name:'我的提交',exact:true}).click();await page.getByRole('button',{name:'换机找回',exact:true}).click();await page.getByRole('textbox',{name:'恢复码',exact:true}).fill(RECOVERY_A);await page.getByRole('button',{name:'恢复',exact:true}).click();await page.getByText('第 1 页，符合条件共 1000 条',{exact:true}).waitFor();
 await page.getByRole('button',{name:/^通知/}).click();await page.getByRole('button',{name:/T39 非当前页通知/}).click();
 await page.locator('.conversation-head').getByText('250 条',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.comment-list article').length===50);
 const comments=page.locator('.comment-list article p');let texts=await comments.allTextContents();ok('latest50 chronological',texts.length===50 && texts[0]==='T39-A-comment-200' && texts[49]==='T39-A-comment-249');
 for(let n=100;n<=250;n+=50){await page.getByRole('button',{name:'加载较早沟通记录',exact:true}).click();await page.waitForFunction(n=>document.querySelectorAll('.comment-list article').length===n,n);}
 texts=await comments.allTextContents();ok('all250 ordered deduplicated',texts.length===250 && texts.every((text,i)=>text===`T39-A-comment-${String(i).padStart(3,'0')}`) && new Set(texts).size===250);
 ok('oldest exhausted',await page.getByRole('button',{name:'加载较早沟通记录',exact:true}).count()===0);
 await page.getByRole('textbox',{name:'补充说明',exact:true}).fill('T39 user synthetic appended after oldest page');await page.getByRole('button',{name:'发送补充',exact:true}).click();await page.locator('.conversation-head').getByText('251 条',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.comment-list article').length===251);
 texts=await comments.allTextContents();ok('post retains250 and appends1',texts.length===251 && texts[0]==='T39-A-comment-000' && texts[250]==='T39 user synthetic appended after oldest page' && new Set(texts).size===251);
 await page.screenshot({path:'output/playwright/T-39-user-251.png',fullPage:true});
 await page.getByRole('button',{name:'返回我的提交',exact:true}).click();await page.getByRole('textbox',{name:'搜索提交内容',exact:true}).fill('NEEDLE-cross-page');await page.getByText('第 1 页，符合条件共 1 条',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.record-list > button').length===1);
 const armed=await page.request.post('http://127.0.0.1:3038/__fixture/hold-comments');ok('fixture hold armed',armed.status()===200);
 const aRequest=page.waitForRequest(r=>r.method()==='GET' && r.url().includes('/feedback/T39-0007/comments'));
 await page.locator('.record-list > button').first().click();await aRequest;
 await page.getByRole('button',{name:/^通知/}).click();await page.getByRole('button',{name:/T39 切换记录 B/}).click();await page.locator('.conversation-head').getByText('3 条',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.comment-list article').length===3);
 const deliveredA=page.waitForResponse(r=>r.url().includes('/feedback/T39-0007/comments'));
 const release=await page.request.post('http://127.0.0.1:3038/__fixture/release-comments');ok('actual delayed response released',(await release.text())==='released 1');await deliveredA;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 texts=await comments.allTextContents();ok('lateA cannot replaceB',texts.length===3 && texts.every((x,i)=>x===`T39-B-comment-${i}`) && !(await page.locator('.detail-content').innerText()).includes('FULL-BODY-END-7'));
 await page.screenshot({path:'output/playwright/T-39-user-B-after-stale.png',fullPage:true});
 return {task:'T-39',role:'user',fixtureOnly:true,checks,finalComments:texts};
}
