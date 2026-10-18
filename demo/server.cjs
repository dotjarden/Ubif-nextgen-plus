const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
http.createServer((req,res)=>{
  const url = new URL(req.url,'http://localhost');
  // Any script in extension/ or demo/ can be hot-loaded into a live portal tab.
  const isScript = /^\/(extension(\/vendor)?|demo)\/[a-z0-9][a-z0-9.-]*\.js$/.test(url.pathname);
  // The settings page previews with in-memory storage (no extension APIs).
  const isSettings = url.pathname === '/extension/popup.html';
  const file = isScript || isSettings ? path.join(__dirname,'..',url.pathname) : path.join(__dirname,url.pathname === '/messages' ? 'messages.html' : /^\/repair\/workorder\/\d+$/.test(url.pathname) ? 'workorder.html' : 'index.html');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');
  // The preview is also used to hot-load the scripts into a live portal tab.
  res.setHeader('Access-Control-Allow-Origin','*');
  // Always serve the current files while iterating.
  res.setHeader('Cache-Control','no-store');
  res.end(fs.readFileSync(file));
}).listen(Number(process.env.UBIF_PREVIEW_PORT || 8765),'127.0.0.1',()=>console.log('Preview server started.'));
