function runMonitor() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const productsSheet = ss.getSheetByName("Товары");
  const logSheet = ss.getSheetByName("Лог изменений");
  const errorSheet = ss.getSheetByName("Лог ошибок");
  const settingsSheet = ss.getSheetByName("Настройки");
  
  if (!productsSheet || !logSheet || !errorSheet || !settingsSheet) {
    SpreadsheetApp.getUi().alert("Не найдена структура листов. Пожалуйста, запустите 'Шаг 1: Создать структуру листов'.");
    return;
  }
  
  const data = productsSheet.getDataRange().getValues();
  if (data.length <= 1) {
    SpreadsheetApp.getUi().alert("В листе 'Товары' нет данных для мониторинга.");
    return;
  }

  // 1. Динамическая карта столбцов (индексы)
  const headers = data[0];
  const colMap = {};
  for (let i = 0; i < headers.length; i++) {
    if (headers[i]) {
      colMap[headers[i].trim()] = i;
    }
  }

  // 2. Чтение настроек
  const settingsData = settingsSheet.getDataRange().getValues();
  const settings = {};
  for (let i = 1; i < settingsData.length; i++) {
    settings[settingsData[i][0]] = settingsData[i][1];
  }
  
  // В этом цикле будет осуществляться опрос API и парсинг по каждой строке
  let changesFound = false;
  
  for (let i = 1; i < data.length; i++) {
    let sku = colMap["Артикул (Внутренний)"] !== undefined ? data[i][colMap["Артикул (Внутренний)"]] : "";
    let name = colMap["Название"] !== undefined ? data[i][colMap["Название"]] : "";
    
    // Пример динамического доступа к колонке:
    // let wbUrl = colMap["WB Ссылка"] !== undefined ? data[i][colMap["WB Ссылка"]] : "";
    
    // TODO: Здесь будет логика сбора цен, расчет расхождений по порогу settings["Порог расхождения цен (%)"]
  }
  
  // Запись времени последнего обновления
  productsSheet.getRange(1, 1).setNote("Последнее обновление: " + new Date().toLocaleString());
  
  // Отправка шаблона
  let template = settings["Шаблон сообщения (ОК)"] || "✅ Сканирование завершено.";
  template = template.replace("{name}", "Все товары");
  
  sendTelegramMessage(template + "\nПроверено товаров: " + (data.length - 1));
}

// Триггер для автоматического запуска
function createDynamicTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settingsSheet = ss.getSheetByName("Настройки");
  let hours = 24; // по умолчанию
  
  if (settingsSheet) {
    const val = settingsSheet.getRange("B2").getValue();
    if (val && !isNaN(val)) {
      hours = parseInt(val);
    }
  }
  
  // Удаляем старые триггеры
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() == 'runMonitor') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // Создаем новый
  ScriptApp.newTrigger('runMonitor')
      .timeBased()
      .everyHours(hours)
      .create();
      
  SpreadsheetApp.getUi().alert("Таймер автообновления настроен на каждые " + hours + " ч.!");
}
