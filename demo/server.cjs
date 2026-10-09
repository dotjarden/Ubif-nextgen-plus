const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
http.createServer((req,res)=>{
  const url = new URL(req.url,'http://localhost');
  // Any script in extension/ or demo/ can be hot-loaded into a live portal tab.
  const isScript = /^\/(extension|demo)\/[a-z0-9][a-z0-9.-]*\.js$/.test(url.pathname);
  const file = isScript ? path.join(__dirname,'..',url.pathname) : path.join(__dirname,'index.html');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');
  // The preview is also used to hot-load the scripts into a live portal tab.
  res.setHeader('Access-Control-Allow-Origin','*');
  res.end(fs.readFileSync(file));
}).listen(8765,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:8765'));
