/**
 * МОНИТОРИНГ ЦЕН ДЛЯ ПОКУПАТЕЛЯ И СКИДОК
 * Сравниваются только витринные цены (то, что платит покупатель).
 * Цена в кабинете собирается, но в сравнении не участвует — она нужна
 * только как база для расчёта скидки: (кабинет − витрина) ÷ кабинет × 100.
 *
 * Секреты только в Script Properties:
 *   TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, OZON_CLIENT_ID, OZON_API_KEY,
 *   WB_API_KEY, YANDEX_TOKEN, SCRAPINGBEE_API_KEY
 */

var SHEET_GOODS = 'Товары';
var SHEET_SET   = 'Настройки';
var SHEET_ERR   = 'Лог ошибок';
var SHEET_LOG   = 'Лог разбега';
var SHEET_STATE = '_Состояние';
var SHEET_HIST  = 'История';
var SHEET_DASH  = 'Дашборд';

/**
 * Площадки. site — колонка витринной цены, cab — цена в кабинете (только для скидки),
 * scrape: true — витрина берётся парсингом страницы (тратит кредиты ScrapingBee).
 */
var MPS = [
  { code:'WB',   title:'WB',          id:'WB Артикул',     cab:'WB Кабинет',     site:'WB Сайт',         disc:'WB Скидка %',        link:'WB Ссылка',        scrape:false },
  { code:'OZ',   title:'Ozon',        id:'Ozon Артикул',   cab:'Ozon Кабинет',   site:'Ozon Сайт',       disc:'Ozon Скидка %',      link:'Ozon Ссылка',      scrape:false },
  { code:'YM',   title:'Yandex',      id:'Yandex Артикул', cab:'Yandex Кабинет', site:'Yandex Сайт',     disc:'Yandex Скидка %',    link:'Yandex Ссылка',    scrape:false },
  { code:'SITE', title:'Сайт бренда', id:'',               cab:'',               site:'Бренд-сайт Цена', disc:'', link:'Бренд-сайт Ссылка',scrape:false },
  { code:'LE',   title:'Летуаль',     id:'',               cab:'',               site:'Letual Сайт',     disc:'', link:'Letual Ссылка',    scrape:false },
  { code:'GA',   title:'GoldApple',   id:'',               cab:'',               site:'GoldApple Сайт',  disc:'', link:'GoldApple Ссылка', scrape:true  },
  { code:'MM',   title:'MegaMarket',  id:'',               cab:'',               site:'MegaMarket Сайт', disc:'', link:'MegaMarket Ссылка',scrape:true  },
  { code:'SAM',  title:'Самокат',     id:'',               cab:'',               site:'Samokat Сайт',    disc:'', link:'Samokat Ссылка',   scrape:true  },
  { code:'FW',   title:'FlowWow',     id:'',               cab:'',               site:'FlowWow Сайт',    disc:'', link:'FlowWow Ссылка',   scrape:true  }
];

/** Площадки, которые облако больше не пытается собирать само — их даёт
 *  локальный сборщик на Маке (обходит антибот через настоящий браузер, либо
 *  облачный источник оказался ненадёжным/багованным).
 *  Отсутствие свежих данных от облака по ним не считается сбоем. */
var LOCAL_ONLY_MPS_ = ['OZ', 'LE', 'GA', 'SITE', 'YM'];

/** Свой цвет на графиках дашборда для каждой площадки — чтобы не путать линии. */
/** Цвета подобраны по фирменным цветам площадок (источники — в чате):
 *  WB — зарегистрированный товарный знак Pantone 675C;
 *  Ozon — фирменный "digital blue";
 *  Yandex Маркет — фирменный жёлтый (красный — это цвет материнского Яндекса);
 *  GoldApple — запатентованный лаймовый Pantone 389C (немного затемнён для
 *    читаемости линии на белом фоне — оригинал #DCFF00 почти не виден);
 *  Летуаль — "синий электрик" из ребрендинга 2023 (точный hex не публиковался,
 *    взят тёмный вариант, чтобы не путать с более ярким синим Ozon). */
var MP_COLORS_ = {
  'WB':          '#AE2573', // малиново-фиолетовый (Pantone 675C)
  'Ozon':        '#005BFF', // фирменный синий Ozon
  'Yandex':      '#FFCC00', // фирменный жёлтый Яндекс Маркета
  'Сайт бренда': '#2E7D32', // зелёный (не площадка — цвет для отличия сохранён)
  'Летуаль':     '#16215E', // тёмно-синий "электрик"
  'GoldApple':   '#9ACD00', // лаймовый (Pantone 389C, затемнён для видимости)
  'MegaMarket':  '#CE93D8', // светло-сиреневый
  'Самокат':     '#9E9E9E', // серый
  'FlowWow':     '#EF5350'  // светло-красный
};

/** Показатели сравнения. Цены в кабинете НЕ сравниваются. */
var METRICS = [
  { key:'SITE', title:'цена для покупателя', setting:'сравнивать: цена на площадке', thr:'порог разбега: цена на площадке', pct:false },
  { key:'DISC', title:'скидка',              setting:'сравнивать: скидка',           thr:'порог разбега: скидка',           pct:true  }
];

var SPREAD_COLS = ['Мин. цена, ₽','Где мин.','Макс. цена, ₽','Где макс.','Разбег, %',
  'Медиана, ₽','Выбивается','Статус','Обновлено','Разбег скидка, п.п.','Не сравнивать'];

/** Колонки, оставшиеся от прежней версии, — удаляются при подготовке листа. */
var OBSOLETE_COLS = ['Разбег кабинет, %','WB: доп. скидка МП, %','Ozon: доп. скидка МП, %',
  'Yandex: доп. скидка МП, %','Letual Скидка %','GoldApple Скидка %','FlowWow Скидка %',
  'MegaMarket Скидка %','Samokat Скидка %','Бренд-сайт Скидка %'];

var DEF = { thrSite:10, thrDisc:5, minRub:100, stepPp:5, cooldownH:6,
            runHour:20, maxAttempts:5, crBudget:900 };   // 20:00 Екатеринбург = 18:00 Москва

/* ==================================================================== */
/*  МЕНЮ                                                                */
/* ==================================================================== */
function addSpreadMenu_(ui) {
  ui.createMenu('📊 Мониторинг цен')
    .addItem('1. Подготовить листы «Товары» и «Настройки»', 'setupSpread')
    .addItem('2. Перенести секреты из ячеек в Script Properties', 'migrateSecretsFromSheet')
    .addItem('3. Перестроить колонки «Товары» (группы по площадкам)', 'restructureGoods')
    .addSeparator()
    .addItem('▶️ Собрать цены сейчас', 'runSpreadSafe')
    .addItem('🔁 Повторить сбор (после исправления ошибки)', 'retryNow')
    .addItem('⏱ Включить расписание (раз в день + повторы)', 'installSchedule')
    .addSeparator()
    .addItem('📈 Собрать/обновить Дашборд', 'buildDashboard')
    .addItem('📘 Обновить лист «Инструкция»', 'buildInstructionSheet')
    .addItem('♻ Сбросить базу (следующий сбор промолчит)', 'resetSpreadState')
    .addSeparator()
    .addItem('🧪 Тест Telegram', 'testTelegram')
    .addItem('🧪 Проверить источники цен', 'testSources')
    .addItem('🧪 Проверить скрейперы и кредиты', 'checkScrapers')
    .addToUi();
}

/* ==================================================================== */
/*  РАСЧЁТ РАЗБЕГА                                                      */
/* ==================================================================== */
/**
 * Разбег значений одного товара по площадкам.
 * Разбег% = (макс − мин) ÷ мин × 100. Для скидки — в п.п.: макс − мин.
 * @param {Array<{mp:string, val:number}>} points
 * @param {boolean} isPercentMetric
 * @return {?object} null, если меньше двух площадок с данными
 */
function calcSpread(points, isPercentMetric) {
  var pts = (points || []).filter(function (p) {
    var n = num_(p.val);
    return !isNaN(n) && (isPercentMetric ? n >= 0 : n > 0);
  }).map(function (p) { return { mp: p.mp, val: num_(p.val) }; });
  if (pts.length < 2) return null;

  var sorted = pts.slice().sort(function (a, b) { return a.val - b.val; });
  var lo = sorted[0], hi = sorted[sorted.length - 1];
  var vals = sorted.map(function (p) { return p.val; });
  var mid = Math.floor(vals.length / 2);
  var median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  var spread = isPercentMetric ? r2_(hi.val - lo.val) : r2_((hi.val - lo.val) / lo.val * 100);

  var outlier = null;
  if (median > 0) {
    pts.forEach(function (p) {
      var dev = r2_((p.val - median) / median * 100);
      if (!outlier || Math.abs(dev) > Math.abs(outlier.dev)) outlier = { mp: p.mp, dev: dev };
    });
    if (outlier && Math.abs(outlier.dev) < 1) outlier = null;
  }
  return { spread: spread, min: lo.val, max: hi.val, minMp: lo.mp, maxMp: hi.mp,
           median: r2_(median), rub: r2_(hi.val - lo.val), outlier: outlier,
           n: pts.length, points: sorted };
}

