const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
http.createServer((req,res)=>{
  const url = new URL(req.url,'http://localhost');
  const served = ['/extension/scanner.js','/extension/model.js','/extension/content.js','/extension/page.js','/extension/search-model.js','/extension/search.js'];
  const file = served.includes(url.pathname) ? path.join(__dirname,'..',url.pathname) : path.join(__dirname,'index.html');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');
  // The preview is also used to hot-load the scripts into a live portal tab.
  res.setHeader('Access-Control-Allow-Origin','*');
  res.end(fs.readFileSync(file));
}).listen(8765,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:8765'));
