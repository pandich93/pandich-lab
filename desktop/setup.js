'use strict';
const $ = id => document.getElementById(id);
const logBox = $('logBox');
function logLine(l) { logBox.style.display = 'block'; logBox.textContent += l + '\n'; logBox.scrollTop = logBox.scrollHeight; }
window.setup.onLog(logLine);

function render(st) {
  const c = st.claude;
  $('cDot').className = 'dot ' + (c.path ? 'ok' : 'bad');
  $('cDet').textContent = c.path ? `Найден: ${c.path}${c.version ? ' · ' + c.version : ''}` : 'Не найден. «Установить» запустит официальный установщик Anthropic (без прав администратора).';
  $('cInstall').textContent = c.path ? 'Переустановить' : 'Установить';
  $('cInstall').className = c.path ? '' : 'primary';
  $('lLogin').disabled = !c.path;
  if (st.platform !== 'win32') {
    $('mDot').className = 'dot';
    $('mDet').textContent = `${st.platform === 'darwin' ? 'На macOS' : 'На Linux'} пакет MetaTrader5 для Python не работает (только Windows). Данные: Binance; MT5 — позже через Windows-машину или VPS.`;
    $('mInstall').style.display = 'none';
  } else {
    const p = st.python;
    $('mDot').className = 'dot ' + (p && p.mt5 ? 'ok' : 'opt');
    $('mDet').innerHTML = !p || !p.cmd
      ? 'Нужен 64-битный Python 3 (до 3.13) — <a href="#" id="pyLink">скачать с python.org</a>, при установке отметь «Add python.exe to PATH». Потом нажми «Подключить». Без MT5 работают данные Binance.'
      : p.mt5 ? `Готово: Python ${p.version}, пакет MetaTrader5 установлен. Запусти терминал MT5 и войди в счёт.` : `Python ${p.version} найден. «Подключить» установит пакет MetaTrader5.`;
    const a = $('pyLink'); if (a) a.onclick = e => { e.preventDefault(); window.setup.openUrl('https://www.python.org/downloads/windows/'); };
    $('mInstall').disabled = !p || !p.cmd || p.mt5;
  }
}
async function refresh() { render(await window.setup.status()); }

$('cInstall').onclick = async () => {
  $('cInstall').disabled = true; logLine('Устанавливаю Claude Code…');
  const r = await window.setup.installClaude();
  logLine(r.ok ? 'Готово.' : 'Установщик завершился с ошибкой — смотри вывод выше.');
  render(r.status); $('cInstall').disabled = false;
};
$('lLogin').onclick = async () => { const r = await window.setup.loginClaude(); if (!r.ok) logLine(r.error); else $('lDot').className = 'dot ok'; };
$('mInstall').onclick = async () => {
  $('mInstall').disabled = true; logLine('Устанавливаю пакет MetaTrader5…');
  const r = await window.setup.installMT5();
  logLine(r.ok ? 'Готово.' : (r.error || 'pip завершился с ошибкой — смотри вывод выше.'));
  render(r.status);
};
$('finish').onclick = () => window.setup.finish({ autostart: $('auto').checked });
refresh();
