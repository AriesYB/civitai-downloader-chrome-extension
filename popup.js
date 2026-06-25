/* popup.js */
var C = window.CivitaiCore;

function $(id) { return document.getElementById(id); }

function setType(type) {
  var el = $("type");
  var supported = (type === "list" || type === "post" || type === "image");
  el.className = "type " + (supported ? "supported" : "unsupported");
  if (type === "post") el.textContent = "当前：Post 页";
  else if (type === "list") el.textContent = "当前：列表页";
  else if (type === "image") el.textContent = "当前：媒体详情";
  else el.textContent = "当前页不支持";
}

function refresh() {
  C.sendBg("QUERY_PAGE_TYPE").then(function (r) {
    if (r && r.ok) setType(r.type);
  }).catch(function () { setType("other"); });

  C.sendBg("QUERY_SELECTION").then(function (r) {
    if (r && r.ok) {
      $("sel-count").textContent = String(r.count || 0);
      $("download").disabled = (r.count || 0) === 0 || (r.progress && r.progress.active);
      setType(r.page);
      // 根据选择模式更新开关按钮文案
      $("toggle").textContent = (r.selectMode) ? "关闭选择模式" : "开启选择模式";
    }
  }).catch(function () { $("sel-count").textContent = "0"; });
}

function act(type) {
  C.sendBg(type).then(function () {
    setTimeout(refresh, 150);
  }).catch(function () { setTimeout(refresh, 150); });
}

$("toggle").addEventListener("click", function () { act("ACTION_TOGGLE_SELECT"); });
$("all").addEventListener("click", function () { act("ACTION_SELECT_ALL"); });
$("videos").addEventListener("click", function () { act("ACTION_SELECT_VIDEOS"); });
$("images").addEventListener("click", function () { act("ACTION_SELECT_IMAGES"); });
$("invert").addEventListener("click", function () { act("ACTION_INVERT"); });
$("clear").addEventListener("click", function () { act("ACTION_CLEAR"); });
$("download").addEventListener("click", function () { act("ACTION_DOWNLOAD"); });
$("options").addEventListener("click", function () { chrome.runtime.openOptionsPage(); });

document.addEventListener("DOMContentLoaded", refresh);
