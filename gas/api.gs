/**
 * GAS Web App 進入點。回應格式一律 { ok, data?, error?, run_id }（spec 第 6 節）。
 * Phase 0 只實作 ping（GET / POST 跨網域測試）與 phase0（讀回連線測試結果）。
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'ping';
  try {
    if (action === 'ping') {
      return jsonOut_({ ok: true, data: { method: 'GET', echo: e.parameter, server_time: new Date().toISOString() }, run_id: 'phase0' });
    }
    if (action === 'phase0') {
      return jsonOut_({ ok: true, data: readPhase0_(), run_id: 'phase0' });
    }
    return jsonOut_({ ok: false, error: 'unknown action: ' + action, run_id: 'phase0' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err), run_id: 'phase0' });
  }
}

/** 前端以 Content-Type: text/plain 送 JSON 字串，避免 CORS 預檢。 */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return jsonOut_({ ok: true, data: { method: 'POST', content_type: e.postData.type, echo: body,
                                         server_time: new Date().toISOString() }, run_id: 'phase0' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err), run_id: 'phase0' });
  }
}
