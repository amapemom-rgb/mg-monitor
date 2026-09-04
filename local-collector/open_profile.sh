#!/bin/bash
# Открывает ИМЕННО ТОТ профиль Chrome, которым пользуется сборщик цен.
# Нужен, чтобы один раз войти на площадки — дальше сборщик работает сам.
#
# Что сделать в открывшемся окне (по одному разу):
#   1. wildberries.ru       — войти, чтобы показывалась цена с WB Кошельком
#   2. ozon.ru              — подтвердить 18+ и выбрать нужный город доставки
#   3. seller.ozon.ru       — войти в кабинет продавца
#   4. partner.market.yandex.ru — войти в кабинет Яндекс.Маркета
# Потом просто закрыть окно. Логины сохранятся в профиле.
#
# ВАЖНО: закройте это окно перед запуском сбора — Chrome не запускает
# два процесса на одном профиле одновременно.

PROFILE_DIR="/Users/YOUR_USERNAME/mg-monitor-local/chrome_profile"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

"$CHROME_BIN" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run --no-default-browser-check \
  --window-size=1280,900 \
  "https://www.wildberries.ru/" \
  "https://www.ozon.ru/" \
  "https://seller.ozon.ru/app/prices/control" \
  "https://partner.market.yandex.ru/"
