# Contributing / Как помочь проекту

Спасибо, что хочешь помочь! / Thanks for helping!

## Правила / Rules
- Лицензия AGPL-3.0: отправляя pull request, ты соглашаешься, что твой вклад распространяется под AGPL-3.0.
  By submitting a PR you agree your contribution is licensed under AGPL-3.0.
- **Не присылай код чужих платных или закрытых индикаторов и советников** (декомпиляцию, «клоны» Market-продуктов, скрипты с закрытым исходником TradingView). Только собственный код или код с совместимой открытой лицензией.
  **Do not submit code from paid or closed-source indicators/EAs** (decompiled code, clones of marketplace products, closed TradingView scripts). Only your own code or code under a compatible open license.
- Никаких ключей, токенов, номеров счетов в коммитах. / No keys, tokens or account numbers in commits.

## Разработка / Development
```bash
npm install
MOCK=1 npm start        # синтетические данные / synthetic data, no MT5/Binance needed
```
- Сервер — `server.mjs` (Node 18+, без сборки). Фронтенд — `public/*.js` (vanilla JS, без сборщика).
- Новый встроенный индикатор: файл `library/<name>.pine` с шапкой
  ```
  // @name Название
  // @category Тренд | Волатильность | Осцилляторы | Объём | Уровни | Структура | Стратегии
  // @desc Одна строка описания
  // @tags ключевые слова для поиска
  //@version=6
  ```
  Перед PR прогони его через `/api/run` на нескольких символах и ТФ без ошибок.
- Проверь вручную: график, смена ТФ/символа, мульти-график, Replay, Watch, библиотека.
- Пиши в описании PR, что и как проверено.

## Сообщить об ошибке / Bug reports
Открой issue: что делал, что ожидал, что получил, логи из консоли сервера и браузера, версия Node и ОС.
