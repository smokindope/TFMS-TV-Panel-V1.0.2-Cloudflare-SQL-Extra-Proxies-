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

    const hostUrl = new URL(request.url).origin;

// Auto-add optional stream header columns if this D1 database was created before this update.
// Safe to leave in place: existing-column errors are ignored.
async function ensureStreamHeaderColumns() {
  try { await db.prepare("ALTER TABLE streams ADD COLUMN user_agent TEXT DEFAULT ''").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE streams ADD COLUMN referer TEXT DEFAULT ''").run(); } catch (e) {}
}

await ensureStreamHeaderColumns();

const isAccountExpired = (expDateStr) => {
  if (!expDateStr || expDateStr === "Never") return false;
  const expiry = new Date(expDateStr + "T23:59:59");
  if (isNaN(expiry.getTime())) return false;
  return Date.now() > expiry.getTime();
};

  if (pathname === "/proxy") {

  const encoded = searchParams.get("data");
  const user = searchParams.get("user");
  const pass = searchParams.get("pass");

  if (!encoded) {
    return new Response("Missing Stream URL", { status: 400 });
  }

  let streamUrl;

  try {
    streamUrl = atob(encoded);
  } catch {
    return new Response("Invalid Stream Token", { status: 400 });
  }

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

/** @type {Record<string, string>} */
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

if (pathname.startsWith("/play/")) {

  const user = searchParams.get("user");
  const pass = searchParams.get("pass");

  const streamId = pathname.split("/play/")[1];

  const userCheck = await db.prepare(
    "SELECT * FROM users WHERE username = ? AND password = ? AND status='active'"
  )
  .bind(user, pass)
  .first();

  if (!userCheck) {
    return new Response("Unauthorized", { status: 401 });
  }

  const stream = await db.prepare(
    "SELECT * FROM streams WHERE id = ?"
  )
  .bind(streamId)
  .first();

  if (!stream) {
    return new Response("Stream Not Found", { status: 404 });
  }

/** @type {Record<string, string>} */
const playHeaders = {};

if (stream.user_agent) {
  playHeaders["User-Agent"] = stream.user_agent;
}

if (stream.referer) {
  playHeaders["Referer"] = stream.referer;
}

const response = await fetch(stream.url, {
  headers: playHeaders
});

const playResponseHeaders = new Headers(response.headers);
playResponseHeaders.set("Access-Control-Allow-Origin", "*");

return new Response(response.body, {
  status: response.status,
  headers: playResponseHeaders
});
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

      if (proxyId === 'none') {
        isNoProxy = true;
      } else if (proxyId === 'default' || !proxyId) {
        baseProxyString = `${hostUrl}/proxy?user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}&data=`;
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
        
if (!isNoProxy) {

if (isBuiltIn) {
  const encodedUrl = btoa(stream.url);
  targetUrl = `${baseProxyString}${encodeURIComponent(encodedUrl)}`;

  if (stream.user_agent) {
    targetUrl += `&ua=${encodeURIComponent(stream.user_agent)}`;
  }

  if (stream.referer) {
    targetUrl += `&referer=${encodeURIComponent(stream.referer)}`;
  }
}

else if (baseProxyString) {
let computedProxy = baseProxyString
.replace(/{user}/g, encodeURIComponent(user))
.replace(/{pass}/g, encodeURIComponent(pass))
.replace(/{ua}/g, encodeURIComponent(stream.user_agent || ""))
.replace(/{user_agent}/g, encodeURIComponent(stream.user_agent || ""))
.replace(/{referer}/g, encodeURIComponent(stream.referer || ""));

targetUrl = `${computedProxy}${stream.url}`;
}}

        let category = stream.category || "";
let logo = "";

if (category.includes("|")) {
  const parts = category.split("|");
  category = parts[0];
  logo = parts[1] || "";
}

const logoTag = logo ? `tvg-logo="${logo}"` : "";

m3u += `#EXTINF:-1 tvg-name="${stream.name}" ${logoTag} group-title="${category}",${stream.name}\n`;

if (stream.user_agent) {
  m3u += `#EXTVLCOPT:http-user-agent=${stream.user_agent}\n`;
}

if (stream.referer) {
  m3u += `#EXTVLCOPT:http-referrer=${stream.referer}\n`;
}

m3u += `${targetUrl}\n`;
      }

      return new Response(m3u, {
        headers: {
          "Content-Type": "application/mpegurl",
          "Content-Disposition": `attachment; filename="${user}_playlist.m3u"`,
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

const COOKIE_NAME = "tfms_admin_session";

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

if (pathname === "/login" && request.method === "GET") {

  return new Response(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>TFMS Admin Login</title>
<link rel="stylesheet" href="https://tfms.xyz/firestick/core/css/panel.login.css">
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
<input type="text" name="username" placeholder="Username" required>
<input type="password" name="password" placeholder="Password" required>
<button type="submit">Login</button>
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

    if (request.method === "POST" && pathname.startsWith("/api/")) {
      const body = await request.json();

if (pathname === "/api/tinyurl") {
  const longUrl = body.url;

  if (!longUrl || typeof longUrl !== "string") {
    return Response.json({ error: "Missing URL" }, { status: 400 });
  }

  try {
    const tinyRes = await fetch(
      "https://tinyurl.com/api-create.php?url=" + encodeURIComponent(longUrl)
    );

    if (!tinyRes.ok) {
      return Response.json({ error: "TinyURL request failed" }, { status: 500 });
    }

    const tinyUrl = (await tinyRes.text()).trim();

    if (!tinyUrl.startsWith("http")) {
      return Response.json({ error: tinyUrl || "TinyURL returned an invalid response" }, { status: 500 });
    }

    return Response.json({ success: true, tinyUrl });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

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
        await db.prepare("INSERT INTO streams (name, url, category, user_agent, referer) VALUES (?, ?, ?, ?, ?)")
          .bind(body.name, body.url, body.category || "Live", body.user_agent || "", body.referer || "").run();
        return Response.json({ success: true });
      }

if (pathname === "/api/backup/sql_import") {
  const sql = body.sql;

  if (!sql || typeof sql !== "string") {
    return Response.json({ error: "Invalid SQL input" }, { status: 400 });
  }

  const cleaned = sql
    .replace(/BEGIN TRANSACTION;?/gi, "")
    .replace(/COMMIT;?/gi, "");

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
    sql += `INSERT INTO streams (id, name, url, category, user_agent, referer) VALUES (` +
      `${s.id}, '${esc(s.name)}', '${esc(s.url)}', '${esc(s.category)}', '${esc(s.user_agent)}', '${esc(s.referer)}');\n`;
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
    currentcategory = catmatch
      ? catmatch[1].trim()
      : "imported";
  } else {
    currentcategory = forcedCategory;
  }
}
      else if (line.toLowerCase().startsWith("http")) {
      await db.prepare("insert into streams (name, url, category, user_agent, referer) values (?, ?, ?, ?, ?)")
        .bind(currentname, line, currentcategory, "", "").run();
        
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
        "INSERT INTO streams (name, url, category, user_agent, referer) VALUES (?, ?, ?, ?, ?)"
      ).bind(currentname, line, currentcategory, "", "").run();

      currentname = "unknown stream";
      currentcategory = "imported";
    }
  }

  return Response.json({ success: true });
}

      if (pathname === "/api/streams/edit") {
        await db.prepare("UPDATE streams SET name = ?, url = ?, category = ?, user_agent = ?, referer = ? WHERE id = ?")
          .bind(body.name, body.url, body.category, body.user_agent || "", body.referer || "", body.id).run();
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

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<meta charset="UTF-8">
<title>TFMS IPTV Panel</title>
<link rel="stylesheet" href="https://tfms.xyz/firestick/core/css/panel.index.css">
</head>

<body>
<div class="container">
<header style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
<img src="https://tfms.xyz/firestick/core/images/banner.png" alt="TFMS IPTV Panel" style="height:60px; object-fit:contain;"/>
<div style="display:flex; gap:10px;">
<button onclick="toggleTheme()" id="themeBtn">🌙</button>
<button id="aboutBtn" onclick="showAboutModal()" style="display:none; background:#7c3aed;">About</button>
<button id="updatesBtn" onclick="window.open('https://tfms.xyz/firestick/core/tuts/tfms-tv-panel-v1-0-1.TUT.GUIDE.html','_blank')" style="display:none; background:#16a34a;">Updates</button>
<button onclick="window.location='/logout'" style="background:#dc2626;">Logout</button>
</div>
</header>

<div class="tabs">
  <div style="display:flex; gap:10px;">
    <button class="tab-btn active" onclick="switchTab('overviewTab', this)">Dashboard</button>
    <button class="tab-btn" onclick="switchTab('usersTab', this)">User lines</button>
    <button class="tab-btn" onclick="switchTab('streamsTab', this)">Streams & VOD</button>
    <button class="tab-btn" onclick="switchTab('proxiesTab', this)">Add Proxies</button>
    <button class="tab-btn" onclick="switchTab('settingsTab', this)">Tools & Settings</button>
    <button class="tab-btn" onclick="switchTab('browserTab', this)">Browser</button>
  </div>
</div>

<div id="proxiesTab" class="tab-content">

  <div class="card">
    <h2>Add New Proxy Server</h2>
    <hr>
    <div class="settings-grid">

      <div class="settings-box">
        <h3>Proxy Configuration</h3>
        <input type="text" id="proxyName" placeholder="New Proxy Name">
        <input type="text" id="proxyUrl" placeholder="New Proxy Url, Must Include trailing / Can include - /?url= etc">
        <button onclick="addProxy()">Add Proxy Server</button>
      </div>

      <div class="settings-box">
        <h3>Proxy Information</h3>
        <div style=" font-size:14px; line-height:1.8; color:#64748b;">
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

  <div class="card">
    <h2>Configured Proxy Servers</h2>
    <hr>
    <div class="proxy-list">
<div style=" display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap;gap:10px;">

        <strong>Saved Proxy Routes</strong>
<input type="text" id="proxySearch" placeholder="Search proxies..." onkeyup="filterProxies()" style=" width:220px; padding:6px 10px; font-size:12px; border-radius:6px; margin:0;">
      </div>

      <div id="proxyContainer"></div>
    </div>
  </div>

<div class="card">
  <h2>Proxy Tools & Resources</h2>
  <hr>
  <div style=" display:grid; grid-template-columns:1fr 1fr; gap:20px; align-items:start;">

    <div class="settings-box" style="padding:0; overflow:hidden;">
<div style="padding:12px 15px; border-bottom:1px solid var(--border); font-weight:700; background:var(--tableHead);">Proxy Creation Tools</div>
<iframe src="https://tfms.xyz/firestick/sites/proxies2.html" style="width:100%; height:800px; border:0; background:white;" loading="lazy"></iframe>
</div>

    <div class="settings-box" style="padding:0; overflow:hidden;">
<div style="padding:12px 15px; border-bottom:1px solid var(--border); font-weight:700; background:var(--tableHead);">Proxy Resources</div>
<iframe src="https://solitary-wind-7787.rzvaldpwgwymnhdshn.workers.dev/" style="width:100%; height:800px; border:0; background:white;" loading="lazy"></iframe>
</div>

<div class="card">
  <h2>Install this <a href="https://tfms.xyz/firestick/core/tuts/proxy.with.pass.html" target="_blank"><button>PROXY</button></a></h2>
Enter the proxy url into the box below (Protected proxy with pass & expiry tokens)
  <hr>
  <div class="settings-box">
    <div style="display:flex; gap:0px; margin-bottom:0px;">
<input type="text" id="customIframeUrl" placeholder="https://example.com" style="flex:1;" >
<button onclick="loadCustomIframe()">Load Site</button>
    </div>
<iframe id="customIframe" src="about:blank" style="width:100%; height:800px; border:0; background:white;"></iframe>
</div>
</div>

<div class="card">
  <h2>Install this <a href="https://tfms.xyz/firestick/core/tuts/proxy.with.no.pass.html" target="_blank"><button>PROXY</button></a></h2>
Enter the proxy url into the box below (Open proxy with expiry tokens)
  <hr>
  <div class="settings-box">
<div style="display:flex; gap:0px; margin-bottom:0px;">
<input type="text" id="customIframeUrl2" placeholder="https://example.com" style="flex:1;">
<button onclick="loadCustomIframe2()">Load Site</button>
</div>
<iframe id="customIframe2" src="about:blank" style="width:100%; height:800px; border:0; background:white;"></iframe>
</div>
</div>
</div>
</div>
</div>
</div>

<div id="browserTab" class="tab-content">
  <div class="card">
    <h2>Headless Browser For Extracting Streams From Embed Pages</h2>
    <hr>
    <iframe
      src="https://paul9876587-browser2.hf.space"
      style="width:100%; height:900px; border:1px solid var(--border); border-radius:8px; background:white;"
      loading="lazy"
      allow="clipboard-read; clipboard-write; fullscreen"
      allowfullscreen>
    </iframe>
  </div>
</div>

<div id="settingsTab" class="tab-content">

  <div style=" background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; padding: 12px 16px; border-radius: 8px; margin-bottom: 15px; font-size: 14px; font-weight: 600;box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
    📢 Announcement:<br>Note this panel plays the direct links behind proxies, If you are using a 1 connection playlist as your stream source this will not work when you are serving multiple users, Always use streams from a good multi connection playlist
  </div>

  <div class="card">
    <h2>Admin Settings</h2>
    <hr>
    <div class="settings-grid">

      <div class="settings-box">
        <h3>Change Admin Login</h3>
        <input type="text" id="adminUser"  placeholder="Admin Username">
        <input type="password" id="adminPass" placeholder="Admin Password">
        <button onclick="saveSettings()">Save Admin Settings</button>
      </div>

      <div class="settings-box">
        <h3>Admin Information</h3>
        <div style="font-size:14px; line-height:1.8; color:#64748b;">
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

  <div class="card">
    <h2>Get FREE Streams</h2>
    <hr>
    <iframe src="https://tfms.xyz/firestick/sites/links.html" style="width:100%; height:600px; border:1px solid var(--border); border-radius:8px; background:white;" loading="lazy"></iframe>
  </div>

<div class="card">
  <h2>Live Media Players</h2>
  <hr>
  <div class="media-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">

    <div class="settings-box" style="padding:0; overflow:hidden;">
<iframe src="https://tfms.xyz/firestick/sites/jwplayer.html" style="width:100%; height:400px; border:0;" loading="lazy" allow="fullscreen" allowfullscreen></iframe>
</div>

    <div class="settings-box" style="padding:0; overflow:hidden;">
<iframe src="https://tfms.xyz/firestick/sites/clapprplayer.html" style="width:100%; height:400px; border:0;" loading="lazy" allow="fullscreen" allowfullscreen></iframe>
</div>
</div>
</div>

<div class="card">
  <h2>Tools</h2>
  <hr>

  <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">

    <div class="settings-box" style="padding:0; overflow:hidden;">
      <iframe src="https://tfms.xyz/firestick/sites/linkanalyzer1.html" style="width:100%; height:900px; border:0;" loading="lazy"></iframe>
    </div>

    <div class="settings-box" style="padding:0; overflow:hidden;">
      <iframe src="https://tfms.xyz/firestick/sites/url-formatter1.html" style="width:100%; height:900px; border:0;" loading="lazy"></iframe>
    </div>
  </div>
</div>

<div class="card">
  <h2>D1 SQL Backup Tools</h2>
  <hr>
  <div class="settings-grid">

    <div class="settings-box">
      <h3>Import/Export SQL Backup</h3>
      <div style="font-size:13px; color:#64748b; margin-bottom:10px;">Paste a full SQL backup export below and click import.</div>
      <textarea id="sqlInput" rows="12" placeholder="Paste SQL backup here..." style="width:100%; resize:vertical;"></textarea>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
        <button class="btn-success" onclick="uploadSqlImport()">Import SQL Backup</button>
        <button onclick="downloadSQLBackup()">Export SQL Backup</button>
      </div>
    </div>

    <div class="settings-box">
      <h3>Here You Can Import/Export Your SQL Backup</h3><br>
      <div style="font-size:14px; line-height:1.8; color:#64748b; margin-bottom:15px;">
        Export a full SQL backup containing:<br>
        • Users, Streams, Proxies, Settings<br><br>
        Import a full SQL backup:<br>
       Open Your SQL Backup On Your PC & Copy The Contents & Paste Into The Box<br><br>If This Fails Use Cloudflare Dashboard
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

<textarea id="adminComments" style="flex:1; width:100%; margin-top:10px; resize:none;"></textarea>
<button style="margin-top:10px;" onclick="saveComments()">Save Comments</button>
</div>

    <div class="xc-card blue" style="height: 400px; display:flex; flex-direction:column; padding:18px;">
    <div class="xc-title">TFMS IPTV Panel v1.0.4</div>
    <div style="margin-top:12px; font-size:13px; line-height:1.6; opacity:0.95;">
    
    <b>What's New in This Release</b>
    <ul style="margin:8px 0 0 18px; padding:0;">
      <li>Built in proxy encodes the urls</li>
      <li>2 new proxy options with tokens</li>
      <li>Choose proxy per userline</li>
      <li>Copy playlist button</li>
      <li>Tinyurl button auto generated</li>
      <li>Headless browser for finding streams</li>
      <li>User-agent & referal options</li>
      <li>Hardcoded EPG TV guide</li>
      <li>Choose Category in Mass Import</li>
      <li>Some UI Updates</li>
    </ul>

    <div style="margin-top:12px;">
      <b>Coming Next</b>
      <div style="margin-top:6px; opacity:0.9;">
        • Big code clean up<br>
        • Anything else i can think of<br>
      </div>
    </div>
  </div>
</div>

<div class="xc-card green" style="height:400px; display:flex; flex-direction:column; justify-content:center; gap:12px;">

<button class="quick-btn" onclick="window.open('#','_blank')">🌐 Spare</button>
<button class="quick-btn" onclick="window.open('https://tfms.xyz/firestick/mark/webtv.html','_blank')">🌐 Live Web-TV</button>
<button class="quick-btn" onclick="window.open('https://epgshare01.online/','_blank')">🌐 TV-Guides</button>
<button class="quick-btn" onclick="window.open('https://videodownloader.site/','_blank')">🌐 Movie Downloader</button>
<button class="quick-btn" onclick="window.open('https://www.livesoccertv.com','_blank')">🌐 Sports TV Schedule</button>
<button class="quick-btn" onclick="window.open('http://webtv.iptvsmarters.com/')">🌐 Smarters Online</button>
<button class="quick-btn" onclick="window.open('https://github.com/smokindope?tab=repositories')">🌐 Github Goodies</button>
</div>
    </div>
  </div>
</div>

<div id="usersTab" class="tab-content">

  <div class="card">
    <div class="settings-grid">
      <div class="settings-box">
        <h2>User Line Registry</h2>
        <hr>
        <h3>Create & Edit Account</h3>
        <input type="hidden" id="userId">

        <input type="text" id="username" placeholder="New Account Username">
<input type="text" id="password" placeholder="New Account Password">
<input type="number" id="maxConnections" placeholder="Max Allowed Simultaneous Connections" min="1" value="1">

        <input type="date" id="userExp">
        <select id="userStatus">
          <option value="active">Line Active</option>
          <option value="disabled">Line Deactivated</option>
        </select>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button id="userBtn" onclick="saveUser()">Create New User</button>
          <button id="cancelUserBtn" style="display:none; background:#64748b" onclick="resetUserForm()">Cancel</button>
        </div>
      </div>

      <div class="settings-box">
        <h2>Line Information</h2>
        <hr>
        <div style="font-size:14px; line-height:1.8; color:#64748b;">

          <b>Username & Password</b><br>
          Unique account login used for playlist generation<br>
          <b>Max Connections</b><br>Controls simultaneous active streams allowed per account<br>
          <b>Expiration Date</b><br>Accounts automatically stop working after 23:59 on selected date<br>
          <b>Status Types</b><br>Active = User can stream normally<br>Disabled = Account blocked manually<br>
          <b>Playlist Downloads</b><br>Generate playlists using direct streams, built-in proxy, or custom proxies<br>
          <b>Hardcoded EPG</b><br>TV-Guide is hardcoded your iptv app should pick it up<br>
          <b>NOTES</b><br>Only using the built in proxy will hide the real stream url this is to avoid double proxying and helps avoid cloudflares TOS
        </div>
      </div>
    </div>
  </div>

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
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
              <span>Actions</span>
              <input type="text" id="userSearch" placeholder="Search users..." onkeyup="filterUsers()" style="width:180px; padding:6px 10px; font-size:12px; border-radius:6px; margin:0;">
              <select id="globalProxySelect" title="Global default proxy" style="width:auto; min-width:200px; padding:6px 10px; font-size:12px; border-radius:6px; margin:0;"></select>
            </div>
          </th>
        </tr>
      </thead>
      <tbody id="userTable"></tbody>
    </table>
  </div>
</div>

<div id="streamsTab" class="tab-content">

  <div class="card">
    <h2>Streams & VOD Management</h2>
    <hr>
    <div class="settings-grid">

      <div class="settings-box">
        <h3>Create & Edit Streams & VOD</h3>
        <input type="hidden" id="streamId">
        <input type="text" id="streamName" placeholder="Stream/VOD Name">
        <input type="text" id="streamUrlInput" placeholder="Stream/VOD Source URL">
        <input type="text" id="streamCategory" placeholder="Choose A Category & Add Image, EG: Sports|https://logos.com/sky-sports.png">
        <input type="text" id="streamUserAgent" placeholder="Optional User-Agent header for this stream">
        <input type="text" id="streamReferer" placeholder="Optional Referer header for this stream">
        <button id="streamBtn" onclick="saveStream()">Add New Stream</button>
        <button id="cancelStreamBtn" style="display:none; background:#64748b" onclick="resetStreamForm()">Cancel</button>
        <br><br>

        <u>OPTIONAL</u><br>
        To add an image use the category input field<br>
        Example:
          Sports|https://logos.com/sky-sports.png<br><br>
        Optional User-Agent and Referer are sent by the built-in proxy and added as VLC options in generated playlists.
      </div>

      <div class="settings-box">
        <h3>M3U Bulk Import (.m3u parsing)</h3>
        <input type="text" id="massImportCategory" placeholder="Optional: Force Category (leave empty to use group-title)"/>
        <textarea id="massM3u" rows="8" placeholder="Mass Import M3U, If (group-title=) is included the category will be auto selected"></textarea>
        <button class="btn-success" onclick="massImport()">Mass Import Streams</button>
<hr>
<h3>OR Import From URL</h3>
<input type="text" id="remoteM3uUrl" placeholder="https://your.iptv.com/playlist.m3u"/>
<input type="text" id="remoteCategory" placeholder="Optional force category"/>
<button class="btn-success" onclick="importFromUrl()">Import From URL</button>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Registered Streams & VOD</h2>
    <hr>
    <table>
      <thead>
        <tr>
          <th>Channel Name</th>
          <th>Group Tag</th>
          <th style="width:520px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">

              <span>Actions</span>
              <div style="display:flex; gap:8px; align-items:center;">
                <input type="text" id="streamSearch" placeholder="Search streams..." onkeyup="filterStreams()" style="width:200px; padding:6px 10px; font-size:12px; border-radius:6px; margin:0;">
                <button onclick="clearStreamSearch()" style="padding:6px 10px; font-size:12px;">Clear</button>
              </div>
            </div>
          </th>
        </tr>
      </thead>
      <tbody id="streamTable"></tbody>
    </table>
  </div>

  <div class="card">
    <h2>Mass Delete Tools</h2>
    <hr>
    <div class="mass-delete-box">
      <strong style=" color:#991b1b; font-size:14px; white-space:nowrap;">Mass Delete:</strong>
      <select id="massDeleteSelect" style="margin:0; padding:6px; font-size:13px;">
      <option value="all">Wipe All Streams Completely</option></select>
      <button class="btn-danger" style="white-space: nowrap;" onclick="executeMassDelete()">Clear Streams</button>
    </div>
  </div>
</div>

<div id="player" style="width:100%; height:100%;"></div>
<footer style="margin-top:40px; text-align:center; font-size:12px; color:#64748b; padding:20px 0; border-top:1px solid var(--border);">
<a href="https://forum.tfms.xyz" target="_blank">Forum.tfms</a> TFMS IPTV Panel v1.0.4 - 2026
</footer>

<div id="aboutModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,.7); z-index:9999; justify-content:center; align-items:center;">
<div style="background:var(--card); color:var(--text); width:600px; max-width:90%; padding:25px; border-radius:10px;">
<h2>About TFMS IPTV Panel</h2>
<p>Version: <b>1.0.4</b></p>
<p>TFMS IPTV Panel is a lightweight Cloudflare Worker based IPTV management system featuring:</p>

<ul>
<li>User Line Management</li>
<li>Stream Management</li>
<li>Playlist Generation</li>
<li>Proxy Management</li>
<li>Tools M3U Analyzer, Url Formatter</li>
<li>Tools 1 Click Proxy Creation</li>
<li>Section To Get Free Streams</li>
<li>M3U Mass Imports</li>
<li>SQL Backup & Restore</li>
<li>Light/Dark Mode Support</li>
<li>2 Native Media Players</li>
<li>Use The Software Responsibly</li><br>
<li>EPG is hardcoded into the playlists</li>
<li>For stream images use the category field</li>
<li>This is to help save your cloudflare resources</li>
</ul>

<div style="text-align:right;"><button onclick="closeAboutModal()">Close</button></div>
</div>
</div>
</body>
</html>

<script>
function loadCustomIframe() {
  const url = document.getElementById('customIframeUrl').value.trim();

  if (!url) return alert('Enter a URL');

  let finalUrl = url;

  if (!finalUrl.startsWith('http://') &&
      !finalUrl.startsWith('https://')) {
    finalUrl = 'https://' + finalUrl;
  }

  localStorage.setItem('customIframeUrl', finalUrl);
  document.getElementById('customIframe').src = finalUrl;
}

function loadCustomIframe2() {
  let url = document.getElementById('customIframeUrl2').value.trim();
  if (!url) return alert('Enter a URL');

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  localStorage.setItem('customIframeUrl2', url);
  document.getElementById('customIframe2').src = url;
}

window.addEventListener('load', () => {
  const saved2 = localStorage.getItem('customIframeUrl2');
  if (saved2) {
    document.getElementById('customIframeUrl2').value = saved2;
    document.getElementById('customIframe2').src = saved2;
  }
});

window.addEventListener('load', () => {
  const saved = localStorage.getItem('customIframeUrl');

  if (saved) {
    document.getElementById('customIframeUrl').value = saved;
    document.getElementById('customIframe').src = saved;
  }
});
const builtInProxy = { id: 'default', name: 'Built In Proxy', url: '' };
const noProxyOption = { id: 'none', name: 'Use Direct Url or Choose Proxy', url: '' };

function proxyOptionsHtml(allProxies, selected = '') {
return allProxies.map(p => {
const safeId = String(p.id).replace(/"/g, '&quot;');
const safeName = String(p.name).replace(/</g, '&lt;').replace(/>/g, '&gt;');
return '<option value="' + safeId + '" ' + (String(p.id) === String(selected) ? 'selected' : '') + '>' + safeName + '</option>';
}).join('');
}

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
<button onclick='editUser(\${u.id}, \${JSON.stringify(u.username)}, \${JSON.stringify(u.password)}, \${JSON.stringify(u.exp_date)}, \${JSON.stringify(u.status)}, \${u.max_connections || 1})'>Edit</button>
<button class="btn-danger" onclick="deleteUser(\${u.id})">Delete</button>
<button class="btn-success" \${isExpired ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} onclick='downloadPlaylist(\${JSON.stringify(u.username)}, \${JSON.stringify(u.password)}, document.getElementById("proxySelect_\${u.id}").value || null)'>Playlist</button>
<button \${isExpired ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} onclick='copyPlaylistUrl(\${JSON.stringify(u.username)}, \${JSON.stringify(u.password)}, document.getElementById("proxySelect_\${u.id}").value || null)'>Copy</button>
<button \${isExpired ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : 'style="background:#0ea5e9;"'} onclick='tinyPlaylistUrl(\${JSON.stringify(u.username)}, \${JSON.stringify(u.password)}, document.getElementById("proxySelect_\${u.id}").value || null)'>TinyURL</button>
<select id="proxySelect_\${u.id}" title="Proxy for this user" style="width:165px; padding:6px 8px; font-size:12px; border-radius:6px; margin:0;">
<option value="">Use Global Proxy Setting</option>
\${proxyOptionsHtml(allProxies)}
</select>
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
const headerInfo = [
  s.user_agent ? 'UA: ' + s.user_agent : '',
  s.referer ? 'Referer: ' + s.referer : ''
].filter(Boolean).join(' | ');
tr.innerHTML = \`
<td>\${s.name}\${headerInfo ? '<br><small style="color:#64748b;">' + headerInfo + '</small>' : ''}</td>
<td>\${s.category}</td>
<td class="action-btns">
<button onclick='editStream(\${s.id}, \${JSON.stringify(s.name)}, \${JSON.stringify(s.url)}, \${JSON.stringify(s.category)}, \${JSON.stringify(s.user_agent || "")}, \${JSON.stringify(s.referer || "")})'>Edit</button>
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
category: document.getElementById('streamCategory').value,
user_agent: document.getElementById('streamUserAgent').value,
referer: document.getElementById('streamReferer').value
};
if (id) {
postData('/api/streams/edit', { id: parseInt(id), ...data });
} else {
postData('/api/streams/add', data);
}
resetStreamForm();
}

function editStream(id, name, url, category, userAgent = '', referer = '') {
document.getElementById('streamId').value = id;
document.getElementById('streamName').value = name;
document.getElementById('streamUrlInput').value = url;
document.getElementById('streamCategory').value = category;
document.getElementById('streamUserAgent').value = userAgent || '';
document.getElementById('streamReferer').value = referer || '';
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
document.getElementById('streamUserAgent').value = '';
document.getElementById('streamReferer').value = '';
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

function buildPlaylistUrl(user, pass, proxyId = null) {
const globalSelect = document.getElementById('globalProxySelect');
const finalProxyId = proxyId || globalSelect?.value || 'none';
return \`\${window.location.origin}/get_playlist?user=\${encodeURIComponent(user)}&pass=\${encodeURIComponent(pass)}&proxy=\${encodeURIComponent(finalProxyId)}\`;
}

function downloadPlaylist(user, pass, proxyId = null) {
window.open(buildPlaylistUrl(user, pass, proxyId), '_blank');
}

async function copyPlaylistUrl(user, pass, proxyId = null) {
const playlistUrl = buildPlaylistUrl(user, pass, proxyId);

try {
  await navigator.clipboard.writeText(playlistUrl);
  showCopyPopup('Playlist URL copied to clipboard');
} catch (e) {
  const tempInput = document.createElement('input');
  tempInput.value = playlistUrl;
  document.body.appendChild(tempInput);
  tempInput.select();
  document.execCommand('copy');
  tempInput.remove();

  showCopyPopup('Playlist URL copied to clipboard');
}
}

async function tinyPlaylistUrl(user, pass, proxyId = null) {
const playlistUrl = buildPlaylistUrl(user, pass, proxyId);

try {
  const res = await fetch('/api/tinyurl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: playlistUrl })
  });

  const data = await res.json();

  if (!res.ok || !data.tinyUrl) {
    throw new Error(data.error || 'TinyURL conversion failed');
  }

  try {
    await navigator.clipboard.writeText(data.tinyUrl);
    showCopyPopup('TinyURL copied to clipboard');
  } catch (clipError) {
    const tempInput = document.createElement('input');
    tempInput.value = data.tinyUrl;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    tempInput.remove();

    showCopyPopup('TinyURL copied to clipboard');
  }
} catch (e) {
  alert('TinyURL Error: ' + e.message);
}
}

function showCopyPopup(message) {
  const popup = document.createElement('div');

  popup.textContent = message;

  popup.style.position = 'fixed';
  popup.style.bottom = '20px';
  popup.style.right = '20px';
  popup.style.background = '#16a34a';
  popup.style.color = '#fff';
  popup.style.padding = '12px 18px';
  popup.style.borderRadius = '8px';
  popup.style.fontSize = '14px';
  popup.style.zIndex = '99999';
  popup.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';
  popup.style.opacity = '1';
  popup.style.transition = 'opacity 0.4s ease';

  document.body.appendChild(popup);

  setTimeout(() => {
    popup.style.opacity = '0';

    setTimeout(() => {
      popup.remove();
    }, 400);

  }, 2000);
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
const aboutBtn = document.getElementById('aboutBtn');

if (tabId === 'settingsTab') {
  updatesBtn.style.display = 'inline-block';
  aboutBtn.style.display = 'inline-block';
} else {
  updatesBtn.style.display = 'none';
  aboutBtn.style.display = 'none';
}
}

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

function showAboutModal() {
  document.getElementById('aboutModal').style.display = 'flex';
}

function closeAboutModal() {
  document.getElementById('aboutModal').style.display = 'none';
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

const splitContainer = document.getElementById('splitContainer');
const dragHandle = document.getElementById('dragHandle');

if (splitContainer && dragHandle) {
  const leftPane = splitContainer.querySelector('.left-pane');
  let isDragging = false;

  dragHandle.addEventListener('mousedown', () => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    document.body.style.cursor = 'default';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging || !leftPane) return;

    const rect = splitContainer.getBoundingClientRect();
    let percent = ((e.clientX - rect.left) / rect.width) * 100;

    if (percent < 20) percent = 20;
    if (percent > 80) percent = 80;

    leftPane.style.width = percent + '%';
  });
}

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

if (typeof jwplayer === 'function' && document.getElementById('player')) {
  jwplayer("player").setup({
    file: "YOUR_STREAM_URL",
    width: "100%",
    height: "100%",
    stretching: "uniform",
    autostart: true,
    primary: "html5",
    fullscreen: true
  });
}

if (typeof Clappr !== 'undefined' && Clappr.Player && document.getElementById('player')) {
  var player = new Clappr.Player({
    source: "YOUR_STREAM_URL",
    parentId: "#player",
    width: "100%",
    height: "100%",
    autoPlay: true,
    plugins: [Clappr.FlasHLS, Clappr.MediaControl].filter(Boolean),
    fullscreenEnabled: true
  });
}
</script>
`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }
};
