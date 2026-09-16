import argparse, csv, os, re, json, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Сюда складываются страницы, на которых цена не нашлась. Без этого разбор
# любого сбоя упирался в то, что от неудачной попытки не остаётся ничего:
# в логе просто None, и понять, была там заглушка, капча, редизайн или
# страница не успела отрисоваться, можно только повторив сбой вручную.
DEBUG_DIR = os.path.join(BASE_DIR, "debug")
DEBUG_KEEP_DAYS = 14
# Регион, в котором площадки показывали цены в прошлый раз. Лежит рядом с кодом,
# чтобы смена региона была заметна между запусками.
REGION_FILE = os.path.join(BASE_DIR, "region.json")
REGION_WARNINGS = []

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
# Профиль браузера ОБЯЗАТЕЛЬНО должен лежать в постоянной папке.
# Раньше он был в /tmp — macOS очистила её при перезагрузке, вместе с ней
# слетели все сессии (WB, Ozon Seller, Yandex Partner) и подтверждение 18+.
# Последствия были незаметными и потому опасными: кабинеты стали писать
# "сессия не авторизована", карточка Ozon стала отдавать заглушку 18+, а WB
# перестал показывать цену с Кошельком — но в таблице при этом продолжали
# висеть старые цены, выглядевшие правдоподобно. Не переносите в /tmp снова.
PROFILE_DIR = os.path.join(BASE_DIR, "chrome_profile")
CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CDP_PORT = 9333


def http_get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


def brand_site(url):
    # mistergentle.ru: current selling price is the FIRST "price" field in the
    # page's own JSON-LD Offer block (top-level "price", not "ListPrice").
    try:
        html = http_get(url)
        m = re.findall(r'"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?', html)
        for x in m:
            if float(x) >= 50:
                return float(x)
    except Exception:
        return None
    return None


def price_from_title(title):
    # Letu: "... купить по цене 4473₽ в ЛЭТУАЛЬ"
    m = re.search(r'(?:за|цене)\s+([\d\s\xa0]+)\s*₽', title)
    if not m:
        return None
    digits = re.sub(r'[\s\xa0]', '', m.group(1))
    return float(digits) if digits else None


def _normalize_spaces(txt):
    # Разные площадки используют разные "тонкие" юникодные пробелы как разделитель
    # разрядов (\xa0,  ,  ,   и т.п.), и набор может отличаться от
    # загрузки к загрузке (эксперименты/AB-тесты на стороне площадки) — поэтому
    # перечислять конкретные символы в классе регулярки ненадёжно (уже дважды
    # ловили баг, когда очередной незнакомый пробел обрубал число). Вместо этого
    # заменяем ЛЮБОЙ юникодный пробельный символ, КРОМЕ настоящего переноса строки,
    # на обычный пробел. Перенос строки (\n) специально НЕ трогаем — это граница,
    # которая должна останавливать регулярку и не даёт ей "перепрыгнуть" через
    # реальный разрыв между разными числами (например, "1/19" от галереи фото WB).
    return ''.join(' ' if (ch != '\n' and ch.isspace()) else ch for ch in txt)


def wb_price_from_text(txt):
    # WB карточка показывает 2-3 цены подряд: актуальная (красная, с WB Кошельком),
    # зачёркнутая обычная, зачёркнутая исходная. Нам нужна именно первая — она
    # и есть цена, которую видит покупатель по умолчанию.
    txt = _normalize_spaces(txt)
    m = re.search(r'(?m)^(\d[\d ]{2,8})\s*₽\s*$', txt)
    if not m:
        m = re.search(r'(\d[\d ]{2,8})\s*₽', txt)
    if not m:
        return None
    digits = re.sub(r' ', '', m.group(1))
    return float(digits) if digits.isdigit() else None


def wb_wallet_price_from_text(txt):
    # Цена с WB Кошельком (та, которую покупатель реально платит) показывается
    # только залогиненному пользователю и подписана словом "Кошелёк" рядом.
    # Если сессия слетела, WB отдаёт обычную цену — она примерно на 1% выше,
    # и раньше сборщик молча писал именно её (факт 3459 ₽ vs собрано 3494 ₽).
    # Поэтому ищем цену прицельно рядом со словом "Кошел", а не первую попавшуюся.
    txt = _normalize_spaces(txt)
    for m in re.finditer(r'Кошел', txt):
        window = txt[max(0, m.start() - 80):m.start()]
        prices = re.findall(r'(\d[\d ]{2,8})\s*₽', window)
        if prices:
            digits = re.sub(r' ', '', prices[-1])
            if digits.isdigit():
                return float(digits)
    return None


