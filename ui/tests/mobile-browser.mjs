import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import {mobileFixture} from './mobile-fixture.mjs';

const fixture = await mobileFixture();
const browser = await puppeteer.launch({executablePath:process.env.UI_BROWSER_EXECUTABLE || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const errors = [], checks = [];
const passed = text => {checks.push(text);console.log(`PASS ${text}`);};
const page = await browser.newPage();
page.on('pageerror',error => errors.push(error.message));
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
const bottom = () => page.waitForFunction(() => {const s=document.querySelector('#content-scroll');return s && s.scrollHeight-s.scrollTop-s.clientHeight<=2;});
const click = async selector => {await page.waitForSelector(selector,{visible:true});await page.click(selector);await settle();};
try {
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await page.goto(fixture.url,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#message-input');await settle();await bottom();
  passed('long conversations open at the latest message');
  const selected = await page.$eval('#message-form',form => form.dataset.thread);
  const job = fixture.jobs.find(job => job.id === selected);
  fixture.app.store.message(job,'orchestrator','A new streamed answer.');
  await page.waitForFunction(() => document.querySelector('.thread-content').textContent.includes('A new streamed answer.'));
  await bottom();passed('live updates stay at bottom');

  await page.evaluate(() => {const s=document.querySelector('#content-scroll');s.dispatchEvent(new Event('touchstart'));s.dispatchEvent(new Event('touchmove'));s.scrollTop=s.scrollHeight/2;});
  await settle();await page.waitForSelector('#jump-latest:not([hidden])');
  const anchor = await page.evaluate(() => {const s=document.querySelector('#content-scroll');const n=[...s.querySelectorAll('[data-scroll-key]')].find(n=>n.getBoundingClientRect().bottom>s.getBoundingClientRect().top);return {key:n.dataset.scrollKey,y:n.getBoundingClientRect().top};});
  job.messages[0].text += 'Additional material before the reading position. '.repeat(40);
  fixture.app.store.touchMessage(job,job.messages[0]);
  fixture.app.store.message(job,'orchestrator','Another live answer while you read history.');
  await page.waitForFunction(() => document.querySelector('.thread-content').textContent.includes('Another live answer while you read history.'));
  await settle();
  const anchorY = await page.evaluate(key => document.querySelector(`[data-scroll-key="${key}"]`).getBoundingClientRect().top,anchor.key);
  assert(Math.abs(anchorY-anchor.y)<=2,'reading position moved after content above it grew');
  await click('#jump-latest');await bottom();passed('history stays anchored; Latest returns to bottom');

  await page.focus('#message-input');await page.type('#message-input','Mobile draft\nSecond line');
  const inputHeight = await page.$eval('#message-input',n=>n.clientHeight);
  await page.evaluate(() => {const p=document.querySelector('.message:last-of-type p');p.textContent += 'Late content layout. '.repeat(80);});
  await settle();await bottom();
  assert.equal(await page.$eval('#message-input',n=>n.value),'Mobile draft\nSecond line');
  assert(inputHeight>24,'composer did not grow for multiline input');
  assert.equal(await page.evaluate(() => scrollY),0,'focusing composer scrolled document');
  passed('multiline composer, late layout and focus preserve bottom and draft');
  await click('[data-tab=activity]');await click('[data-tab=thread]');await bottom();
  assert.equal(await page.$eval('#message-input',n=>n.value),'Mobile draft\nSecond line');
  await click('[data-action=sidebar]');
  assert.equal(await page.$eval('#main',n=>n.inert),true);
  const other = fixture.jobs.find(j=>j!==job);
  await click(`[data-action=select][data-id="${other.id}"]`);await bottom();
  assert.equal(await page.$eval('#message-input',n=>n.value),'','draft leaked into another thread');
  await click('[data-action=sidebar]');await click(`[data-action=select][data-id="${job.id}"]`);await bottom();
  assert.equal(await page.$eval('#message-input',n=>n.value),'Mobile draft\nSecond line');
  passed('tab and thread switches open latest; drafts stay with their thread');

  await page.focus('#message-input');
  await page.evaluate(() => {Object.defineProperty(visualViewport,'height',{configurable:true,value:400});visualViewport.dispatchEvent(new Event('resize'));});
  await settle();await bottom();
  assert.equal(await page.$eval('#app',n=>n.clientHeight),400);
  assert(await page.$eval('#message-input',n=>n.getBoundingClientRect().bottom<=400));
  await click('[data-action=configure]');
  assert(await page.$eval('.modal',n=>n.getBoundingClientRect().bottom<=401));
  await click('[data-action=close]');
  await page.evaluate(() => {delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});
  await settle();await bottom();passed('keyboard resize keeps composer and dialogs inside visible viewport');

  for (const [width,height] of [[320,568],[390,844],[430,932],[768,1024],[844,390],[1440,900]]) {
    await page.setViewport({width,height,isMobile:width<1000,hasTouch:width<1000});await settle();await bottom();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth>innerWidth),false,`horizontal overflow at ${width}×${height}`);
    assert(await page.$eval('#message-input',n=>n.getBoundingClientRect().bottom<=innerHeight+1));
    if (width<1000) assert(await page.$eval('#message-input',n=>parseFloat(getComputedStyle(n).fontSize)>=16),'touch input risks iOS zoom');
    await click('[data-action=configure]');
    if (width<1000) assert(await page.$$eval('.modal input:not([type=checkbox]):not([type=radio]),.modal select,.modal textarea',nodes=>nodes.every(n=>parseFloat(getComputedStyle(n).fontSize)>=16)));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth>innerWidth),false,`dialog overflow at ${width}`);
    await click('[data-action=close]');await bottom();
  }
  passed('phone, tablet, landscape and desktop layouts; 16px touch fields; no page overflow');
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await settle();
  await mkdir('.video/ui-qa',{recursive:true});await page.screenshot({path:'.video/ui-qa/mobile-thread.png'});
  await click('[data-action=sidebar]');await page.screenshot({path:'.video/ui-qa/mobile-threads.png'});
  await click('.drawer-close');
  await click('[data-action=configure]');await page.screenshot({path:'.video/ui-qa/mobile-settings.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks,runtimeErrors:errors},null,2));
} finally {await browser.close();await fixture.close();}
