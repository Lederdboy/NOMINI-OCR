@echo off
title NOMINI - Servidor Visor y Segmentador
cd /d "%~dp0"
echo ==========================================
echo   NOMINI - Suite Laboral Offline
echo   Servidor en http://127.0.0.1:4173
echo   (No cierres esta ventana mientras uses el sistema)
echo ==========================================
start "" "http://127.0.0.1:4173/visor.html#splitter"
node devServer.js
pause