def wb_price_from_page(page):
    # Цену берём из блока ценника, а не из всего текста карточки. На WB это
    # контейнер с классом, содержащим priceBlock: внутри только цена покупателя,
    # зачёркнутая и цена для бизнеса — ничего постороннего. Раньше бралось
    # первое число с ₽ на всей странице, и рядом с ценой соседствовали
    # рассрочка, галерея фото «1/19» и блок похожих товаров.
    # Возвращает пару: цена и текст ценника (нужен для журнала).
    try:
        el = page.wait_for_selector('[class*=priceBlock]', timeout=20000)
    except Exception:
        return None, ''
    if not el:
        return None, ''
    block = el.inner_text()
    # У залогиненного пользователя WB первой показывает цену с Кошельком —
    # ту, что реально платит покупатель. Слова «Кошелёк» на странице нет,
    # поэтому берём первую; помеченную используем, если она вдруг найдётся.
    return (wb_wallet_price_from_text(block) or wb_price_from_text(block)), block


def ga_from_html(html):
    # Устаревший способ: Золотое Яблоко перестало заполнять микроразметку —
    # itemprop="price" теперь отдаёт "0". Оставлен как запасной вариант.
    m = re.findall(r'itemprop=["\']price["\'][^>]*content=["\']([0-9.]+)["\']', html)
    vals = [float(x) for x in m if float(x) >= 50]
    return min(vals) if vals else None


def ga_price_from_page(page):
    # Цену берём из блока предложения: на GoldApple это элемент с itemprop=offers,
    # внутри только действующая цена, зачёркнутая и размер скидки. Раньше бралось
    # первое число с ₽ во всём тексте страницы, где рядом лежат платежи в
    # рассрочку и блок сопутствующих товаров.
    # Возвращает пару: цена и текст ценника (нужен для журнала).
    try:
        el = page.wait_for_selector('[itemprop=offers]', timeout=20000)
    except Exception:
        return None, ''
    if not el:
        return None, ''
    block = el.inner_text()
    return ga_price_from_text(block), block


def ga_price_from_text(txt):
    # Актуальная цена — первая на странице; за ней идёт зачёркнутая старая
    # и сумма платежа в рассрочку (она меньше, поэтому min() брать нельзя).
    # Пример: "4 299 ₽ | 5 243 ₽ | со скидкой -18% при авторизации | от 1 074 ₽".
    txt = _normalize_spaces(txt)
    for x in re.findall(r'(\d[\d ]{2,8})\s*₽', txt):
        digits = re.sub(r' ', '', x)
        if digits.isdigit() and float(digits) >= 50:
            return float(digits)
    return None


def letu_price_from_page(page, url):
    # На Летуали цену берём из заголовка вкладки: "... купить по цене 4473₽
    # в ЛЭТУАЛЬ". Это самый узкий якорь из возможных — одно число, написанное
    # самим магазином. Из ценника на странице брать нельзя: там первой идёт
    # СТАРАЯ зачёркнутая цена ("8 698 ₽ −49% 4 473 ₽"), и правило "первое
    # число" дало бы завышенное значение.
    # Слабое место заголовка — он остаётся от предыдущей страницы, если переход
    # не состоялся: цена тогда будет чужой, но совершенно правдоподобной.
    # Поэтому сверяем адрес: оказались не на той странице — возвращаем пусто.
    title = page.title()
    if url.split('?')[0].rstrip('/') not in page.url:
        print(f"LETU: адрес после перехода не совпал с запрошенным ({page.url[:60]})",
              flush=True)
        return None, title
    return price_from_title(title), title


def ym_price_from_page(page):
    # Цену берём из блока ценника: на Яндексе это зона с именем price, внутри
    # неё только текущая цена, зачёркнутая и процент скидки. Раньше бралось
    # первое число с ₽ во всём тексте карточки, а там рядом лежат платежи по
    # рассрочке («12 × 327 ₽») и промокоды.
    # Возвращает пару: цена и текст ценника (нужен для журнала).
    try:
        el = page.wait_for_selector('[data-zone-name=price]', timeout=20000)
    except Exception:
        return None, ''
    if not el:
        return None, ''
    block = el.inner_text()
    return ym_price_from_text(block), block


def ym_price_from_text(txt):
    # Яндекс.Маркет разбивает цену на разряды тонким юникодным пробелом (символ
    # варьируется между загрузками), а сам знак ₽ часто оказывается на следующей
    # визуальной строке (реальный перенос строки внутри innerText между числом
    # и значком), например: "3 827\n ₽"
    # _normalize_spaces() приводит любой такой пробел к обычному " ", сохраняя
    # настоящие переносы строк как границу (см. её комментарий выше).
    txt = _normalize_spaces(txt)
    # Та же защита, что и для кабинета: 15.09 Яндекс выкатил страницы со
    # сломанной локализацией, где вместо ₽ стоял служебный ключ. Приводим его
    # обратно к знаку рубля, чтобы поломка на их стороне не обнуляла сбор.
    txt = re.sub(r'b2b-shared\.currency:\w+\.symbol', '₽', txt)
    m = re.findall(r'(\d[\d ]{2,8})\s*₽', txt)
    vals = []
    for x in m:
        digits = re.sub(r' ', '', x)
        if digits.isdigit():
            v = float(digits)
            if v >= 50:
                vals.append(v)
    return vals[0] if vals else None


