// PriceWriter.js — принимает витринные цены от локального сборщика (Мак)
// и записывает их в лист "Товары" по названию товара.
// Не трогает Compare.gs и остальную логику мониторинга.

// Секрет для аутентификации локального сборщика (Мак) хранится в Script
// Properties (Project Settings -> Script properties -> PW_SECRET), НЕ в коде —
// это единственная "дверь" в веб-приложение (оно задеплоено с доступом
// "ANYONE", см. appsscript.json), так что секрет в открытом виде в публичном
// репозитории был бы риском. Временный запасной вариант ниже нужен только на
// первом запуске, пока вы не зададите PW_SECRET сами (см. README, раздел
// "Меры предосторожности").
var PW_SECRET_STORED_ = PropertiesService.getScriptProperties().getProperty('PW_SECRET');
var PW_SECRET = PW_SECRET_STORED_ || 'CHANGE_ME';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (body.action === 'set_pw_secret') {
      // Разовое (bootstrap) действие: если PW_SECRET ещё ни разу не задавался
      // в Script Properties, разрешаем задать его без проверки текущего
      // секрета (иначе первый вызов невозможен — курица и яйцо). После того
      // как значение сохранено, повторный set_pw_secret требует совпадения
      // со СТАРЫМ сохранённым секретом, как и все остальные действия.
      if (PW_SECRET_STORED_ && body.secret !== PW_SECRET_STORED_) {
        return ContentService.createTextOutput(JSON.stringify({ok: false, error: 'bad secret'}))
          .setMimeType(ContentService.MimeType.JSON);
      }
      PropertiesService.getScriptProperties().setProperty('PW_SECRET', body.new_secret);
      return ContentService.createTextOutput(JSON.stringify({ok: true, result: 'secret updated'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.secret !== PW_SECRET) {
      return ContentService.createTextOutput(JSON.stringify({ok: false, error: 'bad secret'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'export_products') {
      // Отдаёт лист "Товары" целиком (шапка + строки как объекты по названию
      // колонки) — используется локальным сборщиком (Мак) для регенерации
      // tovary.csv перед каждым запуском, чтобы список товаров/ссылок всегда
      // был синхронизирован с таблицей и не зависел от файла, лежащего
      // в /tmp (который macOS может очистить между перезагрузками).
      var shExp = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Товары');
      var valsExp = shExp.getDataRange().getValues();
      var headerExp = valsExp[0];
      var rowsExp = [];
      for (var re_ = 1; re_ < valsExp.length; re_++) {
        var rowObj = {};
        headerExp.forEach(function (h, i) { rowObj[h] = valsExp[re_][i]; });
        if (String(rowObj['Название'] || '').trim()) rowsExp.push(rowObj);
      }
      return ContentService.createTextOutput(JSON.stringify({ok: true, rows: rowsExp}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'rebuild_dashboard') {
      buildDashboard();
      return ContentService.createTextOutput(JSON.stringify({ok: true, result: 'dashboard rebuilt'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'get_settings') {
      var sset = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Настройки');
      var vset = sset ? sset.getDataRange().getValues() : [];
      return ContentService.createTextOutput(JSON.stringify({ok: true, settings: vset}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'set_run_hour') {
      var sset2 = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Настройки');
      var vset2 = sset2.getDataRange().getValues();
      var found = false;
      for (var i2 = 0; i2 < vset2.length; i2++) {
        if (String(vset2[i2][0] || '').toLowerCase().indexOf('час ежедневного сбора') === 0) {
          sset2.getRange(i2 + 1, 2).setValue(body.hour);
          found = true;
          break;
        }
      }
      installSchedule();
      return ContentService.createTextOutput(JSON.stringify({ok: true, found: found}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'run_analysis') {
      var ares = runSpreadSafe();
      return ContentService.createTextOutput(JSON.stringify({ok: true, result: ares}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'rebuild_instruction') {
      buildInstructionSheet();
      return ContentService.createTextOutput(JSON.stringify({ok: true, result: 'instruction rebuilt'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'install_stale_guard') {
      return ContentService.createTextOutput(JSON.stringify({ok: true, result: installStaleGuard()}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'run_stale_guard') {
      return ContentService.createTextOutput(JSON.stringify({ok: true, result: staleGuard()}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'log_run') {
      logRun_(body.row || {});
      return ContentService.createTextOutput(JSON.stringify({ok: true, result: 'logged'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'notify') {
      // Сводку о прогоне составляет локальный сборщик — только он знает,
      // сколько времени занял сбор и что не собралось. Отправляет облако,
      // чтобы токен бота жил в одном месте (Script Properties) и не появлялся
      // копией на Маке. tgSend_ лежит в Compare.js: он, в отличие от простой
      // отправки, переживает смену ID группы на супергрупповой.
      tgSend_(String(body.text || ''));
      return ContentService.createTextOutput(JSON.stringify({ok: true, result: 'sent'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'set_product_and_refresh') {
      var dashSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Дашборд');
      dashSh.getRange('B4').setValue(body.name || '');
      var histSh3 = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('История');
      var mpHeaders3 = dashSh.getRange(1, 28, 1, dashSh.getMaxColumns() - 27).getValues()[0];
      var mpTitles3 = [];
      for (var i3 = 0; i3 < mpHeaders3.length; i3++) {
        if (!mpHeaders3[i3]) break;
        mpTitles3.push(mpHeaders3[i3]);
      }
      fillDashboardGrid_(dashSh, histSh3, mpTitles3, 27, 42);
      var gridOut = dashSh.getRange(1, 27, 10, mpTitles3.length + 1).getValues();
      return ContentService.createTextOutput(JSON.stringify({ok: true, grid: gridOut}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'dump_history') {
      var histSh2 = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('История');
      var histVals2 = histSh2.getDataRange().getValues();
      var wantName2 = body.name || '';
      var out2 = [];
      for (var hr2 = 1; hr2 < histVals2.length; hr2++) {
        var rowv = histVals2[hr2];
        if (String(rowv[1] || '').trim() === wantName2) out2.push(rowv);
      }
      return ContentService.createTextOutput(JSON.stringify({ok: true, rows: out2}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'dump_goods_row') {
      var shG = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Товары');
      var valsG = shG.getDataRange().getValues();
      var headerG = valsG[0];
      var nameColG = headerG.indexOf('Название');
      var wantName = body.name || '';
      var rowOut = null;
      for (var rg = 1; rg < valsG.length; rg++) {
        if (String(valsG[rg][nameColG] || '').trim() === wantName) {
          rowOut = {};
          headerG.forEach(function (h, i) { rowOut[h] = valsG[rg][i]; });
          break;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ok: true, header: headerG, row: rowOut}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'cleanup_unused_mps_and_reset') {
      var setSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Настройки');
      var setVals = setSh.getDataRange().getValues();
      var offNames = ['площадка: megamarket', 'площадка: самокат', 'площадка: flowwow'];
      var offCount = 0;
      for (var si = 0; si < setVals.length; si++) {
        var label = String(setVals[si][0] || '').toLowerCase();
        if (offNames.indexOf(label) >= 0) {
          setSh.getRange(si + 1, 2).setValue(false);
          offCount++;
        }
      }
      var props4 = PropertiesService.getScriptProperties();
      props4.deleteProperty('RUN_ATTEMPTS');
      props4.deleteProperty('RUN_ALERTED');
      props4.deleteProperty('RUN_OK_DATE');
      installSchedule();
      return ContentService.createTextOutput(JSON.stringify({ok: true, disabledCount: offCount}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'diag_schedule') {
      var props3 = PropertiesService.getScriptProperties();
      var trg = ScriptApp.getProjectTriggers().map(function (t) {
        var info = { handler: t.getHandlerFunction(), type: String(t.getEventType()) };
        try { info.everyHours = true; } catch (e) {}
        return info;
      });
      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        scriptTimeZone: Session.getScriptTimeZone(),
        spreadsheetTimeZone: SpreadsheetApp.getActive().getSpreadsheetTimeZone(),
        serverNow_UTC: new Date().toISOString(),
        serverNow_inScriptTZ: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
        triggers: trg,
        RUN_ATTEMPTS: props3.getProperty('RUN_ATTEMPTS'),
        RUN_OK_DATE: props3.getProperty('RUN_OK_DATE'),
        RUN_ALERTED: props3.getProperty('RUN_ALERTED'),
        hasZenrowsKey: !!props3.getProperty('ZENROWS_API_KEY'),
        hasScrapingBeeKey: !!props3.getProperty('SCRAPINGBEE_API_KEY')
      })).setMimeType(ContentService.MimeType.JSON);
    }
    if (body.action === 'introspect') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheets = ss.getSheets().map(function (s) { return {name: s.getName(), gid: s.getSheetId()}; });
      var dash = ss.getSheetByName('Дашборд');
      var dump = null;
      if (dash) dump = dash.getRange(1, 1, 15, 10).getValues();
      var formulas = dash ? dash.getRange(7, 1, 1, 5).getFormulas()[0] : null;
      var gridDump = dash ? dash.getRange(1, 27, 10, 5).getValues() : null;
      var a11f = dash ? dash.getRange('A11').getFormula() : null;
      var gridf = dash ? dash.getRange(2, 27).getFormula() : null;
      var hist_ = ss.getSheetByName('История');
      var histInfo = hist_ ? {lastRow: hist_.getLastRow(), lastCol: hist_.getLastColumn(),
        sample: hist_.getRange(1, 1, Math.min(hist_.getLastRow(), 5), Math.min(hist_.getLastColumn(), 5)).getValues()} : null;
      return ContentService.createTextOutput(JSON.stringify({ok: true, sheets: sheets, dash: dump, formulas: formulas, grid: gridDump, a11f: a11f, gridf: gridf, hist: histInfo}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var result = writeSitePrices_(body.updates || []);
    return ContentService.createTextOutput(JSON.stringify({ok: true, result: result}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok: false, error: String(err)}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// Сколько дней молчания считать поводом для сообщения. Разные пороги потому,
// что причины разные: молчащий Мак — это выключенный ноутбук или упавший
// запуск (замечать надо быстро), а площадка без свежей цены — чаще временный
// сбой парсера, и дёргать из-за одного пропущенного дня незачем.
var STALE_LOCAL_DAYS_ = 2;
var STALE_MP_DAYS_ = 3;


function staleGuard() {
  // Сторож застоявшихся данных. Существующий dailyGuard в Compare.js следит
  // только за облачным сбором и повторяет его при неудаче — но площадки,
  // которые собирает Мак (Ozon, Летуаль, GoldApple, Яндекс, сайт бренда),
  // для него не считаются сбоем, иначе он слал бы ложные тревоги каждую ночь.
  // Из-за этого выключенный на неделю Мак или слетевшая сессия в кабинете
  // проходили совершенно незаметно. Этот сторож смотрит с другой стороны:
  // не «удался ли запуск», а «когда по этим данным последний раз была свежая
  // цена» — и потому ловит тихие поломки независимо от того, кто собирает.
  var props = PropertiesService.getScriptProperties();
  var today = new Date();
  var problems = [], keys = [];

  var last = props.getProperty('LAST_LOCAL_RUN');
  if (last) {
    var dl = daysSince_(new Date(last + 'T12:00:00'), today);
    if (dl >= STALE_LOCAL_DAYS_) {
      problems.push('Локальный сборщик молчит ' + dl + ' дн., последний прогон ' + last);
      keys.push('local');
    }
  }

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('История');
  if (sh && sh.getLastRow() > 1) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    var lastByMp = {};
    for (var i = 0; i < vals.length; i++) {
      var d = vals[i][0], mp = String(vals[i][2] || '').trim(), price = vals[i][3];
      if (!mp || !(d instanceof Date)) continue;
      if (typeof price !== 'number' || !(price > 0)) continue;
      if (!lastByMp[mp] || d > lastByMp[mp]) lastByMp[mp] = d;
    }
    Object.keys(lastByMp).sort().forEach(function (mp) {
      var days = daysSince_(lastByMp[mp], today);
      if (days >= STALE_MP_DAYS_) {
        problems.push(mp + ' — ' + days + ' дн. без свежей цены');
        keys.push(mp);
      }
    });
  }

  if (!problems.length) {
    props.deleteProperty('STALE_ALERTED');
    return 'всё свежее';
  }

  // Подпись состояния — только из названий, без числа дней. Иначе счётчик
  // растёт каждые сутки, подпись меняется, и одна и та же нерешённая проблема
  // присылала бы новое сообщение каждый день. Молчим, пока состав не изменится.
  var sign = keys.sort().join('|');
  if (props.getProperty('STALE_ALERTED') === sign) return 'уже сообщали';
  props.setProperty('STALE_ALERTED', sign);
  tgSend_('MG-MONITOR · сторож\nДанные перестали обновляться:\n' + problems.join('\n'));
  return 'отправлено: ' + problems.join('; ');
}


function daysSince_(d, now) {
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
}


function installStaleGuard() {
  // Отдельный триггер, не через installSchedule() из Compare.js: тот при каждом
  // вызове сносит триггеры по своему списку имён, и staleGuard в него не входит,
  // так что этот триггер переживает перенастройку расписания.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'staleGuard') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('staleGuard').timeBased().atHour(16).nearMinute(0).everyDays(1).create();
  return 'сторож застоявшихся данных: проверка ежедневно в 16:00';
}


// На сколько цена должна отличиться от прошлого сбора, чтобы про неё сообщили.
// Треть выбрана намеренно: обычные акции маркетплейсов дают 10–20% и сообщать
// о них незачем, а подмена числа парсером обычно в разы. 15.09 цена ROSE на
// Ozon уехала с 3393 ₽ на 827 ₽ — такое этот порог ловит с запасом.
var JUMP_THRESHOLD_ = 0.33;


function logRun_(row) {
  // Лист «Диагностика»: по строке на каждый запуск сбора. Нужен, чтобы историю
  // запусков было видно прямо в таблице, без терминала и логов на Маке —
  // и чтобы закономерности («WB отваливается по понедельникам») бросались
  // в глаза сами, а не находились перебором задним числом.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Диагностика');
  if (!sh) {
    sh = ss.insertSheet('Диагностика');
    sh.appendRow(['Дата', 'Время', 'Мин', 'Собрано', 'Возможно было', 'Не собрано', 'Итог']);
    sh.getRange(1, 1, 1, 7)
      .setFontWeight('bold').setBackground('#f1f3f4').setVerticalAlignment('middle');
    sh.setFrozenRows(1);
    [90, 70, 50, 80, 110, 360, 90].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  }

  var ok = String(row.status || '') !== 'сбой';
  // Отметка для сторожа: свежая дата ставится только после удавшегося прогона,
  // поэтому неделя падений выглядит для него так же, как выключенный Мак.
  if (ok) {
    PropertiesService.getScriptProperties().setProperty('LAST_LOCAL_RUN',
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
  }
  sh.appendRow([
    String(row.date || ''), String(row.time || ''), Number(row.minutes || 0),
    Number(row.got || 0), Number(row.expected || 0),
    String(row.missing || ''), ok ? 'ОК' : 'сбой'
  ]);

  var r = sh.getLastRow();
  // Приглушённая заливка итога: зелёная — всё собралось, жёлтая — собралось
  // не всё, красная — прогон вообще не дошёл до конца. Без ярких цветов,
  // чтобы лист читался как таблица, а не как светофор.
  var full = ok && Number(row.got || 0) >= Number(row.expected || 0);
  sh.getRange(r, 7).setBackground(!ok ? '#f4cccc' : (full ? '#d9ead3' : '#fff2cc'));
  sh.getRange(r, 6).setFontColor('#666666');

  // Держим последние 200 запусков — это больше полугода ежедневных прогонов.
  var keep = 200;
  if (sh.getLastRow() > keep + 1) sh.deleteRows(2, sh.getLastRow() - keep - 1);
}


function writeSitePrices_(updates) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Товары');
  if (!sh) throw new Error('Лист "Товары" не найден');

  var values = sh.getDataRange().getValues();
  var header = values[0];
  var col = {};
  header.forEach(function (h, i) { col[String(h).trim()] = i; });

  var fieldMap = {
    wb_site: 'WB Сайт',
    brand_site: 'Бренд-сайт Цена',
    ga_site: 'GoldApple Сайт',
    letu_site: 'Letual Сайт',
    yandex_site: 'Yandex Сайт',
    yandex_cab: 'Yandex Кабинет',
    ozon_site: 'Ozon Сайт',
    ozon_cab: 'Ozon Кабинет'
  };


  var updatedCol = col['Обновлено'];
  var nameCol = col['Название'];
  var now = new Date();
  var log = [];
  var missing = [];
  var jumps = [];

  for (var r = 1; r < values.length; r++) {
    var name = String(values[r][nameCol] || '').trim();
    var upd = updates.filter(function (u) { return u.name === name; })[0];
    if (!upd) continue;

    var changed = false;
    var missingHere = [];
    Object.keys(fieldMap).forEach(function (key) {
      var colName = fieldMap[key];
      var ci = col[colName];
      if (ci === undefined) return;
      var v = upd[key];

      // Раньше здесь стоял простой `return` — если цену собрать не удалось,
      // ячейку не трогали, и в таблице продолжала висеть цена прошлых дней.
      // Внешне она выглядела свежей (колонка "Обновлено" обновлялась), поэтому
      // поломка парсера могла жить неделями незамеченной — именно так и вышло
      // с Ozon Сайт и обоими кабинетами. Теперь несобранная цена очищается:
      // пустая ячейка честно означает "сегодня собрать не удалось".
      if (v === null || v === undefined || v === '') {
        if (String(sh.getRange(r + 1, ci + 1).getValue()) !== '') {
          sh.getRange(r + 1, ci + 1).clearContent();
        }
        missingHere.push(colName);
        return;
      }
      // Сверяем с тем, что стояло в ячейке до записи, — это цена прошлого сбора.
      // Цену всё равно записываем: резкий скачок бывает и настоящим (акция,
      // распродажа). Но молча он больше не проходит.
      var prev = sh.getRange(r + 1, ci + 1).getValue();
      if (typeof prev === 'number' && prev > 0 &&
          Math.abs(v - prev) / prev > JUMP_THRESHOLD_) {
        jumps.push(name + ': ' + colName + ' ' + Math.round(prev) + ' → ' + Math.round(v));
      }
      sh.getRange(r + 1, ci + 1).setValue(v);
      changed = true;
    });

    if (changed && updatedCol !== undefined) {
      sh.getRange(r + 1, updatedCol + 1).setValue(now);
    }
    if (changed) log.push(name);
    if (missingHere.length) missing.push(name + ': ' + missingHere.join(', '));
  }

  return {updated: log, missing: missing, jumps: jumps};
}
