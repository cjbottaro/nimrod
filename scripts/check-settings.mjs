// Actual browser dialog/layout regression. No app/Pi process, network content, or model calls.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';
if (!process.env.CHROMIUM) throw new Error('Set CHROMIUM to a local chrome-headless-shell executable');
const dir = mkdtempSync(join(tmpdir(), 'nimrod-settings-check-'));
try {
  const css = readFileSync('src/pi/transcript.css', 'utf8') + readFileSync('src/theme.css', 'utf8');
  const transcript = readFileSync('src/pi/transcript.html', 'utf8');
  const html = readFileSync('index.html', 'utf8').replace('<script type="module" src="/src/main.ts"></script>', '<script src="fixture.js"></script>')
    .replace('</head>', `<style>${css}</style></head>`);
  const bundle = buildSync({ stdin: { contents: "export {installSettings,installRuntimeSettings} from './src/settings'; export {mountPiView} from './src/pi/webview-client'; export {installThemes} from './src/themes/picker';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'Fixture', write: false }).outputFiles[0].text;
  const script = `
(async () => {
  const result = document.createElement('pre'); result.id = 'settings-result'; result.style.display='none'; document.body.append(result);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  // dump-dom advances virtual timers, not visual frames. Layout and modality remain real;
  // this fixture verifies node/animation identity, not native animation timing.
  window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16);
  window.cancelAnimationFrame = id => clearTimeout(id);
  const frame = () => new Promise(resolve => setTimeout(resolve, 48));
  try {
    const get = id => document.getElementById(id);
    get('welcome').hidden = true;
    get('conversation').hidden = false;
    get('conversation').innerHTML = ${JSON.stringify(transcript)};
    let receive;
    Fixture.mountPiView({getState:()=>undefined,setState:()=>{},postMessage:()=>{},onMessage:listener=>{receive=listener;}});
    const history = Array.from({length:80},(_,i)=>({key:'history-'+i,role:'assistant',content:'Fixture history paragraph '+i}));
    const tool = {type:'toolCall',id:'tool',name:'bash',arguments:{command:'fixture'},toolStatus:'running',executionOutput:'one'};
    const snapshot = block => receive({type:'snapshot',state:{busy:true,messages:[...history,{key:'live',role:'assistant',content:[block]}]}});
    snapshot(tool); await frame();
    const settings = Fixture.installSettings(window,get('settings-page'),get('open-settings'),get('settings-back'));
    const runtime = Fixture.installRuntimeSettings({form:get('runtime-settings'),fields:get('runtime-fields'),pi:get('pi-path'),node:get('node-path'),status:get('runtime-status')},{read:()=>null,save:()=>{}});
    runtime.initialize({pi:'/fixture/pi',node:'/fixture/node'}); const launch = runtime.current();
    Fixture.installThemes({root:document.documentElement,select:get('theme-picker'),file:get('theme-file'),notice:get('theme-notice'),noticeText:get('theme-notice-text'),dismiss:get('theme-notice-dismiss')},{read:()=>null,save:()=>{},newId:()=> 'import-fixture'});
    const details = document.querySelector('.tool-card'); details.open = true; await frame();
    const pane = get('transcript-viewport'), prompt = get('prompt');
    pane.scrollTop=200; pane.dispatchEvent(new Event('scroll')); prompt.value='keep draft'; prompt.dispatchEvent(new Event('input')); prompt.focus({preventScroll:true}); await frame();
    const spinner=details.querySelector('.tool-card-spinner'), animation=spinner.getAnimations()[0];
    const before={height:pane.clientHeight,width:pane.clientWidth,scroll:pane.scrollTop};
    window.dispatchEvent(new KeyboardEvent('keydown',{key:',',metaKey:true,cancelable:true}));
    assert(settings.isOpen,'Settings opens');
    assert(get('settings-page').getBoundingClientRect().width === innerWidth,'Settings fills viewport width');
    assert(get('settings-page').getBoundingClientRect().height === innerHeight,'Settings fills viewport height');
    assert(get('settings-page').scrollWidth <= innerWidth,'Settings does not overflow horizontally');
    assert(document.activeElement === get('settings-back'),'Back receives page-entry focus');
    prompt.focus(); assert(document.activeElement !== prompt,'Native modality blocks background focus');
    snapshot({...tool,executionOutput:'one\\ntwo'}); await frame();
    assert(pane.clientHeight===before.height && pane.clientWidth===before.width,'Workspace geometry is retained while covered');
    assert(pane.scrollTop===before.scroll,'Older-history position retained during stream');
    assert(document.querySelector('.tool-card')===details && details.open && spinner.isConnected,'Live nodes and disclosure retained');
    assert(spinner.getAnimations()[0]===animation,'Spinner animation identity retained');
    get('pi-path').value='/next/pi';get('node-path').value='/next/node';get('pi-path').focus();
    get('runtime-settings').requestSubmit();
    assert(runtime.current().pi==='/next/pi' && launch.pi==='/fixture/pi','Save affects next launch only');
    const picker=get('theme-picker');picker.value='dracula';picker.dispatchEvent(new Event('change'));
    assert(getComputedStyle(document.documentElement).backgroundColor==='rgb(40, 42, 54)','Appearance applies from Settings');
    const host=get('host-dialog');host.showModal();settings.close();assert(settings.isOpen,'Nested Pi dialog owns dismissal');host.close();
    get('settings-back').click();await frame();
    assert(!settings.isOpen && document.activeElement===prompt,'Return restores the composer focus');
    assert(prompt.value==='keep draft' && pane.scrollTop===before.scroll,'Return preserves draft and scroll');
    assert(details.open && details.querySelector('.tool-card-spinner')===spinner,'Return preserves live cards');
    result.textContent='PASS full-page geometry, native focus containment/restore, live streaming, spinner identity, drafts, scroll, appearance and next-session runtime paths';
  } catch(error) { result.textContent='FAIL '+error.stack; }
})();`;
  writeFileSync(join(dir,'index.html'),html);writeFileSync(join(dir,'fixture.js'),bundle+script);
  const output = spawnSync(process.env.CHROMIUM,['--headless',`--window-size=${Number(process.env.VIEWPORT_WIDTH)||1000},900`,'--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--host-resolver-rules=MAP * ~NOTFOUND',`--user-data-dir=${join(dir,'profile')}`,'--virtual-time-budget=3000','--run-all-compositor-stages-before-draw','--dump-dom',pathToFileURL(join(dir,'index.html')).href],{encoding:'utf8',timeout:30000,maxBuffer:4000000});
  const result=output.stdout?.match(/<pre id="settings-result"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
  if(output.status!==0 || !result?.startsWith('PASS ')) throw new Error(result || output.error?.message || output.stderr || 'Browser fixture did not finish');
  console.log(result);
} finally {rmSync(dir,{recursive:true,force:true});}
