/* content.js — 注入到 civitai.red
 * 勾选 + 批量下载交互层。content 只负责「收集媒体 id」，下载在 background 完成：
 * background 会逐个打开 /images/<id> 详情页 tab 读出原址再用 chrome.downloads 下载
 * （这条路 list / post / 右键 通用，统一可靠）。
 *
 * 交互：
 *  - 每个卡片左上角常驻复选框。单击切换，Shift+点区间多选。
 *  - 悬浮面板：全选 / 仅视频 / 仅图片 / 反选 / 清空 / 下载所选。
 *  - 右键图片/视频 → 「Civitai：另存此图/视频」。
 */
(function () {
  "use strict";
  var C = window.CivitaiCore;
  if (window.__civitaiDlInjected) return;
  window.__civitaiDlInjected = true;

  var state = {
    pageType: "other",
    selectMode: false,  // 默认关闭：checkbox 隐藏、正常浏览不干扰；手动开启才进入选择模式
    selected: new Map(), // id -> { id, el, type }
    url: location.href,
    panelEl: null,
    lastClickedId: null,
    lastClickedIdx: null,
    lastContextTarget: null,
    progress: { active: false, total: 0, done: 0, failed: 0, skipped: 0, visible: false }
  };

  function setStatus(text) {
    var el = document.getElementById("cvdl-status");
    if (el) el.textContent = text;
  }

  function findCard(anchor) {
    var n = anchor, depth = 0;
    while (n && n !== document.body && depth < 12) {
      if (n.tagName === "A") { n = n.parentElement; depth++; continue; }
      var rect = n.getBoundingClientRect();
      if (window.getComputedStyle(n).position === "relative" && rect.height > 80 && rect.width > 80) return n;
      n = n.parentElement; depth++;
    }
    return anchor;
  }

  function detectType(card) {
    if (card && card.querySelector("video")) return "video";
    var html = "";
    try { html = card ? (card.outerHTML || "") : ""; } catch (e) { html = ""; }
    // 视频卡片可能含 .mp4/.webm 链接、data-video、video 标记类名、或 video poster
    if (/\.mp4|\.webm|\.mov|data-video|video-poster|isVideo/i.test(html)) return "video";
    return "image";
  }

  // post / list 页：读卡片里 image.civitai.com 的地址并升级到原画质。
  // 不开新标签页：列表缩略图 original=false / width=N，点击放大后地址是
  //   .../original=true,quality=90/...，直接做段替换即可，无需重新加载。
  // video source/currentSrc 同理（很多本身就是 original=true）。
  function pickOriginalUrl(card) {
    if (!card) return null;
    // 1) video source
    var vs = card.querySelectorAll("video source");
    for (var i = 0; i < vs.length; i++) {
      var s = vs[i].src;
      if (s && /image\.civitai\.com/.test(s)) return C.upgradeToOriginal(s);
    }
    var vid = card.querySelector("video");
    if (vid && vid.currentSrc && /image\.civitai\.com/.test(vid.currentSrc)) return C.upgradeToOriginal(vid.currentSrc);
    // 2) 图片：取最大那张（原图通常最大；缩略图升级后等价）
    var imgs = Array.prototype.slice.call(card.querySelectorAll('img[src*="image.civitai.com"]'));
    var best = null, bestArea = 0;
    for (var j = 0; j < imgs.length; j++) {
      var im = imgs[j];
      var area = (im.naturalWidth || 0) * (im.naturalHeight || 0);
      // 主图未载完时 area=0，给个最小面积兜底（大于 64x64）避免取到图标
      if (im.naturalWidth && im.naturalWidth < 32) continue;
      if (area >= bestArea) { bestArea = area; best = im; }
    }
    return best ? C.upgradeToOriginal(best.src) : null;
  }

  // 按卡片读作者。优先级：
  //  1) 卡片内 /user/<name> 链接（避开 /images /videos /posts 二级页）
  //  2) 当前页面 URL 里的 /user/<name>（/user/xxx/videos、/user/xxx/images 都自带作者）
  //  3) document.title（post 页有「Image post by xxx」）
  function authorFromCard(card) {
    if (card) {
      var as = card.querySelectorAll('a[href*="/user/"]');
      for (var i = 0; i < as.length; i++) {
        var href = as[i].getAttribute("href") || "";
        var m = href.match(/^\/user\/([^/?#]+)(?:\/images|\/videos|\/posts)?\/?$/i);
        if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
      }
    }
    // /user/<name>/videos 或 /user/<name>/images 页面，URL 自带作者
    var fromUrl = C.extractUserSegment(location.href);
    if (fromUrl) return fromUrl;
    return C.extractAuthorFromTitle(document.title);
  }

  // ---------- 收集卡片（按 a[href*=/images/<id>] 锚点） ----------
  function getCards() {
    var out = [], seen = new Set();
    var anchors = document.querySelectorAll('a[href*="/images/"]');
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var id = C.extractMediaId(a.getAttribute("href") || "");
      if (!id || seen.has(id)) continue;
      var card = findCard(a);
      // 不要求 img/video 已存在：视频卡片加载前可能只有占位，没有 media 元素也要能勾选。
      // pickOriginalUrl 读不到 url 时返回 null，列表页本就靠 background 开详情页取址，无影响。
      seen.add(id);
      var url = (state.pageType === "post") ? pickOriginalUrl(card) : null;
      var author = authorFromCard(card);
      out.push({ id: id, card: card, type: detectType(card), url: url, author: author });
    }
    return out;
  }

  // ---------- 复选框 ----------
  function ensureCheckbox(card, item) {
    if (card.dataset.cvdlBox === "1") {
      var cb0 = card.querySelector(".cvdl-check");
      if (cb0) {
        cb0.dataset.id = item.id; cb0.dataset.type = item.type || "image";
        cb0.dataset.url = item.url || ""; cb0.dataset.author = item.author || "";
      }
      return;
    }
    card.dataset.cvdlBox = "1";
    if (window.getComputedStyle(card).position === "static") card.style.position = "relative";

    var box = document.createElement("div");
    box.className = "cvdl-check";
    box.title = "勾选下载（Shift+点 = 区间多选）";
    box.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    box.dataset.id = item.id;
    box.dataset.type = item.type || "image";
    box.dataset.url = item.url || "";
    box.dataset.author = item.author || "";

    function kill(e) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }
    box.addEventListener("pointerdown", function (e) { kill(e); handleBoxClick(box, e.shiftKey); }, true);
    ["mousedown", "click", "dblclick", "auxclick", "selectstart"].forEach(function (ev) {
      box.addEventListener(ev, kill, true); box.addEventListener(ev, kill, false);
    });
    card.appendChild(box);

    if (state.selected.has(item.id)) {
      box.classList.add("checked");
      box.setAttribute("aria-checked", "true");
      card.classList.add("cvdl-selected");
    }
  }

  // Shift 区间用「DOM 顺序索引」而非像素坐标。
  // 像素坐标方案在虚拟滚动/容器嵌套下不稳定（rect.top 随滚动同步变化，算出来的区间
  // 宽度会塌缩）。DOM 索引方案：按 .cvdl-check 在 DOM 里的出现顺序排序，点 A 记 A 的索引，
  // Shift 点 B 时选 [A索引, B索引] 之间所有卡片。对当前 DOM 内卡片 100% 可靠。
  // 列表是虚拟滚动时，被滚出屏幕回收的卡片不在 DOM，无法选中（物理限制）。
  function allBoxesOrdered() {
    var list = Array.prototype.slice.call(document.querySelectorAll(".cvdl-check"));
    // 按渲染位置（行→列）排序，保证视觉上从上到下、从左到右
    list.sort(function (a, b) {
      var ra = a.parentElement.getBoundingClientRect();
      var rb = b.parentElement.getBoundingClientRect();
      var ya = Math.round(ra.top + ra.height / 2), yb = Math.round(rb.top + rb.height / 2);
      if (Math.abs(ya - yb) > 40) return ya - yb; // 不同行
      return Math.round(ra.left - rb.left);       // 同行按列
    });
    return list;
  }

  function indexOfBox(box) {
    var list = allBoxesOrdered();
    for (var i = 0; i < list.length; i++) if (list[i] === box) return i;
    return -1;
  }

  function handleBoxClick(box, shift) {
    var id = box.dataset.id;
    if (shift && state.lastClickedId != null && state.lastClickedId !== id && state.lastClickedIdx != null) {
      var list = allBoxesOrdered();
      var startIdx = -1, endIdx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].dataset.id === state.lastClickedId) startIdx = i;
        if (list[i] === box) endIdx = i;
      }
      if (startIdx >= 0 && endIdx >= 0) {
        var lo = Math.min(startIdx, endIdx), hi = Math.max(startIdx, endIdx);
        for (var j = lo; j <= hi; j++) selectBox(list[j], true);
      }
      state.lastClickedId = id;
      state.lastClickedIdx = endIdx >= 0 ? endIdx : indexOfBox(box);
      updatePanel();
      return;
    }
    selectBox(box, !state.selected.has(id));
    state.lastClickedId = id;
    state.lastClickedIdx = indexOfBox(box);
    updatePanel();
  }


  function selectBox(box, on) {
    if (!box) return;
    var id = box.dataset.id, card = box.parentElement;
    if (on) {
      state.selected.set(id, { id: id, el: card, type: box.dataset.type || "image", url: box.dataset.url || null, author: box.dataset.author || null });
      box.classList.add("checked"); box.setAttribute("aria-checked", "true");
      if (card) card.classList.add("cvdl-selected");
    } else {
      state.selected.delete(id);
      box.classList.remove("checked"); box.setAttribute("aria-checked", "false");
      if (card) card.classList.remove("cvdl-selected");
    }
  }

  // ---------- 扫描注入 ----------
  function scanAndInject() {
    // 无论 selectMode 开关都注入 checkbox（关闭时由 cvdl-off 类隐藏），这样一开启就立即可用。
    if (state.pageType !== "list" && state.pageType !== "image" && state.pageType !== "post") return;
    getCards().forEach(function (it) {
      ensureCheckbox(it.card, { id: it.id, type: it.type, url: it.url || null, author: it.author || null });
    });
  }

  // ---------- 面板 ----------
  function buildPanel() {
    if (state.panelEl) return;
    var p = document.createElement("div");
    p.id = "cvdl-panel";
    p.innerHTML =
      '<div class="cvdl-head"><span class="cvdl-title">Civitai 下载</span><span class="cvdl-type" id="cvdl-type"></span><button class="cvdl-mini" id="cvdl-min" title="收起">—</button></div>' +
      '<div class="cvdl-body">' +
      '  <div class="cvdl-row"><button id="cvdl-toggle-mode" class="toggle-off">开启选择模式</button></div>' +
      '  <div class="cvdl-row"><span id="cvdl-status">已选 0 项</span></div>' +
      '  <div class="cvdl-row cvdl-filters">' +
      '    <button id="cvdl-all">全选</button><button id="cvdl-videos">仅视频</button><button id="cvdl-images">仅图片</button>' +
      '    <button id="cvdl-invert">反选</button><button id="cvdl-clear">清空</button>' +
      '  </div>' +
      '  <div class="cvdl-row"><button id="cvdl-download" class="primary">下载所选</button></div>' +
      '  <div class="cvdl-row cvdl-progress" id="cvdl-progress" style="display:none"><div class="cvdl-bar"><div class="cvdl-bar-fill" id="cvdl-barfill"></div></div><span id="cvdl-progtext"></span></div>' +
      '  <div class="cvdl-foot">开启选择模式后，点卡片左上角框勾选（Shift+点 = 区间多选）；关闭则正常浏览。或在图上右键另存。</div>' +
      '</div>';
    document.documentElement.appendChild(p);
    state.panelEl = p;
    p.querySelector("#cvdl-min").addEventListener("click", function () { p.classList.toggle("collapsed"); });
    p.querySelector("#cvdl-toggle-mode").addEventListener("click", toggleSelectMode);
    p.querySelector("#cvdl-all").addEventListener("click", function () { selectByType("all"); });
    p.querySelector("#cvdl-videos").addEventListener("click", function () { selectByType("video", "only"); });
    p.querySelector("#cvdl-images").addEventListener("click", function () { selectByType("image", "only"); });
    p.querySelector("#cvdl-invert").addEventListener("click", invertVisible);
    p.querySelector("#cvdl-clear").addEventListener("click", clearSelection);
    p.querySelector("#cvdl-download").addEventListener("click", downloadSelected);
  }

  // 开关：开启时显示 checkbox + 进入选择态；关闭时隐藏 + 清空勾选，恢复纯浏览。
  function toggleSelectMode() {
    state.selectMode = !state.selectMode;
    document.documentElement.classList.toggle("cvdl-off", !state.selectMode);
    var btn = document.getElementById("cvdl-toggle-mode");
    if (btn) {
      btn.textContent = state.selectMode ? "关闭选择模式" : "开启选择模式";
      btn.className = state.selectMode ? "toggle-on" : "toggle-off";
    }
    if (!state.selectMode) clearSelection(); // 关闭时清空勾选，避免残留状态
    if (state.selectMode) scanAndInject();
    updatePanel();
  }

  function updatePanel() {
    var n = state.selected.size, vids = 0, imgs = 0;
    state.selected.forEach(function (rec) { if (rec.type === "video") vids++; else imgs++; });
    setStatus("已选 " + n + " 项（视频 " + vids + " / 图片 " + imgs + "）");
    var dl = document.getElementById("cvdl-download");
    if (dl) dl.disabled = n === 0 || state.progress.active;
    var t = document.getElementById("cvdl-type");
    if (t) t.textContent = pageTypeLabel(state.pageType);
  }

  function pageTypeLabel(p) {
    return p === "post" ? "Post 页" : (p === "list" ? "列表页" : (p === "image" ? "媒体详情" : "不支持"));
  }

  function selectByType(filter, mode) {
    var boxes = visibleBoxes();
    if (mode === "only") clearSelection();
    boxes.forEach(function (box) {
      var type = box.dataset.type || "image";
      if (filter === "all" || filter === type) selectBox(box, true);
    });
    updatePanel();
  }

  function invertVisible() {
    visibleBoxes().forEach(function (box) { selectBox(box, !state.selected.has(box.dataset.id)); });
    updatePanel();
  }

  function visibleBoxes() {
    var out = [], boxes = document.querySelectorAll(".cvdl-check");
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i], card = box.parentElement;
      if (!box.isConnected || !card) continue;
      var r = card.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(box);
    }
    return out;
  }

  function clearSelection() {
    // 直接遍历 DOM 里所有 checkbox 强制取消，不依赖 state.selected 的记录
    // （Shift 选中后某些卡片的 rec.el 引用可能失效，或被虚拟滚动重渲染，仅清 state 会漏）
    var boxes = document.querySelectorAll(".cvdl-check.checked");
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].classList.remove("checked");
      boxes[i].setAttribute("aria-checked", "false");
      var card = boxes[i].parentElement;
      if (card) card.classList.remove("cvdl-selected");
    }
    state.selected.clear();
    state.lastClickedId = null;
    state.lastClickedIdx = null;
    updatePanel();
  }

  // ---------- 下载：收集任务（每张图带 url+author 直存，读不到 url 才开详情页） ----------
  function downloadSelected() {
    if (state.progress.active || state.selected.size === 0) return;
    var tasks = [];
    state.selected.forEach(function (rec) {
      // 作者优先级：卡片 DOM 作者 → document.title 作者 → null（详情页注入脚本兜底）
      tasks.push({ id: rec.id, url: rec.url || null, author: rec.author || null });
    });
    submitDownload(tasks);
  }

  function submitDownload(tasks) {
    showProgress(true, 0, tasks.length);
    var withUrl = tasks.filter(function (t) { return t.url; }).length;
    setStatus("已提交 " + tasks.length + " 项（" + withUrl + " 项直存，" + (tasks.length - withUrl) + " 项开详情页取原址）…");
    C.sendBg("DOWNLOAD_IDS", { tasks: tasks }).then(function (resp) {
      if (!resp || !resp.ok) setStatus("下载失败：" + (resp && resp.error));
      else setStatus("下载任务已派发，请看浏览器下载与进度。");
    }).catch(function (e) { setStatus("下载出错：" + e.message); });
  }

  // ---------- 右键另存：post 页读 DOM 原址直存，列表页开详情页取真原址 ----------
  function handleContextSave(payload) {
    var id = resolveContextId(payload);
    if (!id) { setStatus("未识别到媒体，请在图片/视频上右键"); return; }
    // 列表页缩略图升级后并非原画质（尤其视频），只 post 页直存
    var url = (state.pageType === "post") ? resolveContextUrl(payload) : null;
    // 作者优先级：卡片 DOM → document.title
    var author = null;
    var target = state.lastContextTarget;
    if (target) {
      var card = findCard(target);
      if (card) author = authorFromCard(card);
    }
    if (!author) author = C.extractAuthorFromTitle(document.title);
    showProgress(true, 0, 1);
    setStatus(url ? ("直存：" + id) : ("正在打开详情页取址：" + id));
    C.sendBg("DOWNLOAD_IDS", { tasks: [{ id: id, url: url, author: author }] }).then(function (resp) {
      if (resp && resp.ok) setStatus("已提交下载：" + id);
      else setStatus("下载失败：" + (resp && resp.error));
    }).catch(function (e) { setStatus("下载出错：" + e.message); });
  }

  function resolveContextUrl(payload) {
    payload = payload || {};
    // 右键图片的 srcUrl 若是 civitai 图床，升级到原画质后直用
    if (payload.srcUrl && /image\.civitai\.com/.test(payload.srcUrl)) return C.upgradeToOriginal(payload.srcUrl);
    // 否则从鼠标目标元素读
    var target = state.lastContextTarget;
    if (target) {
      var card = findCard(target);
      if (card) return pickOriginalUrl(card);
    }
    return null;
  }

  function resolveContextId(payload) {
    payload = payload || {};
    if (payload.linkUrl) { var i = C.extractMediaId(payload.linkUrl); if (i) return i; }
    if (payload.srcUrl) { var j = C.extractMediaId(payload.srcUrl); if (j) return j; }
    var target = state.lastContextTarget;
    if (target) {
      var n = target, d = 0;
      while (n && d < 8) {
        var a = n.querySelector ? n.querySelector('a[href*="/images/"]') : null;
        if (a) { var k = C.extractMediaId(a.getAttribute("href") || ""); if (k) return k; }
        n = n.parentElement; d++;
      }
    }
    return null;
  }

  // ---------- 进度 ----------
  function showProgress(visible, done, total) {
    var box = document.getElementById("cvdl-progress");
    if (!box) return;
    box.style.display = visible ? "" : "none";
    state.progress.active = !!visible;
    if (visible) { state.progress.total = total || 0; state.progress.done = done || 0; state.progress.failed = 0; state.progress.skipped = 0; renderProgress(); }
    updatePanel();
  }
  function renderProgress() {
    var fill = document.getElementById("cvdl-barfill");
    var txt = document.getElementById("cvdl-progtext");
    var p = state.progress;
    if (fill) fill.style.width = (p.total > 0 ? Math.round((p.done + p.failed) * 100 / p.total) : 0) + "%";
    var bits = [p.done + "/" + p.total];
    if (p.failed) bits.push("失败 " + p.failed);
    if (p.skipped) bits.push("跳过 " + p.skipped);
    if (txt) txt.textContent = bits.join(" ");
  }

  // ---------- 消息 ----------
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (msg.type === "PROGRESS") {
      var p = msg.payload || {}, stage = p.stage;
      if (stage === "start") {
        showProgress(true, 0, p.total || 0);
        state.progress.skipped = p.skipped || 0;
      }
      else if (stage === "skipped") { state.progress.skipped = (state.progress.skipped || 0) + (p.count || 0); renderProgress(); }
      else if (stage === "complete") { state.progress.done = p.done || (state.progress.done + 1); renderProgress(); }
      else if (stage === "error") { state.progress.failed = p.failed || (state.progress.failed + 1); renderProgress(); }
      else if (stage === "finish") {
        state.progress.done = p.done || state.progress.done;
        state.progress.failed = p.failed || state.progress.failed;
        state.progress.skipped = p.skipped || state.progress.skipped || 0;
        renderProgress();
        var parts = ["完成 " + state.progress.done + "/" + state.progress.total];
        if (state.progress.failed) parts.push("失败 " + state.progress.failed);
        if (state.progress.skipped) parts.push("跳过(已下载) " + state.progress.skipped);
        setStatus(parts.join("，"));
        setTimeout(function () { showProgress(false); }, 4000);
      }
      sendResponse({ ok: true }); return;
    }
    if (msg.type === "QUERY_SELECTION") {
      sendResponse({ ok: true, count: state.selected.size, page: state.pageType, selectMode: state.selectMode, progress: state.progress }); return;
    }
    if (msg.type === "ACTION_TOGGLE_SELECT") {
      toggleSelectMode();
      sendResponse({ ok: true, selectMode: state.selectMode }); return;
    }
    if (msg.type === "ACTION_SELECT_ALL") { selectByType("all"); sendResponse({ ok: true, count: state.selected.size }); return; }
    if (msg.type === "ACTION_SELECT_VIDEOS") { selectByType("video", "only"); sendResponse({ ok: true, count: state.selected.size }); return; }
    if (msg.type === "ACTION_SELECT_IMAGES") { selectByType("image", "only"); sendResponse({ ok: true, count: state.selected.size }); return; }
    if (msg.type === "ACTION_INVERT") { invertVisible(); sendResponse({ ok: true, count: state.selected.size }); return; }
    if (msg.type === "ACTION_CLEAR") { clearSelection(); sendResponse({ ok: true, count: 0 }); return; }
    if (msg.type === "ACTION_DOWNLOAD") { sendResponse({ ok: true }); downloadSelected(); return; }
    if (msg.type === "CONTEXT_SAVE") { sendResponse({ ok: true }); handleContextSave(msg.payload || {}); return; }
  });

  // ---------- SPA 路由 ----------
  function reinit() {
    if (location.href === state.url) return;
    state.url = location.href;
    state.selected.clear();
    state.lastClickedId = null;
    state.lastClickedIdx = null;
    state.pageType = C.detectPageType(location.href);
    buildPanel();
    var t = document.getElementById("cvdl-type");
    if (t) t.textContent = pageTypeLabel(state.pageType);
    document.documentElement.classList.toggle("cvdl-off", state.pageType === "other" || !state.selectMode);
    var btn = document.getElementById("cvdl-toggle-mode");
    if (btn) { btn.textContent = state.selectMode ? "关闭选择模式" : "开启选择模式"; btn.className = state.selectMode ? "toggle-on" : "toggle-off"; }
    updatePanel();
    showProgress(false);
    setTimeout(scanAndInject, 600);
  }

  var push = history.pushState;
  history.pushState = function () { var r = push.apply(this, arguments); setTimeout(reinit, 50); return r; };
  var replace = history.replaceState;
  history.replaceState = function () { var r = replace.apply(this, arguments); setTimeout(reinit, 50); return r; };
  window.addEventListener("popstate", function () { setTimeout(reinit, 50); });
  window.addEventListener("click", function () { setTimeout(reinit, 200); }, true);
  window.addEventListener("contextmenu", function (e) { state.lastContextTarget = e.target; }, true);

  var scanTimer = null;
  var mo = new MutationObserver(function () {
    if (scanTimer) return;
    scanTimer = setTimeout(function () { scanTimer = null; if (state.pageType !== "other") scanAndInject(); }, 400);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  function boot() {
    state.pageType = C.detectPageType(location.href);
    buildPanel();
    // 选择模式默认关闭（cvdl-off 隐藏 checkbox）；不支持的页面也强制隐藏
    document.documentElement.classList.toggle("cvdl-off", !state.selectMode || state.pageType === "other");
    var t = document.getElementById("cvdl-type");
    if (t) t.textContent = pageTypeLabel(state.pageType);
    var btn = document.getElementById("cvdl-toggle-mode");
    if (btn) { btn.textContent = state.selectMode ? "关闭选择模式" : "开启选择模式"; btn.className = state.selectMode ? "toggle-on" : "toggle-off"; }
    updatePanel();
    C.sendBg("PAGE_INFO", { page: state.pageType, url: location.href }).catch(function () {});
    setTimeout(scanAndInject, 800);
    setTimeout(scanAndInject, 2000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
