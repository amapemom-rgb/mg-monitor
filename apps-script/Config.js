function setConfig() {
  const ui = SpreadsheetApp.getUi();
  const properties = PropertiesService.getScriptProperties();
  
  const scrapingBeeRes = ui.prompt("Настройка ключей", "Введите API-ключ ScrapingBee (оставьте пустым для пропуска):", ui.ButtonSet.OK_CANCEL);
  if (scrapingBeeRes.getSelectedButton() == ui.Button.OK && scrapingBeeRes.getResponseText()) {
    properties.setProperty('SCRAPINGBEE_API_KEY', scrapingBeeRes.getResponseText());
  }

  const tgBotRes = ui.prompt("Настройка ключей", "Введите Token Telegram бота (оставьте пустым для пропуска):", ui.ButtonSet.OK_CANCEL);
  if (tgBotRes.getSelectedButton() == ui.Button.OK && tgBotRes.getResponseText()) {
    properties.setProperty('TG_BOT_TOKEN', tgBotRes.getResponseText());
  }
  
  const tgChatRes = ui.prompt("Настройка ключей", "Введите Chat ID Telegram (оставьте пустым для пропуска):", ui.ButtonSet.OK_CANCEL);
  if (tgChatRes.getSelectedButton() == ui.Button.OK && tgChatRes.getResponseText()) {
    properties.setProperty('TG_CHAT_ID', tgChatRes.getResponseText());
  }
  const wbRes = ui.prompt("Настройка ключей", "Введите API-ключ Wildberries (оставьте пустым для пропуска):", ui.ButtonSet.OK_CANCEL);
  if (wbRes.getSelectedButton() == ui.Button.OK && wbRes.getResponseText()) {
    properties.setProperty('WB_API_KEY', wbRes.getResponseText());
  }

  const ozonIdRes = ui.prompt("Настройка ключей", "Введите Client ID Ozon (оставьте пустым для пропуска):", ui.ButtonSet.OK_CANCEL);
  if (ozonIdRes.getSelectedButton() == ui.Button.OK && ozonIdRes.getResponseText()) {
    properties.setProperty('OZON_CLIENT_ID', ozonIdRes.getResponseText());
  }

  const ozonKeyRes = ui.prompt("Настройка ключей", "Введите API-ключ Ozon (оставьте пустым для пропуска):", ui.ButtonSet.OK_CANCEL);
  if (ozonKeyRes.getSelectedButton() == ui.Button.OK && ozonKeyRes.getResponseText()) {
    properties.setProperty('OZON_API_KEY', ozonKeyRes.getResponseText());
  }

  const ymRes = ui.prompt("Настройка ключей", "Введите OAuth токен Yandex Market (оставьте пустым для пропуска):", ui.ButtonSet.OK_CANCEL);
  if (ymRes.getSelectedButton() == ui.Button.OK && ymRes.getResponseText()) {
    properties.setProperty('YANDEX_TOKEN', ymRes.getResponseText());
  }
  
  ui.alert("Все ключи и настройки сохранены!");
}

// Добавляем пункт в меню
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('MG-MONITOR')
      .addItem('Шаг 1: Создать/Обновить структуру листов', 'setupSheets')
      .addItem('Шаг 2: Ввести API Ключи', 'setConfig')
      .addItem('Шаг 3: Настроить автообновление (Триггер)', 'createDynamicTrigger')
      .addSeparator()
      .addItem('Запустить мониторинг сейчас', 'runMonitor')
      .addToUi();

  addSpreadMenu_(ui);
}
