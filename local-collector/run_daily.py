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


def main():
    token = get_access_token()

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

    log('Запускаю облачный анализ (Летуаль и остальное + статусы + история)')
    r2 = call_appscript(token, {'secret': SECRET, 'action': 'run_analysis'}, timeout=180)
    log(f'Ответ анализа: {r2}')

    log('Пересобираю дашборд')
    r3 = call_appscript(token, {'secret': SECRET, 'action': 'rebuild_dashboard'}, timeout=180)
    log(f'Ответ дашборда: {r3}')

    with open(STATE_FILE, 'w') as f:
        f.write(date.today().isoformat())
    log('Готово, отметка о запуске сохранена: ' + date.today().isoformat())


if __name__ == '__main__':
    main()
