const { chromium } = require('playwright');
(async () => {
  const exe = require('fs').readdirSync('/opt/pw-browsers').find(d=>d.startsWith('chromium_headless_shell'));
  const sub = require('fs').readdirSync('/opt/pw-browsers/'+exe).find(d=>d.startsWith('chrome'));
  const b = await chromium.launch({executablePath:`/opt/pw-browsers/${exe}/${sub}/headless_shell`});
  const p = await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await p.goto('file://'+process.argv[2], {waitUntil:'load'});
  await p.waitForFunction(()=>window.MathJax && MathJax.startup && MathJax.startup.promise, null, {timeout:20000});
  await p.evaluate(()=>MathJax.startup.promise);
  await p.waitForTimeout(800);
  await p.pdf({path:process.argv[3], format:'A4', printBackground:true, displayHeaderFooter:true, headerTemplate:'<span></span>',
    footerTemplate:'<div style="font-size:8px;width:100%;text-align:center;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin:{top:'15mm',bottom:'15mm',left:'14mm',right:'14mm'}});
  console.log('errors', JSON.stringify(errs));
  await b.close();
})();
