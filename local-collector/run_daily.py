#!/usr/bin/env python3
"""
MG-MONITOR: ежедневный локальный сбор + запись в Google-таблицу.
1. Собирает витринные цены (WB, Бренд-сайт, GoldApple, Letu, Yandex, Ozon)
2. Пишет их в лист "Товары" через веб-приложение PriceWriter
3. Запускает облачный анализ (runSpreadSafe) — досчитывает Летуаль/прочие площадки,
   статусы и историю
4. Пересобирает дашборд
5. Отмечает успешный запуск в файле состояния (для догона пропущенных запусков)
"""
import csv
import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import date, datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)
import collector  # BASE_DIR/collector.py (постоянная папка, не /tmp — см. README)

try:
    from config import EXEC_URL, SECRET  # BASE_DIR/config.py, не в git (см. config.example.py)
except ImportError:
    raise SystemExit(
        'Не найден config.py. Скопируйте config.example.py в config.py и '
        'заполните EXEC_URL/SECRET (см. README, раздел "Быстрый старт").'
    )

CLASPRC = os.path.expanduser('~/.clasprc.json')
STATE_FILE = os.path.join(BASE_DIR, 'last_run.txt')
LOG_FILE = os.path.join(BASE_DIR, 'run.log')
PRODUCTS_CSV = os.path.join(BASE_DIR, 'tovary.csv')

# Какой колонке в tovary.csv соответствует каждая площадка. Нужно, чтобы
# отличать настоящий сбой от "товара там просто нет": у TEDY PINK нет карточки
# на Яндекс Маркете, у MINI — на GoldApple и Летуали. Ссылка пустая, собирать
# нечего, и в отчёт о несобранном это попадать не должно — иначе живая ошибка
# теряется среди строк, которые будут повторяться каждый день вечно.
MISSING_SOURCE_COL = {
    'WB Сайт': 'WB Артикул',
    'Бренд-сайт Цена': 'Бренд-сайт Ссылка',
    'GoldApple Сайт': 'GoldApple Ссылка',
    'Letual Сайт': 'Letual Ссылка',
    'Yandex Сайт': 'Yandex Ссылка',
    'Yandex Кабинет': 'Yandex Ссылка',
    'Ozon Сайт': 'Ozon Ссылка',
    'Ozon Кабинет': 'Ozon Ссылка',
}


def filter_real_misses(miss):
    """Оставляет только то, что действительно не собралось: ссылка есть, а цены нет."""
    try:
        with open(PRODUCTS_CSV, newline='', encoding='utf-8') as f:
            by_name = {(r.get('Название') or '').strip(): r for r in csv.DictReader(f)}
    except OSError:
        return miss  # не смогли прочитать список — лучше показать всё, чем скрыть лишнее
    out = []
    for item in miss:
        name, _, cols = item.partition(':')
        name = name.strip()
        row = by_name.get(name)
        real = []
        for c in [c.strip() for c in cols.split(',') if c.strip()]:
            src = MISSING_SOURCE_COL.get(c)
            if src and row is not None and not str(row.get(src) or '').strip():
                continue
            real.append(c)
        if real:
            out.append(f'{name}: {", ".join(real)}')
    return out


MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
             'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

# Те же соответствия, что и выше, но для ключей, которыми оперирует сборщик.
# Нужны, чтобы считать «собрано X из Y», где Y — только те цены, которые
# в принципе могли собраться: у товара заполнена ссылка на площадку.
FIELD_SOURCE_COL = {
    'wb_site': 'WB Артикул',
    'brand_site': 'Бренд-сайт Ссылка',
    'ga_site': 'GoldApple Ссылка',
    'letu_site': 'Letual Ссылка',
    'yandex_site': 'Yandex Ссылка',
    'yandex_cab': 'Yandex Ссылка',
    'ozon_site': 'Ozon Ссылка',
    'ozon_cab': 'Ozon Ссылка',
}


