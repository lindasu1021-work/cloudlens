/**
 * 告警信：寄到 Script Property ALERT_EMAIL；以 mail_log 防止同一 run 重寄。
 */

function sendAlert_(runId, type, subject, body) {
  var key = runId + ':' + type;
  if (readColumn_('mail_log', 'mail_key').indexOf(key) >= 0) return false;
  var to = getProp_('ALERT_EMAIL', '');
  if (!to) {
    Logger.log('未設定 ALERT_EMAIL，告警只寫 log：' + subject);
    return false;
  }
  MailApp.sendEmail(to, subject, body + '\n\n— CloudLens 自動通知');
  appendObjects_('mail_log', [{ mail_key: key, sent_at: nowIso_() }]);
  return true;
}