function num_(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  var s = String(v).replace(/\u00A0/g, '').replace(/\s/g, '')
    .replace(/₽|руб\.?|%/gi, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}
function r2_(n) { return Math.round(n * 100) / 100; }
function fp_(n) { return String(Math.round(n * 10) / 10).replace('.', ','); }
function fm_(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

/* ==================================================================== */
/*  СОБЫТИЯ                                                             */
/* ==================================================================== */
function detectSpreadEvent(cur, prev, cfg) {
  var above = cur.spread > cfg.thr;
  if (above && !cfg.isPercentMetric && cfg.minRub > 0 && cur.rub < cfg.minRub) above = false;

  var hasPrev = prev && prev.spread !== '' && prev.spread !== null &&
                prev.spread !== undefined && !isNaN(num_(prev.spread));
  if (!hasPrev) return { type: 'BASE' };

  var prevSpread = num_(prev.spread);
  var prevAbove = prevSpread > cfg.thr;
  var ev = null;
  if (prev.minMp && cur.minMp && prev.minMp !== cur.minMp) ev = { type: 'SWITCH' };
  else if (above && !prevAbove) ev = { type: 'EXCEED' };
  else if (!above && prevAbove) ev = { type: 'NORMAL' };
  else if (above && prevAbove && Math.abs(cur.spread - prevSpread) >= cfg.stepPp)
    ev = { type: 'GROWTH', from: prevSpread };
  if (!ev) return null;

  if (ev.type !== 'NORMAL' && cfg.cooldownMs > 0 && prev.lastAlert) {
    var last = new Date(prev.lastAlert).getTime();
    if (cfg.now - last < cfg.cooldownMs) return null;
  }
  return ev;
}

/* ==================================================================== */
/*  СБОРКА СООБЩЕНИЙ                                                    */
/* ==================================================================== */
function buildSpreadMessage(type, name, metric, cur, cfg, extra) {
  var isP = cfg.isPercentMetric;
  var spread = isP ? fp_(cur.spread) + ' п.п.' : fp_(cur.spread) + '%';
  var gap    = isP ? fp_(cur.rub) + ' п.п.'    : fm_(cur.rub) + ' ₽';
  var thr    = isP ? fp_(cfg.thr) + ' п.п.'    : fp_(cfg.thr) + '%';
  var fv = function (v) { return isP ? fp_(v) + '%' : fm_(v) + ' ₽'; };

  var head;
  if (type === 'EXCEED')
    head = '🔴 ' + name + ': разбег ' + metric.title + ' ' + spread + ' — выше порога ' + thr + '.';
  else if (type === 'SWITCH')
    head = '🔄 ' + name + ': самая низкая ' + metric.title + ' теперь на ' + cur.minMp +
           ' (было ' + (extra && extra.prevMinMp || '—') + '). Разбег ' + spread + '.';
  else if (type === 'GROWTH') {
    var from = num_(extra && extra.from);
    head = '📈 ' + name + ': разбег ' + metric.title + ' ' +
           (cur.spread >= from ? 'вырос' : 'снизился') + ' с ' +
           (isP ? fp_(from) + ' п.п.' : fp_(from) + '%') + ' до ' + spread + '.';
  } else if (type === 'NORMAL')
    head = '🟢 ' + name + ': разбег ' + metric.title + ' снова в норме — ' + spread + ' ≤ ' + thr + '.';
  else head = name + ': разбег ' + metric.title + ' ' + spread + '.';

  var lines = cur.points.map(function (p) {
    var mark = p.mp === cur.minMp ? ' ← дешевле всех' : (p.mp === cur.maxMp ? ' ← дороже всех' : '');
    return fv(p.val) + ' • ' + p.mp + mark;
  });
  return head + '\n' + lines.join('\n');
}

/* ==================================================================== */
/*  ГЛАВНЫЙ СБОР                                                        */
/* ==================================================================== */
function runSpreadSafe() {
  try { return runSpread(); }
  catch (e) {
    logErr_('Сбор', String(e && e.stack || e));
    mailFail_('Мониторинг цен: сбор упал', String(e && e.stack || e));
    throw e;
  }
}

/**
 * @return {{ok:boolean, failed:Array<string>}} ok — все включённые площадки отдали данные
 */
function runSpread() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET_GOODS);
  if (!sh) throw new Error('нет листа «Товары»');

  var data = sh.getDataRange().getValues();
  var col = headerMap_(data[0]);
  var cfg = readSettings_();
  var now = new Date();
  var state = readState_();

  // 1. Сбор по включённым площадкам, каждая изолирована.
  // Ozon/Летуаль/GoldApple облако не собирает вообще (см. LOCAL_ONLY_MPS_) —
  // их даёт локальный сборщик на Маке, и отсутствие данных от облака здесь
  // не считается сбоем, чтобы не слать ложные ночные уведомления.
  var fetched = {}, failed = [];
  cfg.mpOn.forEach(function (code) {
    var isLocalOnly = LOCAL_ONLY_MPS_.indexOf(code) >= 0;
    try {
      var got = fetchMp_(code, data, col, cfg);
      fetched[code] = got || {};
      var n = 0; for (var k in fetched[code]) n++;
      if (!n && !isLocalOnly) failed.push(mpByCode_(code).title);
    } catch (e) {
      logErr_('Источник ' + code, String(e && e.message || e));
      fetched[code] = {};
      if (!isLocalOnly) failed.push(mpByCode_(code).title);
    }
  });
  var stale = failed.length > 0;

  var msgs = [], logRows = [], histRows = [];

  for (var r = 1; r < data.length; r++) {
    try {
      var row = data[r];
      var name = String(row[col['Название']] || '').trim();
      if (!name) continue;
      if (col['Не сравнивать'] !== undefined && isTrue_(row[col['Не сравнивать']])) continue;

      // 2. Запись цен с проверкой правдоподобности
      var refPrices = [];
      cfg.mpOn.forEach(function (code) {
        var m0 = mpByCode_(code);
        if (!m0.site || col[m0.site] === undefined) return;
        var v0 = num_(row[col[m0.site]]);
        if (v0 > 0) refPrices.push(v0);
      });
      cfg.mpOn.forEach(function (code) {
        var got = fetched[code] && fetched[code][r];
        if (!got) return;
        var mp = mpByCode_(code);
        if (got.site !== undefined && col[mp.site] !== undefined) {
          if (plausible_(got.site, refPrices)) row[col[mp.site]] = got.site;
          else logErr_(mp.title, 'цена ' + got.site + ' ₽ по «' + name +
            '» отброшена как недостоверная (другие площадки: ' + refPrices.join(', ') + ')');
        }
        if (got.cab !== undefined && mp.cab && col[mp.cab] !== undefined) row[col[mp.cab]] = got.cab;
      });

      // 3. Скидка = (кабинет − витрина) ÷ кабинет × 100. Без кабинета — пусто.
      MPS.forEach(function (mp) {
        if (!mp.disc || col[mp.disc] === undefined) return;
        if (!mp.cab || col[mp.cab] === undefined) { row[col[mp.disc]] = ''; return; }
        var cabV = num_(row[col[mp.cab]]), siteV = num_(row[col[mp.site]]);
        row[col[mp.disc]] = (cabV > 0 && siteV > 0 && cabV >= siteV)
          ? r2_((cabV - siteV) / cabV * 100) : '';
      });

      // 4. Разбег по включённым показателям
      var res = {};
      METRICS.forEach(function (m) {
        if (!cfg.metricOn[m.key]) { res[m.key] = null; return; }
        var pts = [];
        cfg.mpOn.forEach(function (code) {
          var mp = mpByCode_(code);
          var cName = (m.key === 'SITE') ? mp.site : mp.disc;
          if (!cName || col[cName] === undefined) return;
          pts.push({ mp: mp.title, val: row[col[cName]] });
        });
        res[m.key] = calcSpread(pts, m.pct);
      });

      var main = res['SITE'];
      if (main) {
        setCell_(row, col, 'Мин. цена, ₽', main.min);
        setCell_(row, col, 'Где мин.', main.minMp);
        setCell_(row, col, 'Макс. цена, ₽', main.max);
        setCell_(row, col, 'Где макс.', main.maxMp);
        setCell_(row, col, 'Разбег, %', main.spread);
        setCell_(row, col, 'Медиана, ₽', main.median);
        setCell_(row, col, 'Выбивается', main.outlier ? main.outlier.mp + ' (' +
          (main.outlier.dev > 0 ? '+' : '') + fp_(main.outlier.dev) + '%)' : '');
        setCell_(row, col, 'Статус', (main.spread > cfg.thr['SITE'] ? '🔴 ВЫШЕ ПОРОГА' : '🟢 В НОРМЕ') +
          (stale ? ' ⚠️ нет свежих данных: ' + failed.join(', ') : ''));
      } else {
        ['Мин. цена, ₽','Где мин.','Макс. цена, ₽','Где макс.','Разбег, %','Медиана, ₽','Выбивается']
          .forEach(function (c) { setCell_(row, col, c, ''); });
        setCell_(row, col, 'Статус', 'НЕТ ДАННЫХ (нужно ≥2 площадки)');
      }
      setCell_(row, col, 'Разбег скидка, п.п.', res['DISC'] ? res['DISC'].spread : '');
      setCell_(row, col, 'Обновлено', now);

      // 5. События
      if (!stale) {
        METRICS.forEach(function (m) {
          var cur = res[m.key];
          if (!cur) return;
          var key = name + '|' + m.key;
          var prev = state[key] || {};
          var mcfg = { thr: cfg.thr[m.key], minRub: m.pct ? 0 : cfg.minRub,
                       stepPp: cfg.stepPp, cooldownMs: cfg.cooldownH * 3600 * 1000,
                       now: now.getTime(), isPercentMetric: m.pct };
          var ev = detectSpreadEvent(cur, prev, mcfg);
          var ns = { spread: cur.spread, minMp: cur.minMp, lastAlert: prev.lastAlert || '' };
          if (ev && ev.type !== 'BASE') {
            var text = buildSpreadMessage(ev.type, name, m, cur, mcfg,
              { from: ev.from, prevMinMp: prev.minMp });
            msgs.push(text);
            ns.lastAlert = now;
            logRows.push([now, name, m.title, ev.type, cur.spread, cur.rub,
              cur.minMp, cur.min, cur.maxMp, cur.max, cur.median, cur.n, text]);
          }
          state[key] = ns;
        });
      }

      // 6. Снимок в историю: по каждой площадке отдельная строка
      cfg.mpOn.forEach(function (code) {
        var mp = mpByCode_(code);
        if (!mp.site || col[mp.site] === undefined) return;
        var pv = num_(row[col[mp.site]]);
        if (!(pv > 0)) return;
        var dv = mp.disc && col[mp.disc] !== undefined ? num_(row[col[mp.disc]]) : NaN;
        histRows.push([new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          name, mp.title, pv, isNaN(dv) ? '' : dv]);
      });
    } catch (e) {
      logErr_('Строка ' + (r + 1), String(e && e.message || e));
    }
  }

  sh.getRange(1, 1, data.length, data[0].length).setValues(data);
  if (!stale) writeState_(state);
  if (histRows.length) appendHistory_(histRows);
  if (logRows.length) appendSpreadLog_(logRows);
  sendBatch_(msgs);

  return { ok: !stale, failed: failed };
}

function setCell_(row, col, header, val) { if (col[header] !== undefined) row[col[header]] = val; }
function mpByCode_(code) { for (var i = 0; i < MPS.length; i++) if (MPS[i].code === code) return MPS[i]; return null; }
function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE' || String(v).toLowerCase() === 'да'; }
function headerMap_(hdr) { var m = {}; for (var i = 0; i < hdr.length; i++) { var h = String(hdr[i] || '').trim(); if (h) m[h] = i; } return m; }

/** Отсекает мусор от парсеров: при 2+ известных ценах новое значение не должно
 *  отличаться от их медианы больше чем в 4 раза. */
function plausible_(val, refs) {
  var v = num_(val);
  if (!(v > 0)) return false;
  var a = (refs || []).filter(function (x) { return x > 0; }).sort(function (x, y) { return x - y; });
  if (a.length < 2) return true;
  var mid = Math.floor(a.length / 2);
  var med = a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  return v >= med / 4 && v <= med * 4;
}

/* ==================================================================== */
/*  ИСТОЧНИКИ ЦЕН                                                       */
/* ==================================================================== */
function fetchMp_(code, data, col, cfg) {
  if (code === 'WB') return fetchWb_(data, col);
  // Ozon, Летуаль, GoldApple, сайт бренда и теперь Yandex (кабинет+витрина)
  // полностью на локальном сборщике на Маке: Ozon/Летуаль недоступны облаку
  // из-за антибота, GoldApple раньше портил историю случайными числами,
  // Ozon Кабинет через API v5/product/info/prices иногда путал товары между
  // собой, а Yandex Кабинет через offer-mappings API (basicPrice.value) даёт
  // одно и то же число для разных товаров — недостоверно (см. чат). Витрину
  // Yandex локальный сборщик и так уже парсит с реальной карточки. Теперь
  // кабинет тоже читается локально со страницы partner.market.yandex.ru —
  // облако больше вообще не трогает Yandex.
  if (LOCAL_ONLY_MPS_.indexOf(code) >= 0) return {};
  return fetchExternalSite_(data, col, mpByCode_(code), cfg);
}

function fetchRetry_(url, opts, tries) {
  var n = tries || 3, wait = 6000, res;
  for (var i = 0; i < n; i++) {
    res = UrlFetchApp.fetch(url, opts);
    var c = res.getResponseCode();
    if (c !== 429 && c < 500) return res;
    if (i < n - 1) { Utilities.sleep(wait); wait *= 2; }
  }
  return res;
}

/* ---------- WB ---------- */
function fetchWb_(data, col) {
  var out = {}, nmRows = {}, nms = [];
  var ci = col['WB Артикул'];
  if (ci === undefined) return out;
  for (var r = 1; r < data.length; r++) {
    var nm = String(data[r][ci] || '').trim();
    if (nm) { nmRows[nm] = r; nms.push(nm); }
  }
  if (!nms.length) return out;

  // витрина (WB Сайт) сюда НЕ пишем: card.wb.ru отдаёт обычную/чёрную цену
  // без учёта скидки WB Кошелька, а покупателю по умолчанию показывается
  // именно красная цена С Кошельком — её видит и сравнивает пользователь.
  // Раньше этот блок тихо перезаписывал верное значение, которое пишет
  // локальный сборщик (collector.py, парсит реальную карточку товара) —
  // тот же паттерн бага, что был найден и исправлен для Ozon Сайт (см. ниже).

  // кабинет: WB троттлит, поэтому один общий запрос, при отказе — по кругу
  try {
    var key = PropertiesService.getScriptProperties().getProperty('WB_API_KEY');
    if (!key) throw new Error('нет WB_API_KEY');
    var opts = { muteHttpExceptions: true, headers: { Authorization: key } };
    var take = function (g) {
      var rr = nmRows[String(g.nmID)];
      if (rr === undefined) return;
      var s = (g.sizes || [])[0] || {};
      out[rr] = out[rr] || {};
      if (s.discountedPrice) out[rr].cab = r2_(s.discountedPrice);
      else if (s.price) out[rr].cab = r2_(s.price);
    };
    var bulk = UrlFetchApp.fetch(
      'https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=0', opts);
    if (bulk.getResponseCode() === 200) {
      var goods = ((JSON.parse(bulk.getContentText()).data) || {}).listGoods || [];
      goods.forEach(take);
      Logger.log('WB кабинет: одним запросом, товаров ' + goods.length);
    } else {
      logErr_('WB кабинет (общий список)', 'HTTP ' + bulk.getResponseCode() + ' — обновляю по кругу');
      var props = PropertiesService.getScriptProperties();
      var pos = parseInt(props.getProperty('WB_CAB_POS') || '0', 10);
      if (isNaN(pos) || pos >= nms.length) pos = 0;
      var done = 0;
      for (var k = 0; k < nms.length && done < 2; k++) {
        var nmi = nms[(pos + k) % nms.length];
        var rc = UrlFetchApp.fetch(
          'https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=10&filterNmID=' + nmi, opts);
        if (rc.getResponseCode() !== 200) { Utilities.sleep(3000); continue; }
        (((JSON.parse(rc.getContentText()).data) || {}).listGoods || []).forEach(take);
        done++; Utilities.sleep(3000);
      }
      props.setProperty('WB_CAB_POS', String((pos + Math.max(done, 1)) % nms.length));
    }
  } catch (e) { logErr_('WB кабинет', String(e && e.message || e)); }
  return out;
}

