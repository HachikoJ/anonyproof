async (page) => {
 page.setDefaultTimeout(10000);const checks=[];const ok=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw new Error(name)};
 await page.getByRole('textbox',{name:'访问密码',exact:true}).fill('T39-synthetic-browser-password-123');await page.getByRole('button',{name:'登录管理台',exact:true}).click();await page.getByText('2000 条 · 当前页 50 条',{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'搜索',exact:true}).fill('NEEDLE-cross-page');await page.getByText('1 条 · 当前页 1 条',{exact:true}).waitFor();await page.locator('.feedback-row').first().click();await page.waitForFunction(()=>document.querySelectorAll('.comment-list .comment').length===50);
 let texts=await page.locator('.comment-list .comment p').allTextContents();ok('admin latest50 chronological',texts.length===50 && texts[0]==='T39-A-comment-201' && texts[49]==='T39 user synthetic appended after oldest page');
 for(const n of [100,150,200,250,251]){await page.getByRole('button',{name:'加载较早沟通记录',exact:true}).click();await page.waitForFunction(n=>document.querySelectorAll('.comment-list .comment').length===n,n);}
 texts=await page.locator('.comment-list .comment p').allTextContents();ok('admin full251 no duplicates',texts.length===251 && texts.slice(0,250).every((text,i)=>text===`T39-A-comment-${String(i).padStart(3,'0')}`) && new Set(texts).size===251);
 await page.getByRole('textbox',{name:'回复内容',exact:true}).fill('T39 admin synthetic appended after oldest page');await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.comment-list .comment').length===252);
 texts=await page.locator('.comment-list .comment p').allTextContents();ok('admin post retains old pages',texts.length===252 && texts[0]==='T39-A-comment-000' && texts[251]==='T39 admin synthetic appended after oldest page' && new Set(texts).size===252);
 await page.screenshot({path:'output/playwright/T-39-admin-252.png',fullPage:true});
 return {task:'T-39',role:'admin',fixtureOnly:true,checks,count:texts.length};
}
