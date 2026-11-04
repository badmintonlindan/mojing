import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const base='reports/android/tablet/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const fullBytes=await readFile(base+'full-before-restart-result.json');
const originalBytes=await readFile(base+'result.json');
assert.equal(sha(fullBytes),sha(originalBytes));
const full=JSON.parse(fullBytes),resume=await read(base+'resume-restart-result.json'),split=await read(base+'physical-splitter-result.json'),installed=await read(base+'installed-artifact.json');
assert.equal(full.failure.stage,'restart'); assert.equal(full.errors.length,0);
assert.equal(resume.completed,true); assert.equal(resume.errors.length,0);assert.equal(resume.resumes.sha256,sha(fullBytes));
assert.equal(split.completed,true);assert.equal(installed.matches,true);
const bytes=await readFile(resume.export.path);assert.equal(sha(bytes),resume.export.sha256);assert.equal(bytes.length,resume.export.bytes);
const roundtripPath='reports/roundtrip/windows-from-android-tablet.json';const roundtrip=await read(roundtripPath);assert.equal(roundtrip.completed,true);assert.equal(roundtrip.inputSha256,sha(bytes));assert.equal(roundtrip.errors.length,0);
const file=async(relative,extra={})=>({path:relative,sha256:sha(await readFile(relative)),...extra});
const final={
  format:'mojing.android-tablet.acceptance',version:1,completed:true,platform:'Android APK',serial:'emulator-5556',deviceClass:'Android tablet AVD; API35 x86_64, WebView124; no physical stylus hardware',
  verifiedAt:new Date().toISOString(),apk:installed,
  execution:'Acceptance combined from preserved successful stages and a successful resumed cold-start/export session. The original full-run driver failure remains completed:false and is not rewritten.',
  sessions:[await file(base+'full-before-restart-result.json',{sessionId:44180,mode:'full',passedThrough:'review',stoppedAt:'restart',driverIssue:'A stale CDP WebView page closed during process replacement; original failure is retained.'}),await file(base+'resume-restart-result.json',{sessionId:21746,mode:'resume-restart',completed:true,linkedPreviousSha256:resume.resumes.sha256})],
  runtime:resume.runtime,input:full.input,
  passedSteps:[...full.steps.map(s=>s.text),...resume.steps.slice(2).map(s=>s.text),'Physical tablet splitter swipe changed both panes from 57% to 40% and back, with opaque nonblank PDF pixels.','Frozen Android export reimported through packaged Windows UI, sources and relationships checked, then actual Windows process closed and reopened.'],
  stateAfterRestart:resume.restart,scanChecks:resume.scanChecks,layouts:full.layouts,
  nativeSplit:await file(base+'physical-splitter-result.json',{completed:true,measurements:split.measurements}),
  export:{...resume.export,frozen:true},windowsReimport:await file(roundtripPath,{completed:true,inputSha256:roundtrip.inputSha256,metrics:roundtrip.metrics}),
  screenshots:{capture:'Actual Android OS screencap; no CDP screenshots used as final display evidence.',visuallyInspected:['portrait.png','landscape.png','force-stop-reopened.png','native-export-picker.png','native-export-completed.png','physical-splitter-40.png'].map(p=>base+p),findings:'Original manuscript pixels, blue ink, card image and Chinese controls are visibly present in both tablet orientations and after cold start. Native Save UI and returned app are present.'},
  warnings:resume.console,limitations:['Pen pressure uses injected pen pointer input. Physical stylus latency and palm rejection require real hardware.','Publisher archival scan page4 contains low-quality embedded text; screenshot capture does not use OCR.','CDP capture may omit this WebView canvas; OS images and raw opaque pixel checks are the accepted display evidence.'],
  script:await file('scripts/test-android.mjs'),failureReportsPreserved:true
};
await writeFile(base+'acceptance-final.json',JSON.stringify(final,null,2));console.log(JSON.stringify({completed:final.completed,file:base+'acceptance-final.json',export:final.export,windowsReimport:final.windowsReimport}));