/* ---------- OZON: кабинет из API, витрина парсингом карточки ---------- */
function fetchOzon_(data, col, cfg) {
  var out = {};
  var api = {};
  try { api = ozonPrices_(); } catch (e) { logErr_('Ozon API', String(e && e.message || e)); }

  var idc = col['Ozon Артикул'];
  for (var r = 1; r < data.length; r++) {
    var nm = String(data[r][col['Название']] || '').trim();
    if (!nm) continue;
    var sku = idc !== undefined ? String(data[r][idc] || '').trim() : '';
    var key = nm.toLowerCase().replace(/[\s_-]+/g, '');
    var it = (api.byKey && api.byKey[sku]) || (api.byName && api.byName[key]);
    if (!it) continue;
    var cab = num_(it.price);
    if (!isNaN(cab)) out[r] = { cab: r2_(cab) };
  }

  // витрина (Ozon Сайт) сюда НЕ пишем: облако не видит настоящую
  // "цену для покупателя" (та доступна только в авторизованном кабинете
  // seller.ozon.ru и требует WAF-обхода) — публичная карточка/API отдают
  // другую цифру (цену без персональной скидки) и раньше тихо перезаписывали
  // верное значение, которое пишет локальный сборщик (collector.py). Кабинет
  // (cab) — законная API-цена, её оставляем.
  return out;
}

function ozonPrices_() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('OZON_CLIENT_ID'), key = p.getProperty('OZON_API_KEY');
  if (!id || !key) throw new Error('нет OZON_CLIENT_ID / OZON_API_KEY');
  var headers = { 'Client-Id': id, 'Api-Key': key, 'Content-Type': 'application/json' };
  var byKey = {}, byName = {}, cursor = '', guard = 0;
  do {
    var res = fetchRetry_('https://api-seller.ozon.ru/v5/product/info/prices', {
      method: 'post', headers: headers, muteHttpExceptions: true,
      payload: JSON.stringify({ cursor: cursor, limit: 1000,
        filter: { offer_id: [], product_id: [], visibility: 'ALL' } })
    }, 3);
    if (res.getResponseCode() !== 200)
      throw new Error('Ozon HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
    var d = JSON.parse(res.getContentText());
    var items = d.items || (d.result && d.result.items) || [];
    items.forEach(function (it) {
      var pr = it.price || {};
      var rec = { price: pr.price, marketing_seller_price: pr.marketing_seller_price, old_price: pr.old_price };
      if (it.offer_id) {
        byKey[String(it.offer_id).trim()] = rec;
        byName[String(it.offer_id).toLowerCase().replace(/[\s_-]+/g, '')] = rec;
      }
      if (it.product_id) byKey[String(it.product_id).trim()] = rec;
    });
    cursor = d.cursor || (d.result && d.result.cursor) || '';
  } while (cursor && guard++ < 20);
  return { byKey: byKey, byName: byName };
}

/* ---------- YANDEX: только кабинет ---------- */
function fetchYandex_(data, col) {
  var token = PropertiesService.getScriptProperties().getProperty('YANDEX_TOKEN');
  if (!token) throw new Error('нет YANDEX_TOKEN');
  var h = { 'Api-Key': token, 'Content-Type': 'application/json' };
  var base = 'https://api.partner.market.yandex.ru';
  var props = PropertiesService.getScriptProperties();
  var bid = props.getProperty('YANDEX_BUSINESS_ID');
  if (!bid) {
    var rc = UrlFetchApp.fetch(base + '/campaigns', { muteHttpExceptions: true, headers: h });
    if (rc.getResponseCode() !== 200) throw new Error('campaigns HTTP ' + rc.getResponseCode());
    var camps = (JSON.parse(rc.getContentText()).campaigns) || [];
    if (!camps.length || !camps[0].business) throw new Error('не найден businessId');
    bid = String(camps[0].business.id);
    props.setProperty('YANDEX_BUSINESS_ID', bid);
  }
  var byOffer = {}, pageToken = '', guard = 0;
  do {
    var u = base + '/businesses/' + bid + '/offer-mappings?limit=200' + (pageToken ? '&page_token=' + pageToken : '');
    var r = UrlFetchApp.fetch(u, { method: 'post', muteHttpExceptions: true, headers: h, payload: JSON.stringify({}) });
    if (r.getResponseCode() !== 200) throw new Error('offer-mappings HTTP ' + r.getResponseCode());
    var d = JSON.parse(r.getContentText());
    ((d.result && d.result.offerMappings) || []).forEach(function (x) {
      var o = x.offer || {};
      if (o.offerId) byOffer[String(o.offerId).toLowerCase().replace(/[\s_-]+/g, '')] = o;
    });
    pageToken = (d.result && d.result.paging && d.result.paging.nextPageToken) || '';
  } while (pageToken && guard++ < 20);

  var out = {};
  for (var r2 = 1; r2 < data.length; r2++) {
    var nm = String(data[r2][col['Название']] || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    var o = byOffer[nm];
    if (!o || !o.basicPrice) continue;
    var v = num_(o.basicPrice.value);
    if (!isNaN(v)) out[r2] = { cab: r2_(v) };
  }
  return out;
}

/* ---------- ВИТРИНА ПАРСИНГОМ СТРАНИЦЫ ---------- */
/**
 * Читает цену покупателя со страницы товара по ссылке из листа.
 * Сначала бесплатный прямой запрос, затем ScrapingBee с эскалацией режимов:
 * дорогой режим включается только если дешёвый не дал цену.
 */
function fetchExternalSite_(data, col, mp, cfg) {
  var lc = col[mp.link];
  if (lc === undefined) return {};
  var out = {};

  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var u = String(data[r][lc] || '').trim();
    if (/^https?:\/\//.test(u)) rows.push({ r: r, url: u });
  }
  if (!rows.length) return out;

  var fails = 0, tried = 0, lastErr = '';
  for (var i = 0; i < rows.length; i++) {
    tried++;
    try {
      var res = extractSitePrice_(rows[i].url, mp, cfg);
      if (!res) throw new Error('цена на странице не найдена');
      out[rows[i].r] = { site: res.price };
    } catch (e) { fails++; lastErr = String(e && e.message || e); }
  }
  if (fails) logErr_(mp.title, 'цена не получена по ' + fails + ' из ' + tried +
    ' ссылок; последняя причина: ' + lastErr);
  return out;
}

/** Режимы ZenRows по возрастанию стоимости в кредитах. */
var ZR_MODES = [
  { q: '',                                                            credits: 1  },
  { q: '&js_render=true&wait=8000',                                   credits: 5  },
  { q: '&js_render=true&premium_proxy=true&proxy_country=ru&wait=15000', credits: 25 }
];
/** Резервный сервис — ScrapingBee, если он ещё оплачен. */
var SB_MODES = [
  { q: '&render_js=true',                                             credits: 5  },
  { q: '&render_js=true&premium_proxy=true&country_code=ru&block_resources=false&wait=9000', credits: 75 }
];

function extractSitePrice_(url, mp, cfg) {
  var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

  // 1. Бесплатный прямой запрос — им берётся наш сайт
  try {
    var r1 = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': ua, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
    if (r1.getResponseCode() === 200) {
      var got0 = parsePriceFromHtml_(r1.getContentText());
      if (got0) return got0;
    }
  } catch (e) {}

  if (!mp.scrape) throw new Error('прямой запрос не дал цену');

  var props = PropertiesService.getScriptProperties();
  var reasons = [];

  // 2. ZenRows с эскалацией: дорогой режим только если дешёвый не дал цену
  var zr = props.getProperty('ZENROWS_API_KEY');
  if (zr) {
    for (var i = 0; i < ZR_MODES.length; i++) {
      var zm = ZR_MODES[i];
      if (!creditsAllow_('ZR', zm.credits, cfg)) { reasons.push('ZenRows: дневной лимит кредитов'); break; }
      var zu = 'https://api.zenrows.com/v1/?apikey=' + zr + '&url=' + encodeURIComponent(url) + zm.q;
      var zres = UrlFetchApp.fetch(zu, { muteHttpExceptions: true });
      creditsSpend_('ZR', zm.credits);
      var zc = zres.getResponseCode();
      if (zc === 200) {
        var zgot = parsePriceFromHtml_(zres.getContentText());
        if (zgot) return zgot;
        reasons.push('ZenRows режим ' + (i + 1) + ': страница есть, цены нет');
      } else if (zc === 401 || zc === 403) {
        reasons.push('ZenRows ' + zc + ' — ключ или тариф'); break;
      } else {
        reasons.push('ZenRows ' + zc);
      }
    }
  } else reasons.push('нет ключа ZenRows');

  // 3. Резерв — ScrapingBee
  var sb = props.getProperty('SCRAPINGBEE_API_KEY');
  if (sb && isTrue_(String(props.getProperty('SB_FALLBACK') || 'false'))) {
    for (var j = 0; j < SB_MODES.length; j++) {
      var sm = SB_MODES[j];
      if (!creditsAllow_('SB', sm.credits, cfg)) break;
      var su = 'https://app.scrapingbee.com/api/v1/?api_key=' + sb + '&url=' + encodeURIComponent(url) + sm.q;
      var sres = UrlFetchApp.fetch(su, { muteHttpExceptions: true });
      creditsSpend_('SB', sm.credits);
      if (sres.getResponseCode() === 200) {
        var sgot = parsePriceFromHtml_(sres.getContentText());
        if (sgot) return sgot;
      } else if (sres.getResponseCode() === 401) { reasons.push('ScrapingBee 401 — кредиты кончились'); break; }
    }
  }
  throw new Error(reasons.join('; ') || 'цену получить не удалось');
}

/** Учёт кредитов по сервису и по дням. */
function creditsAllow_(svc, credits, cfg) {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (props.getProperty(svc + '_DAY') !== today) {
    props.setProperty(svc + '_DAY', today); props.setProperty(svc + '_SPENT', '0');
  }
  var spent = parseInt(props.getProperty(svc + '_SPENT') || '0', 10) || 0;
  var limit = (cfg && cfg.crBudget) || DEF.crBudget;
  return spent + credits <= limit;
}
function creditsSpend_(svc, credits) {
  var props = PropertiesService.getScriptProperties();
  var spent = parseInt(props.getProperty(svc + '_SPENT') || '0', 10) || 0;
  props.setProperty(svc + '_SPENT', String(spent + credits));
}
function creditsSpentToday_(svc) {
  return parseInt(PropertiesService.getScriptProperties().getProperty(svc + '_SPENT') || '0', 10) || 0;
}

/**
 * Ищет цену покупателя в HTML: явная разметка → WooCommerce → рублёвые значения.
 * HTML-сущности пробелов приводятся к пробелу, иначе «4&nbsp;473 ₽» читается как 473.
 */
function parsePriceFromHtml_(html) {
  var ok = function (n) { return !isNaN(n) && n >= 50 && n <= 1000000; };
  var t = String(html)
    .replace(/&nbsp;|&#160;|&#xA0;|&thinsp;|&#8201;|&#x2009;|&#8239;/gi, ' ')
    .replace(/\u00A0|\u202F|\u2009/g, ' ');

  var m;

  // 1. Микроразметка Schema.org: itemprop="price" content="4299" — так отдаёт GoldApple
  var micro = [];
  var reM = /itemprop\s*=\s*["']price["'][^>]*content\s*=\s*["']([0-9]+(?:[.,][0-9]{1,2})?)["']/gi;
  while ((m = reM.exec(t))) { var nm = num_(m[1]); if (ok(nm)) micro.push(nm); }
  var reM2 = /content\s*=\s*["']([0-9]+(?:[.,][0-9]{1,2})?)["'][^>]*itemprop\s*=\s*["']price["']/gi;
  while ((m = reM2.exec(t))) { var nm2 = num_(m[1]); if (ok(nm2)) micro.push(nm2); }
  if (micro.length) return { price: r2_(Math.min.apply(null, micro)), how: 'микроразметка' };

  // 2. Мета-теги Open Graph
  var og = [];
  var reOg = /(?:og:price:amount|product:price:amount)["'][^>]*content\s*=\s*["']([0-9]+(?:[.,][0-9]{1,2})?)["']/gi;
  while ((m = reOg.exec(t))) { var no = num_(m[1]); if (ok(no)) og.push(no); }
  if (og.length) return { price: r2_(Math.min.apply(null, og)), how: 'og-мета' };

  // 3. JSON-поля
  var named = [];
  var re1 = /"(price|salePrice|finalPrice|currentPrice|actualPrice|cardPrice)"\s*:\s*"?([0-9]+(?:[.,][0-9]{1,2})?)"?/gi;
  while ((m = re1.exec(t))) { var n1 = num_(m[2]); if (ok(n1)) named.push(n1); }
  if (named.length) return { price: r2_(Math.min.apply(null, named)), how: 'json-разметка' };

  var woo = (t.match(/woocommerce-Price-amount amount"><bdi>([^<]+)/g) || [])
    .map(function (x) { return num_(x.replace(/.*<bdi>/, '')); }).filter(ok);
  if (woo.length) return { price: r2_(Math.min.apply(null, woo)), how: 'woocommerce' };

  var re3 = /(^|[^0-9.,])([0-9]{1,3}(?: [0-9]{3})+|[0-9]{3,6})(?:[.,][0-9]{1,2})?\s*(?:₽|руб)/g;
  var vals = [];
  while ((m = re3.exec(t))) { var n3 = num_(m[2]); if (ok(n3)) vals.push(n3); }
  if (vals.length) {
    var cnt = {}, best = null;
    vals.forEach(function (v) { cnt[v] = (cnt[v] || 0) + 1; });
    for (var k in cnt) if (best === null || cnt[k] > cnt[best] || (cnt[k] === cnt[best] && +k > +best)) best = k;
    return { price: r2_(+best), how: 'текст в рублях' };
  }
  return null;
}

/** Проверка источников: что вернул каждый включённый источник. */
function testSources() {
  var ss = SpreadsheetApp.getActive();
  var data = ss.getSheetByName(SHEET_GOODS).getDataRange().getValues();
  var col = headerMap_(data[0]);
  var cfg = readSettings_();
  Logger.log('Включённые площадки: ' + cfg.mpOn.join(', '));
  cfg.mpOn.forEach(function (code) {
    try {
      var res = fetchMp_(code, data, col, cfg);
      var n = 0; for (var k in res) n++;
      Logger.log(code + ': строк с данными ' + n + ' | пример: ' + JSON.stringify(res[1] || null));
    } catch (e) { Logger.log(code + ': ОШИБКА — ' + (e && e.message || e)); }
  });
  Logger.log('Кредитов потрачено сегодня — ZenRows: ' + creditsSpentToday_('ZR') + ', ScrapingBee: ' + creditsSpentToday_('SB'));
}

/* ==================================================================== */
/*  РАСПИСАНИЕ: раз в день + повторы при неудаче                        */
/* ==================================================================== */
/**
 * Ставит два триггера: ежедневный сбор в заданный час и часовой «сторож»,
 * который повторяет сбор, если за сегодня он ещё не прошёл успешно.
 */
function installSchedule() {
  ['runSpreadSafe', 'runSpread', 'dailyRun', 'dailyGuard', 'compareWbOzonSafe'].forEach(function (f) {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === f) ScriptApp.deleteTrigger(t);
    });
  });
  var cfg = readSettings_();
  ScriptApp.newTrigger('dailyRun').timeBased().atHour(cfg.runHour).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('dailyGuard').timeBased().everyHours(1).create();
  Logger.log('Расписание: сбор в ' + cfg.runHour + ':00 (' + Session.getScriptTimeZone() +
    '), сторож повторов — каждый час');
}

function dailyRun() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('RUN_ATTEMPTS', '0');
  props.deleteProperty('RUN_ALERTED');
  attemptRun_();
}

/** Сторож: повторяет сбор, пока за сегодня не будет успеха. */
function dailyGuard() {
  var props = PropertiesService.getScriptProperties();
  var today = todayKey_();

  // ручная команда «Попробуй снова» — из таблицы или из Telegram
  if (retryRequested_()) {
    props.setProperty('RUN_ATTEMPTS', '0');
    props.deleteProperty('RUN_ALERTED');
    props.deleteProperty('RUN_OK_DATE');
    clearRetryRequest_();
    attemptRun_();
    return;
  }

  if (props.getProperty('RUN_OK_DATE') === today) return;              // уже собрали успешно
  var cfg = readSettings_();
  var hourNow = parseInt(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'), 10);
  if (hourNow < cfg.runHour) return;                                    // время сбора ещё не пришло
  var attempts = parseInt(props.getProperty('RUN_ATTEMPTS') || '0', 10) || 0;
  if (attempts >= cfg.maxAttempts) return;                              // ждём команды «Попробуй снова»
  attemptRun_();
}

function attemptRun_() {
  var props = PropertiesService.getScriptProperties();
  var cfg = readSettings_();
  var attempts = (parseInt(props.getProperty('RUN_ATTEMPTS') || '0', 10) || 0) + 1;
  props.setProperty('RUN_ATTEMPTS', String(attempts));

  var res;
  try { res = runSpread(); }
  catch (e) {
    logErr_('Сбор (попытка ' + attempts + ')', String(e && e.message || e));
    res = { ok: false, failed: ['сбой прогона: ' + (e && e.message || e)] };
  }

  if (res.ok) {
    props.setProperty('RUN_OK_DATE', todayKey_());
    props.setProperty('RUN_ATTEMPTS', '0');
    props.deleteProperty('RUN_ALERTED');
    try { buildDashboard(); } catch (e) { logErr_('Дашборд', String(e && e.message || e)); }
    return;
  }

  if (attempts >= cfg.maxAttempts && !props.getProperty('RUN_ALERTED')) {
    props.setProperty('RUN_ALERTED', '1');
    try {
      tgSend_('⚠️ Мониторинг цен: за ' + attempts + ' попыток не удалось собрать цены.\n' +
        'Не отдали данные: ' + res.failed.join(', ') + '.\n' +
        'Кредитов ZenRows потрачено сегодня: ' + creditsSpentToday_('ZR') + '.\n' +
        'Исправьте причину (ключ, баланс, доступ) и напишите в этот чат «Попробуй снова» — ' +
        'сбор запустится в течение часа. Либо поставьте галочку «Повторить сбор сейчас» в листе «Настройки».');
    } catch (e) { logErr_('Telegram', String(e && e.message || e)); }
  }
}

function todayKey_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Кнопка в меню: повторить прямо сейчас. */
function retryNow() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('RUN_ATTEMPTS', '0');
  props.deleteProperty('RUN_ALERTED');
  props.deleteProperty('RUN_OK_DATE');
  attemptRun_();
  Logger.log('Повторный сбор выполнен. Успех сегодня: ' +
    (PropertiesService.getScriptProperties().getProperty('RUN_OK_DATE') === todayKey_() ? 'да' : 'нет'));
}

/** Просьба повторить: галочка в «Настройках» или сообщение боту. */
function retryRequested_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_SET);
  if (sh) {
    var v = sh.getDataRange().getValues();
    for (var i = 0; i < v.length; i++)
      if (String(v[i][0] || '').toLowerCase().indexOf('повторить сбор сейчас') === 0 && isTrue_(v[i][1]))
        return true;
  }
  return telegramRetryCommand_();
}

