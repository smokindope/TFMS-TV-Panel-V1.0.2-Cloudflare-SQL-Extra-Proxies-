export default {
  async fetch(request, env, ctx) {
    const { pathname, searchParams } = new URL(request.url);
    const db = env.DB;
    const kv = env.KV_CONNECTIONS;
const settings = await db
  .prepare("SELECT admin_user, admin_pass FROM settings WHERE id = 1")
  .first();

const ADMIN_USER = settings?.admin_user || "admin";
const ADMIN_PASS = settings?.admin_pass || "SecretPassword123";

    // ==========================================
    // CRITICAL SECURITY PARAMETERS
    // Change these values to secure your admin panel
    // ==========================================

    const hostUrl = new URL(request.url).origin;

    // Helper logic to check if a user record has expired
const isAccountExpired = (expDateStr) => {
  if (!expDateStr || expDateStr === "Never") return false;

  // Force end-of-day expiry
  const expiry = new Date(expDateStr + "T23:59:59");

  if (isNaN(expiry.getTime())) return false;

  return Date.now() > expiry.getTime();
};

    // 1. PUBLIC ENDPOINTS (Exempt from Admin Login Challenge)
    if (pathname === "/proxy") {
      const streamUrl = searchParams.get("url");
      const user = searchParams.get("user");
      const pass = searchParams.get("pass");

      if (!streamUrl) return new Response("Missing Stream URL", { status: 400 });
      if (!user || !pass) return new Response("Missing Credentials", { status: 401 });

      const userCheck = await db.prepare("SELECT * FROM users WHERE username = ? AND password = ? AND status = 'active'").bind(user, pass).first();
      if (!userCheck) return new Response("Unauthorized Line", { status: 401 });

      if (isAccountExpired(userCheck.exp_date)) {
        return new Response("Subscription Expired. Access Denied.", {
          status: 403,
          headers: { "Access-Control-Allow-Origin": "*" }
        });
      }

      const maxAllowed = parseInt(userCheck.max_connections) || 1;
      const kvKey = `active_conn:${user}`;
      let currentConns = 0;

      if (kv) {
        const stored = await kv.get(kvKey);
        currentConns = stored ? parseInt(stored) : 0;
        if (currentConns >= maxAllowed) {
          return new Response(`Connection Limit Reached (${currentConns}/${maxAllowed}). Close existing stream first.`, {
            status: 403,
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        }
        await kv.put(kvKey, (currentConns + 1).toString(), { expirationTtl: 14400 });
      }

      try {
        const customUA = searchParams.get("ua");
const customReferer = searchParams.get("referer");

const proxyHeaders = {};

if (customUA) {
  proxyHeaders["User-Agent"] = customUA;
}

if (customReferer) {
  proxyHeaders["Referer"] = customReferer;
}

const response = await fetch(streamUrl, {
  headers: proxyHeaders
});
        const newHeaders = new Headers(response.headers);
        newHeaders.set("Access-Control-Allow-Origin", "*");

        const originalBody = response.body;
        const transformStream = new TransformStream({
          flush(controller) {
            if (kv) {
              ctx.waitUntil((async () => {
                const freshCount = await kv.get(kvKey);
                const currentVal = freshCount ? parseInt(freshCount) : 1;
                await kv.put(kvKey, Math.max(0, currentVal - 1).toString(), { expirationTtl: 14400 });
              })());
            }
          }
        });

        const modifiedBody = originalBody.pipeThrough(transformStream);
        return new Response(modifiedBody, { status: response.status, headers: newHeaders });

      } catch (e) {
        if (kv) {
          const freshCount = await kv.get(kvKey);
          const currentVal = freshCount ? parseInt(freshCount) : 1;
          await kv.put(kvKey, Math.max(0, currentVal - 1).toString(), { expirationTtl: 14400 });
        }
        return new Response("Proxy Playback Error: " + e.message, { status: 500 });
      }
    }

    if (pathname === "/get_playlist") {
      const user = searchParams.get("user");
      const pass = searchParams.get("pass");
      const proxyId = searchParams.get("proxy");

      const userCheck = await db.prepare("SELECT * FROM users WHERE username = ? AND password = ? AND status = 'active'").bind(user, pass).first();
      if (!userCheck) return new Response("Unauthorized Account", { status: 401 });

      if (isAccountExpired(userCheck.exp_date)) {
        return new Response("Subscription Expired. Playlist generation locked.", { status: 403 });
      }

      let baseProxyString = "";
      let isBuiltIn = false;
      let isNoProxy = false;

      // Check selector flags
      if (proxyId === 'none') {
        isNoProxy = true; // Use the raw target URL directly without changes
      } else if (proxyId === 'default' || !proxyId) {
        baseProxyString = `${hostUrl}/proxy?user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}&url=`;
        isBuiltIn = true;
      } else {
        const proxy = await db.prepare("SELECT url FROM proxies WHERE id = ?").bind(proxyId).first();
        if (proxy) baseProxyString = proxy.url;
      }

      const streams = await db.prepare("SELECT * FROM streams").all();
      const EPG_URL = "https://epgshare01.online/epgshare01/epg_ripper_ALL_SOURCES1.xml.gz";
      let m3u = `#EXTM3U url-tvg="${EPG_URL}"\n`;

      for (const stream of streams.results) {
        let targetUrl = stream.url;
        
        // Only apply proxy rules if bypass flag 'isNoProxy' is false
        if (!isNoProxy) {
if (isBuiltIn) {
  targetUrl = `${baseProxyString}${stream.url}`;
} else if (baseProxyString) {
  let computedProxy = baseProxyString
    .replace(/{user}/g, encodeURIComponent(user))
    .replace(/{pass}/g, encodeURIComponent(pass));

  // remove URL encoding from stream URL
  targetUrl = `${computedProxy}${stream.url}`;
}
        }
        
        let category = stream.category || "";
let logo = "";

if (category.includes("|")) {
  const parts = category.split("|");
  category = parts[0];
  logo = parts[1] || "";
}

const logoTag = logo ? `tvg-logo="${logo}"` : "";

m3u += `#EXTINF:-1 tvg-name="${stream.name}" ${logoTag} group-title="${category}",${stream.name}\n${targetUrl}\n`;
      }

      return new Response(m3u, {
        headers: {
          "Content-Type": "application/mpegurl",
          "Content-Disposition": `attachment; filename="${user}_playlist.m3u"`,
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

// ==========================================
// 2. CUSTOM LOGIN PAGE AUTH SYSTEM
// ==========================================

const COOKIE_NAME = "tfms_admin_session";

// Parse cookies
function getCookies(req) {
  const cookieHeader = req.headers.get("Cookie") || "";
  return Object.fromEntries(
    cookieHeader.split(";").map(c => {
      const parts = c.trim().split("=");
      return [parts[0], parts[1]];
    })
  );
}

const cookies = getCookies(request);

// LOGIN PAGE
if (pathname === "/login" && request.method === "GET") {

  return new Response(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>TFMS Admin Login</title>

<style>
body{
  margin:0;
  font-family:system-ui;
  background:#0f172a;
  display:flex;
  justify-content:center;
  align-items:center;
  height:100vh;
}

.login-box{
  width:350px;
  background:#1e293b;
  padding:30px;
  border-radius:12px;
  box-shadow:0 10px 30px rgba(0,0,0,.4);
}

h1{
  color:white;
  margin-top:0;
  margin-bottom:20px;
  text-align:center;
}

input{
  width:100%;
  padding:12px;
  margin-bottom:15px;
  border:none;
  border-radius:8px;
  background:#334155;
  color:white;
  box-sizing:border-box;
}

button{
  width:100%;
  padding:12px;
  border:none;
  border-radius:8px;
  background:#2563eb;
  color:white;
  font-weight:bold;
  cursor:pointer;
}

button:hover{
  background:#1d4ed8;
}

.error{
  color:#f87171;
  text-align:center;
  margin-bottom:15px;
}

.split-container{
  display:flex;
  width:100%;
  height:900px;
  border:1px solid var(--border);
  border-radius:8px;
  overflow:hidden;
}

.pane{
  display:flex;
  flex-direction:column;
  height:100%;
  overflow:hidden;
}

.left-pane{
  width:50%;
  min-width:300px;
}

.right-pane{
  flex:1;
  min-width:300px;
}

.pane-header{
  padding:10px 12px;
  font-weight:700;
  font-size:14px;
  background:var(--tableHead);
  border-bottom:1px solid var(--border);
}

.pane-frame{
  width:100%;
  height:100%;
  border:0;
}

/* DRAG HANDLE */
.splitter{
  width:6px;
  cursor:col-resize;
  background:transparent;
  position:relative;
}

.splitter::before{
  content:"";
  position:absolute;
  top:0;
  bottom:0;
  left:2px;
  width:2px;
  background:var(--border);
  opacity:0.6;
}

.splitter:hover::before{
  background:#2563eb;
  opacity:1;
}
</style>
</head>

<body>

<div class="login-box">

<h1>TFMS IPTV</h1>

${
  searchParams.get("error")
    ? `<div class="error">Invalid login</div>`
    : ""
}

<form method="POST" action="/login">

<input
  type="text"
  name="username"
  placeholder="Username"
  required
>

<input
  type="password"
  name="password"
  placeholder="Password"
  required
>

<button type="submit">
  Login
</button>

</form>

</div>

</body>
</html>
`, {
    headers: {
      "Content-Type": "text/html"
    }
  });
}

// HANDLE LOGIN SUBMIT
if (pathname === "/login" && request.method === "POST") {

  const form = await request.formData();

  const username = form.get("username");
  const password = form.get("password");

  if (
    username === ADMIN_USER &&
    password === ADMIN_PASS
  ) {

    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/",
        "Set-Cookie":
          `${COOKIE_NAME}=authorized; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`
      }
    });
  }

  return Response.redirect(`${hostUrl}/login?error=1`, 302);
}

// LOGOUT
if (pathname === "/logout") {
  return new Response(null, {
    status: 302,
    headers: {
      "Location": "/login",
      "Set-Cookie":
        `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`
    }
  });
}

// Protect admin routes
const publicRoutes = [
  "/proxy",
  "/get_playlist",
  "/login"
];

const isPublic =
  publicRoutes.some(route => pathname.startsWith(route));

if (!isPublic) {

  if (cookies[COOKIE_NAME] !== "authorized") {
    return Response.redirect(`${hostUrl}/login`, 302);
  }

}

    // ADMINISTRATIVE POST APIs ROUTERS
    if (request.method === "POST" && pathname.startsWith("/api/")) {
      const body = await request.json();

if (pathname === "/api/settings/save") {

  await db.prepare(`
    UPDATE settings
    SET admin_user = ?, admin_pass = ?
    WHERE id = 1
  `)
  .bind(body.admin_user, body.admin_pass)
  .run();

  return Response.json({ success: true });
}

if (pathname === "/api/comments/save") {
  const content = body.content || "";

  const exists = await db.prepare("SELECT id FROM comments WHERE id = 1").first();

  if (exists) {
    await db.prepare(
      "UPDATE comments SET content = ?, updated_at = ? WHERE id = 1"
    ).bind(content, new Date().toISOString()).run();
  } else {
    await db.prepare(
      "INSERT INTO comments (id, content, updated_at) VALUES (1, ?, ?)"
    ).bind(content, new Date().toISOString()).run();
  }

  return Response.json({ success: true });
}

      if (pathname === "/api/users/add") {
        await db.prepare("INSERT INTO users (username, password, exp_date, max_connections) VALUES (?, ?, ?, ?)")
          .bind(body.username, body.password, body.exp_date || "Never", parseInt(body.max_connections) || 1).run();
        return Response.json({ success: true });
      }

      if (pathname === "/api/users/edit") {
        await db.prepare("UPDATE users SET password = ?, status = ?, exp_date = ?, max_connections = ? WHERE id = ?")
          .bind(body.password, body.status, body.exp_date, parseInt(body.max_connections) || 1, body.id).run();
        return Response.json({ success: true });
      }

      if (pathname === "/api/users/delete") {
        await db.prepare("DELETE FROM users WHERE id = ?").bind(body.id).run();
        return Response.json({ success: true });
      }

      if (pathname === "/api/streams/add") {
        await db.prepare("INSERT INTO streams (name, url, category) VALUES (?, ?, ?)")
          .bind(body.name, body.url, body.category || "Live").run();
        return Response.json({ success: true });
      }

if (pathname === "/api/backup/sql_import") {
  const sql = body.sql;

  if (!sql || typeof sql !== "string") {
    return Response.json({ error: "Invalid SQL input" }, { status: 400 });
  }

  // remove transaction wrappers (D1 doesn't need them)
  const cleaned = sql
    .replace(/BEGIN TRANSACTION;?/gi, "")
    .replace(/COMMIT;?/gi, "");

  // split safely (better than naive ;)
  const statements = cleaned
    .split(";\n")
    .map(s => s.trim())
    .filter(Boolean);

  const errors = [];
  let successCount = 0;

  for (const stmt of statements) {
    try {
      await db.prepare(stmt).run();
      successCount++;
    } catch (e) {
      errors.push({
        statement: stmt.slice(0, 120),
        error: e.message
      });
    }
  }

  return Response.json({
    success: true,
    executed: successCount,
    failed: errors.length,
    errors
  });
}

if (pathname === "/api/backup/sql") {
  const users = await db.prepare("SELECT * FROM users").all();
  const streams = await db.prepare("SELECT * FROM streams").all();
  const proxies = await db.prepare("SELECT * FROM proxies").all();

  const esc = (v) =>
    String(v ?? "").replace(/'/g, "''");

  let sql = "-- TFMS IPTV Backup\nBEGIN TRANSACTION;\n\n";

  for (const u of users.results) {
    sql += `INSERT INTO users (id, username, password, status, exp_date, max_connections) VALUES (` +
      `${u.id}, '${esc(u.username)}', '${esc(u.password)}', '${esc(u.status)}', '${esc(u.exp_date)}', ${u.max_connections || 1});\n`;
  }

  sql += "\n";

  for (const s of streams.results) {
    sql += `INSERT INTO streams (id, name, url, category) VALUES (` +
      `${s.id}, '${esc(s.name)}', '${esc(s.url)}', '${esc(s.category)}');\n`;
  }

  sql += "\n";

  for (const p of proxies.results) {
    sql += `INSERT INTO proxies (id, name, url) VALUES (` +
      `${p.id}, '${esc(p.name)}', '${esc(p.url)}');\n`;
  }

  sql += "\nCOMMIT;";

  return new Response(sql, {
    headers: {
      "Content-Type": "text/plain",
      "Content-Disposition": `attachment; filename="tfms_backup.sql"`,
      "Access-Control-Allow-Origin": "*"
    }
  });
}

if (pathname === "/api/streams/mass_import") {
  const lines = body.m3u.split("\n");

  const forcedCategory = body.category?.trim(); // NEW

  let currentname = "unknown stream";
  let currentcategory = forcedCategory || "imported";

  for (let line of lines) {
    line = line.trim();
    
if (line.toLowerCase().startsWith("#extinf:")) {
  const namematch = line.match(/,(.*)$/);
  if (namematch) currentname = namematch[1].trim();

  const catmatch = line.match(/group-title="([^"]+)"/);

  // Priority:
  // 1. forced dropdown category
  // 2. group-title from M3U
  // 3. fallback
  if (!forcedCategory) {
    currentcategory = catmatch
      ? catmatch[1].trim()
      : "imported";
  } else {
    currentcategory = forcedCategory;
  }
}
      else if (line.toLowerCase().startsWith("http")) {
      // This now inserts clean strings
      await db.prepare("insert into streams (name, url, category) values (?, ?, ?)")
        .bind(currentname, line, currentcategory).run();
        
      // Optional: Reset defaults for the next stream iteration
      currentname = "unknown stream";
      currentcategory = "imported";
    }
  }
  return Response.json({ success: true });
}

if (pathname === "/api/streams/import_url") {
  const url = body.url;

  if (!url || typeof url !== "string") {
    return Response.json({ error: "Missing URL" }, { status: 400 });
  }

  let m3uText;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return Response.json({ error: "Failed to fetch playlist" }, { status: 500 });
    }

    m3uText = await res.text();
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }

  const lines = m3uText.split("\n");

  const forcedCategory = body.category?.trim();
  let currentname = "unknown stream";
  let currentcategory = forcedCategory || "imported";

  for (let line of lines) {
    line = line.trim();

    if (line.toLowerCase().startsWith("#extinf:")) {
      const namematch = line.match(/,(.*)$/);
      if (namematch) currentname = namematch[1].trim();

      const catmatch = line.match(/group-title="([^"]+)"/);

      if (!forcedCategory) {
        currentcategory = catmatch ? catmatch[1].trim() : "imported";
      } else {
        currentcategory = forcedCategory;
      }

    } else if (line.toLowerCase().startsWith("http")) {
      await db.prepare(
        "INSERT INTO streams (name, url, category) VALUES (?, ?, ?)"
      ).bind(currentname, line, currentcategory).run();

      currentname = "unknown stream";
      currentcategory = "imported";
    }
  }

  return Response.json({ success: true });
}

      if (pathname === "/api/streams/edit") {
        await db.prepare("UPDATE streams SET name = ?, url = ?, category = ? WHERE id = ?")
          .bind(body.name, body.url, body.category, body.id).run();
        return Response.json({ success: true });
      }

      if (pathname === "/api/streams/delete") {
        await db.prepare("DELETE FROM streams WHERE id = ?").bind(body.id).run();
        return Response.json({ success: true });
      }

      if (pathname === "/api/streams/mass_delete") {
        if (body.scope === "all") {
          await db.prepare("DELETE FROM streams").run();
        } else if (body.scope === "category" && body.category) {
          await db.prepare("DELETE FROM streams WHERE category = ?").bind(body.category).run();
        }
        return Response.json({ success: true });
      }

      if (pathname === "/api/proxies/add") {
        await db.prepare("INSERT INTO proxies (name, url) VALUES (?, ?)")
          .bind(body.name, body.url).run();
        return Response.json({ success: true });
      }

      if (pathname === "/api/proxies/delete") {
        await db.prepare("DELETE FROM proxies WHERE id = ?").bind(body.id).run();
        return Response.json({ success: true });
      }
    }

    if (pathname === "/api/data") {
      const users = await db.prepare("SELECT * FROM users").all();
      const streams = await db.prepare("SELECT * FROM streams").all();
      const proxies = await db.prepare("SELECT * FROM proxies").all();
      const commentRow = await db.prepare("SELECT content FROM comments WHERE id = 1").first();
      const comment = commentRow?.content || "";
      const mappedUsers = await Promise.all(users.results.map(async (u) => {
        let activeNow = 0;
        if (kv) {
          const count = await kv.get(`active_conn:${u.username}`);
          activeNow = count ? parseInt(count) : 0;
        }
        const expired = isAccountExpired(u.exp_date);
        return { ...u, active_connections: activeNow, is_expired: expired };
      }));

const settingsData = await db
  .prepare("SELECT admin_user, admin_pass FROM settings WHERE id = 1")
  .first();

return Response.json({
  users: mappedUsers,
  streams: streams.results,
  proxies: proxies.results,
  comment,
  settings: settingsData
});
    }

    // 3. DASHBOARD UI LAYOUT GENERATION
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<link
  rel="stylesheet"
  href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
/>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<meta charset="UTF-8">
<title>TFMS IPTV Panel</title>
<style>
.settings-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:20px;
  margin-top:15px;
}

.settings-box{
  background:var(--card);
  padding:15px;
  border-radius:8px;
  border:1px solid var(--border);
}

/* responsive fallback */
@media(max-width:900px){
  .settings-grid{
    grid-template-columns:1fr;
  }
}

:root{
  --bg:#f4f5f7;--card:#fff;--text:#333;--header:#1a1f2c;
  --border:#e2e8f0;--input:#fff;--tableHead:#edf2f7;
}

body.dark{
  --bg:#0f172a;--card:#1e293b;--text:#f1f5f9;--header:#020617;
  --border:#334155;--input:#0f172a;--tableHead:#1e293b;
}

body{
  font-family:system-ui,sans-serif;
  background:var(--bg);
  color:var(--text);
  margin:0;padding:20px;
  transition:.3s;
}

.container{
  width:100%;
  max-width:1400px;
  margin:0 auto;
}

.card,
.settings-box,
.xc-card,
.proxy-list,
.mass-delete-box{
  width:100%;
  box-sizing:border-box;
}

.grid,
.settings-grid,
.xc-grid{
  width:100%;
  align-items:stretch;
}

header{
  background:var(--header);
  color:#fff;
  padding:20px;
  border-radius:8px;
  margin-bottom:20px;
  display:flex;
  justify-content:space-between;
  align-items:center;
}

h1,h2,h3{margin:0}
h3{font-size:16px;margin:15px 0 5px;color:#475569}

.card{
  background:var(--card);
  padding:20px;
  border-radius:8px;
  box-shadow:0 2px 4px rgba(0,0,0,.05);
  margin-bottom:20px;
}

.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}

table{width:100%;border-collapse:collapse;margin-top:10px}
th,td{
  text-align:left;
  padding:10px;
  border-bottom:1px solid var(--border);
  font-size:14px;
}
th{background:var(--tableHead)}

input,select,textarea{
  width:100%;
  padding:8px;
  margin:4px 0 10px;
  border:1px solid var(--border);
  border-radius:4px;
  background:var(--input);
  color:var(--text);
  box-sizing:border-box;
}

button{
  background:#2563eb;
  color:#fff;
  border:0;
  padding:8px 14px;
  border-radius:4px;
  font-weight:700;
  cursor:pointer;
}
button:hover{background:#1d4ed8}

.btn-danger{background:#dc2626}
.btn-danger:hover{background:#b91c1c}
.btn-success{background:#16a34a}

.action-btns button{padding:4px 8px;font-size:12px;margin-right:4px}
.flex-actions{display:flex;gap:4px;align-items:center}

.tabs{display:flex;gap:10px;margin-bottom:20px}
.tab-btn{
  background:var(--tableHead);
  color:var(--text);
  border:0;
  padding:10px 18px;
  border-radius:6px;
  font-weight:700;
  cursor:pointer;
}
.tab-btn.active{background:#2563eb;color:#fff}

.tab-content{display:none}
.tab-content.active{display:block}

.proxy-list,.mass-delete-box{
  margin-top:15px;
  padding:10px;
  border-radius:6px;
  background:var(--card);
  border:1px solid var(--border);
}

.proxy-item{
  display:flex;
  justify-content:space-between;
  padding:6px 0;
  border-bottom:1px solid var(--border);
  font-size:13px;
}
.proxy-item:last-child{border:0}

.badge{
  display:inline-block;
  padding:2px 6px;
  border-radius:4px;
  font-size:11px;
  font-weight:700;
  color:#fff;
  background:#64748b;
}
.badge-alert{background:#dc2626}
.badge-ok{background:#16a34a}
.badge-expired{text-decoration:line-through}

.xc-grid{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:15px;
  margin-top:15px;
}

.xc-card{
  padding:18px;
  border-radius:10px;
  color:#fff;
  box-shadow:0 4px 12px rgba(0,0,0,.15);
}

.xc-title{font-size:13px;opacity:.85;letter-spacing:.5px}
.xc-value{font-size:28px;font-weight:700;margin-top:8px}
.xc-sub{font-size:11px;opacity:.7;margin-top:5px}

.xc-card.blue{background:linear-gradient(135deg,#2563eb,#1e40af)}
.xc-card.green{background:linear-gradient(135deg,#16a34a,#065f46)}
.xc-card.purple{background:linear-gradient(135deg,#7c3aed,#4c1d95)}
.xc-card.orange{background:linear-gradient(135deg,#f97316,#c2410c)}

@media(max-width:900px){.xc-grid{grid-template-columns:1fr 1fr}}
@media(max-width:500px){.xc-grid{grid-template-columns:1fr}}

.quick-btn{
  background:#2563eb;
  color:#fff;
  border:0;
  padding:12px;
  border-radius:8px;
  font-weight:700;
  cursor:pointer;
  transition:.2s;
}
.quick-btn:hover{background:#1d4ed8;transform:translateY(-1px)}

@media(max-width:1200px){
  .settings-grid,
  .grid{
    grid-template-columns:1fr;
  }

  .xc-grid{
    grid-template-columns:1fr 1fr;
  }
}

@media(max-width:700px){
  .xc-grid{
    grid-template-columns:1fr;
  }
}
</style>
</head>
<body>
<div class="container">
<header style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
  <h1>TFMS IPTV Panel v1.0.2</h1>

<div style="display:flex; gap:10px;">

<button onclick="toggleTheme()" id="themeBtn">
  🌙
</button>

<button
  id="updatesBtn"
  onclick="window.open('https://tfms.xyz/firestick/core/tuts/tfms-tv-panel-v1-0-1.TUT.GUIDE.html','_blank')"
  style="display:none; background:#16a34a;"
>
  Updates
</button>

<button
  onclick="window.location='/logout'"
  style="background:#dc2626;"
>
  Logout
</button>

</div>
</header>

<div class="tabs">

  <div style="display:flex; gap:10px;">
    <button class="tab-btn active" onclick="switchTab('overviewTab', this)">
      Dashboard
    </button>

    <button class="tab-btn" onclick="switchTab('usersTab', this)">
      User lines
    </button>

    <button class="tab-btn" onclick="switchTab('streamsTab', this)">
      Streams & VOD
    </button>

    <button class="tab-btn" onclick="switchTab('proxiesTab', this)">
      Add Proxies
    </button>

<button class="tab-btn" onclick="switchTab('settingsTab', this)">
  Tools & Settings
</button>
  </div>
</div>

<div id="proxiesTab" class="tab-content">

  <!-- ========================================= -->
  <!-- BLOCK 1 : ADD PROXY -->
  <!-- ========================================= -->

  <div class="card">

    <h2>Add New Proxy Server</h2>
    <hr>

    <div class="settings-grid">

      <!-- LEFT : ADD PROXY -->
      <div class="settings-box">

        <h3>Proxy Configuration</h3>

        <input
          type="text"
          id="proxyName"
          placeholder="New Proxy Name"
        >

        <input
          type="text"
          id="proxyUrl"
          placeholder="New Proxy Url, Must Include trailing / Can include - /?url= etc"
        >

        <button onclick="addProxy()">
          Add Proxy Server
        </button>
      </div>

      <!-- RIGHT : INFO PANEL -->
      <div class="settings-box">

        <h3>Proxy Information</h3>

        <div style="
          font-size:14px;
          line-height:1.8;
          color:#64748b;
        ">

          <b>Supported Formats</b><br>
          https://domain.com/<br>
          https://domain.com/proxy?url=<br>
          https://domain.com/fetch/<br>
          https://domain.com/play?u={user}&p={pass}&url=<br><br>

          <b>Tips</b><br>
          • Add your proxy here then select it from the dropdown in user lines<br>
          • Always include trailing slash if required<br>
          • Cloudflare Workers work best for M3U routing<br>
          • You can use placeholders like {user} and {pass}<br>
        </div>
      </div>
    </div>
  </div>

  <!-- ========================================= -->
  <!-- BLOCK 2 : CONFIGURED PROXIES -->
  <!-- ========================================= -->

  <div class="card">

    <h2>Configured Proxy Servers</h2>
    <hr>

    <div class="proxy-list">

      <div
        style="
          display:flex;
          justify-content:space-between;
          align-items:center;
          margin-bottom:10px;
          flex-wrap:wrap;
          gap:10px;
        "
      >

        <strong>Saved Proxy Routes</strong>

        <input
          type="text"
          id="proxySearch"
          placeholder="Search proxies..."
          onkeyup="filterProxies()"
          style="
            width:220px;
            padding:6px 10px;
            font-size:12px;
            border-radius:6px;
            margin:0;
          "
        >
      </div>

      <div id="proxyContainer"></div>
    </div>
  </div>

<!-- ========================================= -->
<!-- SIDE BY SIDE : PROXY TOOLS + RESOURCES -->
<!-- ========================================= -->

<div class="card">

  <h2>Proxy Tools & Resources</h2>
  <hr>

  <div
    style="
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:20px;
      align-items:start;
    "
  >

    <!-- LEFT : PROXY CREATION TOOLS -->
    <div class="settings-box" style="padding:0; overflow:hidden;">

      <div
        style="
          padding:12px 15px;
          border-bottom:1px solid var(--border);
          font-weight:700;
          background:var(--tableHead);
        "
      >
        Proxy Creation Tools
      </div>

      <iframe
        src="https://tfms.xyz/firestick/sites/proxies2.html"
        style="
          width:100%;
          height:800px;
          border:0;
          background:white;
        "
        loading="lazy"
      ></iframe>

    </div>

    <!-- RIGHT : PROXY RESOURCES -->
    <div class="settings-box" style="padding:0; overflow:hidden;">

      <div
        style="
          padding:12px 15px;
          border-bottom:1px solid var(--border);
          font-weight:700;
          background:var(--tableHead);
        "
      >
        Proxy Resources
      </div>

      <iframe
        src="https://solitary-wind-7787.rzvaldpwgwymnhdshn.workers.dev/"
        style="
          width:100%;
          height:800px;
          border:0;
          background:white;
        "
        loading="lazy"
      ></iframe>

    </div>

  </div>

</div>
</div>
</div>

<div id="settingsTab" class="tab-content">

  <!-- Announcement Bar -->
  <div style="
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 15px;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  ">
    📢 Announcement:<br>Note this panel plays the direct links behind proxies, If you are using a 1 connection playlist as your stream source this will not work when you are serving multiple users, Always use streams from a good multi connection playlist<br>
  </div>

  <!-- ========================================= -->
  <!-- BLOCK 1 : ADMIN SETTINGS -->
  <!-- ========================================= -->

  <div class="card">

    <h2>Admin Settings</h2>
    <hr>

    <div class="settings-grid">

      <!-- LEFT -->
      <div class="settings-box">

        <h3>Change Admin Login</h3>

        <input
          type="text"
          id="adminUser"
          placeholder="Admin Username"
        >

        <input
          type="password"
          id="adminPass"
          placeholder="Admin Password"
        >

        <button onclick="saveSettings()">
          Save Admin Settings
        </button>
      </div>

      <!-- RIGHT -->
      <div class="settings-box">

        <h3>Admin Information</h3>

        <div style="
          font-size:14px;
          line-height:1.8;
          color:#64748b;
        ">

          <b>Security Notice</b><br>
          Changing admin credentials will immediately affect login access.<br><br>

          <b>Session System</b><br>
          Existing login cookies may require browser refresh after updates.<br><br>

          <b>Best Practice</b><br>
          Use strong passwords and avoid default credentials.
        </div>
      </div>
    </div>
  </div>

  <!-- ========================================= -->
  <!-- BLOCK 3 : FREE STREAMS -->
  <!-- ========================================= -->

  <div class="card">

    <h2>Get FREE Streams</h2>
    <hr>
    <iframe
      src="https://tfms.xyz/firestick/sites/links.html"
      style="
        width:100%;
        height:600px;
        border:1px solid var(--border);
        border-radius:8px;
        background:white;
      "
      loading="lazy"
    ></iframe>
  </div>

<!-- SIDE BY SIDE MEDIA PLAYERS -->
<div class="card">
  <h2>Live Media Players</h2>
  <hr>

  <div class="media-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">

    <!-- JW PLAYER -->
    <div class="settings-box" style="padding:0; overflow:hidden;">

      <iframe
  src="https://tfms.xyz/firestick/sites/jwplayer.html"
  style="width:100%; height:400px; border:0;"
  loading="lazy"
  allow="fullscreen"
  allowfullscreen
></iframe>
    </div>

    <!-- CLAPPR PLAYER -->
    <div class="settings-box" style="padding:0; overflow:hidden;">

      <iframe
  src="https://tfms.xyz/firestick/sites/clapprplayer.html"
  style="width:100%; height:400px; border:0;"
  loading="lazy"
  allow="fullscreen"
  allowfullscreen
></iframe>
    </div>

  </div>
</div>

<!-- SIDE BY SIDE: ANALYZER + FORMATTER -->
<div class="card">
  <h2>Tools</h2>
  <hr>

  <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">

    <!-- Playlist Analyzer -->
    <div class="settings-box" style="padding:0; overflow:hidden;">
      <iframe
        src="https://tfms.xyz/firestick/sites/linkanalyzer1.html"
        style="width:100%; height:900px; border:0;"
        loading="lazy"
      ></iframe>
    </div>

    <!-- URL Formatter -->
    <div class="settings-box" style="padding:0; overflow:hidden;">
      <iframe
        src="https://tfms.xyz/firestick/sites/url-formatter1.html"
        style="width:100%; height:900px; border:0;"
        loading="lazy"
      ></iframe>
    </div>
  </div>
</div>
<!-- ========================================= -->
<!-- BLOCK 2 : SQL BACKUP TOOLS -->
<!-- ========================================= -->

<div class="card">

  <h2>D1 SQL Backup Tools</h2>
  <hr>

  <div class="settings-grid">

    <!-- LEFT -->
    <div class="settings-box">

      <h3>Import/Export SQL Backup</h3>

      <div style="
        font-size:13px;
        color:#64748b;
        margin-bottom:10px;
      ">
        Paste a full SQL backup export below and click import.
      </div>

      <textarea
        id="sqlInput"
        rows="12"
        placeholder="Paste SQL backup here..."
        style="width:100%; resize:vertical;"
      ></textarea>

      <div style="
        display:flex;
        gap:10px;
        flex-wrap:wrap;
        margin-top:10px;
      ">

        <button
          class="btn-success"
          onclick="uploadSqlImport()"
        >
          Import SQL Backup
        </button>

        <button onclick="downloadSQLBackup()">
          Export SQL Backup
        </button>
      </div>
    </div>

    <!-- RIGHT -->
    <div class="settings-box">

      <h3>Here You Can Import/Export Your SQL Backup</h3><br>

      <div style="
        font-size:14px;
        line-height:1.8;
        color:#64748b;
        margin-bottom:15px;
      ">

        Export a full SQL backup containing:<br>
        • Users, Streams, Proxies, Settings<br><br>

        Import a full SQL backup:<br>
       Open Your SQL Backup On Your PC & Copy The Contents & Paste Into The Box<br><br>If This Fails Use Cloudflare Dashboard
      </div>
    </div>


  </div>
</div>
</div>
</div>
    </div>
  </div>
</div>

<div id="overviewTab" class="tab-content active">
  <div class="card">
    <div class="xc-grid">

      <div class="xc-card blue">
        <div class="xc-title">Total Users</div>
        <div class="xc-value" id="totalUsers">0</div>
        <div class="xc-sub">Registered Lines</div>
      </div>

      <div class="xc-card green">
        <div class="xc-title">Total Streams</div>
        <div class="xc-value" id="totalStreams">0</div>
        <div class="xc-sub">Active Channels</div>
      </div>

      <div class="xc-card purple">
        <div class="xc-title">Proxies</div>
        <div class="xc-value" id="totalProxies">0</div>
        <div class="xc-sub">Routing Nodes</div>
      </div>

      <div class="xc-card orange">
        <div class="xc-title">System Status</div>
        <div class="xc-value">ONLINE</div>
        <div class="xc-sub">All services running</div>
      </div>

<div class="xc-card" style="padding:0; overflow:hidden;">
  <div id="worldMap" style="height:400px; width:100%;"></div>
</div>

<div class="xc-card purple" style="height: 400px; display:flex; flex-direction:column;">
  <div class="xc-title">Sticky System Notes</div>

  <textarea 
    id="adminComments"
    style="flex:1; width:100%; margin-top:10px; resize:none;"
  ></textarea>

  <button style="margin-top:10px;" onclick="saveComments()">
    Save Comments
  </button>
</div>

    <div class="xc-card blue" style="height: 400px; display:flex; flex-direction:column; padding:18px;">
    <div class="xc-title">TFMS IPTV Panel v1.0.2</div>
    <div style="margin-top:12px; font-size:13px; line-height:1.6; opacity:0.95;">
    
    <b>What's New in This Release</b>
    <ul style="margin:8px 0 0 18px; padding:0;">
      <li>New dashboard tabs added</li>
      <li>Sticky System Notes</li>
      <li>D1 SQL Backup & Restore function</li>
      <li>Quick Links Panel</li>
      <li>Night Mode Theme support</li>
      <li>M3U Bulk Import fixed</li>
      <li>Hardcoded EPG TV guide</li>
      <li>Choose Category in Mass Import</li>
      <li>Settings Page</li>
      <li>Some UI Updates</li>
    </ul>

    <div style="margin-top:12px;">
      <b>Coming Next</b>
      <div style="margin-top:6px; opacity:0.9;">
        • User-Agent & Referer Support<br>
        • Encoded / optimized stream handling<br>
      </div>
    </div>
  </div>
</div>

<div class="xc-card green" style="height:400px; display:flex; flex-direction:column; justify-content:center; gap:12px;">

<button class="quick-btn" onclick="window.open('https://tfms-browser.rzvaldpwgwymnhdshn.workers.dev/','_blank')">
  🌐 TFMS Anon Browser
</button>

<button class="quick-btn" onclick="window.open('https://tfms.xyz/firestick/mark/webtv.html','_blank')">
  🌐 Live Web-TV
</button>

<button class="quick-btn" onclick="window.open('https://epgshare01.online/','_blank')">
  🌐 TV-Guides
</button>

<button class="quick-btn" onclick="window.open('https://videodownloader.site/','_blank')">
  🌐 Movie Downloader
</button>

<button class="quick-btn" onclick="window.open('https://www.livesoccertv.com','_blank')">
  🌐 Sports TV Schedule
</button>

<button class="quick-btn" onclick="window.open('http://webtv.iptvsmarters.com/')">
  🌐 Smarters Online
</button>

<button class="quick-btn" onclick="window.open('https://github.com/smokindope?tab=repositories')">
  🌐 Github Goodies
</button>
</div>
    </div>
  </div>
</div>

<div id="usersTab" class="tab-content">

  <!-- ========================================= -->
  <!-- BLOCK 1 : USER REGISTRY + INFO PANEL -->
  <!-- ========================================= -->

  <div class="card">

    <div class="settings-grid">

      <!-- LEFT : USER REGISTRY -->
      <div class="settings-box">

        <h2>User Line Registry</h2>
        <hr>

        <h3>Create & Edit Account</h3>

        <input type="hidden" id="userId">

        <input
          type="text"
          id="username"
          placeholder="New Account Username"
        >

        <input
          type="text"
          id="password"
          placeholder="New Account Password"
        >

        <input
          type="number"
          id="maxConnections"
          placeholder="Max Allowed Simultaneous Connections"
          min="1"
          value="1"
        >

        <input type="date" id="userExp">

        <select id="userStatus">
          <option value="active">Line Active</option>
          <option value="disabled">Line Deactivated</option>
        </select>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">

          <button id="userBtn" onclick="saveUser()">
            Create New User
          </button>

          <button
            id="cancelUserBtn"
            style="display:none; background:#64748b"
            onclick="resetUserForm()"
          >
            Cancel
          </button>
        </div>
      </div>

      <!-- RIGHT : INFORMATION PANEL -->
      <div class="settings-box">

        <h2>Line Information</h2>
        <hr>

        <div style="
          font-size:14px;
          line-height:1.8;
          color:#64748b;
        ">

          <b>Username & Password</b><br>
          Unique account login used for playlist generation<br>

          <b>Max Connections</b><br>
          Controls simultaneous active streams allowed per account<br>

          <b>Expiration Date</b><br>
          Accounts automatically stop working after 23:59 on selected date<br>

          <b>Status Types</b><br>
          Active = User can stream normally<br>
          Disabled = Account blocked manually<br>

          <b>Playlist Downloads</b><br>
          Generate playlists using direct streams, built-in proxy, or custom proxies<br>

          <b>Hardcoded EPG</b><br>
          TV-Guide is hardcoded your iptv app should pick it up
        </div>
      </div>
    </div>
  </div>

  <!-- ========================================= -->
  <!-- BLOCK 2 : REGISTERED USERS -->
  <!-- ========================================= -->

  <div class="card">

    <h2>Registered User Lines</h2>
    <hr>

    <table>
      <thead>
        <tr>

          <th>Subscriber</th>
          <th style="white-space:nowrap;">
            Conns (Live/Max)
          </th>
          <th>Status</th>
          <th style="width:520px;">

            <div style="
              display:flex;
              align-items:center;
              justify-content:space-between;
              gap:10px;
              flex-wrap:wrap;
            ">

              <span>Actions</span>

              <input
                type="text"
                id="userSearch"
                placeholder="Search users..."
                onkeyup="filterUsers()"
                style="
                  width:180px;
                  padding:6px 10px;
                  font-size:12px;
                  border-radius:6px;
                  margin:0;
                "
              >

              <select
                id="globalProxySelect"
                style="
                  width:auto;
                  min-width:200px;
                  padding:6px 10px;
                  font-size:12px;
                  border-radius:6px;
                  margin:0;
                "
              >
              </select>
            </div>
          </th>
        </tr>
      </thead>

      <tbody id="userTable"></tbody>
    </table>
  </div>
</div>

<div id="streamsTab" class="tab-content">

  <!-- ========================================= -->
  <!-- BLOCK 1 : STREAM CREATION + BULK IMPORT -->
  <!-- ========================================= -->

  <div class="card">

    <h2>Streams & VOD Management</h2>
    <hr>

    <div class="settings-grid">

      <!-- LEFT : CREATE / EDIT STREAMS -->
      <div class="settings-box">

        <h3>Create & Edit Streams & VOD</h3>

        <input type="hidden" id="streamId">

        <input
          type="text"
          id="streamName"
          placeholder="Stream/VOD Name"
        >

        <input
          type="text"
          id="streamUrlInput"
          placeholder="Stream/VOD Source URL"
        >

        <input
          type="text"
          id="streamCategory"
          placeholder="Choose A Category & Add Image, EG: Sports|https://logos.com/sky-sports.png"
        >

        <button id="streamBtn" onclick="saveStream()">
          Add New Stream
        </button>

        <button
          id="cancelStreamBtn"
          style="display:none; background:#64748b"
          onclick="resetStreamForm()"
        >
          Cancel
        </button>

        <br><br>

        <u>OPTIONAL</u><br>
        To add an image use the category input field
        <br>

        Example:
          Sports|https://logos.com/sky-sports.png

      </div>

      <!-- RIGHT : BULK IMPORT -->
      <div class="settings-box">

        <h3>M3U Bulk Import (.m3u parsing)</h3>

        <input
          type="text"
          id="massImportCategory"
          placeholder="Optional: Force Category (leave empty to use group-title)"
        />

        <textarea
          id="massM3u"
          rows="8"
          placeholder="Mass Import M3U, If (group-title=) is included the category will be auto selected"
        ></textarea>

        <button class="btn-success" onclick="massImport()">
          Mass Import Streams
        </button>

<hr>

<h3>OR Import From URL</h3>

<input
  type="text"
  id="remoteM3uUrl"
  placeholder="https://your.iptv.com/playlist.m3u"
/>

<input
  type="text"
  id="remoteCategory"
  placeholder="Optional force category"
/>

<button class="btn-success" onclick="importFromUrl()">
  Import From URL
</button>

      </div>
    </div>
  </div>

  <!-- ========================================= -->
  <!-- BLOCK 2 : STREAM REGISTRY TABLE -->
  <!-- ========================================= -->

  <div class="card">

    <h2>Registered Streams & VOD</h2>
    <hr>

    <table>
      <thead>
        <tr>

          <th>Channel Name</th>
          <th>Group Tag</th>
          <th style="width:520px;">

            <div style="
              display:flex;
              justify-content:space-between;
              align-items:center;
              gap:10px;
              flex-wrap:wrap;
            ">

              <span>Actions</span>

              <div style="display:flex; gap:8px; align-items:center;">

                <input
                  type="text"
                  id="streamSearch"
                  placeholder="Search streams..."
                  onkeyup="filterStreams()"
                  style="
                    width:200px;
                    padding:6px 10px;
                    font-size:12px;
                    border-radius:6px;
                    margin:0;
                  "
                >

                <button
                  onclick="clearStreamSearch()"
                  style="padding:6px 10px; font-size:12px;"
                >
                  Clear
                </button>
              </div>
            </div>
          </th>

        </tr>
      </thead>
      <tbody id="streamTable"></tbody>
    </table>
  </div>

  <!-- ========================================= -->
  <!-- BLOCK 3 : MASS DELETE -->
  <!-- ========================================= -->

  <div class="card">

    <h2>Mass Delete Tools</h2>
    <hr>

    <div class="mass-delete-box">

      <strong
        style="
          color:#991b1b;
          font-size:14px;
          white-space:nowrap;
        "
      >
        Mass Delete:
      </strong>

      <select
        id="massDeleteSelect"
        style="margin:0; padding:6px; font-size:13px;"
      >
        <option value="all">
          Wipe All Streams Completely
        </option>
      </select>

           <button
        class="btn-danger"
        style="white-space: nowrap;"
        onclick="executeMassDelete()"
      >
        Clear Streams
      </button>
    </div>
  </div>
</div>

<script>
const builtInProxy = { id: 'default', name: 'Built In Proxy', url: '' };
const noProxyOption = { id: 'none', name: 'Use Direct Url or Choose Proxy', url: '' };

async function loadData() {
const res = await fetch('/api/data');
if (res.status === 401) return window.location.reload();
const data = await res.json();
document.getElementById('totalUsers').textContent = data.users.length;
document.getElementById('totalStreams').textContent = data.streams.length;
document.getElementById('totalProxies').textContent = data.proxies.length;
const proxySelect = document.getElementById('globalProxySelect');
document.getElementById('adminComments').value = data.comment || "";

document.getElementById('adminUser').value =
  data.settings?.admin_user || '';

document.getElementById('adminPass').value =
  data.settings?.admin_pass || '';

const lastSelected = proxySelect.value || 'none';
proxySelect.innerHTML = '';

// Include the new direct connection bypass mode in the array injection list
const allProxies = [noProxyOption, builtInProxy, ...data.proxies];
allProxies.forEach(p => {
const opt = document.createElement('option');
opt.value = p.id;
opt.textContent = p.name;
proxySelect.appendChild(opt);
});
proxySelect.value = lastSelected;

const proxyContainer = document.getElementById('proxyContainer');
proxyContainer.innerHTML = '';
data.proxies.forEach(p => {
const div = document.createElement('div');
div.className = 'proxy-item';
div.innerHTML = \`
<span><strong>\${p.name}</strong> - <small style="color:#2563eb">\${p.url}</small></span>
<button class="btn-danger" style="padding: 2px 6px; font-size: 11px;" onclick="deleteProxy(\${p.id})">Remove Proxy</button>
\`;
proxyContainer.appendChild(div);
});

const userTable = document.getElementById('userTable');
userTable.innerHTML = '';
data.users.forEach(u => {
let badgeClass = 'badge badge-ok';
let connLabel = \`\${u.active_connections} / \${u.max_connections || 1}\`;
let isExpired = u.is_expired;
if (u.active_connections >= (u.max_connections || 1)) {
badgeClass = 'badge badge-alert';
}
if (isExpired) {
badgeClass = 'badge badge-expired';
connLabel = 'EXPIRED';
}
const tr = document.createElement('tr');
tr.innerHTML = \`
<td style="\${isExpired ? 'color:#94a3b8; text-decoration:line-through;' : ''}">
<b>\${u.username}</b> <br>
<small style="font-size:10px; color:#64748b;">Expires: \${u.exp_date || 'Never'}</small>
</td>
<td><span class="\${badgeClass}">\${connLabel}</span></td>
<td>\${u.status}</td>
<td class="action-btns">
<div class="flex-actions">
<button onclick="editUser(\${u.id}, '\${u.username}', '\${u.password}', '\${u.exp_date}', '\${u.status}', \${u.max_connections || 1})">Edit</button>
<button class="btn-danger" onclick="deleteUser(\${u.id})">Delete</button>
<button class="btn-success" \${isExpired ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} onclick="downloadPlaylist('\${u.username}', '\${u.password}')">Playlist</button>
</div>
</td>
\`;
userTable.appendChild(tr);
});

const streamTable = document.getElementById('streamTable');
const massDeleteSelect = document.getElementById('massDeleteSelect');
streamTable.innerHTML = '';
massDeleteSelect.innerHTML = '<option value="all">Wipe All Streams Completely</option>';
const uniqueCategories = new Set();
data.streams.forEach(s => {
if (s.category) uniqueCategories.add(s.category);
const tr = document.createElement('tr');
tr.innerHTML = \`
<td>\${s.name}</td>
<td>\${s.category}</td>
<td class="action-btns">
<button onclick="editStream(\${s.id}, '\${s.name}', '\${s.url}', '\${s.category}')">Edit</button>
<button class="btn-danger" onclick="deleteStream(\${s.id})">Delete</button>
</td>
\`;
streamTable.appendChild(tr);
});
uniqueCategories.forEach(cat => {
const opt = document.createElement('option');
opt.value = \`category:\${cat}\`;
opt.textContent = \`Clear Category: "\${cat}"\`;
massDeleteSelect.appendChild(opt);
});
}

async function postData(url, data) {
const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
if (res.status === 401) return window.location.reload();
loadData();
}

function saveUser() {
const id = document.getElementById('userId').value;
const data = {
username: document.getElementById('username').value,
password: document.getElementById('password').value,
exp_date: document.getElementById('userExp').value || "Never",
status: document.getElementById('userStatus').value,
max_connections: parseInt(document.getElementById('maxConnections').value) || 1
};
if (id) {
postData('/api/users/edit', { id: parseInt(id), ...data });
} else {
postData('/api/users/add', data);
}
resetUserForm();
}

function editUser(id, user, pass, exp, status, maxConn) {
document.getElementById('userId').value = id;
document.getElementById('username').value = user;
document.getElementById('username').disabled = true;
document.getElementById('password').value = pass;
document.getElementById('userExp').value =
  (!exp || exp === 'Never') ? '' : exp.split('T')[0];
document.getElementById('userStatus').value = status;
document.getElementById('maxConnections').value = maxConn;
document.getElementById('userBtn').textContent = "Update Account Parameters";
document.getElementById('cancelUserBtn').style.display = "inline-block";
}

function deleteUser(id) { if(confirm('Delete user line entirely?')) postData('/api/users/delete', { id }); }

function resetUserForm() {
document.getElementById('userId').value = '';
document.getElementById('username').value = '';
document.getElementById('username').disabled = false;
document.getElementById('password').value = '';
document.getElementById('userExp').value = '';
document.getElementById('maxConnections').value = 1;
document.getElementById('userBtn').textContent = "Create New User";
document.getElementById('cancelUserBtn').style.display = "none";
}

function saveStream() {
const id = document.getElementById('streamId').value;
const data = {
name: document.getElementById('streamName').value,
url: document.getElementById('streamUrlInput').value,
category: document.getElementById('streamCategory').value
};
if (id) {
postData('/api/streams/edit', { id: parseInt(id), ...data });
} else {
postData('/api/streams/add', data);
}
resetStreamForm();
}

function editStream(id, name, url, category) {
document.getElementById('streamId').value = id;
document.getElementById('streamName').value = name;
document.getElementById('streamUrlInput').value = url;
document.getElementById('streamCategory').value = category;
document.getElementById('streamBtn').textContent = "Update Stream Entry";
document.getElementById('cancelStreamBtn').style.display = "inline-block";
}

function deleteStream(id) { if(confirm('Delete target broadcast stream?')) postData('/api/streams/delete', { id }); }

function massImport() {
  const m3u = document.getElementById('massM3u').value;
  const category = document.getElementById('massImportCategory').value;

  postData('/api/streams/mass_import', { m3u, category });

  document.getElementById('massM3u').value = '';
  document.getElementById('massImportCategory').value = '';
}

function executeMassDelete() {
const selection = document.getElementById('massDeleteSelect').value;
let confirmationMsg = "Are you absolutely sure you want to delete all streams completely?";
let payload = { scope: "all" };
if (selection.startsWith("category:")) {
const categoryName = selection.substring(9);
confirmationMsg = \`Are you sure you want to delete all streams inside the category: "\${categoryName}"?\`;
payload = { scope: "category", category: categoryName };
}
if (confirm(confirmationMsg)) {
postData('/api/streams/mass_delete', payload);
}
}

function resetStreamForm() {
document.getElementById('streamId').value = '';
document.getElementById('streamName').value = '';
document.getElementById('streamUrlInput').value = '';
document.getElementById('streamCategory').value = '';
document.getElementById('streamBtn').textContent = "Add New Stream";
document.getElementById('cancelStreamBtn').style.display = "none";
}

function addProxy() {
const name = document.getElementById('proxyName').value;
const url = document.getElementById('proxyUrl').value;
if(!name || !url) return alert('Fill out proxy parameters.');
postData('/api/proxies/add', { name, url });
document.getElementById('proxyName').value = '';
document.getElementById('proxyUrl').value = '';
}

function deleteProxy(id) { if(confirm('Delete this proxy server reference?')) postData('/api/proxies/delete', { id }); }

function downloadPlaylist(user, pass) {
const select = document.getElementById('globalProxySelect');
const proxyId = select.value;
let downloadUrl = \`/get_playlist?user=\${encodeURIComponent(user)}&pass=\${encodeURIComponent(pass)}&proxy=\${proxyId}\`;
window.open(downloadUrl, '_blank');
}




function switchTab(tabId, button) {

  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  document.getElementById(tabId).classList.add('active');
  button.classList.add('active');

  const updatesBtn = document.getElementById('updatesBtn');

  if (tabId === 'settingsTab') {
    updatesBtn.style.display = 'inline-block';
  } else {
    updatesBtn.style.display = 'none';
  }
}




// =========================
// THEME SYSTEM
// =========================

function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.classList.add('dark');
    document.getElementById('themeBtn').innerHTML = '☀️';
  } else {
    document.body.classList.remove('dark');
    document.getElementById('themeBtn').innerHTML = '🌙';
  }
}

function toggleTheme() {
  const current = localStorage.getItem('theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';

  localStorage.setItem('theme', next);
  applyTheme(next);
}

// Load saved theme
applyTheme(localStorage.getItem('theme') || 'light');

setInterval(loadData, 120000);
loadData();
let map;

function initMap() {
  map = L.map('worldMap').setView([20, 0], 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

// initialize once DOM is ready
setTimeout(initMap, 500);

function downloadSQLBackup() {
fetch('/api/backup/sql')
  .then(res => res.blob())
  .then(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "tfms_backup.sql";
    a.click();
    URL.revokeObjectURL(url);
  });
}

function uploadSqlImport() {
  const sql = document.getElementById('sqlInput').value;
  if (!sql.trim()) return alert("Empty SQL file");

  postData('/api/backup/sql_import', { sql });

  document.getElementById('sqlInput').value = '';
  closeSqlImportModal();
}

function saveComments() {
  const content = document.getElementById('adminComments').value;
  postData('/api/comments/save', { content });
}

function saveSettings() {

  const admin_user =
    document.getElementById('adminUser').value;

  const admin_pass =
    document.getElementById('adminPass').value;

  if (!admin_user || !admin_pass) {
    return alert('Username and password required');
  }

  postData('/api/settings/save', {
    admin_user,
    admin_pass
  });

  alert('Admin settings updated');
}

function filterStreams() {
  const search = document
    .getElementById('streamSearch')
    .value
    .toLowerCase();

  const rows = document.querySelectorAll('#streamTable tr');

  rows.forEach(row => {
    const text = row.textContent.toLowerCase();

    if (text.includes(search)) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

function filterUsers() {
  const search = document
    .getElementById('userSearch')
    .value
    .toLowerCase();

  const rows = document.querySelectorAll('#userTable tr');

  rows.forEach(row => {
    const text = row.textContent.toLowerCase();

    if (text.includes(search)) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

function clearUserSearch() {
  document.getElementById('userSearch').value = '';
  filterUsers();
}

function clearStreamSearch() {
  document.getElementById('streamSearch').value = '';
  filterStreams();
}

function filterProxies() {
  const search = document
    .getElementById('proxySearch')
    .value
    .toLowerCase();

  const rows = document.querySelectorAll('.proxy-item');

  rows.forEach(row => {
    const text = row.textContent.toLowerCase();

    if (text.includes(search)) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

const container = document.getElementById('splitContainer');
const leftPane = container.querySelector('.left-pane');
const rightPane = container.querySelector('.right-pane');
const handle = document.getElementById('dragHandle');

let isDragging = false;

handle.addEventListener('mousedown', () => {
  isDragging = true;
  document.body.style.cursor = 'col-resize';
});

document.addEventListener('mouseup', () => {
  isDragging = false;
  document.body.style.cursor = 'default';
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;

  const rect = container.getBoundingClientRect();
  let percent = ((e.clientX - rect.left) / rect.width) * 100;

  // clamp so it doesn't collapse
  if (percent < 20) percent = 20;
  if (percent > 80) percent = 80;

  leftPane.style.width = percent + '%';
});

function importFromUrl() {
  const url = document.getElementById('remoteM3uUrl').value;
  const category = document.getElementById('remoteCategory').value;

  if (!url) return alert("Please enter a URL");

  postData('/api/streams/import_url', {
    url,
    category
  });

  document.getElementById('remoteM3uUrl').value = '';
  document.getElementById('remoteCategory').value = '';
}

jwplayer("player").setup({
  file: "YOUR_STREAM_URL",
  width: "100%",
  height: "100%",
  stretching: "uniform",
  autostart: true,
  primary: "html5",
  fullscreen: true
});

var player = new Clappr.Player({
  source: "YOUR_STREAM_URL",
  parentId: "#player",
  width: "100%",
  height: "100%",
  autoPlay: true,
  plugins: [Clappr.FlasHLS, Clappr.MediaControl],
  fullscreenEnabled: true
});
</script>
<div id="player" style="width:100%; height:100%;"></div>
</body>
</html>
`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }
};
