#!/bin/bash
# Обёртка для launchd: запускает сбор цен MG-MONITOR раз в день,
# с "догоном" — если сегодняшний запуск ещё не выполнялся (например,
# Мак был выключен/закрыт в 12:00), выполняет его немедленно при следующем
# старте launchd-агента (при логине/пробуждении Мака).

STATE_FILE="/Users/YOUR_USERNAME/mg-monitor-local/last_run.txt"
LOG_FILE="/Users/YOUR_USERNAME/mg-monitor-local/wrapper.log"
NET_CHECK_URL="https://oauth2.googleapis.com/"
NET_TRIES=20          # 20 попыток по 30 секунд — ждём сеть до 10 минут
TODAY=$(date +%F)

echo "[$(date '+%F %T')] wrapper triggered" >> "$LOG_FILE"

if [ -f "$STATE_FILE" ] && [ "$(cat "$STATE_FILE")" = "$TODAY" ]; then
  echo "[$(date '+%F %T')] уже запускалось сегодня ($TODAY), пропускаю" >> "$LOG_FILE"
  exit 0
fi

# Ждём сеть перед запуском. 12.09 сбор упал в 12:03 на первом же обращении
# к Google: Мак проснулся, launchd сработал по расписанию, а Wi-Fi ещё не
# поднялся. Скрипт умер на получении токена, повтора не было, и день выпал
# из истории целиком. Отметка о запуске при этом НЕ ставится, поэтому после
# неудачи догон сработает при следующем пробуждении.
for i in $(seq 1 $NET_TRIES); do
  if curl -s -m 5 -o /dev/null "$NET_CHECK_URL"; then
    break
  fi
  echo "[$(date '+%F %T')] сети нет, жду 30 с (попытка $i из $NET_TRIES)" >> "$LOG_FILE"
  sleep 30
done

if ! curl -s -m 5 -o /dev/null "$NET_CHECK_URL"; then
  echo "[$(date '+%F %T')] сеть так и не появилась, запуск отложен до следующего раза" >> "$LOG_FILE"
  exit 1
fi

echo "[$(date '+%F %T')] запускаю run_daily.py" >> "$LOG_FILE"
/Users/YOUR_USERNAME/mg-monitor-local/venv/bin/python3 /Users/YOUR_USERNAME/mg-monitor-local/run_daily.py >> "$LOG_FILE" 2>&1
# Код возврата берём СРАЗУ. Раньше здесь стояло "код выхода: $?" внутри строки
# с $(date ...) — подстановка даты выполнялась первой и затирала $?, поэтому
# в логе всегда стояло "код выхода: 0", даже когда сбор падал с трассировкой.
CODE=$?
echo "[$(date '+%F %T')] завершено, код выхода: $CODE" >> "$LOG_FILE"
exit $CODE
