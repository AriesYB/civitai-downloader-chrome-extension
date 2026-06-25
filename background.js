/* background.js — MV3 service worker
 * 统一基于「打开详情页 tab」取址再下载，对 list / post / 右键 都适用。
 * 流程：content 发来 ids → 逐个 chrome.tabs.create 打开 /images/<id> →
 *   chrome.scripting.executeScript 读出 <video>/<img> 的 original=true 原址与作者 →
 *   chrome.downloads.download 保存到 civitai/<作者>/<id>.<ext> → 关闭 tab。
 * 用原生下载：无 CORS、带 civitai.red Referer、filename 支持子目录。
 */
importScripts("civitai-core.js");
var C = self.CivitaiCore;

var DEFAULTS = { downloadFolder: "civitai", downloadedIds: {} };

// 版本信标：worker 每次启动在 service worker 控制台打一行，方便核对是否刷新到最新代码。
// chrome://extensions 的「Service Worker」链接打开的 DevTools 能看到。
console.log("[civitai-dl] background service worker booted v1.5.1 @", new Date().toISOString());

// ---------- 已下载记录（去重用，持久化到 chrome.storage.local.downloadedIds） ----------
// { "<id>": "<filename>" }。成功下载后写入；下载前检查，命中则跳过防止重复下载。
// 注意：这只记扩展自己下过的。更可靠的去重是查 Chrome 下载历史（existsFileInHistory），
// 能覆盖所有经 Chrome 下载的文件（不限本扩展）。
function readHistory() {
  return chrome.storage.local.get({ downloadedIds: {} }).then(function (s) {
    return s.downloadedIds || {};
  });
}
function recordDownloaded(id, filename) {
  return readHistory().then(function (hist) {
    hist[id] = filename || true;
    return chrome.storage.local.set({ downloadedIds: hist });
  });
}
function clearHistory() {
  return chrome.storage.local.set({ downloadedIds: {} });
}

// 查 Chrome 下载历史，构造「相对路径 -> 是否存在」表，用于判断目标文件是否已下过。
// chrome.downloads.search 的 DownloadItem 有 filename(绝对路径) 和 exists(文件是否还在磁盘)。
// 我们关心的是「下载目录/顶层目录/作者/id.ext」这种相对路径是否已存在且文件还在。
// 一次性查全部历史（条目可能很多，但 search 很快），过滤出含本扩展目录名的项。
var _existCache = null; // {rel: boolean} 缓存，单次 runDownloadTasks 内复用
function buildExistCache(topFolder) {
  return chrome.downloads.search({}).then(function (items) {
    var map = {};
    (items || []).forEach(function (it) {
      if (!it.filename) return;
      // filename 是绝对路径，如 C:\Users\x\Downloads\civitai\prush\123.jpg
      // 取相对下载目录的部分：规范化分隔符后，找 topFolder 起的子路径
      var rel = it.filename.replace(/\\/g, "/");
      // 尝试从 topFolder 处截断；找不到就退而用最后两段（作者/id.ext）
      var idx = topFolder ? rel.toLowerCase().indexOf("/" + topFolder.toLowerCase() + "/") : -1;
      if (idx >= 0) rel = rel.slice(idx + 1); // 含 topFolder/...
      else {
        var parts = rel.split("/");
        rel = parts.slice(-2).join("/"); // 作者/id.ext
      }
      // 同一 rel 只要任一次 exists=true 就算存在（避免被删除项误判）
      if (map[rel] === undefined || it.exists) map[rel.toLowerCase()] = map[rel.toLowerCase()] || !!it.exists;
    });
    return map;
  });
}
// 判断「顶层目录/作者/id.ext」是否已在下载历史且文件仍在磁盘
function existsInHistory(id, author, ext, topFolder) {
  if (!_existCache) return false;
  var a = C.sanitizeSegment(author || "") || "unknown";
  var rel = (topFolder ? topFolder + "/" : "") + a + "/" + id + "." + ext;
  return !!_existCache[rel.toLowerCase()];
}

// ---------- 右键菜单 + 安装 ----------
chrome.runtime.onInstalled.addListener(function () {
  try {
    chrome.contextMenus.create({
      id: "civitai-save-media",
      title: "Civitai：另存此图/视频（原始质量）",
      contexts: ["image", "video", "link", "page"]
    });
  } catch (e) { /* 已存在 */ }
  chrome.storage.local.get(DEFAULTS, function (cur) {
    var patch = {};
    Object.keys(DEFAULTS).forEach(function (k) { if (cur[k] === undefined) patch[k] = DEFAULTS[k]; });
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  });
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId !== "civitai-save-media" || !tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, C.msg("CONTEXT_SAVE", {
    srcUrl: info.srcUrl || null,
    linkUrl: info.linkUrl || null,
    pageUrl: info.pageUrl || (tab.url || null)
  }), function () { void chrome.runtime.lastError; });
});

