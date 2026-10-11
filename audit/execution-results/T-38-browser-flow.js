// Replace RECOVERY_A/B from the fixture-only private recoveryPath before CLI run-code; do not publish values.
async (page) => {
 const checks=[];const ok=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw new Error(name)};
 await page.getByRole('button',{name:'换机找回',exact:true}).click(); await page.getByRole('textbox',{name:'恢复码',exact:true}).fill(RECOVERY_A); await page.getByRole('button',{name:'恢复',exact:true}).click(); await page.waitForFunction(()=>document.querySelector('.record-id')?.textContent==='#T38-0999');
 const rows=page.locator('.record-list > button'), ids=()=>rows.locator('.record-id').allTextContents();
 await page.waitForFunction(()=>document.querySelectorAll('.record-list > button').length===50);
 ok('recovered A 1000 with 50 rows',await rows.count()===50 && (await page.locator('.record-summary span').first().innerText())==='1000');
 const first=await ids();ok('first previous disabled',await page.getByRole('button',{name:'上一页',exact:true}).isDisabled());
 await page.getByRole('button',{name:'下一页',exact:true}).click();await page.getByText('第 2 页，符合条件共 1000 条',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.record-id')?.textContent==='#T38-0949');
 const second=await ids();ok('second distinct 50',second.length===50 && !second.some(x=>first.includes(x)));
 await page.getByRole('button',{name:'上一页',exact:true}).click();await page.getByText('第 1 页，符合条件共 1000 条',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.record-id')?.textContent==='#T38-0999');ok('previous exact',JSON.stringify(await ids())===JSON.stringify(first));
 await page.getByRole('textbox',{name:'搜索提交内容',exact:true}).fill('NEEDLE-cross-page');await page.getByText('第 1 页，符合条件共 1 条',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.record-list > button').length===1);
 ok('full-content search beyond summary',!(await rows.first().innerText()).includes('NEEDLE-cross-page') && (await ids())[0]==='#T38-0007');
 await page.getByRole('combobox',{name:'按提交类型筛选',exact:true}).selectOption('complaint');await page.getByRole('combobox',{name:'按处理状态筛选',exact:true}).selectOption('no_solution');await page.getByText('第 1 页，符合条件共 1 条',{exact:true}).waitFor();
 await page.getByRole('combobox',{name:'按处理状态筛选',exact:true}).selectOption('resolved');await page.getByText('第 1 页，符合条件共 0 条',{exact:true}).waitFor();
 ok('global total independent filter',await page.locator('.record-summary span').first().innerText()==='1000');
 await page.getByRole('combobox',{name:'按处理状态筛选',exact:true}).selectOption('no_solution');await page.getByText('第 1 页，符合条件共 1 条',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.record-list > button').length===1);
 await rows.first().click();await page.locator('.detail-content').getByText(/FULL-BODY-END-7/).waitFor();ok('full detail',await page.locator('.detail-content').getByText(/NEEDLE-cross-page/).isVisible());
 await page.getByRole('button',{name:'返回我的提交',exact:true}).click();await page.getByRole('textbox',{name:'搜索提交内容',exact:true}).fill('');await page.getByRole('combobox',{name:'按提交类型筛选',exact:true}).selectOption('all');await page.getByRole('combobox',{name:'按处理状态筛选',exact:true}).selectOption('all');await page.getByText('第 1 页，符合条件共 1000 条',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.record-list > button').length===50);
 ok('offpage notice target',!(await ids()).some(s=>s.includes('T38-0007')));
 await page.getByRole('button',{name:/^通知/}).click();await page.getByRole('button',{name:/T38 非当前页通知/}).click();await page.locator('.detail-content').getByText(/FULL-BODY-END-7/).waitFor();checks.push({name:'offpage notification detail',pass:true});
 await page.getByRole('button',{name:'返回我的提交',exact:true}).click();await page.getByRole('textbox',{name:'恢复码',exact:true}).fill(RECOVERY_B);await page.getByRole('button',{name:'恢复',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.record-id')?.textContent==='#T38-1999');
 ok('identity B has only B page',(await ids()).every(s=>Number(s.match(/\d{4}$/)[0])>=1000));
 ok('A detail and notification cleared',!(await page.locator('body').innerText()).includes('FULL-BODY-END-7') && !(await page.locator('body').innerText()).includes('T38 非当前页通知'));
 await page.getByRole('textbox',{name:'搜索提交内容',exact:true}).fill('NEEDLE-cross-page');await page.getByText('第 1 页，符合条件共 0 条',{exact:true}).waitFor();ok('B cannot search A',await rows.count()===0);
 await page.getByRole('textbox',{name:'搜索提交内容',exact:true}).fill('');await page.getByText('第 1 页，符合条件共 1000 条',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.record-list > button').length===50);
 await page.getByRole('button',{name:'收起',exact:true}).click();
 await page.locator('.identity-bar code').evaluate(el=>{el.textContent='[合成恢复码已遮盖]'});
 await page.screenshot({path:'output/playwright/T-38-user-B-final.png',fullPage:true});
 return {task:'T-38',fixtureOnly:true,checks,first,second,screenshot:'output/playwright/T-38-user-B-final.png'};
}