function clearRetryRequest_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_SET);
  if (!sh) return;
  var v = sh.getDataRange().getValues();
  for (var i = 0; i < v.length; i++)
    if (String(v[i][0] || '').toLowerCase().indexOf('повторить сбор сейчас') === 0)
      sh.getRange(i + 1, 2).setValue(false);
}

/** Читает новые сообщения бота и ищет команду повтора. */
function telegramRetryCommand_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var t = props.getProperty('TELEGRAM_TOKEN') || props.getProperty('TG_BOT_TOKEN');
    if (!t) return false;
    var offset = props.getProperty('TG_OFFSET') || '';
    var url = 'https://api.telegram.org/bot' + t + '/getUpdates?timeout=0' + (offset ? '&offset=' + offset : '');
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return false;
    var d = JSON.parse(res.getContentText());
    var found = false, maxId = 0;
    ((d.result) || []).forEach(function (u) {
      if (u.update_id > maxId) maxId = u.update_id;
      var msg = u.message || u.edited_message || u.channel_post;
      var txt = msg && msg.text ? String(msg.text) : '';
      if (/попроб|снова|retry|повтор/i.test(txt)) found = true;
    });
    if (maxId) props.setProperty('TG_OFFSET', String(maxId + 1));
    return found;
  } catch (e) { return false; }
}

/* ==================================================================== */
/*  TELEGRAM / ЛОГИ / ИСТОРИЯ / ПОЧТА                                   */
/* ==================================================================== */
function tgSend_(text) {
  var p = PropertiesService.getScriptProperties();
  var t = p.getProperty('TELEGRAM_TOKEN') || p.getProperty('TG_BOT_TOKEN');
  var c = p.getProperty('TELEGRAM_CHAT_ID') || p.getProperty('TG_CHAT_ID');
  if (!t || !c) throw new Error('нет TELEGRAM_TOKEN / TELEGRAM_CHAT_ID в Script Properties');

  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + t + '/sendMessage', {
    method: 'post', muteHttpExceptions: true,
    payload: { chat_id: c, text: text, disable_web_page_preview: 'true' }
  });
  if (res.getResponseCode() === 200) return;

  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) {}
  var mig = body && body.parameters && body.parameters.migrate_to_chat_id;
  if (mig) {   // группу превратили в супергруппу — Telegram выдал новый ID
    p.setProperty('TELEGRAM_CHAT_ID', String(mig));
    p.setProperty('TG_CHAT_ID', String(mig));
    logErr_('Telegram', 'ID группы сменился на ' + mig + ' — сохранил новый');
    var res2 = UrlFetchApp.fetch('https://api.telegram.org/bot' + t + '/sendMessage', {
      method: 'post', muteHttpExceptions: true,
      payload: { chat_id: String(mig), text: text, disable_web_page_preview: 'true' }
    });
    if (res2.getResponseCode() === 200) return;
    throw new Error('Telegram после смены ID: ' + res2.getContentText().slice(0, 200));
  }
  throw new Error('Telegram: ' + res.getContentText().slice(0, 200));
}
function testTelegram() { tgSend_('🧪 Тест: мониторинг цен подключён.'); }

function sendBatch_(msgs) {
  if (!msgs || !msgs.length) return;
  try {
    if (msgs.length <= 3) { msgs.forEach(function (m) { tgSend_(m); }); return; }
    var chunk = '📊 Мониторинг цен: событий ' + msgs.length + '\n\n';
    for (var i = 0; i < msgs.length; i++) {
      if ((chunk + msgs[i]).length > 3800) { tgSend_(chunk); chunk = ''; }
      chunk += msgs[i] + '\n\n';
    }
    if (chunk.trim()) tgSend_(chunk);
  } catch (e) { logErr_('Telegram', String(e && e.message || e)); }
}

