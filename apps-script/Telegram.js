function sendTelegramMessage(text) {
  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty('TG_BOT_TOKEN');
  const chatId = properties.getProperty('TG_CHAT_ID');
  
  if (!token || !chatId) {
    Logger.log("Telegram не настроен. Пропускаем отправку.");
    return;
  }
  
  const url = "https://api.telegram.org/bot" + token + "/sendMessage";
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML"
  };
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  UrlFetchApp.fetch(url, options);
}
