/* options.js */
function $(id) { return document.getElementById(id); }
var DEFAULTS = { downloadFolder: "civitai" };

function load() {
  chrome.storage.local.get(DEFAULTS, function (s) {
    $("folder").value = s.downloadFolder || "";
    updatePreview();
  });
  loadHistory();
}
function updatePreview() {
  var folder = $("folder").value.trim() || "civitai";
  $("preview").textContent = "预览路径：下载目录/" + folder + "/<作者>/<id>.<ext>";
}
function save() {
  chrome.storage.local.set({ downloadFolder: $("folder").value.trim() }, function () {
    var el = $("saved"); el.style.display = "inline";
    setTimeout(function () { el.style.display = "none"; }, 1500);
    updatePreview();
  });
}

// 已下载记录（去重）：显示数量 + 清除
function loadHistory() {
  chrome.runtime.sendMessage({ type: "QUERY_HISTORY", payload: {} }, function (resp) {
    if (chrome.runtime.lastError || !resp) return;
    $("hist-count").textContent = "已记录 " + (resp.count || 0) + " 项";
  });
}
function clearHistory() {
  if (!confirm("确定清除全部已下载记录吗？清除后已下载过的内容可被再次下载。")) return;
  chrome.runtime.sendMessage({ type: "CLEAR_HISTORY", payload: {} }, function () {
    loadHistory();
  });
}

$("save").addEventListener("click", save);
$("folder").addEventListener("input", updatePreview);
$("clear-hist").addEventListener("click", clearHistory);
document.addEventListener("DOMContentLoaded", load);
