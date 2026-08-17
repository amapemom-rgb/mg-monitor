import csv, os, re, json, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
# ВНИМАНИЕ: профиль браузера сознательно оставлен в /tmp — здесь уже сохранены
# рабочие логины (Ozon Seller, Yandex ID/Partner Market, подтверждение 18+).
# Правда в том, что /tmp может быть очищен macOS между перезагрузками — тогда
# логины слетят и понадобится один раз войти заново вручную (см. README,
# раздел "Известные ошибки и меры предосторожности"). Если хотите более
# надёжное решение, перенесите PROFILE_DIR в постоянную папку и войдите заново.
PROFILE_DIR = "/tmp/mg_chrome_profile"
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
    # разрядов (\xa0 и т.п.), и набор может отличаться от
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


def ga_from_html(html):
    m = re.findall(r'itemprop=["\']price["\'][^>]*content=["\']([0-9.]+)["\']', html)
    vals = [float(x) for x in m if float(x) >= 50]
    return min(vals) if vals else None


def ym_price_from_text(txt):
    # Яндекс.Маркет разбивает цену на разряды тонким юникодным пробелом (символ
    # варьируется между загрузками), а сам знак ₽ часто оказывается на следующей
    # визуальной строке (реальный перенос строки внутри innerText между числом
    # и значком), например: "3 827\n ₽"
    # _normalize_spaces() приводит любой такой пробел к обычному " ", сохраняя
    # настоящие переносы строк как границу (см. её комментарий выше).
    txt = _normalize_spaces(txt)
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
    # sku — это ваш offer_id/артикул в нижнем регистре, сопоставленный с
    # названиями товаров в tovary.csv.
    txt = _normalize_spaces(txt)
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


def ozon_prices_for_offer(text, offer_id):
    # Таблица в личном кабинете продавца (seller.ozon.ru/app/prices/control).
    # Порядок цен после названия/артикула товара:
    # [0] "Ваша цена" (кабинет) -> Ozon Кабинет
    # [1] "Цена до скидки" (зачёркнутая, не используем)
    # [2] "Цена для покупателя" — раньше считали, что это и есть цена на сайте,
    #     но выяснилось, что это поле в кабинете может отставать от реальной
    #     цены на публичной карточке товара (Ozon добавляет свои промо/скидки
    #     поверх цены продавца) — см. README, раздел "Известные ошибки".
    #     Поэтому этот индекс больше НЕ используем для Ozon Сайт — только для
    #     Ozon Кабинет.
    lines = text.split("\n")
    try:
        idx = lines.index(offer_id)
    except ValueError:
        return None
    prices = []
    for line in lines[idx + 1:idx + 20]:
        m = re.match(r'^([\d\s\xa0]{2,8})\s*₽$', line.strip())
        if m:
            digits = re.sub(r'[\s\xa0]', '', m.group(1))
            if digits.isdigit():
                prices.append(float(digits))
        if len(prices) >= 3:
            break
    if len(prices) >= 1:
        return prices[0]  # кабинет
    return None


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


def collect():
    products = load_products()
    results = {}

    for p in products:
        results[p['name']] = {
            'wb_site': None,
            'brand_site': brand_site(p['brand_url']) if p['brand_url'] else None,
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

            for p in products:
                if p['wb_nm']:
                    url = f"https://www.wildberries.ru/catalog/{p['wb_nm']}/detail.aspx"
                    try:
                        page.goto(url, wait_until="load", timeout=45000)
                        page.wait_for_timeout(7000)
                        wb_val = wb_price_from_text(page.inner_text("body"))
                        results[p['name']]['wb_site'] = wb_val
                        print(f"WB {p['name']}: {wb_val}", flush=True)
                    except Exception as e:
                        print(f"WB {p['name']}: ОШИБКА {e}", flush=True)

                if p['ga_url']:
                    try:
                        page.goto(p['ga_url'], wait_until="domcontentloaded", timeout=45000)
                        page.wait_for_timeout(6000)
                        results[p['name']]['ga_site'] = ga_from_html(page.content())
                    except Exception:
                        pass

                if p['letu_url']:
                    results[p['name']]['letu_site'] = goto_title_price(p['letu_url'], wait_ms=9000)

                if p['ym_url']:
                    try:
                        page.goto(p['ym_url'], wait_until="load", timeout=45000)
                        page.wait_for_timeout(3000)
                        btn = page.get_by_role("button", name="Уже есть")
                        if btn.count() > 0:
                            btn.first.click(timeout=5000)
                            page.wait_for_timeout(6000)
                        else:
                            page.wait_for_timeout(3000)
                        ym_val = ym_price_from_text(page.inner_text("body"))
                        results[p['name']]['yandex_site'] = ym_val
                        print(f"YM {p['name']}: {ym_val}", flush=True)
                    except Exception as e:
                        print(f"YM {p['name']}: ОШИБКА {e}", flush=True)

                if p['ozon_url']:
                    # Публичная карточка товара — надёжнее, чем поле "Цена для
                    # покупателя" в кабинете продавца: выяснилось, что кабинет
                    # может отставать от реальной цены на сайте (Ozon добавляет
                    # свои промо поверх цены продавца), см. README.
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
                        oz_val = ozon_site_price_from_text(page.inner_text("body"))
                        results[p['name']]['ozon_site'] = oz_val
                        print(f"Ozon сайт {p['name']}: {oz_val}", flush=True)
                    else:
                        print(f"Ozon сайт {p['name']}: не удалось открыть страницу", flush=True)

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
                    for p in products:
                        cab = ozon_prices_for_offer(ozon_text, p['ozon_offer_id'])
                        results[p['name']]['ozon_cab'] = cab
                else:
                    print("Ozon: сессия не авторизована, пропускаю", flush=True)
            except Exception as e:
                print("Ozon: ошибка сбора:", e, flush=True)

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
                    else:
                        cab_by_sku = ym_cab_prices_from_text(ym_text)
                        for p in products:
                            sku = p['name'].lower().replace(' ', '')
                            v = cab_by_sku.get(sku) or cab_by_sku.get(p['name'].lower())
                            results[p['name']]['yandex_cab'] = v
                        print("Yandex Кабинет:", cab_by_sku, flush=True)
                else:
                    print("Yandex Кабинет: не удалось открыть страницу", flush=True)
            except Exception as e:
                print("Yandex Кабинет: ошибка сбора:", e, flush=True)

            ctx.close()
    finally:
        # закрываем Chrome в любом случае — и при успехе, и при сбое посреди сбора,
        # чтобы окно не висело на экране до следующего запуска
        stop_chrome(chrome_proc)

    return results


if __name__ == '__main__':
    res = collect()
    print(json.dumps(res, ensure_ascii=False, indent=2))
    with open(os.path.join(BASE_DIR, 'collector_result.json'), 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, indent=2)
