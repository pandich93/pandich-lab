# Pandich Lab — заметки к релизам

Раздел `## <версия>` попадает на страницу релиза GitHub (workflow Desktop build). Пиши человеческим языком: что изменилось для пользователя, без названий файлов и коммитов. Сначала по-русски, затем коротко по-английски.

## 0.2.13

Понятные ошибки данных: если источник котировок временно недоступен, в панели над графиком — короткое «нет связи с источником, повторяю…», а для несуществующего символа — «Символ … не найден на Binance» вместо длинной технической ошибки (полный текст — во всплывающей подсказке).

*English:* clear data errors — a short "no connection, retrying…" when the data source is unreachable and "Symbol … not found on Binance" for an unknown symbol, instead of a long technical error (full text in the tooltip).

## 0.2.12

**Тур первого запуска.** При первом запуске программа сама покажет, что она умеет, проверит, готовы ли графики и Panda, проведёт по интерфейсу и предложит за минуту проверить пример стратегии. Пройти тур снова: «Настройки» → «Тур по программе».

*English:* a first-run tour — what the app can do, a readiness check (charts and Panda), a guided walk through the interface and a one-click honest check of an example strategy. Reopen it from Settings → App tour.
