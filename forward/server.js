/* Runs on the addresses the website used to have. Connect is one site now, so every path opens the same path there:
   the site answers all of the old ones (/work, /builders/3, /me, /c/<slug> and the rest). No dependencies. */
const http = require("node:http");

const site = new URL(process.env.SITE_URL || process.env.NEXT_PUBLIC_CONNECT_APP_URL || "https://connect-production-77ec4d79.up.railway.app").origin;

http.createServer((req, res) => {
  const raw = String(req.url || "/");
  const at = raw.indexOf("?");
  let path = at < 0 ? raw : raw.slice(0, at);
  // Only a plain path is carried over, and it is always joined to the site's own origin.
  if (!path.startsWith("/") || path.includes("\\") || /[^\x21-\x7e]/.test(path)) path = "/";
  path = path.replace(/^\/{2,}/, "/");
  const query = at < 0 ? "" : raw.slice(at).replace(/[^\x21-\x7e]/g, "");
  if (path === "/api/health") { res.writeHead(200, { "content-type": "application/json" }); return res.end('{"ok":true}'); }
  res.writeHead(req.method === "GET" || req.method === "HEAD" ? 307 : 303, { location: site + path + query, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end();
}).listen(Number(process.env.PORT) || 3000, "0.0.0.0");
