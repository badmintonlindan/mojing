import { _android } from 'playwright';
import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const adb=(...args)=>execFileSync('.tools/android-sdk/platform-tools/adb.exe',['-s','emulator-5556',...args],{maxBuffer:64*1024*1024});
const device=(await _android.devices()).find(d=>d.serial()==='emulator-5556');
let page;
const result={serial:'emulator-5556',startedAt:new Date().toISOString(),completed:false,input:'physical Android ADB touchscreen swipe, coordinates from DOM and native WebView bounds',measurements:[]};
try {
  page=await(await device.webView({pkg:'cn.mojing.study'})).page();
  page.setDefaultTimeout(45000);
  await expect(page.locator('.app-shell')).toBeVisible();
  adb('shell','settings','put','system','accelerometer_rotation','0');
  adb('shell','settings','put','system','user_rotation','0');
  await expect.poll(()=>page.evaluate(()=>innerWidth>innerHeight)).toBe(true);
  const ready=async()=>{
    await expect(page.locator('.pdf-page canvas')).toHaveAttribute('data-rendered-page',await page.getByLabel('跳转页码',{exact:true}).inputValue(),{timeout:60000});
    await expect(page.locator('.pdf-page canvas')).toHaveAttribute('data-render-state','ready',{timeout:60000});
  };
  await ready();
  const separator=page.getByRole('separator',{name:'调整阅读与知识面板比例',exact:true});
  await expect(separator).toBeVisible();
  const before=Number(await separator.getAttribute('aria-valuenow'));
  adb('shell','uiautomator','dump','/sdcard/mojing-tablet-splitter-ui.xml');
  const xml=adb('exec-out','cat','/sdcard/mojing-tablet-splitter-ui.xml').toString();
  const nativeTag=xml.match(/<node\b(?=[^>]*class="android.webkit.WebView")(?=[^>]*package="cn.mojing.study")[^>]*>/)?.[0];
  assert.ok(nativeTag);
  const bounds=nativeTag.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
  const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  const point=(x,y)=>[String(Math.round(bounds[0]+x*(bounds[2]-bounds[0])/viewport.width)),String(Math.round(bounds[1]+y*(bounds[3]-bounds[1])/viewport.height))];
  const drag=async ratio=>{
    const s=await separator.boundingBox(); const w=await page.locator('.workspace').boundingBox();
    const from=point(s.x+s.width/2,s.y+s.height/2); const to=point(w.x+w.width*ratio/100,s.y+s.height/2);
    adb('shell','input','swipe',...from,...to,'750');
    await expect.poll(async()=>Math.abs(Number(await separator.getAttribute('aria-valuenow'))-ratio)).toBeLessThan(1.5);
    await ready();
    const m=await page.evaluate(()=>{
      const canvas=document.querySelector('.pdf-page canvas');const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let dark=0,opaque=0;for(let i=0;i<data.length;i+=4){if(data[i+3]===255)opaque++;if(data[i+3]>0&&data[i]+data[i+1]+data[i+2]<600)dark++;}
      return {ratio:Number(document.querySelector('.splitter').getAttribute('aria-valuenow')),reader:document.querySelector('.reader-pane').getBoundingClientRect().width,knowledge:document.querySelector('.knowledge-pane').getBoundingClientRect().width,canvas:{width:canvas.width,height:canvas.height,dark,opaque,pixels:canvas.width*canvas.height}};
    });
    assert.ok(m.reader>200&&m.knowledge>200);assert.ok(m.canvas.dark>1000);assert.equal(m.canvas.opaque,m.canvas.pixels);
    result.measurements.push({requested:ratio,from,to,...m});
  };
  await drag(40);
  adb('shell','screencap','-p','/sdcard/mojing-tablet-splitter-40.png');
  adb('pull','/sdcard/mojing-tablet-splitter-40.png','reports/android/tablet/physical-splitter-40.png');
  await drag(before);
  result.initialRatio=before; result.nativeBounds=bounds;result.viewport=viewport;result.completed=true;
} catch(error){result.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{result.finishedAt=new Date().toISOString();await writeFile('reports/android/tablet/physical-splitter-result.json',JSON.stringify(result,null,2));await device.close();}
console.log(JSON.stringify(result));process.exit(process.exitCode||0);
