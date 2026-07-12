@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   MOBILE NINJA — сервер (игра + комнаты)
echo   Открой на телефоне (та же Wi-Fi сеть):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo   http://%%a:8000  (без пробела)
echo   Не закрывай это окно, пока играете.
echo ============================================
python server.py
pause
