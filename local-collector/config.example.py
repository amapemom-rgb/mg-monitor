# Скопируйте этот файл в config.py и заполните своими значениями.
# config.py НЕ должен попадать в git (см. .gitignore) — в нём хранится секрет,
# дающий право писать в вашу Google-таблицу через веб-приложение Apps Script.
#
# EXEC_URL: адрес /exec вашего задеплоенного веб-приложения
#   (Apps Script -> Deploy -> Manage deployments -> Web app URL).
# SECRET: любая случайная строка, которую вы также сохраните в
#   Project Settings -> Script properties -> PW_SECRET в Apps Script
#   (при первом запуске это можно сделать одним вызовом action=set_pw_secret,
#   см. README, раздел "Быстрый старт").

EXEC_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'
SECRET = 'CHANGE_ME_TO_A_RANDOM_STRING'