YM_CAB_URL = "https://partner.market.yandex.ru/business/YOUR_BUSINESS_ID/prices?campaignId=YOUR_CAMPAIGN_ID"


def ym_cab_prices_from_text(txt):
    # Партнёрский кабинет Яндекс.Маркета: список товаров, у каждого строка вида
    # "<sku>•<категория>", а через несколько строк — "Ваша цена" и сама цена.
    # sku (например "lilu", "rose", "noir", "aqua", "duos", "mini") совпадает
    # с нашими названиями товаров в нижнем регистре — TEDY PINK там нет вообще
    # (у неё нет карточки на Яндексе, см. пустую "Yandex Ссылка" в tovary.csv).
    txt = _normalize_spaces(txt)
    # 15.09 Яндекс выкатил кабинет со сломанной локализацией: вместо знака ₽
    # на странице стоит служебный ключ вида "b2b-shared.currency:RUR.symbol".
    # Парсер искал цены по знаку рубля и перестал находить их вообще — все
    # шесть кабинетных цен превратились в пустые ячейки. Приводим ключ обратно
    # к ₽ перед разбором: когда Яндекс починит локализацию, код продолжит
    # работать, потому что обычный ₽ никуда не делся из остальных мест.
    txt = re.sub(r'b2b-shared\.currency:\w+\.symbol', '₽', txt)
    lines = [l.strip() for l in txt.split("\n")]
    out = {}
    n = len(lines)
    for i, line in enumerate(lines):
        m = re.match(r'^([a-zA-Z0-9_-]+)•', line)
        if not m:
            continue
        sku = m.group(1).lower()
        for j in range(i + 1, min(i + 8, n)):
            if lines[j] == 'Ваша цена':
                for k in range(j + 1, min(j + 3, n)):
                    pm = re.search(r'(\d[\d ]{2,8})\s*₽', lines[k])
                    if pm:
                        digits = re.sub(r' ', '', pm.group(1))
                        if digits.isdigit():
                            out[sku] = float(digits)
                break
    return out


def ozon_prices_for_offer(text, offer_id, all_offer_ids=()):
    # Таблица цен в личном кабинете продавца (seller.ozon.ru/app/prices/control).
    # ВАЖНО про смысл числа: блок «Цены» сейчас состоит из двух колонок —
    # «Предельная цена» и «Зачёркнутая цена». Колонок «Ваша цена» и «Цена для
    # покупателя» в этой таблице больше нет, Ozon её перестроил. Значит первое
    # число в строке товара — это предельная цена, то есть потолок, выше
    # которого портится индекс цен, а вовсе не цена продавца. Раньше код брал
    # его как «Вашу цену» и продолжал это делать после перестройки таблицы,
    # молча подменив смысл колонки.
    #
    # ВАЖНО про границы поиска: таблица виртуализированная, рисуются только
    # видимые строки. Ячейка с ценой нужного товара может быть ещё не
    # отрисована, и поиск «на двадцать строк вперёд» в этом случае забирал
    # число из строки СОСЕДНЕГО товара — так у MINI в таблице оказалось
    # 5050 ₽ при настоящих 5999 ₽. Теперь строку закрывает следующий артикул,
    # и если внутри неё числа нет, возвращается None: пустая ячейка честнее
    # чужой цены.
    lines = [l.strip() for l in text.split("\n")]
    try:
        idx = lines.index(offer_id)
    except ValueError:
        return None
    others = {o for o in all_offer_ids if o != offer_id}
    end = min(idx + 20, len(lines))
    for j in range(idx + 1, min(idx + 40, len(lines))):
        if lines[j] in others:
            end = j
            break
    for line in lines[idx + 1:end]:
        m = re.match(r'^([\d\s\xa0]{2,8})\s*₽$', line)
        if m:
            digits = re.sub(r'[\s\xa0]', '', m.group(1))
            if digits.isdigit():
                return float(digits)
    return None