def count_prices(results):
    try:
        with open(PRODUCTS_CSV, newline='', encoding='utf-8') as f:
            by_name = {(r.get('Название') or '').strip(): r for r in csv.DictReader(f)}
    except OSError:
        return None, None
    got = expected = 0
    for name, vals in results.items():
        row = by_name.get(name) or {}
        for key, src in FIELD_SOURCE_COL.items():
            if not str(row.get(src) or '').strip():
                continue
            expected += 1
            if vals.get(key) is not None:
                got += 1
    return got, expected


def build_summary(results, miss, seconds, jumps=(), regions=()):
    now = datetime.now()
    head = f'MG-MONITOR · {now.day} {MONTHS_RU[now.month - 1]}'
    mins = round(seconds / 60)
    dur = 'меньше минуты' if mins < 1 else f'{mins} мин'
    got, expected = count_prices(results)
    line = f'Собрано {got} из {expected} цен · {dur}' if expected else f'Сбор завершён · {dur}'
    text = f'{head}\n{line}'
    if miss:
        # Двоеточие из отчёта апскрипта меняем на тире: в сообщении это список,
        # а не пары «ключ: значение», и тире читается спокойнее.
        rows = '\n'.join(m.replace(':', ' —', 1) for m in miss)
        text += f'\n\nНе собрано:\n{rows}'
    if jumps:
        # Отдельным блоком и ниже несобранного: это не отказ, а повод взглянуть.
        rows = '\n'.join(j.replace(':', ' —', 1) for j in jumps)
        text += f'\n\nЦена изменилась резко:\n{rows}'
    if regions:
        # Ставим первым по важности после заголовка не получится — блок идёт
        # последним, но смена региона означает, что все цифры выше собраны
        # в другом городе, поэтому формулировка прямая.
        text += '\n\nВНИМАНИЕ, сменился регион:\n' + '\n'.join(regions)
    return text


def send_summary(token, text):
    # Сводка не должна ронять сбор: если Telegram недоступен, просто пишем в лог.
    try:
        r = call_appscript(token, {'secret': SECRET, 'action': 'notify', 'text': text}, timeout=60)
        if not r.get('ok'):
            log(f'Сводку в Telegram отправить не удалось: {r}')
    except Exception as e:
        log(f'Сводку в Telegram отправить не удалось: {e}')


def log(msg):
    line = f'[{datetime.now().isoformat(timespec="seconds")}] {msg}'
    print(line, flush=True)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')


def get_access_token():
    with open(CLASPRC) as f:
        d = json.load(f)
    t = d['tokens']['default']
    data = urllib.parse.urlencode({
        'client_id': t['client_id'],
        'client_secret': t['client_secret'],
        'refresh_token': t['refresh_token'],
        'grant_type': 'refresh_token',
    }).encode()
    req = urllib.request.Request('https://oauth2.googleapis.com/token', data=data, method='POST')
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)['access_token']


def call_appscript(token, payload, timeout=120):
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(EXEC_URL, data=body, method='POST',
                                  headers={'Authorization': f'Bearer {token}',
                                           'Content-Type': 'application/json'})

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **kw):
            return None

    opener = urllib.request.build_opener(NoRedirect)
    try:
        resp = opener.open(req, timeout=timeout)
        return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303):
            loc = e.headers.get('Location')
            with urllib.request.urlopen(loc, timeout=timeout) as r2:
                return json.loads(r2.read().decode('utf-8'))
        raise


