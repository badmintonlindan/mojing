import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.bcmap':'application/octet-stream','.ttf':'font/ttf','.pfb':'application/octet-stream' };
http.createServer(async(req,res)=>{
  try { const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname); const file=path.resolve(root,`.${name === '/' ? '/index.html' : name}`); if (!file.startsWith(root+path.sep)) {res.writeHead(403).end();return;} const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data); }
  catch {res.writeHead(404).end('Not found');}
}).listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('墨径静态测试服务 http://127.0.0.1:'+(process.env.PORT||4173)));