def ozon_site_price_from_page(page):
    # Цену берём из блока ценника, а не из всего текста страницы. У Ozon это
    # устойчивый якорь data-widget="webPrice" — внутри него лежит только сам
    # ценник: текущая цена, цена с банками и зачёркнутая.
    #
    # Раньше цена искалась как первое число с ₽ во всём тексте карточки. Пока
    # ценник успевал отрисоваться, это работало; когда не успевал — парсер
    # хватал первое попавшееся число, чаще всего платёж по рассрочке. Так
    # 15.09 в таблицу попали 827 ₽ у ROSE и 814 ₽ у NOIR при настоящих
    # 3372 ₽ и 3541 ₽. Ошибка не выглядела ошибкой: число, рубли, правдоподобно.
    # Теперь ждём появления самого ценника, и если его нет — возвращаем пусто.
    # Возвращает пару: цена и текст самого ценника (нужен для журнала).
    try:
        el = page.wait_for_selector('[data-widget="webPrice"]', timeout=20000)
    except Exception:
        return None, ''
    if not el:
        return None, ''
    block = el.inner_text()
    return ozon_site_price_from_text(block), block


def ozon_site_price_from_text(txt):
    # Реальная цена для покупателя — берём с публичной карточки товара на
    # ozon.ru (та же логика, что для WB/Yandex: первая цена в тексте страницы,
    # с порогом >=50, чтобы не поймать баннеры вроде "Товары за 1₽").
    txt = _normalize_spaces(txt)
    m = re.findall(r'(\d[\d ]{2,8})\s*₽', txt)
    for x in m:
        digits = re.sub(r' ', '', x)
        if digits.isdigit():
            v = float(digits)
            if v >= 50:
                return v
    return None


def confirm_ozon_age(page, birthdate="01011990"):
    # Заглушка 18+ на карточках Ozon. Кликать мышью нельзя: поверх лежит баннер
    # кук и перехватывает клики (force-клик уводит на страницу политики).
    # Поэтому фокусируем настоящий <input> внутри маскированного поля через JS,
    # печатаем дату с клавиатуры (чтобы отработала маска) и жмём кнопку тоже
    # через JS — баннер кук при этом не трогаем.
    page.evaluate("""() => {
        const d = document.querySelector('[name=birthdate]');
        const inp = d && d.querySelector('input');
        if (inp) { inp.focus(); inp.click(); }
    }""")
    page.keyboard.type(birthdate, delay=80)
    page.wait_for_timeout(500)
    page.evaluate("""() => {
        const b = Array.from(document.querySelectorAll('button'))
            .find(x => (x.innerText || '').trim() === 'Подтвердить');
        if (b) b.click();
    }""")
    page.wait_for_timeout(6000)
    print("Ozon: подтвердил 18+", flush=True)


