/* civitai-core.js
 * 纯函数模块，无 chrome API 依赖。
 * 被 content.js、background.js、popup.js、options.js 三/四处复用：
 *   - content script：manifest.js 数组里本文件排在 content.js 之前，共享 window 全局。
 *   - service worker：background.js 用 importScripts('civitai-core.js') 加载。
 *   - popup/options：用 <script src="civitai-core.js"> 加载。
 * 因此这里导出到全局对象 CivitaiCore，避免重复定义。
 */
(function (global) {
  "use strict";

  if (global.CivitaiCore) return; // 防止重复加载

  var CORE = {};

  // ---------- 常量 ----------
  CORE.CIVITAI_ORIGIN = "https://civitai.red";
  CORE.IMAGE_HOST = "https://image.civitai.com";
  CORE.API_IMAGES = "https://civitai.red/api/v1/images";

  // ---------- 页面类型识别 ----------
  // list  = /images、/images?...、/user/<name>/videos、/user/<name>/images
  // post  = /posts/<id>
  // image = /images/<id>  （单条媒体详情，当作 list 的单条处理：API 取址）
  // other = 其余
  CORE.detectPageType = function (url) {
    if (!url) return "other";
    var u;
    try { u = new URL(url); } catch (e) { return "other"; }
    var p = u.pathname;
    if (/^\/posts\/\d+/.test(p)) return "post";
    if (/^\/images\/\d+/.test(p)) return "image";
    if (/^\/images\/?$/i.test(p)) return "list";
    if (/^\/user\/[^/]+\/videos(\/.*)?$/i.test(p)) return "list";
    if (/^\/user\/[^/]+\/images(\/.*)?$/i.test(p)) return "list";
    if (/^\/searches?\/?$/i.test(p) || /^\/api\//i.test(p)) return "other";
    return "other";
  };

  // ---------- ID 提取 ----------
  CORE.extractMediaId = function (value) {
    var raw = String(value || "").trim();
    if (!raw) return null;
    var direct = raw.match(/^(\d{4,})$/); // 纯数字，至少 4 位避免误伤
    if (direct) return direct[1];
    var urlM = raw.match(/\/images\/(\d+)(?:[/?#]|$)/i);
    return urlM ? urlM[1] : null;
  };

  CORE.extractPostId = function (value) {
    var raw = String(value || "").trim();
    if (!raw) return null;
    var m = raw.match(/\/posts\/(\d+)(?:[/?#]|$)/i);
    return m ? m[1] : null;
  };

  CORE.extractUserSegment = function (value) {
    var raw = String(value || "").trim();
    if (!raw) return null;
    var m = raw.match(/\/user\/([^/?#]+)/i);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    return null;
  };

  // ---------- 从标题提取作者 ----------
  // civitai 详情页 title: "Image posted by <作者>"；post 页: "Image post by <作者>"
  CORE.extractAuthorFromTitle = function (title) {
    try {
      var t = String(title || "").match(/(?:post|creat)(?:ed)?\s+by\s+(.+?)(?:\s+[-|]\s+.+|[.\s]*$)/i);
      if (t && t[1]) return t[1].trim();
    } catch (e) {}
    return null;
  };

  // ---------- 文件系统安全名 ----------
  // 注意：空输入返回 ""，调用方决定如何兜底（比如 buildRelativePath 会折叠掉空段）。
  CORE.sanitizeSegment = function (name) {
    var s = String(name || "").trim();
    // 去掉 Windows/Linux 非法字符 + 控制字符
    s = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "");
    s = s.replace(/\s+/g, " ").trim();
    // 折叠末尾点号（Windows 不喜末尾点/空）
    s = s.replace(/\.+$/g, "");
    return s;
  };

  // ---------- 扩展名推断 ----------
  CORE.inferExtension = function (url, contentType) {
    var ext = null;
    if (url) {
      // 只看路径部分（去掉 query/hash），并排除主机名（image.civitai.com 里的 .com 别误判）
      var pathOnly = String(url).split("?")[0].split("#")[0];
      // 砍掉协议与主机，只留 path
      var slash = pathOnly.indexOf("://");
      if (slash >= 0) pathOnly = pathOnly.slice(slash + 3);
      var hostEnd = pathOnly.indexOf("/");
      if (hostEnd >= 0) pathOnly = pathOnly.slice(hostEnd);
      // 末尾的 .ext（或 .ext 后跟 /）
      var m = pathOnly.match(/\.([a-zA-Z0-9]{2,4})(?:$|\/)/);
      if (m) ext = m[1].toLowerCase();
    }
    // 仅认常见媒体扩展，避免 .com / .net 等被当作扩展名
    var MEDIA = { mp4: 1, webm: 1, mov: 1, m4v: 1, png: 1, webp: 1, gif: 1, jpg: 1, jpeg: 1, avif: 1 };
    if (ext && !MEDIA[ext.toLowerCase()]) ext = null;
    if (!ext && contentType) {
      var ct = String(contentType).toLowerCase();
      if (ct.indexOf("mp4") >= 0) ext = "mp4";
      else if (ct.indexOf("webm") >= 0) ext = "webm";
      else if (ct.indexOf("mov") >= 0) ext = "mov";
      else if (ct.indexOf("png") >= 0) ext = "png";
      else if (ct.indexOf("webp") >= 0) ext = "webp";
      else if (ct.indexOf("gif") >= 0) ext = "gif";
      else if (ct.indexOf("jpeg") >= 0 || ct.indexOf("jpg") >= 0) ext = "jpg";
    }
    if (!ext) ext = "jpg";
    // 规范化
    if (ext === "jpeg") ext = "jpg";
    return ext;
  };

  CORE.isVideoUrl = function (url) {
    return /\.(mp4|webm|mov)(?:$|[/?#])/i.test(String(url || ""));
  };

  // ---------- 缩略图地址升级为原画质 ----------
  // image.civitai.com 的图/视频地址形如：
  //   .../<UUID>/<变换段>/<文件名.ext>
  //   变换段例如 width=800,original=false / width=1024 / transcode=true,...
  // 原画质即把<变换段>整体替换为 original=true,quality=90（与点击放大后详情页地址一致）。
  // 这样无需打开新标签页即可拿到原画质，post/list/右键 都能直存。
  CORE.upgradeToOriginal = function (url) {
    var u = String(url || "");
    if (!u) return u;
    if (/original=true/i.test(u)) return u;            // 已是原图，原样返回
    if (!/image\.civitai\.com/i.test(u)) return u;     // 非本站图床，不动
    // 匹配：/<含等号的变换段>/<文件名.ext>（含等号避免误伤 UUID/文件名）
    var m = u.match(/(\/)([^/]+=[^/]*)(\/[^/]+\.[a-zA-Z0-9]{2,4}(?:[?#]|$))/i);
    if (m) return u.slice(0, m.index) + "/" + "original=true,quality=90" + m[3];
    return u;
  };

  // ---------- 路径构建 ----------
  // 返回相对于「系统下载目录」的子路径：
  //   <topFolder>/<author>/<id>.<ext>
  // author 或 topFolder 为空时折叠掉对应层级。
  CORE.buildRelativePath = function (opts) {
    opts = opts || {};
    var parts = [];
    var top = CORE.sanitizeSegment(opts.topFolder || "");
    var author = CORE.sanitizeSegment(opts.author || "");
    var id = String(opts.id || "").trim();
    var ext = CORE.inferExtension(opts.url, opts.contentType);

    if (top) parts.push(top);
    // 作者为空时给一个 unknown 兜底目录，避免文件全堆在根
    parts.push(author || "unknown");
    if (!id) id = "unknown_" + Date.now();
    parts.push(id + "." + ext);
    return parts.join("/");
  };

  // ---------- 简单消息封装 ----------
  CORE.msg = function (type, payload) {
    return { type: type, payload: payload || {}, t: Date.now() };
  };

  // 一次性发送 + 等待回复（Promise）
  CORE.sendBg = function (type, payload) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(CORE.msg(type, payload), function (resp) {
          var err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message || String(err)));
          else resolve(resp);
        });
      } catch (e) { reject(e); }
    });
  };

  global.CivitaiCore = CORE;
})(typeof window !== "undefined" ? window : self);
