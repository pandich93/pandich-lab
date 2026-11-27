// Pandich Lab desktop — texts of the tray, notifications, error windows and the setup wizard in Русский / O'zbekcha / English.
// Key: Russian text; value: [English, O'zbekcha]. {0}, {1}… are filled at runtime. Used by main.js (require) and setup.html (<script>).
(function (root) {
  'use strict';
  const D = {
    // tray, notifications, windows (main.js)
    'Pandich Lab работает в фоне': ['Pandich Lab is running in the background', 'Pandich Lab fonda ishlayapti'],
    'Сигналы Watch продолжают приходить. Открыть или выйти — значок в {0}.': ['Watch signals keep coming. To open or quit, use the icon in the {0}.', 'Watch signallari kelishda davom etadi. Ochish yoki chiqish — {0}dagi belgi orqali.'],
    'строке меню': ['menu bar', 'menyu satri'],
    'трее': ['system tray', 'tray'],
    'Pandich Lab — настройка': ['Pandich Lab — setup', 'Pandich Lab — sozlash'],
    'Лог: {0}': ['Log: {0}', 'Log: {0}'],
    'Сборка неполная: внутри приложения нет модуля pinets. Переустановите Pandich Lab из официального релиза.': ['The build is incomplete: the pinets module is missing inside the app. Reinstall Pandich Lab from the official release.', "Yig'ma to'liq emas: ilova ichida pinets moduli yo'q. Pandich Lab ni rasmiy relizdan qayta o'rnating."],
    'Сервер Pandich Lab падает при запуске. Подробности — в логе (меню в трее → «Логи»).': ['The Pandich Lab server crashes on start. Details are in the log (tray menu → "Logs").', 'Pandich Lab serveri ishga tushganda yiqilyapti. Tafsilotlar logda (tray menyusi → «Loglar»).'],
    'Не удалось запустить сервер Pandich Lab.': ['Could not start the Pandich Lab server.', "Pandich Lab serverini ishga tushirib bo'lmadi."],
    '⬆ Перезапустить и обновить до {0}': ['⬆ Restart and update to {0}', '⬆ Qayta ishga tushirib {0} ga yangilash'],
    'Открыть Pandich Lab': ['Open Pandich Lab', 'Pandich Lab ni ochish'],
    'Настройки и диагностика': ['Settings and diagnostics', 'Sozlamalar va diagnostika'],
    'Запускать при входе в систему': ['Start at login', 'Tizimga kirganda ishga tushirish'],
    'Мастер настройки (Claude Code, MT5)': ['Setup wizard (Claude Code, MT5)', 'Sozlash ustasi (Claude Code, MT5)'],
    'Папка данных': ['Data folder', "Ma'lumotlar papkasi"],
    'Логи': ['Logs', 'Loglar'],
    'Скачиваю обновление {0}… {1}%': ['Downloading update {0}… {1}%', '{0} yangilanishi yuklab olinmoqda… {1}%'],
    'Проверить обновления': ['Check for updates', 'Yangilanishlarni tekshirish'],
    'Обновления': ['Updates', 'Yangilanishlar'],
    'Перезапустить сервер': ['Restart server', 'Serverni qayta ishga tushirish'],
    'Выход': ['Quit', 'Chiqish'],
    'локальный запуск из исходников': ['running from source', "manbadan lokal ishga tushirish"],
    'сборка без публикации (собрана вручную) — обновления только переустановкой': ['unpublished build (built manually) — update by reinstalling', "nashr qilinmagan yig'ma (qo'lda yig'ilgan) — faqat qayta o'rnatish orqali yangilanadi"],
    'Pandich Lab {0} готов к установке': ['Pandich Lab {0} is ready to install', "Pandich Lab {0} o'rnatishga tayyor"],
    'Нажмите, чтобы перезапустить и обновить. Или обновится при выходе из приложения.': ['Click to restart and update. Or it will update when you quit the app.', "Qayta ishga tushirib yangilash uchun bosing. Yoki ilovadan chiqqanda yangilanadi."],
    'Автообновление выключено: {0}.': ['Auto-update is off: {0}.', "Avtomatik yangilanish o'chirilgan: {0}."],
    'Версия {0} скачана — нажмите «Перезапустить и обновить».': ['Version {0} is downloaded — press "Restart and update".', "{0} versiyasi yuklab olindi — «Qayta ishga tushirib yangilash» ni bosing."],
    'Скачиваю версию {0}… {1}%': ['Downloading version {0}… {1}%', '{0} versiyasi yuklab olinmoqda… {1}%'],
    'Найдена версия {0} — скачиваю, потом предложу перезапустить.': ['Found version {0} — downloading, then I will offer to restart.', "{0} versiyasi topildi — yuklab olinmoqda, so'ng qayta ishga tushirishni taklif qilaman."],
    'Установлена последняя версия.': ['You have the latest version.', "So'nggi versiya o'rnatilgan."],
    'Автообновление есть только для Windows и macOS.': ['Auto-update is available only on Windows and macOS.', 'Avtomatik yangilanish faqat Windows va macOS uchun mavjud.'],
    'Не удалось проверить: {0}': ['Could not check: {0}', "Tekshirib bo'lmadi: {0}"],
    'Доступна версия {0}. Приложение запущено не из «Программ», поэтому обновите вручную: скачайте .dmg и перетащите в «Программы».': ['Version {0} is available. The app is not running from Applications, so update manually: download the .dmg and drag it into Applications.', "{0} versiyasi mavjud. Ilova «Programs» dan ishga tushirilmagan, shuning uchun qo'lda yangilang: .dmg ni yuklab, «Programs» ga torting."],
    'Доступна Pandich Lab {0}': ['Pandich Lab {0} is available', 'Pandich Lab {0} mavjud'],
    'Нажмите, чтобы скачать новую версию.': ['Click to download the new version.', 'Yangi versiyani yuklab olish uchun bosing.'],
    'Claude Code не найден': ['Claude Code not found', 'Claude Code topilmadi'],
    'Подходящий Python 3 не найден': ['No suitable Python 3 found', 'Mos Python 3 topilmadi'],
    'Python для MT5 нужен только на Windows': ['Python for MT5 is needed only on Windows', 'MT5 uchun Python faqat Windows da kerak'],
    'Скачиваю Python 3.13 с python.org…': ['Downloading Python 3.13 from python.org…', 'Python 3.13 python.org dan yuklab olinmoqda…'],
    'Не удалось скачать Python: {0}': ['Could not download Python: {0}', "Python ni yuklab bo'lmadi: {0}"],
    'Устанавливаю Python (1–2 мин, без окон)…': ['Installing Python (1–2 min, no windows)…', "Python o'rnatilmoqda (1–2 daq, oynalarsiz)…"],
    'Установщик Python завершился с кодом {0}': ['The Python installer exited with code {0}', "Python o'rnatuvchisi {0} kodi bilan tugadi"],
    'Python установлен, но не найден — перезапустите Pandich Lab': ['Python is installed but not found — restart Pandich Lab', "Python o'rnatildi, lekin topilmadi — Pandich Lab ni qayta ishga tushiring"],
    'Сервер не ответил': ['The server did not respond', 'Server javob bermadi'],

    // setup wizard (setup.html / setup.js)
    'Добро пожаловать в Pandich Lab': ['Welcome to Pandich Lab', 'Pandich Lab ga xush kelibsiz'],
    'Графики и индикаторы уже работают. Чтобы заработал ИИ-ассистент Panda, нужно поставить пару программ — сделаем это за вас.': ['Charts and indicators already work. To enable the Panda AI assistant, a couple of programs are needed — we will install them for you.', "Grafiklar va indikatorlar allaqachon ishlayapti. Panda AI yordamchisi ishlashi uchun bir nechta dastur kerak — ularni siz uchun o'rnatamiz."],
    'Установить всё одним кликом': ['Install everything in one click', "Hammasini bir bosishda o'rnatish"],
    'Скачаем и поставим всё нужное с официальных сайтов, без прав администратора. Вам останется только войти в аккаунт Claude в браузере.': ['We will download and install everything from the official sites, without admin rights. You will only need to sign in to your Claude account in the browser.', "Kerakli hamma narsani rasmiy saytlardan, administrator huquqisiz yuklab o'rnatamiz. Sizga faqat brauzerda Claude akkauntingizga kirish qoladi."],
    'Скачаем и поставим Claude Code с официального сайта Anthropic. Вам останется только войти в аккаунт Claude в браузере.': ['We will download and install Claude Code from the official Anthropic site. You will only need to sign in to your Claude account in the browser.', "Claude Code ni Anthropic rasmiy saytidan yuklab o'rnatamiz. Sizga faqat brauzerda Claude akkauntingizga kirish qoladi."],
    'Установить всё': ['Install everything', "Hammasini o'rnatish"],
    'Устанавливаю…': ['Installing…', "O'rnatilmoqda…"],
    '✓ Всё готово': ['✓ All set', '✓ Hammasi tayyor'],
    'Подключить MetaTrader 5 (котировки вашего брокера; можно пропустить — будут графики Binance)': ["Connect MetaTrader 5 (your broker's quotes; you can skip it — Binance charts will work)", "MetaTrader 5 ni ulash (brokeringiz kotirovkalari; o'tkazib yuborsa bo'ladi — Binance grafiklari ishlaydi)"],
    'Подробный журнал': ['Detailed log', 'Batafsil jurnal'],
    'Запускать вместе с системой (в фоне, для сигналов Watch)': ['Start with the system (in the background, for Watch signals)', 'Tizim bilan birga ishga tushirish (fonda, Watch signallari uchun)'],
    'Язык': ['Language', 'Til'],
    'Программа, через которую работает Panda (официальный установщик Anthropic).': ['The program Panda works through (official Anthropic installer).', "Panda ishlaydigan dastur (Anthropic rasmiy o'rnatuvchisi)."],
    'Установлен': ['Installed', "O'rnatilgan"],
    'Установщик завершился с ошибкой — откройте журнал ниже.': ['The installer failed — open the log below.', "O'rnatuvchi xato bilan tugadi — quyidagi jurnalni oching."],
    'Нужен Panda, чтобы запускать код на графике (PortableGit, ~60 МБ).': ['Panda needs it to run code on the chart (PortableGit, ~60 MB).', 'Panda grafikda kodni ishga tushirishi uchun kerak (PortableGit, ~60 MB).'],
    'Найден': ['Found', 'Topildi'],
    'Не удалось: {0}': ['Failed: {0}', "Bo'lmadi: {0}"],
    'ошибка': ['error', 'xato'],
    'Нужен для связи с MetaTrader 5 (python.org, ~30 МБ).': ['Needed to connect to MetaTrader 5 (python.org, ~30 MB).', "MetaTrader 5 bilan bog'lanish uchun kerak (python.org, ~30 MB)."],
    'Найден неподходящий ({0}) — поставим 3.13': ['Found an unsuitable one ({0}) — we will install 3.13', "Mos kelmaydigani topildi ({0}) — 3.13 ni o'rnatamiz"],
    '32-битный': ['32-bit', '32-bitli'],
    'версия {0} не поддерживается модулем MetaTrader5': ['version {0} is not supported by the MetaTrader5 module', "{0} versiyasini MetaTrader5 moduli qo'llab-quvvatlamaydi"],
    'Ошибка установки': ['Installation error', "O'rnatish xatosi"],
    'Модуль MetaTrader5': ['MetaTrader5 module', 'MetaTrader5 moduli'],
    'Официальный пакет MetaQuotes для Python.': ['The official MetaQuotes package for Python.', 'Python uchun MetaQuotes rasmiy paketi.'],
    'Установлен. Запустите терминал MT5 и войдите в счёт.': ['Installed. Start the MT5 terminal and log in to your account.', "O'rnatildi. MT5 terminalini ishga tushiring va hisobingizga kiring."],
    'pip завершился с ошибкой — откройте журнал.': ['pip failed — open the log.', 'pip xato bilan tugadi — jurnalni oching.'],
    'Вход в аккаунт Claude': ['Sign in to your Claude account', 'Claude akkauntiga kirish'],
    'Panda работает от вашей подписки Claude (Pro или Max). Ключ API не нужен.': ['Panda runs on your Claude subscription (Pro or Max). No API key needed.', "Panda Claude obunangiz (Pro yoki Max) bilan ishlaydi. API kalit kerak emas."],
    'Пропущено — MetaTrader 5 не подключаем.': ['Skipped — not connecting MetaTrader 5.', "O'tkazib yuborildi — MetaTrader 5 ulanmaydi."],
    'Повторить': ['Retry', 'Qayta urinish'],
    'Войти': ['Sign in', 'Kirish'],
    'Установить': ['Install', "O'rnatish"],
    'Проверить сейчас': ['Check now', 'Hozir tekshirish'],
    'Окно входа': ['Sign-in window', 'Kirish oynasi'],
    'Выполняется…': ['Running…', 'Bajarilmoqda…'],
    'Сначала нужно установить Claude Code.': ['Install Claude Code first.', "Avval Claude Code ni o'rnatish kerak."],
    'Не удалось открыть окно входа': ['Could not open the sign-in window', "Kirish oynasini ochib bo'lmadi"],
    'Открыт «Терминал» с Claude Code (если macOS спросит разрешение — нажмите «OK»). ': ['Terminal is open with Claude Code (if macOS asks for permission, press "OK"). ', "Claude Code bilan «Terminal» ochildi (macOS ruxsat so'rasa — «OK» ni bosing). "],
    'Открыто окно Claude Code. ': ['The Claude Code window is open. ', 'Claude Code oynasi ochildi. '],
    'Выберите вход через подписку Claude и подтвердите в браузере. Если спросит тему оформления или доверие к папке — просто нажмите Enter. Мы сами заметим, когда вход выполнен.': ['Choose sign-in with your Claude subscription and confirm in the browser. If it asks about a theme or trusting the folder, just press Enter. We will notice when you are signed in.', "Claude obunasi orqali kirishni tanlang va brauzerda tasdiqlang. Mavzu yoki papkaga ishonch haqida so'rasa — shunchaki Enter ni bosing. Kirganingizni o'zimiz sezamiz."],
    'Проверяю вход…': ['Checking sign-in…', 'Kirish tekshirilmoqda…'],
    'Вход выполнен — Panda отвечает. Окно Claude Code можно закрыть.': ['Signed in — Panda responds. You can close the Claude Code window.', "Kirildi — Panda javob beryapti. Claude Code oynasini yopsa bo'ladi."],
    'Вход не обнаружен: {0}. Нажмите «Повторить».': ['Sign-in not detected: {0}. Press "Retry".', "Kirish aniqlanmadi: {0}. «Qayta urinish» ni bosing."],
    'Пока не вошли ({0}). Завершите вход в окне Claude Code — проверка повторяется автоматически.': ['Not signed in yet ({0}). Finish signing in in the Claude Code window — the check repeats automatically.', "Hali kirilmadi ({0}). Claude Code oynasida kirishni yakunlang — tekshiruv avtomatik takrorlanadi."],
    'нет ответа': ['no response', "javob yo'q"],
    'Вход уже выполнен.': ['Already signed in.', 'Allaqachon kirilgan.'],
  };
  const COL = { en: 0, uz: 1 };
  function resolve(l) { const s = String(l || '').toLowerCase(); return s.startsWith('uz') ? 'uz' : s.startsWith('ru') ? 'ru' : s ? 'en' : 'ru'; }
  function make(lang) {
    const col = COL[lang];
    return function tr(key, ...args) {
      let s = col === undefined ? key : ((D[key] && D[key][col]) || key);
      args.forEach((a, i) => { s = s.split('{' + i + '}').join(a); });
      return s;
    };
  }
  const api = { D, make, resolve, LANGS: { ru: 'Русский', uz: "O'zbekcha", en: 'English' } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PLI18N = api;
})(typeof self !== 'undefined' ? self : this);