def load_products(csv_path=None):
    if csv_path is None:
        csv_path = os.path.join(BASE_DIR, 'tovary.csv')
    products = []
    with open(csv_path, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            name = (r.get('Название') or '').strip()
            if not name:
                continue
            products.append({
                'name': name,
                'wb_nm': (r.get('WB Артикул') or '').strip(),
                'brand_url': (r.get('Бренд-сайт Ссылка') or '').strip(),
                'ga_url': (r.get('GoldApple Ссылка') or '').strip(),
                'letu_url': (r.get('Letual Ссылка') or '').strip(),
                'ym_url': (r.get('Yandex Ссылка') or '').strip(),
                'ozon_url': (r.get('Ozon Ссылка') or '').strip(),
                'ozon_offer_id': name.lower().replace(' ', '-'),
            })
    return products


def small_corner_geometry():
    # маленькое окно в левом нижнем углу экрана, чтобы не мешало и его случайно
    # не задели курсором во время автоматического сбора цен
    w, h = 420, 300
    try:
        out = subprocess.run(
            ["osascript", "-e", 'tell application "Finder" to get bounds of window of desktop'],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        _, _, sw, sh = [int(x.strip()) for x in out.split(",")]
    except Exception:
        sw, sh = 1440, 900  # разумный запасной вариант, если не удалось узнать размер экрана
    x = 4
    y = max(sh - h - 90, 0)  # отступ снизу — чтобы не перекрывать Dock
    return w, h, x, y


def start_chrome_cdp():
    w, h, x, y = small_corner_geometry()
    proc = subprocess.Popen([
        CHROME_BIN,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={PROFILE_DIR}",
        "--no-first-run", "--no-default-browser-check",
        f"--window-size={w},{h}",
        f"--window-position={x},{y}",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(20):
        try:
            http_get(f"http://localhost:{CDP_PORT}/json/version", timeout=2)
            return proc
        except Exception:
            time.sleep(1)
    raise RuntimeError("Chrome CDP did not start")


def stop_chrome(proc):
    # закрываем окно после сбора, чтобы оно не висело на экране до следующего запуска
    try:
        proc.terminate()
        proc.wait(timeout=8)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def save_debug(page, tag, name):
    # Снимок страницы в момент неудачи: текст (то самое, что видел парсер)
    # и картинка (то, что видел бы человек). Ошибки тут глушим намеренно —
    # сбор важнее, чем отладочный файл, и падать из-за него нельзя.
    try:
        os.makedirs(DEBUG_DIR, exist_ok=True)
        safe = re.sub(r'[^\w]+', '-', name).strip('-')
        base = os.path.join(DEBUG_DIR, f"{time.strftime('%Y-%m-%d_%H%M')}_{tag}_{safe}")
        with open(base + '.txt', 'w', encoding='utf-8') as f:
            f.write(page.url + '\n\n' + page.inner_text('body'))
        page.screenshot(path=base + '.png')
        print(f"   -> страница сохранена для разбора: debug/{os.path.basename(base)}.txt/.png",
              flush=True)
    except Exception as e:
        print(f"   -> не удалось сохранить страницу для разбора: {e}", flush=True)


def journal(line):
    # Одна общая точка записи в дневной журнал debug/cenniki-ГГГГ-ММ-ДД.txt.
    try:
        os.makedirs(DEBUG_DIR, exist_ok=True)
        path = os.path.join(DEBUG_DIR, 'cenniki-%s.txt' % time.strftime('%Y-%m-%d'))
        with open(path, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception as e:
        print(f"   -> журнал недоступен: {e}", flush=True)


def region_from_body(tag, body):
    # Вытаскивает регион, в котором площадка показывает цены. Цены на
    # маркетплейсах региональные: 16.09 выяснилось, что сборщик ходил как
    # покупатель из Самары, а сверялись мы с московскими ценами — часть
    # расхождений была именно из-за этого, и поняли мы это далеко не сразу.
    # На Ozon и Яндексе пункт выдачи стоит в шапке отдельной строкой, сразу
    # после подписи «Пункт ...». У WB его в тексте страницы нет вовсе — там
    # он берётся селектором, см. grab_region в collect().
    lines = [l.strip() for l in (body or '')[:4000].split('\n') if l.strip()]
    for i, l in enumerate(lines):
        if 'Пункт' in l or 'Доставка в' in l:
            return (lines[i + 1] if i + 1 < len(lines) else l)[:60]
    return ''


def check_regions(regions):
    # Сверяем регион с прошлым запуском. Смысл не в том, чтобы знать «правильный»
    # регион — его задаёт человек, — а в том, чтобы смена региона не прошла тихо.
    # Сам по себе сдвиг ничего не ломает: цены просто начинают собираться из
    # другого города и выглядят совершенно нормально.
    warnings = []
    try:
        with open(REGION_FILE, encoding='utf-8') as f:
            old = json.load(f)
    except Exception:
        old = {}
    for tag, val in regions.items():
        if not val:
            continue
        journal('%s | РЕГИОН   | %-10s | %s' % (time.strftime('%H:%M'), tag, val))
        if tag in old and old[tag] != val:
            msg = f'{tag}: регион сменился — было «{old[tag]}», стало «{val}»'
            print('ВНИМАНИЕ, ' + msg, flush=True)
            warnings.append(msg)
    merged = dict(old)
    merged.update({k: v for k, v in regions.items() if v})
    try:
        with open(REGION_FILE, 'w', encoding='utf-8') as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Не удалось сохранить регион: {e}", flush=True)
    return warnings


def log_prices_seen(tag, name, value, txt):
    # Журнал ценников: что было на странице в момент сбора. Пишем по строке на
    # каждый товар и площадку, при каждом прогоне, а не только при неудаче.
    # Причина: 16.09 возник спор, была ли цена 4344 ₽ верной в 07:51. Ответить
    # было нечем — той страницы уже нет, а в логе только итоговое число. Теперь
    # рядом с ним лежит список всех цен, которые видел парсер, и по нему видно,
    # выбрал он правильную или схватил соседнюю. Текст весит копейки.
    try:
        seen = [s.strip() for s in
                re.findall(r'(\d[\d ]{2,9})\s*₽', _normalize_spaces(txt or ''))[:6]]
        journal('%s | %-8s | %-10s | взято: %-9s | на странице: %s' % (
            time.strftime('%H:%M'), tag, name, value, ', '.join(seen) or '—'))
    except Exception as e:
        print(f"   -> не удалось записать в журнал ценников: {e}", flush=True)


def cleanup_debug():
    # Папка иначе растёт бесконечно: каждый скриншот — сотни килобайт.
    try:
        limit = time.time() - DEBUG_KEEP_DAYS * 86400
        for f in os.listdir(DEBUG_DIR):
            p = os.path.join(DEBUG_DIR, f)
            if os.path.isfile(p) and os.path.getmtime(p) < limit:
                os.remove(p)
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"Очистка папки debug не удалась: {e}", flush=True)


def wb_check_auth(page):
    # Проверяет вход на WB по тому, что подделать нельзя: открываем личный
    # кабинет и смотрим, не перебросило ли нас на страницу входа id.wb.ru.
    # Прежняя проверка искала слово «Войти» в шапке карточки товара, но на
    # нынешнем WB его нет ни у гостя, ни у залогиненного — она всегда отвечала
    # «всё хорошо». Из-за этого разлогиненный профиль тихо отдавал цену без
    # Кошелька, примерно на 1% выше настоящей (LILU: 3755 ₽ вместо 3717 ₽),
    # и заметить это можно было только сравнив с сайтом вручную.
    # Возвращает True/False, либо None, если проверить не удалось.
    try:
        page.goto("https://www.wildberries.ru/lk", wait_until="load", timeout=45000)
        page.wait_for_timeout(6000)
        return "id.wb.ru" not in page.url
    except Exception as e:
        print(f"WB: проверить вход не удалось: {e}", flush=True)
        return None


def collect(only_products=None, only_sources=None):
    # only_products / only_sources — фильтры для быстрой проверки одной
    # площадки по одному товару вместо шестиминутного полного сбора.
    # Коды площадок: WB, BRAND, GA, LETU, YM, OZON, OZON_CAB, YM_CAB.
    products = load_products()
    # Полный список артикулов нужен всегда, даже когда сбор идёт по одному
    # товару: по нему определяются границы строк в таблице кабинета Ozon.
    all_offer_ids = {p['ozon_offer_id'] for p in products}
    if only_products:
        want = {s.strip().lower() for s in only_products}
        products = [p for p in products if p['name'].lower() in want]
        if not products:
            raise SystemExit('Ни один товар не подошёл под --product. Есть: '
                             + ', '.join(x['name'] for x in load_products()))
    want_src = {s.strip().upper() for s in only_sources} if only_sources else None

    def need(code):
        return want_src is None or code in want_src

    cleanup_debug()
    results = {}
    regions = {}

    for p in products:
        results[p['name']] = {
            'wb_site': None,
            'brand_site': brand_site(p['brand_url']) if p['brand_url'] and need('BRAND') else None,
            'ga_site': None,
            'letu_site': None,
            'yandex_site': None,
            'ozon_site': None,
            'ozon_cab': None,
            'yandex_cab': None,
        }

    chrome_proc = start_chrome_cdp()

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.connect_over_cdp(f"http://localhost:{CDP_PORT}")
            ctx = browser.contexts[0]
            page = ctx.new_page()

            # Chrome иногда восстанавливает размер/положение окна из прошлого сеанса
            # (профиль постоянный) и игнорирует --window-position при старте — поэтому
            # дополнительно принудительно выставляем маленькое окно в углу через CDP.
            try:
                w, h, x, y = small_corner_geometry()
                cdp = ctx.new_cdp_session(page)
                win = cdp.send("Browser.getWindowForTarget")
                cdp.send("Browser.setWindowBounds", {
                    "windowId": win["windowId"],
                    "bounds": {"left": x, "top": y, "width": w, "height": h, "windowState": "normal"},
                })
            except Exception:
                pass

            def goto_title_price(url, wait_ms=8000, retries=2):
                for _ in range(retries):
                    try:
                        page.goto(url, wait_until="load", timeout=45000)
                        page.wait_for_timeout(wait_ms)
                        price = price_from_title(page.title())
                        if price:
                            return price
                    except Exception:
                        pass
                return None

            def grab_region(tag):
                # Регион снимаем с первой же открытой карточки площадки —
                # отдельных заходов на главную ради этого не делаем.
                if tag in regions:
                    return
                try:
                    if tag == 'WB':
                        # У WB адреса нет в тексте страницы (весь текст карточки
                        # ~2 кБ), он живёт в отдельном элементе блока доставки.
                        el = page.query_selector('[class*=address], [class*=Address]')
                        regions[tag] = ' '.join(el.inner_text().split())[:60] if el else ''
                    else:
                        regions[tag] = region_from_body(tag, page.inner_text("body"))
                except Exception:
                    pass

            if need('WB') and any(p['wb_nm'] for p in products):
                if wb_check_auth(page) is False:
                    print("WB: ВНИМАНИЕ, профиль разлогинен — цены будут без Кошелька, "
                          "примерно на 1% выше настоящих. Войдите один раз: "
                          "cd ~/mg-monitor-local && bash open_profile.sh", flush=True)

            for p in products:
                if p['wb_nm'] and need('WB'):
                    url = f"https://www.wildberries.ru/catalog/{p['wb_nm']}/detail.aspx"
                    # Одной попытки мало. Первая карточка за запуск грузится
                    # "на холодную" — Chrome только что стартовал, и цена не
                    # успевает отрисоваться за фиксированные 7 секунд: в тексте
                    # страницы нет ни одного числа с ₽, парсер возвращает None,
                    # а ячейка в таблице очищается как "не собрано" (так 13.09
                    # потерялась цена LILU — первого товара в списке, при том
                    # что остальные шесть на прогретом браузере собрались).
                    # Поэтому пробуем несколько раз, с каждым разом дольше.
                    wb_val, wb_body = None, ''
                    for attempt, wait_ms in enumerate((7000, 12000, 18000), 1):
                        try:
                            page.goto(url, wait_until="load", timeout=45000)
                            page.wait_for_timeout(wait_ms)
                            wb_val, wb_body = wb_price_from_page(page)
                        except Exception as e:
                            print(f"WB {p['name']}: попытка {attempt} — ОШИБКА {e}", flush=True)
                            continue
                        if wb_val:
                            if attempt > 1:
                                print(f"WB {p['name']}: получилось с попытки {attempt}", flush=True)
                            break
                        print(f"WB {p['name']}: попытка {attempt} — цены на странице нет", flush=True)
                    results[p['name']]['wb_site'] = wb_val
                    print(f"WB {p['name']}: {wb_val}", flush=True)
                    log_prices_seen('WB', p['name'], wb_val, wb_body)
                    grab_region('WB')
                    if not wb_val:
                        save_debug(page, 'WB', p['name'])

                if p['ga_url'] and need('GA'):
                    try:
                        page.goto(p['ga_url'], wait_until="domcontentloaded", timeout=45000)
                        page.wait_for_timeout(6000)
                        ga_val, ga_body = ga_price_from_page(page)
                        results[p['name']]['ga_site'] = ga_val
                        print(f"GA {p['name']}: {ga_val}", flush=True)
                        log_prices_seen('GA', p['name'], ga_val, ga_body)
                        if not ga_val:
                            save_debug(page, 'GA', p['name'])
                    except Exception as e:
                        print(f"GA {p['name']}: ОШИБКА {e}", flush=True)

                if p['letu_url'] and need('LETU'):
                    # Две попытки, как на WB: на холодной странице заголовок
                    # может ещё не смениться на нужный товар.
                    letu_val, letu_title = None, ''
                    for wait_ms in (9000, 14000):
                        try:
                            page.goto(p['letu_url'], wait_until="load", timeout=45000)
                            page.wait_for_timeout(wait_ms)
                        except Exception as e:
                            print(f"LETU {p['name']}: ОШИБКА {e}", flush=True)
                            continue
                        letu_val, letu_title = letu_price_from_page(page, p['letu_url'])
                        if letu_val:
                            break
                    results[p['name']]['letu_site'] = letu_val
                    print(f"LETU {p['name']}: {letu_val}", flush=True)
                    log_prices_seen('LETU', p['name'], letu_val, letu_title)
                    if not letu_val:
                        save_debug(page, 'LETU', p['name'])

                if p['ym_url'] and need('YM'):
                    try:
                        page.goto(p['ym_url'], wait_until="load", timeout=45000)
                        page.wait_for_timeout(3000)
                        btn = page.get_by_role("button", name="Уже есть")
                        if btn.count() > 0:
                            btn.first.click(timeout=5000)
                            page.wait_for_timeout(6000)
                        else:
                            page.wait_for_timeout(3000)
                        ym_val, ym_body = ym_price_from_page(page)
                        results[p['name']]['yandex_site'] = ym_val
                        print(f"YM {p['name']}: {ym_val}", flush=True)
                        log_prices_seen('YM', p['name'], ym_val, ym_body)
                        grab_region('YM')
                        if not ym_val:
                            save_debug(page, 'YM', p['name'])
                    except Exception as e:
                        print(f"YM {p['name']}: ОШИБКА {e}", flush=True)

                if p['ozon_url'] and need('OZON'):
                    # Публичная карточка товара — надёжнее, чем поле "Цена для
                    # покупателя" в кабинете продавца: выяснилось, что кабинет
                    # может отставать от реальной цены на сайте (Ozon добавляет
                    # свои промо поверх цены продавца), см. чат — TEDY PINK:
                    # кабинет 1916₽, а на самой карточке реально 2183₽.
                    ozon_ok = False
                    for _ in range(3):
                        try:
                            page.goto(p['ozon_url'], wait_until="load", timeout=45000)
                            ozon_ok = True
                            break
                        except Exception:
                            page.wait_for_timeout(3000)
                    if ozon_ok:
                        page.wait_for_timeout(6000)
                        # Ozon показывает заглушку "Подтвердите возраст" (18+), пока
                        # в профиле нет соответствующей куки. На заглушке нет ни цен,
                        # ни описания — страница весит ~500 символов, и парсер молча
                        # возвращал None. Подтверждаем возраст один раз и продолжаем.
                        try:
                            if "Подтвердите возраст" in page.inner_text("body"):
                                confirm_ozon_age(page)
                        except Exception as e:
                            print("Ozon: не удалось пройти заглушку 18+:", e, flush=True)
                        oz_val, oz_block = ozon_site_price_from_page(page)
                        results[p['name']]['ozon_site'] = oz_val
                        print(f"Ozon сайт {p['name']}: {oz_val}", flush=True)
                        log_prices_seen('OZON', p['name'], oz_val, oz_block)
                        grab_region('OZON')
                        if not oz_val:
                            save_debug(page, 'OZON', p['name'])
                    else:
                        print(f"Ozon сайт {p['name']}: не удалось открыть страницу", flush=True)

            if need('OZON_CAB'):
                try:
                    page.goto("https://seller.ozon.ru/app/prices/control", wait_until="load", timeout=45000)
                    page.wait_for_timeout(6000)
                    # table is virtualized (only visible rows render) - scroll through it first.
                    # окно маленькое (в углу экрана), видимая область меньше обычной, поэтому
                    # шаг мельче и итераций больше, чтобы не проскочить мимо строк товаров
                    for _ in range(20):
                        page.mouse.wheel(0, 300)
                        page.wait_for_timeout(500)
                    page.wait_for_timeout(1500)
                    ozon_text = page.inner_text("body")
                    if "Вход и регистрация" not in ozon_text:
                        found = 0
                        for p in products:
                            cab = ozon_prices_for_offer(ozon_text, p['ozon_offer_id'], all_offer_ids)
                            results[p['name']]['ozon_cab'] = cab
                            if cab:
                                found += 1
                        print(f"Ozon Кабинет: цены нашлись у {found} из {len(products)}", flush=True)
                        # Таблица виртуализированная — рисуются только видимые строки.
                        # Если прокрутка не дотянулась до нужных, часть товаров молча
                        # остаётся без цены (так и было 11.09 у LILU, ROSE и AQUA).
                        # Сохраняем страницу, чтобы было видно, докуда реально доскроллило.
                        if found < len(products):
                            save_debug(page, 'OZON_CAB', 'kabinet')
                    else:
                        print("Ozon: сессия не авторизована, пропускаю", flush=True)
                        save_debug(page, 'OZON_CAB', 'net-avtorizacii')
                except Exception as e:
                    print("Ozon: ошибка сбора:", e, flush=True)

            if need('YM_CAB'):
                try:
                    ym_cab_ok = False
                    for _ in range(4):
                        try:
                            page.goto(YM_CAB_URL, wait_until="load", timeout=45000)
                            ym_cab_ok = True
                            break
                        except Exception:
                            page.wait_for_timeout(4000)
                    if ym_cab_ok:
                        page.wait_for_timeout(6000)
                        ym_text = page.inner_text("body")
                        if "Войдите" in ym_text or "Авторизация" in page.title():
                            print("Yandex Кабинет: сессия не авторизована, пропускаю", flush=True)
                            save_debug(page, 'YM_CAB', 'net-avtorizacii')
                        else:
                            cab_by_sku = ym_cab_prices_from_text(ym_text)
                            for p in products:
                                sku = p['name'].lower().replace(' ', '')
                                v = cab_by_sku.get(sku) or cab_by_sku.get(p['name'].lower())
                                results[p['name']]['yandex_cab'] = v
                            print("Yandex Кабинет:", cab_by_sku, flush=True)
                            if not cab_by_sku:
                                save_debug(page, 'YM_CAB', 'pusto')
                    else:
                        print("Yandex Кабинет: не удалось открыть страницу", flush=True)
                except Exception as e:
                    print("Yandex Кабинет: ошибка сбора:", e, flush=True)

            global REGION_WARNINGS
            REGION_WARNINGS = check_regions(regions)

            ctx.close()
    finally:
        # закрываем Chrome в любом случае — и при успехе, и при сбое посреди сбора,
        # чтобы окно не висело на экране до следующего запуска
        stop_chrome(chrome_proc)

    return results


if __name__ == '__main__':
    ap = argparse.ArgumentParser(
        description='Сбор витринных цен. Без аргументов собирает всё; с фильтрами — '
                    'быстрая проверка одной площадки или одного товара, в таблицу '
                    'при этом ничего не пишется (для записи используйте run_daily.py).')
    ap.add_argument('--product', help='Товар или несколько через запятую, например: LILU')
    ap.add_argument('--source', help='Площадки через запятую: WB, BRAND, GA, LETU, YM, '
                                     'OZON, OZON_CAB, YM_CAB')
    args = ap.parse_args()
    only_products = args.product.split(',') if args.product else None
    only_sources = args.source.split(',') if args.source else None

    res = collect(only_products=only_products, only_sources=only_sources)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    # Полный результат сохраняем как есть; частичный — отдельным файлом, чтобы
    # проверочный прогон по одному товару не затирал последний полный сбор.
    out = 'collector_result.json' if not (only_products or only_sources) else 'collector_partial.json'
    with open(os.path.join(BASE_DIR, out), 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, indent=2)
