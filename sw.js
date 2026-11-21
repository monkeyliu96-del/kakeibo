const CACHE='kakeibo-v18',LIB='kakeibo-lib-v1';
const CORE=['./','index.html','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k!==LIB).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
 const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
 /* 固定版本号的第三方库(supabase、pdf.js):内容不会变,存一次以后直接用本地的 */
 if(u.origin==='https://cdn.jsdelivr.net'&&/@\d/.test(u.pathname)){
  e.respondWith(caches.open(LIB).then(c=>c.match(r).then(m=>m||fetch(r).then(res=>{if(res.ok)c.put(r,res.clone());return res}))));return}
 if(u.origin!==location.origin)return;
 /* 自己的页面:先用缓存马上打开,同时在后台下载新版,下次打开生效 */
 const net=fetch(r,{cache:'no-cache'}).then(res=>{if(res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp))}return res});
 e.waitUntil(net.catch(()=>{}));
 e.respondWith(caches.match(r,{ignoreSearch:r.mode==='navigate'}).then(m=>m||net.catch(()=>caches.match('index.html'))));
});
