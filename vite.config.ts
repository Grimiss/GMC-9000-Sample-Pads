import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// A small generated worker caches this build, fonts and both audio worklets for offline use.
export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE || "/",
  plugins: [
    {
      name: "gmc-offline",
      generateBundle: {
        order: "post",
        handler(_, bundle) {
          const files = [
            "index.html",
            "crusher.js",
            "capture.js",
            "fonts/NimbusSansNarrow-Regular.otf",
            "fonts/NimbusSansNarrow-Bold.otf",
            ...Object.keys(bundle).filter((n) => /\.(js|css)$/.test(n)),
          ];
          const digest = createHash("sha256")
            .update(Object.keys(bundle).join("|"))
            .update(JSON.stringify(bundle["index.html"] ?? ""));
          for (const file of [
            "crusher.js",
            "capture.js",
            "fonts/NimbusSansNarrow-Regular.otf",
            "fonts/NimbusSansNarrow-Bold.otf",
          ])
            digest.update(readFileSync("public/" + file));
          const version = digest.digest("hex").slice(0, 20);
          const source = `const PREFIX="gmc-9000-v2-"+new URL(self.registration.scope).pathname+"|",CACHE=PREFIX+${JSON.stringify(version)},FILES=${JSON.stringify(files)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(f=>new URL(f,self.registration.scope).href))).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||!e.request.url.startsWith(self.registration.scope))return;e.respondWith(e.request.mode==='navigate'?fetch(e.request).catch(()=>caches.match(new URL('index.html',self.registration.scope).href)):caches.match(e.request,{ignoreVary:true}).then(r=>r||fetch(e.request)));});`;
          this.emitFile({ type: "asset", fileName: "sw.js", source });
        },
      },
    },
  ],
});
