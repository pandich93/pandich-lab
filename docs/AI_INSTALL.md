# Install Pandich Lab with an AI agent

Copy the prompt below into an AI coding agent that can run commands on **your** computer
(Claude Code, Codex CLI, Gemini CLI, Cursor agent and similar). The agent downloads the official release,
installs it and checks that it runs. It asks you before every install step.

Скопируй промпт ниже в ИИ-агента, который умеет выполнять команды на **твоём** компьютере (Claude Code, Codex CLI,
Gemini CLI, агент Cursor и т. п.). Агент скачает официальный релиз, установит и проверит запуск. Перед каждым шагом установки он спросит разрешение.

Quyidagi promptni **o'z** kompyuteringizda buyruqlarni bajara oladigan AI-agentga (Claude Code, Codex CLI, Gemini CLI,
Cursor agenti va h.k.) nusxalang. Agent rasmiy relizni yuklab oladi, o'rnatadi va ishga tushishini tekshiradi. Har bir o'rnatish qadamidan oldin sizdan ruxsat so'raydi.

```text
Install the open-source desktop app "Pandich Lab" on this computer for me.

Official source (use nothing else): https://github.com/pandich93/pandich-lab
Download only from that repository's GitHub Releases.

Rules
- Answer me in the language I write in.
- Ask for my confirmation before each step that downloads, installs or changes something. One step at a time.
- No administrator/sudo rights are needed. Do not use them and do not change any system or security settings
  except the single macOS step marked "ask first".
- Do not touch unrelated files. If a step fails, show me the exact error and stop; do not improvise workarounds.

Steps
1. Detect the OS and CPU architecture. Supported: Windows 10/11 x64, macOS 12+ (Apple Silicon or Intel).
   On anything else use the "From source" fallback at the end.
2. Read https://api.github.com/repos/pandich93/pandich-lab/releases/latest and pick the asset:
   Windows -> PandichLab-<version>-win-x64.exe ; macOS -> PandichLab-<version>-mac-universal.dmg
   (the same files are also attached as PandichLab-Setup.exe / PandichLab-mac.dmg; prefer the versioned names,
   their checksums are listed in latest.yml / latest-mac.yml)
   Tell me the version, file name, size and URL, then download it to my Downloads folder.
   Verify the download: the size must match the API, and the SHA-512 (base64) must match the value in the
   release asset latest.yml (Windows) or latest-mac.yml (macOS). If it does not match, delete the file and stop.
3. Install:
   - Windows: run the installer with the /S flag (silent, per-user). It installs to
     %LOCALAPPDATA%\Programs\pandich-lab-desktop and creates Desktop and Start-menu shortcuts.
   - macOS: mount the .dmg, copy "Pandich Lab.app" to /Applications, unmount.
     The app is not notarized by Apple yet, so macOS blocks the first launch. ASK FIRST, and only if I agree run:
       xattr -dr com.apple.quarantine "/Applications/Pandich Lab.app"
     If I decline, explain how to allow it manually: System Settings -> Privacy & Security -> "Open Anyway".
4. The built-in AI assistant (Panda) uses my own Claude Code. Check `claude --version`.
   If it is missing, ask me, then install it with Anthropic's official installer:
     Windows (PowerShell):  irm https://claude.ai/install.ps1 | iex
     macOS:                 curl -fsSL https://claude.ai/install.sh | bash
   Do NOT sign in for me and never ask for my password or tokens. Tell me to run `claude` once myself and sign in
   with my Claude account. Charts and indicators work without it.
5. Start Pandich Lab. Wait up to 60 seconds and check that the local server answers on one of
   http://127.0.0.1:3779/api/config ... http://127.0.0.1:3785/api/config (the app picks the first free port).
   If it does not, show me the end of the log:
     Windows: %APPDATA%\Pandich Lab\logs\server.log
     macOS:   ~/Library/Application Support/Pandich Lab/logs/server.log
6. Optional, Windows only, and only if I ask for MetaTrader 5 quotes: check for 64-bit Python 3 and run
   `python -m pip install --upgrade MetaTrader5`. The MT5 terminal must be running and logged in.
7. Finish with a short report: installed version, install location, whether Claude Code is ready,
   and what I still have to do myself (sign in to Claude; the app's first-run wizard repeats these checks).

From source (Linux, or if I prefer not to use the installer)
- Needs Node.js 18+ and git. Then:
    git clone https://github.com/pandich93/pandich-lab.git
    cd pandich-lab && npm install && npm start
  Open http://localhost:3777 . The server listens on 127.0.0.1 only; never expose it to a network.
```

## What the prompt does not do

- It does not enter passwords, API keys or sign in anywhere for you.
- It does not use administrator rights.
- The only security-related action is removing the macOS quarantine flag from this one app, and only after you agree.

Pandich Lab is for research and education. Not financial advice.
