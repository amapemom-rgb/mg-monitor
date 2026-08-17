#!/bin/bash
# Обёртка для launchd: запускает сбор цен MG-MONITOR раз в день,
# с "догоном" — если сегодняшний запуск ещё не выполнялся (например,
# Мак был выключен/закрыт в момент запланированного запуска), выполняет
# его немедленно при следующем старте launchd-агента (при логине/пробуждении Мака).
#
# ЗАМЕНИТЕ /Users/YOUR_USERNAME на свой путь перед использованием.

STATE_FILE="/Users/YOUR_USERNAME/mg-monitor-local/last_run.txt"
LOG_FILE="/Users/YOUR_USERNAME/mg-monitor-local/wrapper.log"
TODAY=$(date +%F)

echo "[$(date '+%F %T')] wrapper triggered" >> "$LOG_FILE"

if [ -f "$STATE_FILE" ] && [ "$(cat "$STATE_FILE")" = "$TODAY" ]; then
  echo "[$(date '+%F %T')] уже запускалось сегодня ($TODAY), пропускаю" >> "$LOG_FILE"
  exit 0
fi

echo "[$(date '+%F %T')] запускаю run_daily.py" >> "$LOG_FILE"
/Users/YOUR_USERNAME/mg-monitor-local/venv/bin/python3 /Users/YOUR_USERNAME/mg-monitor-local/run_daily.py >> "$LOG_FILE" 2>&1
echo "[$(date '+%F %T')] завершено, код выхода: $?" >> "$LOG_FILE"