/** История: одна строка = дата + товар + площадка. На ней строятся графики. */
function appendHistory_(rows) {
  try {
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(SHEET_HIST);
    var headers = ['Дата', 'Товар', 'Площадка', 'Цена для покупателя, ₽', 'Скидка, %'];
    if (!sh) {
      sh = ss.insertSheet(SHEET_HIST);
      sh.appendRow(headers);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d9e7fd');
    } else if (String(sh.getRange(1, 3).getValue()).trim() !== 'Площадка') {
      // формат прежней версии — заводим лист заново
      ss.deleteSheet(sh);
      sh = ss.insertSheet(SHEET_HIST);
      sh.appendRow(headers);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d9e7fd');
    }
    // за один день по одной площадке храним один снимок — перезаписываем сегодняшние
    var today = Utilities.formatDate(rows[0][0], Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var last = sh.getLastRow();
    if (last > 1) {
      var dates = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = dates.length - 1; i >= 0; i--) {
        var dv = dates[i][0];
        if (dv instanceof Date &&
            Utilities.formatDate(dv, Session.getScriptTimeZone(), 'yyyy-MM-dd') === today) sh.deleteRow(i + 2);
      }
    }
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).setNumberFormat('dd.MM.yyyy');
    var extra = sh.getLastRow() - 1 - 20000;
    if (extra > 0) sh.deleteRows(2, extra);
  } catch (e) { logErr_('История', String(e && e.message || e)); }
}

function appendSpreadLog_(rows) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET_LOG);
  if (!sh) {
    sh = ss.insertSheet(SHEET_LOG);
    sh.appendRow(['Дата и время','Товар','Показатель','Событие','Разбег','Разница',
      'Где мин.','Мин.','Где макс.','Макс.','Медиана','Площадок','Сообщение']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 13).setFontWeight('bold').setBackground('#d9e7fd');
  }
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function logErr_(src, msg) {
  try {
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(SHEET_ERR) || ss.insertSheet(SHEET_ERR);
    sh.appendRow([new Date(), 'Мониторинг / ' + src, msg]);
  } catch (e) { Logger.log('logErr_: ' + e); }
}

function mailFail_(subject, body) {
  try {
    var to = Session.getEffectiveUser().getEmail();
    if (to) MailApp.sendEmail(to, subject, body + '\n\n' + SpreadsheetApp.getActive().getUrl());
  } catch (e) { Logger.log('mail: ' + e); }
}

/* ==================================================================== */
/*  СОСТОЯНИЕ                                                           */
/* ==================================================================== */
function stateSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET_STATE);
  if (!sh) {
    sh = ss.insertSheet(SHEET_STATE);
    sh.appendRow(['Ключ (товар|показатель)', 'Разбег', 'Где мин.', 'Время последнего алерта']);
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}
function readState_() {
  var sh = stateSheet_(), out = {}, last = sh.getLastRow();
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, 4).getValues().forEach(function (r) {
    if (r[0]) out[String(r[0])] = { spread: r[1], minMp: r[2], lastAlert: r[3] };
  });
  return out;
}
function writeState_(state) {
  var sh = stateSheet_(), rows = [];
  for (var k in state) rows.push([k, state[k].spread, state[k].minMp, state[k].lastAlert || '']);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 4).setValues(rows);
}
function resetSpreadState() {
  var sh = stateSheet_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).clearContent();
  Logger.log('База сброшена — следующий сбор зафиксирует её без уведомлений');
}

/* ==================================================================== */
/*  НАСТРОЙКИ                                                           */
/* ==================================================================== */
function readSettings_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_SET);
  var vals = sh ? sh.getDataRange().getValues() : [];
  var get = function (sub, def) {
    for (var i = 0; i < vals.length; i++)
      if (String(vals[i][0] || '').toLowerCase().indexOf(sub) === 0) {
        var v = vals[i][1];
        return (v === '' || v === null || v === undefined) ? def : v;
      }
    return def;
  };
  var pct = function (sub, def) { var n = num_(get(sub, def)); if (isNaN(n) || n <= 0) return def; return n <= 1 ? n * 100 : n; };
  var int_ = function (sub, def) { var n = num_(get(sub, def)); return (isNaN(n) || n < 0) ? def : n; };

  var cfg = {
    thr: { SITE: pct('порог разбега: цена на площадке', DEF.thrSite),
           DISC: pct('порог разбега: скидка', DEF.thrDisc) },
    minRub:    int_('мин. разница для алерта', DEF.minRub),
    stepPp:    int_('шаг изменения для повторного алерта', DEF.stepPp) || DEF.stepPp,
    cooldownH: int_('кулдаун на товар', DEF.cooldownH),
    runHour:   int_('час ежедневного сбора', DEF.runHour),
    maxAttempts: int_('попыток до уведомления', DEF.maxAttempts) || DEF.maxAttempts,
    crBudget:  int_('лимит кредитов парсинга в день', DEF.crBudget) || DEF.crBudget,
    metricOn: {}, mpOn: []
  };
  METRICS.forEach(function (m) { cfg.metricOn[m.key] = isTrue_(get(m.setting, true)); });
  MPS.forEach(function (mp) { if (isTrue_(get('площадка: ' + mp.title.toLowerCase(), false))) cfg.mpOn.push(mp.code); });
  return cfg;
}

function ensureSettingsSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET_SET) || ss.insertSheet(SHEET_SET);
  var vals = sh.getLastRow() ? sh.getDataRange().getValues() : [];
  var exists = {};
  vals.forEach(function (r) { var s = String(r[0] || '').trim(); if (s) exists[s.toLowerCase()] = true; });

  // строки прежней версии, которые больше не нужны
  ['сравнивать: цена в кабинете'].forEach(function (dead) {
    for (var i = vals.length - 1; i >= 0; i--)
      if (String(vals[i][0] || '').toLowerCase().indexOf(dead) === 0) { sh.deleteRow(i + 1); vals.splice(i, 1); }
  });

  var block = [
    ['— ПОРОГИ (заполните сами) —', ''],
    ['Порог разбега: цена на площадке, %', ''],
    ['Порог разбега: скидка, п.п.', ''],
    ['Мин. разница для алерта, ₽', ''],
    ['Шаг изменения для повторного алерта, п.п.', ''],
    ['Кулдаун на товар, часов', ''],
    ['— РАСПИСАНИЕ —', ''],
    ['Час ежедневного сбора (по часовому поясу проекта)', 20],
    ['Попыток до уведомления в Telegram', 5],
    ['Лимит кредитов парсинга в день', 900],
    ['Повторить сбор сейчас', false],
    ['— ЧТО СРАВНИВАТЬ: ПОКАЗАТЕЛИ —', ''],
    ['Сравнивать: цена на площадке', true],
    ['Сравнивать: скидка, %', true],
    ['— ЧТО СРАВНИВАТЬ: ПЛОЩАДКИ —', ''],
    ['Площадка: wb', true],
    ['Площадка: ozon', true],
    ['Площадка: yandex', true],
    ['Площадка: сайт бренда', true],
    ['Площадка: летуаль', true],
    ['Площадка: goldapple', true],
    ['Площадка: megamarket', false],
    ['Площадка: самокат', false],
    ['Площадка: flowwow', false]
  ].filter(function (r) { return !exists[String(r[0]).toLowerCase()]; });

  if (!block.length) return;
  var start = sh.getLastRow() + 2;
  sh.getRange(start, 1, block.length, 2).setValues(block);
  for (var i = 0; i < block.length; i++) {
    var row = start + i, label = String(block[i][0]);
    if (label.indexOf('—') === 0) {
      sh.getRange(row, 1, 1, 2).setFontWeight('bold').setBackground('#d9e7fd');
    } else if (/^порог|^мин\. разница|^шаг изменения|^кулдаун/i.test(label)) {
      sh.getRange(row, 2).setBackground('#fff2cc')
        .setBorder(true, true, true, true, false, false, '#e69138', SpreadsheetApp.BorderStyle.SOLID);
      sh.getRange(row, 1).setFontColor('#7f6000');
    } else if (typeof block[i][1] === 'boolean') {
      sh.getRange(row, 2).insertCheckboxes();
    }
  }
  sh.setColumnWidth(1, 340);
  sh.setColumnWidth(2, 220);
}

/* ==================================================================== */
/*  ПОДГОТОВКА ЛИСТА «ТОВАРЫ»                                           */
/* ==================================================================== */
function setupSpread() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET_GOODS);
  if (!sh) throw new Error('нет листа «Товары»');

  // удаляем колонки прежней версии
  OBSOLETE_COLS.forEach(function (name) {
    var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var i = hdr.indexOf(name);
    if (i >= 0) { sh.deleteColumn(i + 1); Logger.log('удалена колонка: ' + name); }
  });

  var hdr = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var have = {};
  hdr.forEach(function (h) { var s = String(h || '').trim(); if (s) have[s] = true; });

  var need = [];
  MPS.forEach(function (mp) {
    [mp.cab, mp.site, mp.disc, mp.link].forEach(function (c) {
      if (c && !have[c] && need.indexOf(c) < 0) need.push(c);
    });
  });
  SPREAD_COLS.forEach(function (c) { if (!have[c] && need.indexOf(c) < 0) need.push(c); });
  if (need.length) {
    sh.getRange(1, sh.getLastColumn() + 1, 1, need.length).setValues([need])
      .setFontWeight('bold').setBackground('#e0e0e0').setWrap(true);
  }

  var map = headerMap_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
  var paint = { 'Разбег, %':'#fce8b2', 'Статус':'#fce8b2', 'Мин. цена, ₽':'#e6f4ea',
                'Макс. цена, ₽':'#fce4ec', 'Не сравнивать':'#f3f3f3' };
  for (var k in paint) if (map[k] !== undefined) sh.getRange(1, map[k] + 1).setBackground(paint[k]);
  if (map['Не сравнивать'] !== undefined && sh.getMaxRows() > 1)
    sh.getRange(2, map['Не сравнивать'] + 1, sh.getMaxRows() - 1, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sh.setFrozenRows(1);

  addHeaderNotes_(sh);
  ensureSettingsSheet_();
  stateSheet_();
}

/** Примечания к заголовкам: формулы видны прямо в таблице. */
function addHeaderNotes_(sh) {
  var map = headerMap_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
  var notes = {
    'Разбег, %': 'Разбег = (макс. цена − мин. цена) ÷ мин. цена × 100.\nСчитается только по ценам для покупателя, минимум по двум площадкам.',
    'Медиана, ₽': 'Серединная цена по площадкам. Показывает, разъехались все цены или выбивается одна площадка.',
    'Выбивается': 'Площадка, сильнее всех отклоняющаяся от медианы, и величина отклонения.',
    'Мин. цена, ₽': 'Самая низкая цена для покупателя. Это база расчёта разбега.',
    'Макс. цена, ₽': 'Самая высокая цена для покупателя.',
    'Разбег скидка, п.п.': 'Разброс размера скидки между площадками, в процентных пунктах: макс. скидка − мин. скидка.',
    'Не сравнивать': 'Галочка исключает товар из мониторинга целиком.'
  };
  MPS.forEach(function (mp) {
    if (mp.cab) notes[mp.cab] = 'Цена в кабинете: наша цена после нашей скидки. В сравнении НЕ участвует — нужна только как база для расчёта скидки.';
    if (mp.site) notes[mp.site] = 'Цена для покупателя на витрине. Именно эти цены сравниваются между площадками.';
    if (mp.disc) notes[mp.disc] = mp.cab
      ? 'Скидка = (цена в кабинете − цена для покупателя) ÷ цена в кабинете × 100.\nПоказывает, сколько маркетплейс добавляет от себя (у WB это СПП и кошелёк).'
      : 'Не заполняется: у этой площадки нет цены в кабинете, поэтому считать скидку не от чего.';
  });
  for (var k in notes) if (map[k] !== undefined) sh.getRange(1, map[k] + 1).setNote(notes[k]);
}

