
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Лист "Товары"
  let productsSheet = ss.getSheetByName("Товары");
  if (!productsSheet) {
    productsSheet = ss.insertSheet("Товары");
    
    // Заголовки
    const headers = [
      "Артикул (Внутренний)", "Название", "Бренд", 
      "WB Артикул", "WB Кабинет", "WB Сайт", "WB Скидка %", "WB Ссылка",
      "Ozon Артикул", "Ozon Кабинет", "Ozon Сайт", "Ozon Скидка %", "Ozon Ссылка",
      "Yandex Артикул", "Yandex Кабинет", "Yandex Сайт", "Yandex Скидка %", "Yandex Ссылка",
      "MegaMarket Сайт", "MegaMarket Скидка %", "MegaMarket Ссылка",
      "Samokat Сайт", "Samokat Скидка %", "Samokat Ссылка",
      "Letual Сайт", "Letual Скидка %", "Letual Ссылка",
      "GoldApple Сайт", "GoldApple Скидка %", "GoldApple Ссылка",
      "Sportmaster Сайт", "Sportmaster Скидка %", "Sportmaster Ссылка",
      "FlowWow Сайт", "FlowWow Скидка %", "FlowWow Ссылка"
    ];
    
    productsSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    productsSheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#e0e0e0");
    productsSheet.setFrozenRows(1);
    
    // Группировки столбцов (Try/Catch на случай, если уже сгруппировано)
    try { productsSheet.getRange(1, 4, 1, 5).shiftColumnGroupDepth(1); } catch(e){} // WB
    try { productsSheet.getRange(1, 9, 1, 5).shiftColumnGroupDepth(1); } catch(e){} // Ozon
    try { productsSheet.getRange(1, 14, 1, 5).shiftColumnGroupDepth(1); } catch(e){} // Yandex
    try { productsSheet.getRange(1, 19, 1, 3).shiftColumnGroupDepth(1); } catch(e){} // MegaMarket
    try { productsSheet.getRange(1, 22, 1, 3).shiftColumnGroupDepth(1); } catch(e){} // Samokat
    try { productsSheet.getRange(1, 25, 1, 3).shiftColumnGroupDepth(1); } catch(e){} // Letual
    try { productsSheet.getRange(1, 28, 1, 3).shiftColumnGroupDepth(1); } catch(e){} // GoldApple
    try { productsSheet.getRange(1, 31, 1, 3).shiftColumnGroupDepth(1); } catch(e){} // Sportmaster
    try { productsSheet.getRange(1, 34, 1, 3).shiftColumnGroupDepth(1); } catch(e){} // FlowWow
  }
  
  // Лист "Лог изменений"
  let logSheet = ss.getSheetByName("Лог изменений");
  if (!logSheet) {
    logSheet = ss.insertSheet("Лог изменений");
    logSheet.getRange("A1:G1").setValues([["Дата и Время", "Артикул", "Название", "Маркетплейс", "Старая цена", "Новая цена", "Скидка %"]]).setFontWeight("bold");
    logSheet.setFrozenRows(1);
  }
  
  // Лист "Лог ошибок"
  let errorSheet = ss.getSheetByName("Лог ошибок");
  if (!errorSheet) {
    errorSheet = ss.insertSheet("Лог ошибок");
    errorSheet.getRange("A1:C1").setValues([["Дата и Время", "Маркетплейс/Источник", "Описание ошибки"]]).setFontWeight("bold");
    errorSheet.setFrozenRows(1);
  }
  // Лист "Настройки"
  let settingsSheet = ss.getSheetByName("Настройки");
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet("Настройки");
    settingsSheet.getRange("A1:B1").setValues([["Параметр", "Значение"]]).setFontWeight("bold");
    settingsSheet.getRange("A2:B4").setValues([
      ["Частота мониторинга (в часах)", "24"],
      ["Порог расхождения цен (%)", "5"],
      ["Шаблон сообщения (ОК)", "✅ Товар: {name}\nЦены проверены, всё в норме."]
    ]);
    
    // Валидация для частоты
    const ruleFreq = SpreadsheetApp.newDataValidation().requireValueInList(["2", "4", "6", "12", "24"], true).build();
    settingsSheet.getRange("B2").setDataValidation(ruleFreq);
    
    settingsSheet.setColumnWidth(1, 250);
    settingsSheet.setColumnWidth(2, 350);
  }
  
  // Дашборд
  let dashSheet = ss.getSheetByName("Дашборд");
  if (!dashSheet) {
    dashSheet = ss.insertSheet("Дашборд");
    dashSheet.getRange("A1").setValue("Выбор месяца:");
    
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"], true).build();
    dashSheet.getRange("B1").setDataValidation(rule).setValue("Август");
  }
  
  SpreadsheetApp.getUi().alert("Структура таблиц успешно обновлена (добавлены Настройки)!");
}