def export_products_csv(token):
    # Регенерируем tovary.csv из листа "Товары" перед каждым запуском — так
    # список товаров/ссылок всегда синхронизирован с таблицей, а сам файл
    # живёт в постоянной папке (не в /tmp, который macOS может очистить
    # между перезагрузками).
    r = call_appscript(token, {'secret': SECRET, 'action': 'export_products'}, timeout=60)
    if not r.get('ok'):
        raise RuntimeError(f'export_products не удался: {r}')
    cols = ['Название', 'WB Артикул', 'Бренд-сайт Ссылка', 'GoldApple Ссылка',
            'Letual Ссылка', 'Yandex Ссылка', 'Ozon Ссылка']
    with open(PRODUCTS_CSV, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for row in r['rows']:
            w.writerow({c: row.get(c, '') for c in cols})
    log(f'tovary.csv обновлён: {len(r["rows"])} товаров')


def log_run_row(token, results, miss, seconds, status='ок'):
    # Строка в лист «Диагностика». Как и сводка, это необязательная часть:
    # если записать не удалось, сбор уже сделан и ронять его из-за отчёта нельзя.
    now = datetime.now()
    got, expected = count_prices(results) if results else (0, 0)
    row = {
        'date': now.strftime('%d.%m.%Y'),
        'time': now.strftime('%H:%M'),
        'minutes': round(seconds / 60),
        'got': got or 0,
        'expected': expected or 0,
        'missing': '; '.join(miss) if miss else '',
        'status': status,
    }
    try:
        r = call_appscript(token, {'secret': SECRET, 'action': 'log_run', 'row': row}, timeout=60)
        if not r.get('ok'):
            log(f'Строку в «Диагностику» записать не удалось: {r}')
    except Exception as e:
        log(f'Строку в «Диагностику» записать не удалось: {e}')


def main():
    started = datetime.now()
    token = get_access_token()
    try:
        run_once(token, started)
    except Exception as e:
        # Прогон упал на полпути — всё равно оставляем след и в «Диагностике»,
        # и в Telegram. Иначе день молча выпадает из истории, как 12 сентября,
        # и заметить пропажу можно только случайно, открыв таблицу.
        secs = (datetime.now() - started).total_seconds()
        log_run_row(token, {}, [str(e)[:300]], secs, status='сбой')
        now = datetime.now()
        send_summary(token, f'MG-MONITOR · {now.day} {MONTHS_RU[now.month - 1]}\n'
                            f'Сбор не выполнен\n{str(e)[:300]}')
        raise


def run_once(token, started):

    log('Обновляю список товаров (tovary.csv) из таблицы')
    export_products_csv(token)

    log('Старт сбора витринных цен')
    try:
        results = collector.collect()
    except Exception as e:
        log(f'ОШИБКА сбора: {e}')
        raise
    log(f'Собрано {len(results)} товаров: {list(results.keys())}')

    updates = []
    for name, vals in results.items():
        upd = {'name': name}
        upd.update(vals)
        updates.append(upd)

    log('Пишу цены в лист "Товары"')
    r1 = call_appscript(token, {'secret': SECRET, 'updates': updates})
    log(f'Ответ записи: {r1}')

    # Явно и громко сообщаем, какие цены собрать не удалось. Раньше такие
    # случаи были не видны вообще: ячейка просто сохраняла вчерашнее значение.
    try:
        miss = (r1.get('result') or {}).get('missing') or []
    except AttributeError:
        miss = []
    miss = filter_real_misses(miss)
    if miss:
        log('ВНИМАНИЕ, не собрано (ячейки очищены): ' + '; '.join(miss))

    try:
        jumps = (r1.get('result') or {}).get('jumps') or []
    except AttributeError:
        jumps = []
    if jumps:
        log('ВНИМАНИЕ, цена изменилась резко: ' + '; '.join(jumps))

    log('Запускаю облачный анализ (Летуаль и остальное + статусы + история)')
    r2 = call_appscript(token, {'secret': SECRET, 'action': 'run_analysis'}, timeout=180)
    log(f'Ответ анализа: {r2}')

    log('Пересобираю дашборд')
    r3 = call_appscript(token, {'secret': SECRET, 'action': 'rebuild_dashboard'}, timeout=180)
    log(f'Ответ дашборда: {r3}')

    with open(STATE_FILE, 'w') as f:
        f.write(date.today().isoformat())
    log('Готово, отметка о запуске сохранена: ' + date.today().isoformat())

    region_warns = list(getattr(collector, 'REGION_WARNINGS', []) or [])
    if region_warns:
        log('ВНИМАНИЕ, сменился регион: ' + '; '.join(region_warns))

    summary = build_summary(results, miss, (datetime.now() - started).total_seconds(),
                            jumps, region_warns)
    log('Сводка в Telegram:\n' + summary)
    send_summary(token, summary)
    log_run_row(token, results, miss, (datetime.now() - started).total_seconds())


if __name__ == '__main__':
    main()