/** Переносит секреты из ячеек в Script Properties и очищает ячейки. */
function migrateSecretsFromSheet() {
  var ss = SpreadsheetApp.getActive();
  var props = PropertiesService.getScriptProperties();
  var moved = [];
  ss.getSheets().forEach(function (sh) {
    if (sh.getLastRow() === 0) return;
    var rng = sh.getDataRange(), v = rng.getValues(), dirty = false;
    for (var r = 0; r < v.length; r++) {
      var labelA = String(v[r][0] || '');
      for (var c = 0; c < v[r].length; c++) {
        var s = String(v[r][c] || '').trim();
        if (!s) continue;
        var put = null;
        if (/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(s)) put = 'TELEGRAM_TOKEN';
        else if (c > 0 && /token|токен/i.test(labelA) && /telegram|телеграм|бот/i.test(labelA)) put = 'TELEGRAM_TOKEN';
        else if (c > 0 && /(chat.?id|чат)/i.test(labelA)) put = 'TELEGRAM_CHAT_ID';
        else if (c > 0 && /client.?id/i.test(labelA)) put = 'OZON_CLIENT_ID';
        else if (c > 0 && /api.?key/i.test(labelA) && /ozon|озон/i.test(labelA)) put = 'OZON_API_KEY';
        if (!put) continue;
        props.setProperty(put, s);
        if (put === 'TELEGRAM_TOKEN') props.setProperty('TG_BOT_TOKEN', s);
        if (put === 'TELEGRAM_CHAT_ID') props.setProperty('TG_CHAT_ID', s);
        v[r][c] = ''; dirty = true;
        moved.push(put + ' ← ' + sh.getName() + ' R' + (r + 1) + 'C' + (c + 1));
      }
    }
    if (dirty) rng.setValues(v);
  });
  var msg = moved.length ? 'Перенесено, ячейки очищены:\n' + moved.join('\n')
                         : 'Секретов в ячейках не найдено — ничего не изменено.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/** Диагностика: какие ключи заданы (значения не логируются). */
function listPropertyKeys() {
  var p = PropertiesService.getScriptProperties().getProperties(), out = [];
  for (var k in p) out.push(k + ' = [задан, ' + String(p[k]).length + ' симв.]');
  Logger.log(out.length ? out.join('\n') : 'Script Properties пусты');
}

/* ==================================================================== */
/*  ДАШБОРД                                                             */
/* ==================================================================== */
function colLetter_(i) {
  var s = '', n = i + 1;
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Заполняет таблицу «ТОВАРЫ ПО УБЫВАНИЮ РАЗБЕГА» (A10:H…) значениями, посчитанными
 * в коде (а не формулой SORT/FILTER — на этом листе такие формулы стабильно дают #ERROR!).
 */
function fillGoodsTable_(sh, goodsData, col) {
  var rows = goodsData.map(function (row) {
    var name = String(row[col['Название']] || '').trim();
    if (!name) return null;
    return [
      name,
      row[col['Мин. цена, ₽']],
      row[col['Где мин.']],
      row[col['Макс. цена, ₽']],
      row[col['Где макс.']],
      row[col['Разбег, %']],
      row[col['Медиана, ₽']],
      row[col['Статус']]
    ];
  }).filter(function (r) { return r !== null; });
  rows.sort(function (a, b) {
    var sa = typeof a[5] === 'number' ? a[5] : -Infinity;
    var sb = typeof b[5] === 'number' ? b[5] : -Infinity;
    return sb - sa;
  });
  sh.getRange(11, 1, 40, 8).clearContent();
  if (rows.length) {
    sh.getRange(11, 1, rows.length, 8).setValues(rows);
  } else {
    sh.getRange(11, 1).setValue('нет данных');
  }
}

/**
 * Заполняет служебные сетки цен/скидок по дням для товара из B4 и месяца из D4 —
 * тоже в коде, а не формулой AVERAGEIFS (на этом листе такие формулы дают #ERROR!).
 * Вызывается и при полной пересборке дашборда, и из onEdit при смене B4/D4.
 */
// До 11.08.2026 облачный сборщик писал в «Ozon Сайт» цену с публичной карточки
// («Ваша цена» из личного кабинета продавца), а не настоящую «Цену для покупателя».
// Старые строки истории по Ozon за этот период недостоверны — на дашборде их не
// показываем (сами данные в листе «История» не трогаем, ничего не удаляем).
var OZON_HIST_CUTOFF_ = new Date(2026, 7, 11);

// Ранний парсер GoldApple иногда цеплял не ту цифру на странице и писал в историю
// заведомо заниженную цену (~900–1100 ₽ вместо реальных 3300–4700 ₽). Такие точки
// на дашборде отбрасываем как недостоверные (данные в «Истории» не трогаем).
var GOLDAPPLE_HIST_MIN_ = 1500;

function fillDashboardGrid_(sh, hist, mpTitles, gridP, gridD) {
  var product = String(sh.getRange('B4').getValue() || '').trim();
  var monthStr = String(sh.getRange('D4').getValue() || '').trim();
  var histData = hist ? hist.getRange(2, 1, Math.max(hist.getLastRow() - 1, 0), 5).getValues() : [];
  var byDate = {}, datesSet = {};
  var tz = Session.getScriptTimeZone();
  histData.forEach(function (r) {
    var d = r[0], name = String(r[1] || '').trim(), mp = String(r[2] || '').trim();
    var price = r[3], disc = r[4];
    if (!(d instanceof Date)) return;
    if (name !== product) return;
    if (mp === 'Ozon' && d < OZON_HIST_CUTOFF_) return;
    if (mp === 'GoldApple' && typeof price === 'number' && price < GOLDAPPLE_HIST_MIN_) return;
    var mk = Utilities.formatDate(d, tz, 'yyyy-MM');
    if (mk !== monthStr) return;
    var dk = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    datesSet[dk] = true;
    byDate[dk] = byDate[dk] || {};
    byDate[dk][mp] = byDate[dk][mp] || { p: [], d: [] };
    if (typeof price === 'number') byDate[dk][mp].p.push(price);
    if (typeof disc === 'number') byDate[dk][mp].d.push(disc);
  });
  var dates = Object.keys(datesSet).sort();
  var nMps = mpTitles.length;

  sh.getRange(1, gridP).setValue('Дата');
  sh.getRange(1, gridD).setValue('Дата');
  sh.getRange(2, gridP, 31, nMps + 1).clearContent();
  sh.getRange(2, gridD, 31, nMps + 1).clearContent();

  var rowsP = [], rowsD = [];
  dates.slice(0, 31).forEach(function (dk) {
    var dateObj = new Date(dk + 'T00:00:00');
    var rp = [dateObj], rd = [dateObj];
    mpTitles.forEach(function (mp) {
      var bucket = byDate[dk] && byDate[dk][mp];
      var avgP = bucket && bucket.p.length ? (bucket.p.reduce(function (a, b) { return a + b; }, 0) / bucket.p.length) : '';
      var avgD = bucket && bucket.d.length ? (bucket.d.reduce(function (a, b) { return a + b; }, 0) / bucket.d.length) : '';
      rp.push(avgP); rd.push(avgD);
    });
    rowsP.push(rp); rowsD.push(rd);
  });
  if (rowsP.length) {
    sh.getRange(2, gridP, rowsP.length, nMps + 1).setValues(rowsP);
    sh.getRange(2, gridD, rowsD.length, nMps + 1).setValues(rowsD);
    sh.getRange(2, gridP, rowsP.length, 1).setNumberFormat('ddd dd.MM');
    sh.getRange(2, gridD, rowsD.length, 1).setNumberFormat('ddd dd.MM');
  }
}

/**
 * Простой триггер: при смене товара (B4) или месяца (D4) на листе «Дашборд»
 * пересчитывает таблицу и сетки графиков без полной пересборки листа.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEET_DASH) return;
    var a1 = e.range.getA1Notation();
    if (a1 !== 'B4' && a1 !== 'D4') return;
    var ss = SpreadsheetApp.getActive();
    var hist = ss.getSheetByName(SHEET_HIST);
    var mpHeaders = sh.getRange(1, 28, 1, sh.getMaxColumns() - 27).getValues()[0];
    var mpTitles = [];
    for (var i = 0; i < mpHeaders.length; i++) {
      if (!mpHeaders[i]) break;
      mpTitles.push(mpHeaders[i]);
    }
    fillDashboardGrid_(sh, hist, mpTitles, 27, 42);
  } catch (err) {
    // не мешаем ручному редактированию, если что-то пошло не так
  }
}

/**
 * Дашборд: динамика цен и скидок по дням выбранного месяца.
 * Переключатели «Товар» (B4) и «Месяц» (D4) — линии на графиках это ПЛОЩАДКИ,
 * никакого усреднения между товарами и площадками не происходит.
 */
function buildDashboard() {
  var ss = SpreadsheetApp.getActive();
  var goods = ss.getSheetByName(SHEET_GOODS);
  if (!goods) throw new Error('нет листа «Товары»');
  var col = headerMap_(goods.getRange(1, 1, 1, goods.getLastColumn()).getValues()[0]);
  ['Название','Мин. цена, ₽','Где мин.','Макс. цена, ₽','Где макс.','Разбег, %','Медиана, ₽','Статус','Обновлено']
    .forEach(function (n) { if (col[n] === undefined) throw new Error('в «Товары» нет колонки: ' + n); });
  var L = {}; for (var k in col) L[k] = colLetter_(col[k]);

  var cfg = readSettings_();
  var names = goods.getRange(2, col['Название'] + 1, Math.max(goods.getLastRow() - 1, 1), 1)
    .getValues().map(function (r) { return String(r[0] || '').trim(); })
    .filter(function (s) { return s; });
  var nGoods = Math.min(names.length, 12);

  // месяцы из истории
  var months = [], hist = ss.getSheetByName(SHEET_HIST);
  if (hist && hist.getLastRow() > 1) {
    var seen = {};
    hist.getRange(2, 1, hist.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var d = r[0];
      if (d instanceof Date) {
        var kk = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
        if (!seen[kk]) { seen[kk] = 1; months.push(kk); }
      }
    });
  }
  var nowKey = new Date().getFullYear() + '-' + ('0' + (new Date().getMonth() + 1)).slice(-2);
  if (months.indexOf(nowKey) < 0) months.push(nowKey);
  months.sort();

  var mpTitles = cfg.mpOn.map(function (c) { return mpByCode_(c).title; });
  if (!mpTitles.length) mpTitles = MPS.map(function (m) { return m.title; });

  var old = ss.getSheetByName(SHEET_DASH);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(SHEET_DASH, 1);
  if (sh.getMaxColumns() < 80) sh.insertColumnsAfter(sh.getMaxColumns(), 80 - sh.getMaxColumns());
  if (sh.getMaxRows() < 60) sh.insertRowsAfter(sh.getMaxRows(), 60 - sh.getMaxRows());
  var G = "'" + SHEET_GOODS + "'!", H = "'" + SHEET_HIST + "'!";

  // ── заголовок
  sh.getRange('A1').setValue('ДИНАМИКА ЦЕН И СКИДОК').setFontSize(16).setFontWeight('bold').setFontColor('#ffffff');
  sh.getRange('A1:H1').setBackground('#1c4587');
  var goodsData = goods.getRange(2, 1, Math.max(goods.getLastRow() - 1, 1), goods.getLastColumn()).getValues();
  var lastUpd = null;
  goodsData.forEach(function (row) {
    var d = row[col['Обновлено']];
    if (d instanceof Date && (!lastUpd || d > lastUpd)) lastUpd = d;
  });
  sh.getRange('A2').setValue('Последний сбор: ' + (lastUpd ?
    Utilities.formatDate(lastUpd, Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm') : '—'));
  sh.getRange('A2').setFontColor('#5b636b');

  // ── переключатели
  sh.getRange('A4').setValue('Товар:').setFontWeight('bold');
  sh.getRange('B4').setValue(names[0]).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(names, true).build());
  sh.getRange('C4').setValue('Месяц:').setFontWeight('bold');
  sh.getRange('D4').setNumberFormat('@');   // иначе «2026-08» превратится в дату
  sh.getRange('D4').setValue(months[months.length - 1]).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(months, true).build());
  sh.getRange('B4:D4').setBackground('#fff2cc')
    .setBorder(true, true, true, true, true, false, '#e69138', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('E4').setValue('← переключайте, графики перестроятся сами').setFontColor('#7f6000').setFontSize(10);

  // ── сводка (считаем в коде, а не формулами — надёжнее для открытых диапазонов)
  sh.getRange(6, 1, 1, 5).setValues([['Товаров в мониторинге','Выше порога','Средний разбег','Максимальный разбег','Порог, %']])
    .setFontSize(10).setFontColor('#5b636b').setFontWeight('bold').setWrap(true);
  var totalGoods = 0, aboveCount = 0, spreadVals = [];
  goodsData.forEach(function (row) {
    var nm = String(row[col['Название']] || '').trim();
    if (!nm) return;
    totalGoods++;
    var st = String(row[col['Статус']] || '');
    if (st.indexOf('ВЫШЕ') >= 0) aboveCount++;
    var sp = row[col['Разбег, %']];
    if (typeof sp === 'number' && !isNaN(sp)) spreadVals.push(sp);
  });
  var avgSpread = spreadVals.length ? Math.round((spreadVals.reduce(function (a, b) { return a + b; }, 0) / spreadVals.length) * 10) / 10 : '—';
  var maxSpread = spreadVals.length ? Math.round(Math.max.apply(null, spreadVals) * 10) / 10 : '—';
  sh.getRange(7, 1, 1, 5).setValues([[totalGoods, aboveCount, avgSpread, maxSpread, cfg.thr['SITE']]]);
  sh.getRange(7, 1, 1, 5).setFontSize(18).setFontWeight('bold');
  sh.getRange(6, 1, 2, 5).setBackground('#f7f8f9');
  sh.getRange(7, 3, 1, 3).setNumberFormat('0.0"%"');

  // ── таблица (считаем в коде — формулы SORT/FILTER с {…} на этом листе стабильно дают #ERROR!)
  sh.getRange('A9').setValue('ТОВАРЫ ПО УБЫВАНИЮ РАЗБЕГА').setFontWeight('bold');
  sh.getRange('A9:H9').setBackground('#d9e7fd');
  sh.getRange(10, 1, 1, 8).setValues([['Товар','Мин. цена, ₽','Где мин.','Макс. цена, ₽','Где макс.','Разбег, %','Медиана, ₽','Статус']])
    .setFontWeight('bold').setFontSize(10);
  fillGoodsTable_(sh, goodsData, col);
  sh.getRange(11, 2, 40, 1).setNumberFormat('#,##0');
  sh.getRange(11, 4, 40, 1).setNumberFormat('#,##0');
  sh.getRange(11, 7, 40, 1).setNumberFormat('#,##0');
  sh.getRange(11, 6, 40, 1).setNumberFormat('0.0');

  // ── служебные сетки: цены (AA) и скидки (AP) — тоже считаем в коде, не формулами
  var gridP = 27, gridD = 42;   // 1-based номера колонок AA и AP
  var nMps = mpTitles.length;
  for (var g = 0; g < nMps; g++) {
    sh.getRange(1, gridP + 1 + g).setValue(mpTitles[g]);
    sh.getRange(1, gridD + 1 + g).setValue(mpTitles[g]);
  }
  fillDashboardGrid_(sh, hist, mpTitles, gridP, gridD);

  // ── графики
  // ВАЖНО: цвета задаём через 'series' (по индексу колонки), а НЕ через простой
  // массив 'colors'. У товаров, где для какой-то площадки вообще нет ни одной
  // точки за месяц (например, у TEDY PINK нет карточки на Яндексе — колонка
  // Yandex целиком пустая), Google Sheets пропускает такую пустую серию при
  // отрисовке и сдвигает позиционные цвета у всех следующих площадок — из-за
  // этого, например, Летуаль у TEDY PINK красилась в цвет "Сайта бренда".
  // 'series' привязывает цвет к исходному индексу колонки и не сдвигается.
  var mpColors = mpTitles.map(function (t) { return MP_COLORS_[t] || '#000000'; });
  var seriesColors = {};
  mpColors.forEach(function (c, i) { seriesColors[i] = { color: c }; });
  var c1 = sh.newChart().asLineChart()
    .addRange(sh.getRange(1, gridP, 32, nMps + 1)).setNumHeaders(1)
    .setOption('title', 'Цена для покупателя по дням, ₽ — товар из B4, месяц из D4')
    .setOption('curveType', 'none').setOption('pointSize', 4)
    .setOption('vAxis', { title: '₽' })
    .setOption('series', seriesColors)
    .setOption('width', 700).setOption('height', 330)
    .setPosition(4, 10, 0, 0).build();
  sh.insertChart(c1);

  var c2 = sh.newChart().asLineChart()
    .addRange(sh.getRange(1, gridD, 32, nMps + 1)).setNumHeaders(1)
    .setOption('title', 'Уровень скидок по дням, % — товар из B4, месяц из D4')
    .setOption('curveType', 'none').setOption('pointSize', 4)
    .setOption('vAxis', { title: '%' })
    .setOption('series', seriesColors)
    .setOption('width', 700).setOption('height', 330)
    .setPosition(22, 10, 0, 0).build();
  sh.insertChart(c2);

  // разбег по товарам — вспомогательный
  sh.getRange(1, 60).setValue('Товар'); sh.getRange(1, 61).setValue('Разбег, %');
  sh.getRange(2, 60).setFormula('=IFERROR(SORT(FILTER({' + G + L['Название'] + '2:' + L['Название'] + ',' +
    G + L['Разбег, %'] + '2:' + L['Разбег, %'] + '},' + G + L['Разбег, %'] + '2:' + L['Разбег, %'] + '<>""),2,FALSE),"")');
  var c3 = sh.newChart().asColumnChart()
    .addRange(sh.getRange(1, 60, Math.max(names.length, 1) + 1, 2)).setNumHeaders(1)
    .setOption('title', 'Разбег цен по товарам сейчас, %')
    .setOption('legend', { position: 'none' }).setOption('colors', ['#b45309'])
    .setOption('width', 700).setOption('height', 300)
    .setPosition(40, 10, 0, 0).build();
  sh.insertChart(c3);

  sh.hideColumns(gridP, 40);
  sh.setColumnWidth(1, 160);
  for (var w = 2; w <= 8; w++) sh.setColumnWidth(w, 110);
  sh.setFrozenRows(4);
  Logger.log('Дашборд собран: товаров ' + names.length + ', месяцев ' + months.length +
    ', площадок в графике ' + nMps);
}

function thresholdCellA1_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_SET);
  if (!sh) return null;
  var v = sh.getDataRange().getValues();
  for (var i = 0; i < v.length; i++)
    if (String(v[i][0] || '').toLowerCase().indexOf('порог разбега: цена на площадке') === 0)
      return "'" + SHEET_SET + "'!B" + (i + 1);
  return null;
}

/* ==================================================================== */
/*  ЛИСТ «ИНСТРУКЦИЯ»                                                   */
/* ==================================================================== */
function buildInstructionSheet() {
  var ss = SpreadsheetApp.getActive();
  var old = ss.getSheetByName('Инструкция');
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet('Инструкция', 0);

  var rows = [
    ['H', 'МОНИТОРИНГ ЦЕН И СКИДОК — как работает и как настраивать'],
    ['T', 'Обновлено: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy')],
    ['T', ''],

    ['B', '1. ГЛАВНОЕ ПРАВИЛО'],
    ['T', 'Сравниваются ТОЛЬКО цены для покупателя — то, что человек реально платит на витрине.'],
    ['T', 'Цена в кабинете собирается, но в сравнении не участвует. Она нужна для одного: посчитать скидку.'],
    ['T', 'Скидка = (цена в кабинете − цена для покупателя) ÷ цена в кабинете × 100.'],
    ['T', 'Пример WB, LILU: кабинет 4 500 ₽, витрина 3 699 ₽ → скидка 17,8%. Столько маркетплейс добавляет от себя (СПП и кошелёк).'],
    ['T', 'Где кабинета нет — ваш сайт, Летуаль, Золотое Яблоко — колонка «Скидка %» остаётся пустой. Считать не от чего.'],
    ['T', ''],

    ['B', '2. РАЗБЕГ ЦЕН'],
    ['T', 'Разбег % = (самая высокая цена − самая низкая) ÷ самая низкая × 100. База — самая дешёвая цена.'],
    ['T', 'Считается, только если цены для покупателя есть минимум у двух площадок. Иначе в «Статус» пишется НЕТ ДАННЫХ.'],
    ['T', 'Отдельно считается разбег скидок — в процентных пунктах: макс. скидка − мин. скидка.'],
    ['T', ''],

    ['B', '3. КОГДА БОТ ПИШЕТ В ГРУППУ'],
    ['T', 'Только при событиях. Ничего не изменилось — бот молчит.'],
    ['T', '🔴 Разбег впервые превысил порог.'],
    ['T', '🔄 Сменилась самая дешёвая площадка.'],
    ['T', '📈 Разбег, оставаясь выше порога, изменился на заданный шаг.'],
    ['T', '🟢 Разбег вернулся в пределы порога.'],
    ['T', 'В каждом сообщении: товар, все площадки с ценами, кто дешевле и дороже всех, разница в ₽ и в %, медиана, кто выбивается.'],
    ['T', 'Первый сбор после настройки только запоминает базу — сообщений не будет. Это норма.'],
    ['T', 'Отдельно бот пишет, если сбор не удался (см. раздел 6).'],
    ['T', ''],

    ['B', '4. ДАШБОРД — ГЛАВНОЕ МЕСТО ДЛЯ ГЛАЗ'],
    ['T', 'Два основных графика показывают ДИНАМИКУ за месяц: по горизонтали дни месяца с днём недели, по вертикали величина.'],
    ['T', '   • «Цена для покупателя по дням, ₽» — сколько платит покупатель.'],
    ['T', '   • «Уровень скидок по дням, %» — как менялась скидка.'],
    ['T', 'Каждая линия — отдельная ПЛОЩАДКА. Ничего не усредняется: у площадок разные цены, среднее по ним смысла не имеет.'],
    ['T', 'Переключатели: жёлтая ячейка B4 — товар, жёлтая ячейка D4 — месяц. Меняете значение — оба графика перестраиваются мгновенно, пересобирать ничего не нужно.'],
    ['T', 'Логика переключения: выбрали товар и месяц → видите, как этот товар вёл себя на разных площадках в этом месяце.'],
    ['T', 'Ниже вспомогательный график «Разбег цен по товарам сейчас» и таблица товаров по убыванию разбега.'],
    ['T', 'Дашборд пересобирается сам после каждого успешного сбора. Вручную — меню «📈 Собрать/обновить Дашборд».'],
    ['T', 'ВАЖНО: графики динамики наполняются постепенно — по одной точке в день. В первый день будет одна точка, через неделю — семь.'],
    ['T', ''],

    ['B', '5. ЛИСТЫ'],
    ['T', '«Товары» — единственный источник. Вручную заполняете: Название, артикулы и ссылки. Остальное пишет скрипт.'],
    ['T', 'Название товара — это КЛЮЧ. По нему сходятся offer_id Ozon и Yandex, история и графики. Переименуете — история по товару начнётся заново.'],
    ['T', 'Колонка «Не сравнивать» — галочка исключает товар из мониторинга.'],
    ['T', 'У каждого заголовка есть примечание с формулой — наведите курсор на заголовок.'],
    ['T', '«История» — по одной строке на дату + товар + площадку: цена и скидка. На ней стоят графики. За один день хранится один снимок.'],
    ['T', '«Лог разбега» — только события. «Лог ошибок» — сбои источников. «_Состояние» — скрытый служебный лист, отличает новое событие от давно известного.'],
    ['T', ''],

    ['B', '6. РАСПИСАНИЕ И ЧТО ДЕЛАТЬ ПРИ СБОЕ'],
    ['T', 'Сбор идёт один раз в сутки, в час из настройки «Час ежедневного сбора» (по часовому поясу проекта). 20:00 Екатеринбурга = 18:00 Москвы.'],
    ['T', 'Раз в час работает «сторож»: если за сегодня успешного сбора ещё не было, он пробует снова.'],
    ['T', 'После заданного числа неудачных попыток бот пишет в группу, что собрать не удалось и какие площадки молчат.'],
    ['T', 'Исправили причину (пополнили ScrapingBee, поправили ключ) — есть три способа запустить сбор сразу, не дожидаясь следующего дня:'],
    ['T', '   1) написать в группу боту «Попробуй снова» — сторож увидит команду в течение часа;'],
    ['T', '   2) поставить галочку «Повторить сбор сейчас» в листе «Настройки» — тоже сработает в течение часа;'],
    ['T', '   3) меню «🔁 Повторить сбор» — запускается немедленно.'],
    ['T', 'Успешным считается сбор, в котором все ВКЛЮЧЁННЫЕ площадки отдали данные. Если площадка стабильно не отвечает — снимите её галочку, иначе сторож будет пробовать каждый час.'],
    ['T', ''],

    ['B', '7. ОТКУДА БЕРУТСЯ ЦЕНЫ'],
    ['T', 'WB — витрина с публичного card.wb.ru, кабинет через Discounts-Prices API. Кабинет WB жёстко ограничивает частоту: скрипт берёт весь список одним запросом, при отказе обновляет по кругу.'],
    ['T', 'Ozon — кабинет из Seller API. Витрина: сначала парсинг карточки по ссылке, и только если не вышло — приближение marketing_seller_price из API. Настоящей витринной цены Ozon API не отдаёт.'],
    ['T', 'Yandex — Partner API, только кабинет. Витрины у API нет, поэтому в сравнении цен Yandex не участвует.'],
    ['T', 'Сайт бренда — цена читается прямо со страницы товара, бесплатно.'],
    ['T', 'Летуаль и Золотое Яблоко — своего API нет, берётся только внешняя витрина со страницы через ScrapingBee. Обе площадки закрыты антиботом, поэтому цена приходит не всегда.'],
    ['T', 'Товар не в наличии — цены у площадки нет, она просто не участвует в разбеге. Нулём не считается.'],
    ['T', 'Защита от мусора: если при 2+ известных ценах новое значение отличается от их медианы больше чем в 4 раза, оно не записывается, а уходит в «Лог ошибок».'],
    ['T', ''],

    ['B', '8. КРЕДИТЫ SCRAPINGBEE'],
    ['T', 'Кредиты тратят только площадки, которые приходится парсить: Ozon-витрина, Летуаль, Золотое Яблоко. Запросы к WB, Yandex и вашему сайту бесплатны.'],
    ['T', 'Режимы включаются по возрастанию цены: обычный запрос 1 кредит → с рендерингом 5 → с премиум-прокси 25 → всё вместе 75. Дорогой режим включается только если дешёвый не дал цену.'],
    ['T', 'Настройка «Лимит кредитов ScrapingBee в день» останавливает парсинг при достижении лимита, чтобы не выйти за тариф. По умолчанию 900.'],
    ['T', ''],

    ['B', '9. НАСТРОЙКИ — что меняется без программиста'],
    ['T', 'Жёлтые ячейки — пороги: разбег цены %, разбег скидки п.п., минимальная разница в ₽ для алерта, шаг для повторного алерта, кулдаун на товар.'],
    ['T', 'Расписание: час сбора, число попыток до уведомления, лимит кредитов, галочка «Повторить сбор сейчас».'],
    ['T', 'Галки «Показатели»: сравнивать цену на площадке и/или скидку.'],
    ['T', 'Галки «Площадки»: какие площадки участвуют. Снятая галка — площадка игнорируется полностью.'],
    ['T', ''],

    ['B', '10. КЛЮЧИ'],
    ['T', 'Все токены только в Script Properties (Apps Script → Project Settings). В ячейках и в коде их нет.'],
    ['T', 'TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, OZON_CLIENT_ID, OZON_API_KEY, WB_API_KEY, YANDEX_TOKEN, SCRAPINGBEE_API_KEY.'],
    ['T', 'ID группы: -5527977119 (обязательно с минусом). Бот: @mg_monitor_price_bot.'],
    ['T', 'Если группу превратят в супергруппу, ID станет вида -100… — скрипт подхватит его сам и запишет в Script Properties.'],
    ['T', ''],

    ['B', '11. ЧАСТЫЕ ВОПРОСЫ'],
    ['T', 'Бот молчит — событий не было. Проверьте «Обновлено» в «Товары»: свежее время значит, что система работает.'],
    ['T', 'Много сообщений — поднимите порог, увеличьте «Мин. разница для алерта, ₽» или кулдаун.'],
    ['T', 'Графики динамики пустые — истории ещё нет, нужен хотя бы один успешный сбор; после первого дня будет одна точка.'],
    ['T', 'Новый товар — добавьте строку в «Товары» с артикулами и ссылками. Первый сбор запомнит базу без алерта.'],
    ['T', 'Новая площадка — нужен рабочий источник цены. Если у неё есть страница товара, достаточно добавить колонку со ссылкой; настройка делается в списке MPS файла Compare.gs.']
  ];

  var out = rows.map(function (r) { return [r[1]]; });
  sh.getRange(1, 1, out.length, 1).setValues(out);
  sh.setColumnWidth(1, 1000);
  sh.getRange(1, 1, out.length, 1).setWrap(true).setVerticalAlignment('top');
  for (var i = 0; i < rows.length; i++) {
    var rng = sh.getRange(i + 1, 1);
    if (rows[i][0] === 'H') rng.setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('#ffffff');
    else if (rows[i][0] === 'B') rng.setFontWeight('bold').setBackground('#d9e7fd').setFontSize(11);
    else rng.setFontSize(10);
  }
  sh.setFrozenRows(1);
  Logger.log('Лист «Инструкция» создан, строк: ' + out.length);
}

/** Диагностика скрейперов: какие ключи заданы и что отвечают сервисы. */
function checkScrapers() {
  var p = PropertiesService.getScriptProperties();
  var zr = p.getProperty('ZENROWS_API_KEY'), sb = p.getProperty('SCRAPINGBEE_API_KEY');
  Logger.log('ZenRows: ' + (zr ? 'ключ задан (' + zr.length + ' симв.)' : 'ключа нет'));
  Logger.log('ScrapingBee: ' + (sb ? 'ключ задан (' + sb.length + ' симв.)' : 'ключа нет'));

  if (zr) {
    var t = UrlFetchApp.fetch('https://api.zenrows.com/v1/?apikey=' + zr +
      '&url=' + encodeURIComponent('https://example.com'), { muteHttpExceptions: true });
    Logger.log('ZenRows тестовый запрос: HTTP ' + t.getResponseCode() +
      (t.getResponseCode() === 200 ? ' — ключ рабочий' : ' — ' + t.getContentText().slice(0, 160)));
  }
  if (sb) {
    var u = UrlFetchApp.fetch('https://app.scrapingbee.com/api/v1/usage?api_key=' + sb, { muteHttpExceptions: true });
    Logger.log('ScrapingBee usage: HTTP ' + u.getResponseCode() + ' ' + u.getContentText().slice(0, 200));
  }
  Logger.log('Наш счётчик сегодня — ZenRows: ' + creditsSpentToday_('ZR') +
    ', ScrapingBee: ' + creditsSpentToday_('SB'));
}

/* ==================================================================== */
/*  ПЕРЕСТРОЙКА КОЛОНОК «ТОВАРЫ»                                        */
/* ==================================================================== */
/** Порядок колонок: общие → по каждой площадке «Артикул, Ссылка, Кабинет, Сайт, Скидка» → блок расчёта. */
function goodsColumnPlan_() {
  var plan = [{ title: 'Общее', cols: ['ШК', 'Название', 'Бренд'] }];
  MPS.forEach(function (mp) {
    var cols = [mp.id, mp.link, mp.cab, mp.site, mp.disc].filter(function (c) { return c; });
    if (cols.length) plan.push({ title: mp.title, cols: cols, code: mp.code });
  });
  plan.push({ title: 'Расчёт', cols: SPREAD_COLS.slice() });
  return plan;
}

/**
 * Переставляет колонки листа «Товары» по плану и группирует их по площадкам,
 * чтобы каждую площадку можно было свернуть. Данные сохраняются по названию колонки.
 * Перед изменением делает копию листа.
 */
function restructureGoods() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET_GOODS);
  if (!sh) throw new Error('нет листа «Товары»');

  var lastRow = Math.max(sh.getLastRow(), 1);
  var lastCol = sh.getLastColumn();
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var oldHdr = values[0].map(function (h) { return String(h || '').trim(); });

  // резервная копия
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM HH:mm');
  var backup = sh.copyTo(ss).setName('Товары_копия ' + stamp);
  backup.hideSheet();

  var plan = goodsColumnPlan_();
  var newHdr = [];
  plan.forEach(function (g) { g.cols.forEach(function (c) { if (newHdr.indexOf(c) < 0) newHdr.push(c); }); });

  // колонки, которых нет в плане, но с данными — сохраняем в конец
  var extra = [];
  oldHdr.forEach(function (h, i) {
    if (!h || newHdr.indexOf(h) >= 0 || OBSOLETE_COLS.indexOf(h) >= 0) return;
    var hasData = false;
    for (var r = 1; r < values.length; r++) if (String(values[r][i] || '') !== '') { hasData = true; break; }
    if (hasData) extra.push(h);
  });
  var finalHdr = newHdr.concat(extra);

  var idxOld = {};
  oldHdr.forEach(function (h, i) { if (h) idxOld[h] = i; });

  var out = [finalHdr];
  for (var r = 1; r < values.length; r++) {
    var row = [];
    for (var c = 0; c < finalHdr.length; c++) {
      var oi = idxOld[finalHdr[c]];
      row.push(oi === undefined ? '' : values[r][oi]);
    }
    out.push(row);
  }

  // снимаем прежние группировки и очищаем лист
  try { sh.getRange(1, 1, 1, sh.getMaxColumns()).shiftColumnGroupDepth(-8); } catch (e) {}
  sh.clear({ contentsOnly: false });
  if (sh.getMaxColumns() < finalHdr.length) sh.insertColumnsAfter(sh.getMaxColumns(), finalHdr.length - sh.getMaxColumns());
  if (sh.getMaxColumns() > finalHdr.length) sh.deleteColumns(finalHdr.length + 1, sh.getMaxColumns() - finalHdr.length);
  sh.getRange(1, 1, out.length, finalHdr.length).setValues(out);

  // оформление заголовка
  sh.getRange(1, 1, 1, finalHdr.length).setFontWeight('bold').setBackground('#e0e0e0').setWrap(true);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);

  // группировка по площадкам
  var cfg = readSettings_();
  var pos = 1;
  plan.forEach(function (g) {
    var width = g.cols.length;
    if (g.code) {
      try {
        sh.getRange(1, pos, 1, width).shiftColumnGroupDepth(1);
        var group = sh.getColumnGroup(pos, 1);
        if (group && cfg.mpOn.indexOf(g.code) < 0) group.collapse();   // выключенные площадки сворачиваем
      } catch (e) { logErr_('Группировка ' + g.title, String(e && e.message || e)); }
    }
    pos += width;
  });

  // ширины, форматы, подсветка, примечания
  var map = headerMap_(finalHdr);
  sh.setColumnWidth(1, 120);
  if (map['Название'] !== undefined) sh.setColumnWidth(map['Название'] + 1, 130);
  MPS.forEach(function (mp) {
    [mp.cab, mp.site].forEach(function (c) {
      if (c && map[c] !== undefined && lastRow > 1)
        sh.getRange(2, map[c] + 1, sh.getMaxRows() - 1, 1).setNumberFormat('#,##0.00');
    });
    if (mp.disc && map[mp.disc] !== undefined && lastRow > 1)
      sh.getRange(2, map[mp.disc] + 1, sh.getMaxRows() - 1, 1).setNumberFormat('0.0');
    if (mp.link && map[mp.link] !== undefined) sh.setColumnWidth(map[mp.link] + 1, 90);
  });
  var paint = { 'Разбег, %':'#fce8b2', 'Статус':'#fce8b2', 'Мин. цена, ₽':'#e6f4ea',
                'Макс. цена, ₽':'#fce4ec', 'Не сравнивать':'#f3f3f3' };
  for (var k in paint) if (map[k] !== undefined) sh.getRange(1, map[k] + 1).setBackground(paint[k]);
  if (map['Не сравнивать'] !== undefined)
    sh.getRange(2, map['Не сравнивать'] + 1, sh.getMaxRows() - 1, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  addHeaderNotes_(sh);

  Logger.log('Колонок было ' + lastCol + ', стало ' + finalHdr.length +
    '. Копия: ' + backup.getName() + (extra.length ? '. Сохранены вне плана: ' + extra.join(', ') : ''));
}

/** Удаляет пустой служебный лист Sheet1, если он действительно пуст. */
function removeEmptySheet1() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Sheet1');
  if (!sh) { Logger.log('Sheet1 не найден'); return; }
  if (sh.getLastRow() > 0 || sh.getLastColumn() > 0) { Logger.log('Sheet1 не пуст — не удаляю'); return; }
  ss.deleteSheet(sh);
  Logger.log('Пустой Sheet1 удалён');
}
