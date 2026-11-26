# Pandich Lab

**Локальный график + ИИ-ассистент, который пишет, запускает и рисует индикаторы Pine Script v6.**
**A local charting + AI workbench that writes, runs and draws Pine Script v6 indicators.**

Open source · AGPL-3.0 · некоммерческий проект / non-commercial project

[Русский](#русский) · [English](#english)

---

## Русский

### Что это

Pandich Lab — приложение, которое работает у тебя на компьютере.

- Слева чат **Panda** (Claude), справа живой график.
- Ты описываешь индикатор словами. Panda пишет Pine Script v6, сам запускает его на текущем графике через [PineTS](https://www.npmjs.com/package/pinets), читает ошибки, исправляет и рисует результат.
- Готовый код можно сохранить и вставить в TradingView.

Возможности:

- **График:**
  - любые таймфреймы, включая нестандартные (22m, 90m, 2D);
  - 10 типов графика, логарифмическая и процентная шкалы;
  - поиск символа;
  - 35 инструментов рисования.
- **Мульти-график** до 8 окон с синхронизацией символа, интервала, перекрестия и времени.
- **Pine-редактор** (Monaco): подсветка, автодополнение, ошибки на строке, логи, тестер стратегий, история версий, diff.
- **Replay:** проигрывание истории бар за баром. Индикаторы на каждом шаге пересчитываются только по открытым барам. Есть бумажные сделки с SL/TP и карточка итогов: profit factor, просадка, кривая эквити, CSV.
- **Watch:** сервер сам отслеживает `alert()` и `alertcondition()` на закрытии бара и шлёт уведомление в Telegram или в браузер. Работает и при закрытой вкладке.
- **Библиотека:** 23 встроенных индикатора, шаблоны индикаторов, макеты экрана.
- **Данные:**
  - крипта с Binance через публичное зеркало;
  - по желанию свой счёт MetaTrader 5 (только Windows, только чтение котировок).

### Как работает ИИ

Panda работает через твой собственный Claude:

- **По умолчанию** через локальный [Claude Code](https://docs.claude.com/en/docs/claude-code/overview), вошедший в твою подписку Claude (Pro/Max). Запросы расходуют её лимиты.
- **Или** через твой API-ключ Anthropic: `"backend": "api"` и `"anthropicApiKey"` в `config.json` (или переменная `ANTHROPIC_API_KEY`). Этот режим проще и проверен меньше, чем Claude Code.

Проект не включает и не раздаёт ничьих учётных данных: каждый пользователь подключает свои.

### Приложение для Windows и macOS

Готовые установщики лежат в [Releases](../../releases):
- **Windows 10/11 (x64):** `PandichLab-x.y.z-win-x64.exe`. Двойной клик, и приложение установится без прав администратора.
- **macOS (Apple Silicon и Intel):** `PandichLab-x.y.z-mac-universal.dmg`. Перетащи приложение в «Программы».

При первом запуске откроется мастер: он поставит Claude Code и поможет войти в подписку; на Windows по желанию подключит MetaTrader 5. Приложение обновляется само.

> Установщики пока **не подписаны**:
> - **Windows** покажет «Windows защитила ваш компьютер» → «Подробнее» → «Выполнить в любом случае».
> - **macOS** заблокирует первый запуск → «Системные настройки» → «Конфиденциальность и безопасность» → «Всё равно открыть».

Собрать установщик самому: `desktop\build-win.bat` (Windows) или `desktop/build-mac.sh` (macOS).

### Установка из исходников

Нужно:
- [Node.js](https://nodejs.org) 18+;
- [Claude Code](https://docs.claude.com/en/docs/claude-code/overview): `npm install -g @anthropic-ai/claude-code`, затем один раз запустить `claude` и войти.

Без Claude Code график тоже работает, недоступен только чат.

**Windows:**
1. Распакуй архив и запусти `start.bat`. Он поставит зависимости и откроет http://localhost:3777.
2. Для котировок MetaTrader 5 (необязательно) нужны 64-битный Python 3 и запущенный терминал MT5. `start.bat` сам поставит пакет `MetaTrader5`.
3. Claude Code на Windows нужен Git for Windows (Git Bash).

**macOS / Linux:**
```bash
./start.sh
```
Или вручную: `npm install && npm start`. MT5 здесь недоступен (пакет `MetaTrader5` только для Windows), работают данные Binance.

### Настройка

Скопируй `config.example.json` в `config.json` и измени нужное. Поля в `server.mjs` → `CFG`:
- `backend`: `claude-code` или `api`;
- `model`;
- `claudeBin`;
- `anthropicApiKey` (для `backend: api`);
- `python`, `mt5Path`, `mt5Enabled`.

Переменные окружения:

| Переменная | Назначение |
|---|---|
| `PORT` | порт сервера, по умолчанию 3777 |
| `QL_PYTHON` | команда Python для моста MT5 |
| `MT5_PATH` | путь к `terminal64.exe`, если терминалов несколько |
| `MT5=0` | отключить MT5 |
| `MOCK=1` | синтетические данные для разработки |

Личные данные хранятся только у тебя и в git не попадают (`.gitignore`):
- `data/`: сигналы Watch, настройки Telegram, шаблоны, макеты;
- `scripts/`: сохранённые скрипты.

### Безопасность

- Сервер слушает только `127.0.0.1`. **Не открывай его в сеть и не выставляй в интернет:** в нём нет авторизации.
- Panda запускается в Claude Code с разрешением читать и писать файлы в папке `agent/` и выполнять `node ql.mjs …`, без подтверждения каждого шага (`--permission-mode dontAsk`). Pine-код выполняется в процессе сервера.
- Запускай только код, которому доверяешь.

### Отказ от ответственности

Это инструмент для исследования и обучения, а **не инвестиционная рекомендация**. Индикаторы, сигналы, Replay и бэктесты могут ошибаться. Торговля на финансовых рынках связана с риском потери средств. Авторы не несут ответственности за твои торговые решения.

---

## English

### What it is

Pandich Lab is a local app.

- On the left, an AI chat called **Panda** (Claude); on the right, a live chart.
- You describe an indicator in plain words. Panda writes Pine Script v6, runs it on the current chart through [PineTS](https://www.npmjs.com/package/pinets), reads the errors, fixes them and draws the result.
- You can save the code and paste it into TradingView.

Features:

- **Chart:**
  - any timeframe, including custom ones (22m, 90m, 2D);
  - 10 chart types, log and percent scales;
  - symbol search;
  - 35 drawing tools.
- **Multi-chart** with up to 8 panes, synced symbol, interval, crosshair and time.
- **Pine editor** (Monaco): highlighting, completion, inline errors, logs, strategy tester, version history, diff.
- **Bar Replay:** scripts re-run on revealed bars only, so they can't see the future. Paper trading with SL/TP and a results card: profit factor, drawdown, equity curve, CSV.
- **Watch mode:** the server evaluates `alert()` and `alertcondition()` on every closed bar and notifies Telegram or the browser, even with the tab closed.
- **Library:** 23 built-in indicators, indicator templates, saved screen layouts.
- **Data:**
  - crypto from Binance via its public data mirror;
  - optionally your own MetaTrader 5 account (Windows only, read-only quotes).

### How the AI works

Panda runs on **your own** Claude:

- **By default** through a local [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) signed in to your Claude subscription. Usage counts against that plan's limits.
- **Or** with your own Anthropic API key: `"backend": "api"` plus `"anthropicApiKey"` in `config.json` (or the `ANTHROPIC_API_KEY` env var). This mode is simpler and less tested than Claude Code.

The project ships no credentials; every user brings their own.

### Desktop app (Windows & macOS)

Installers are in [Releases](../../releases):
- **Windows 10/11 (x64):** `PandichLab-x.y.z-win-x64.exe`, a one-click install without admin rights.
- **macOS (Apple Silicon & Intel):** `PandichLab-x.y.z-mac-universal.dmg`.

On first launch a setup wizard installs Claude Code and helps you sign in; on Windows it can also connect MetaTrader 5. The app updates itself.

> The installers are **not code-signed** yet:
> - **Windows SmartScreen:** "More info" → "Run anyway".
> - **macOS:** System Settings → Privacy & Security → "Open Anyway".

Build it yourself: `desktop\build-win.bat` or `desktop/build-mac.sh`.

### Install from source

Requirements:
- [Node.js](https://nodejs.org) 18+;
- [Claude Code](https://docs.claude.com/en/docs/claude-code/overview): `npm install -g @anthropic-ai/claude-code`, then run `claude` once and sign in.

The chart works without Claude Code; only the chat needs it.

- **Windows:** run `start.bat`. MetaTrader 5 quotes need 64-bit Python 3 and a running MT5 terminal; `start.bat` installs the `MetaTrader5` package.
- **macOS / Linux:** run `./start.sh`, or `npm install && npm start`. Binance data only.

### Configuration

Copy `config.example.json` to `config.json`.

| Env var | Purpose |
|---|---|
| `PORT` | server port, default 3777 |
| `QL_PYTHON` | Python command for the MT5 bridge |
| `MT5_PATH` | path to `terminal64.exe` if you have several terminals |
| `MT5=0` | disable MT5 |
| `MOCK=1` | synthetic data for development |

Your data stays in `data/` and `scripts/`, both git-ignored.

### Security

- The server binds to `127.0.0.1` and has no authentication. **Never expose it to a network.**
- Panda runs inside Claude Code with permission to edit files in `agent/` and run `node ql.mjs …` without step-by-step confirmation. Pine code executes inside the server process.

### Disclaimer

For research and education only. **Not financial advice.** Indicators, signals, replays and backtests can be wrong. Trading involves risk of loss.

---

## License

Pandich Lab is licensed under the **GNU Affero General Public License v3.0 only**; see [LICENSE](LICENSE).
Third-party components and attributions are listed in [NOTICE](NOTICE). Charts are powered by TradingView Lightweight Charts™ (https://www.tradingview.com/).

Pandich Lab is an independent project. It is not affiliated with or endorsed by TradingView, Anthropic or MetaQuotes. Pine Script® is a trademark of TradingView, Inc. Claude and Claude Code are trademarks of Anthropic, PBC. MetaTrader is a trademark of MetaQuotes Ltd.
