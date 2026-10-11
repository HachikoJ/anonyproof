// Evidence flow copied from output/playwright/T-23-restart-flow.js.
// Password literal replaced with process.env.T42_BROWSER_ADMIN_PASSWORD; no value stored.
async (page) => {
 page.setDefaultTimeout(10000);const checks=[];const ok=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw new Error(name)};
 const state=await (await page.request.get('http://127.0.0.1:3044/__fixture/state')).json();const admin=state.requests.filter(r=>r.action==='admin_comment');
 ok('admin actual lost-response retry identical',admin.length===3&&admin[0].dropped&&admin[0].databaseCommitted&&admin[0].dropMode==='committed-success-body-truncated'&&admin[1].status===200&&admin[0].acceptedId===admin[1].acceptedId&&admin[0].keyHash===admin[1].keyHash);
 ok('explicit separate action only one new comment',admin[2].keyHash!==admin[0].keyHash&&admin[2].acceptedId!==admin[0].acceptedId&&state.counts.feedback_comments===7&&await page.locator('.comment-list .comment').count()===7);
 await page.getByRole('textbox',{name:'回复内容',exact:true}).fill('T23-UNSENT-ADMIN-DRAFT');await page.getByRole('textbox',{name:'处理说明',exact:true}).fill('T23-UNSENT-SOLUTION-DRAFT');
 if(!await page.locator('.admin-notification-panel').count())await page.getByRole('button',{name:/^通知/}).click();await page.locator('.admin-notification-panel').waitFor();
 const response=await page.request.post('http://127.0.0.1:3044/__fixture/restart-backend');const restart=await response.json();ok('real same DB/key/secret restart',response.status()===200&&restart.sameDatabase&&restart.sameContentKey&&restart.sameSessionSecret);
 if(await page.getByRole('button',{name:'刷新',exact:true}).count())await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('heading',{name:'管理员登录',exact:true}).waitFor();
 const body=await page.locator('body').innerText();ok('expired session notice',body.includes('管理会话已失效')&&body.includes('重新登录'));
 ok('all protected DOM cleared',await page.locator('.feedback-row').count()===0&&await page.locator('.comment-list .comment').count()===0&&await page.getByRole('textbox',{name:'回复内容',exact:true}).count()===0&&await page.getByRole('textbox',{name:'处理说明',exact:true}).count()===0&&await page.locator('.admin-notification-panel').count()===0&&!body.includes('FULL-BODY-END-A-1')&&!body.includes('T23-UNSENT')&&!new URL(page.url()).searchParams.has('feedback'));
 ok('password cleared',await page.getByRole('textbox',{name:'访问密码',exact:true}).inputValue()==='');await page.screenshot({path:'output/playwright/T-23-restart-login-cleared.png',fullPage:true});
 await page.getByRole('textbox',{name:'访问密码',exact:true}).fill(process.env.T42_BROWSER_ADMIN_PASSWORD);await page.getByRole('button',{name:'登录管理台',exact:true}).click();await page.getByText('4 条 · 当前页 4 条',{exact:true}).waitFor();await page.getByRole('button',{name:/#T42-A-1 /}).click();await page.waitForFunction(()=>document.querySelectorAll('.comment-list .comment').length===7);ok('relogin no old drafts',await page.getByRole('textbox',{name:'回复内容',exact:true}).inputValue()===''&&await page.getByRole('textbox',{name:'处理说明',exact:true}).inputValue()==='');
 await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByRole('heading',{name:'管理员登录',exact:true}).waitFor();ok('logout still usable',await page.locator('.feedback-row').count()===0);
 return {tasks:['T-42','T-23'],fixtureOnly:true,checks,counts:state.counts,restart,adminEvents:admin};
}