// ---------- 详情页取址（打开真实 tab，注入脚本读取） ----------
// 注入函数体：自包含，不能访问外部闭包。轮询直到读到 original 媒体或超时（45s）。
var EXTRACT_FUNC = function () {
  function readUser() {
    // 优先：document.title 形如 "Image post by <作者>" / "Image posted by <作者>"
    try {
      var t = (document.title || "").match(/(?:post|creat)(?:ed)?\s+by\s+(.+?)(?:\s+[-|]\s+.+|[.\s]*$)/i);
      if (t && t[1]) return t[1].trim();
    } catch (e) {}
    // 次选：og:title meta
    try {
      var m = document.querySelector('meta[property="og:title"]');
      if (m) {
        var tt = (m.getAttribute("content") || "").match(/(?:post|creat)(?:ed)?\s+by\s+(.+?)(?:\s+[-|]\s+.+|[.\s]*$)/i);
        if (tt && tt[1]) return tt[1].trim();
      }
    } catch (e) {}
    // 兜底：严格匹配 /user/<name>/?$ 的链接（排除导航栏里的当前登录用户等）
    try {
      var as = document.querySelectorAll('a[href*="/user/"]');
      for (var i = 0; i < as.length; i++) {
        var href = as[i].getAttribute("href") || "";
        if (/^\/user\/[^/?#]+\/?$/.test(href)) {
          var seg = href.match(/\/user\/([^/?#]+)/);
          if (seg) { try { return decodeURIComponent(seg[1]); } catch (e) { return seg[1]; } }
        }
      }
    } catch (e) {}
    return null;
  }
  function inferExt(u) {
    var p = String(u || "").split("?")[0].split("#")[0];
    var host = p.indexOf("://"); if (host >= 0) { p = p.slice(host + 3); var sl = p.indexOf("/"); if (sl >= 0) p = p.slice(sl); }
    var m = p.match(/\.([a-zA-Z0-9]{2,4})(?:$|\/)/); var ext = m ? m[1].toLowerCase() : null;
    var MEDIA = { mp4:1, webm:1, mov:1, m4v:1, png:1, webp:1, gif:1, jpg:1, jpeg:1, avif:1 };
    if (ext && !MEDIA[ext.toLowerCase()]) ext = null;
    if (!ext) ext = "jpg";
    if (ext === "jpeg") ext = "jpg";
    return ext;
  }
  return new Promise(function (resolve) {
    var deadline = Date.now() + 45000;
    function tick() {
      try {
        // 视频：必须 original=true（transcode 缩略版不算原画质）
        var vs = document.querySelectorAll("video source");
        for (var i = 0; i < vs.length; i++) {
          var s = vs[i].src;
          if (s && /image\.civitai\.com/.test(s) && /original=true/i.test(s)) { resolve({ url: s, author: readUser(), ext: inferExt(s) }); return; }
        }
        var vid = document.querySelector("video");
        if (vid && vid.currentSrc && /image\.civitai\.com/.test(vid.currentSrc) && /original=true/i.test(vid.currentSrc)) { resolve({ url: vid.currentSrc, author: readUser(), ext: inferExt(vid.currentSrc) }); return; }
        // 图片：必须 original=true（width=N / original=false 缩略图不算原画质）
        var imgs = Array.prototype.slice.call(document.querySelectorAll('img[src*="image.civitai.com"]'));
        var cands = imgs.filter(function (im) { return im.naturalWidth > 100 && im.naturalHeight > 100 && /original=true/i.test(im.src); });
        if (cands.length) {
          cands.sort(function (a, b) { return (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight); });
          resolve({ url: cands[0].src, author: readUser(), ext: inferExt(cands[0].src) }); return;
        }
      } catch (e) {}
      if (Date.now() < deadline) setTimeout(tick, 400);
      else resolve(null);
    }
    tick();
  });
};

// 打开 /images/<id> tab，注入取址脚本，返回 {url, author, ext}，完成后关 tab
function getDetailMedia(id) {
  return new Promise(function (resolve) {
    var url = C.CIVITAI_ORIGIN + "/images/" + id;
    var tabId = null, settled = false, injectTries = 0;
    var safety = setTimeout(function () { finish(null); }, 70000);
    function finish(val) {
      if (settled) return; settled = true;
      clearTimeout(safety);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (tabId != null) { try { chrome.tabs.remove(tabId); } catch (e) {} }
      resolve(val);
    }
    function tryInject() {
      injectTries++;
      chrome.scripting.executeScript({ target: { tabId: tabId }, func: EXTRACT_FUNC }).then(function (res) {
        var r = res && res[0] && res[0].result;
        if (r && r.url) finish(r);
        else if (injectTries < 6) setTimeout(tryInject, 1500);
        else finish(null);
      }).catch(function () {
        if (injectTries < 6) setTimeout(tryInject, 1500); else finish(null);
      });
    }
    function onUpdated(tid, info) {
      if (tid !== tabId || info.status !== "complete") return;
      tryInject();
    }
    chrome.tabs.create({ url: url, active: false }, function (tab) {
      if (!tab) { finish(null); return; }
      tabId = tab.id;
      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(function () { if (!settled) tryInject(); }, 1500);
    });
  });
}

// ---------- 下载编排：tasks → 逐个取址（有 url 直用，无则开详情页 tab）→ 去重检查 → 下载 ----------
// task: { id, url?, author? } —— post 页 content 已带 url（读 DOM），列表页只有 id（开 tab）
function runDownloadTasks(tasks, sourceTabId) {
  return chrome.storage.local.get(DEFAULTS).then(function (s) {
    var top = s.downloadFolder || "";
    // 先构建下载历史存在表，用于去重（判断目标文件是否已存在于磁盘）
    return buildExistCache(top).then(function (cache) {
      _existCache = cache;
      var total = tasks.length, done = 0, failed = 0, skipped = 0, idx = 0;
      pushProgress(sourceTabId, "start", { total: total, done: 0, failed: 0, skipped: 0 });
      function next() {
        if (idx >= tasks.length) {
          pushProgress(sourceTabId, "finish", { done: done, failed: failed, total: total, skipped: skipped });
          _existCache = null; // 清缓存，下次重建
          return Promise.resolve();
        }
        var t = tasks[idx++];
        pushProgress(sourceTabId, "downloading", { id: t.id, done: done, total: total });
        // 有 url（post 页 DOM 已取到原址）直接用；否则开详情页 tab 取址
        var infoP = t.url ? Promise.resolve({ url: t.url, author: t.author, ext: C.inferExtension(t.url) })
                          : getDetailMedia(t.id);
        return infoP.then(function (info) {
          if (!info || !info.url) {
            console.warn("[civitai-dl] no media for", t.id, info ? "" : "(null info)");
            failed++; pushProgress(sourceTabId, "error", { id: t.id, failed: failed }); return next();
          }
          var author = C.sanitizeSegment(info.author || t.author || "") || "unknown";
          var ext = info.ext || C.inferExtension(info.url);
          // 去重：目标文件已在下载历史且文件还在磁盘 → 跳过
          if (existsInHistory(t.id, author, ext, top)) {
            skipped++;
            console.log("[civitai-dl] skip exists:", t.id);
            pushProgress(sourceTabId, "skipped", { count: 1, ids: [t.id] });
            done++; pushProgress(sourceTabId, "complete", { id: t.id, done: done });
            return next();
          }
          var parts = [];
          if (top) parts.push(top);
          parts.push(author);
          parts.push(t.id + "." + ext);
          var filename = parts.join("/");
          console.log("[civitai-dl] task", (idx - 1) + "/" + tasks.length, t.id, "->", filename);
          return downloadOne(info.url, filename).then(function (ok) {
            if (ok) { done++; pushProgress(sourceTabId, "complete", { id: t.id, done: done }); recordDownloaded(t.id, filename); }
            else { failed++; pushProgress(sourceTabId, "error", { id: t.id, failed: failed }); }
            return next();
          });
        }).catch(function () { failed++; pushProgress(sourceTabId, "error", { id: t.id, failed: failed }); return next(); });
      }
      return next();
    });
  });
}

// ---------- 强制文件名：用 onDeterminingFilename 监听 ----------
// 关键背景：chrome.downloads.download 的 filename 参数会被静默忽略，只要浏览器里
// 「任何」一个扩展注册了 onDeterminingFilename 监听器（DownThemAll、各路下载管理器、
// IDM 集成等都会注册）。表现就是文件名变成 locale 默认值（中文为「下载」，无扩展名）、
// 落到 Download 根。解法：我们自己注册 onDeterminingFilename 监听器作为事件所有者，
// 在文件名确定阶段强制写回我们的 filename。
// 实现要点：不能按 downloadId 登记（onDeterminingFilename 在 download 回调拿到 id 之前就
// 触发了，有竞态 → 多选时除第一个外全漏）。改按「目标 URL」登记，监听器用 item.url 匹配，
// URL 在监听器里立即可得，无竞态。
var URL_TO_NAME = new Map(); // url -> 目标 filename

chrome.downloads.onDeterminingFilename.addListener(function (item, suggest) {
  var want = URL_TO_NAME.get(item.url);
  if (want) {
    suggest({ filename: want, conflictAction: "uniquify" });
    return true; // 接管 suggest
  }
  return false; // 非本扩展发起，放行默认行为
});

// 触发一次原生下载，等待完成/中断
function downloadOne(url, filename) {
  return chromeDownloadWait(url, filename);
}

// 实际下发 chrome.downloads 并等到完成/中断
function chromeDownloadWait(dlUrl, filename) {
  return new Promise(function (resolve) {
    var downloadId = null;
    var listener = function (delta) {
      if (delta.id !== downloadId) return;
      if (delta.state && (delta.state.current === "complete" || delta.state.current === "interrupted")) {
        cleanup();
        resolve(delta.state.current === "complete");
      }
    };
    var safety = null;
    function cleanup() {
      if (safety) { clearTimeout(safety); safety = null; }
      URL_TO_NAME.delete(dlUrl);
      try { chrome.downloads.onChanged.removeListener(listener); } catch (e) {}
    }
    try {
      // 发起前先登记 URL→filename，确保 onDeterminingFilename 触发时能匹配到
      URL_TO_NAME.set(dlUrl, filename);
      chrome.downloads.download({ url: dlUrl, filename: filename, conflictAction: "uniquify", saveAs: false }, function (id) {
        var err = chrome.runtime.lastError;
        if (err || id === undefined) { cleanup(); resolve(false); return; }
        downloadId = id;
        console.log("[civitai-dl] queued", id, "->", filename);
        safety = setTimeout(function () { cleanup(); resolve(true); }, 5 * 60 * 1000);
        chrome.downloads.onChanged.addListener(listener);
      });
    } catch (e) { cleanup(); resolve(false); }
  });
}

function pushProgress(tabId, stage, data) {
  if (tabId == null) return;
  try {
    chrome.tabs.sendMessage(tabId, C.msg("PROGRESS", Object.assign({ stage: stage }, data || {})), function () { void chrome.runtime.lastError; });
  } catch (e) {}
}

// ---------- 消息路由 ----------
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;
  var sourceTabId = sender.tab && sender.tab.id;

  if (msg.type === "PING") { sendResponse({ ok: true, pong: Date.now() }); return; }
  if (msg.type === "PAGE_INFO") { sendResponse({ ok: true }); return; }

  // content 发来要下载的任务（id 列表，或 {id,url,author} 列表）
  if (msg.type === "DOWNLOAD_IDS") {
    var raw = (msg.payload && (msg.payload.tasks || msg.payload.ids)) || [];
    // 统一成 {id, url?, author?}
    var tasks = raw.map(function (x) {
      if (typeof x === "string") return { id: x };
      return { id: x.id, url: x.url || null, author: x.author || null };
    }).filter(function (x) { return !!x.id; });
    if (!tasks.length) { sendResponse({ ok: false, error: "no ids" }); return; }
    // 去重/跳过在 runDownloadTasks 内做（即便全部已下载，也会走 start→skipped→finish，让 UI 提示）
    runDownloadTasks(tasks, sourceTabId).then(function () {
      sendResponse({ ok: true, count: tasks.length });
    }).catch(function (e) { sendResponse({ ok: false, error: e.message }); });
    return true; // async
  }

  // 设置页：查询/清除已下载记录
  if (msg.type === "QUERY_HISTORY") {
    readHistory().then(function (hist) {
      sendResponse({ ok: true, count: Object.keys(hist).length });
    });
    return true;
  }
  if (msg.type === "CLEAR_HISTORY") {
    clearHistory().then(function () { sendResponse({ ok: true, count: 0 }); });
    return true;
  }

  if (msg.type === "NOTIFY") {
    try {
      chrome.notifications.create("civitai_" + Date.now(), {
        type: "basic", iconUrl: "icons/icon-128.png",
        title: (msg.payload && msg.payload.title) || "Civitai 下载",
        message: (msg.payload && msg.payload.message) || ""
      });
    } catch (e) {}
    sendResponse({ ok: true }); return;
  }

  function forwardToActiveTab(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tid = tabs[0] && tabs[0].id;
      if (tid == null) { sendResponse({ ok: false }); return; }
      chrome.tabs.sendMessage(tid, message, function (resp) { void chrome.runtime.lastError; sendResponse(resp || { ok: false }); });
    });
  }

  if (msg.type === "QUERY_SELECTION") { forwardToActiveTab(msg); return true; }
  if (msg.type === "QUERY_PAGE_TYPE") {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var url = tabs[0] && tabs[0].url;
      sendResponse({ ok: true, type: C.detectPageType(url), url: url });
    });
    return true;
  }
  if (msg.type === "ACTION_TOGGLE_SELECT" || msg.type === "ACTION_SELECT_ALL"
      || msg.type === "ACTION_SELECT_VIDEOS" || msg.type === "ACTION_SELECT_IMAGES"
      || msg.type === "ACTION_INVERT" || msg.type === "ACTION_CLEAR"
      || msg.type === "ACTION_DOWNLOAD") {
    forwardToActiveTab(msg);
    return true;
  }
});
