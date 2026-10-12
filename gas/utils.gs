/**
 * 共用工具：設定讀取、含重試的 HTTP 請求、JSON 回應。
 */

function getProp_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === '' ? fallback : v;
}

/**
 * 網路錯誤重試 2 次（間隔 2 秒、8 秒），見 spec 第 9 節。
 * 回傳 { code, ms, text, error, attempts }，不丟例外。
 */
function fetchWithRetry_(url, options) {
  var opts = Object.assign({ muteHttpExceptions: true, followRedirects: true }, options || {});
  var waits = [2000, 8000];
  var last = { code: 0, ms: 0, text: '', error: '', attempts: 0 };
  for (var i = 0; i <= waits.length; i++) {
    var t0 = Date.now();
    try {
      var res = UrlFetchApp.fetch(url, opts);
      last = { code: res.getResponseCode(), ms: Date.now() - t0, text: res.getContentText('UTF-8'), error: '', attempts: i + 1 };
      // 4xx 不重試；5xx 重試
      if (last.code < 500) return last;
    } catch (e) {
      last = { code: 0, ms: Date.now() - t0, text: '', error: String(e), attempts: i + 1 };
    }
    if (i < waits.length) Utilities.sleep(waits[i]);
  }
  return last;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
