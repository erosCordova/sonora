@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Sonora - RTX 4050 - Instalar o iniciar

rem Inicio con doble clic: no hace falta escribir comandos.
rem Los archivos privados permanecen en %%LOCALAPPDATA%%\Sonora-GPU.
set "SONORA_HOME=%LOCALAPPDATA%\Sonora-GPU"
set "SONORA_REPO=%SONORA_HOME%\sonora"
set "GIT_BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%GIT_BASH%" set "GIT_BASH=%ProgramFiles%\Git\usr\bin\bash.exe"
if not exist "%GIT_BASH%" set "GIT_BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not exist "%GIT_BASH%" goto missing_git

if exist "%SONORA_REPO%\scripts\install-worker-rtx4050.sh" goto installed_source

where curl.exe >nul 2>nul
if errorlevel 1 goto missing_tools
where tar.exe >nul 2>nul
if errorlevel 1 goto missing_tools

set "ZIP_FILE=%TEMP%\sonora-rtx4050-%RANDOM%%RANDOM%.zip"
set "STAGING=%TEMP%\sonora-rtx4050-%RANDOM%%RANDOM%"
mkdir "%STAGING%" >nul 2>nul
if errorlevel 1 goto failed_download

echo.
echo [Sonora] Descargando instalador actualizado desde GitHub...
curl.exe --fail --location --retry 3 --connect-timeout 20 --output "%ZIP_FILE%" "https://github.com/erosCordova/sonora/archive/refs/heads/main.zip"
if errorlevel 1 goto failed_download

tar.exe -xf "%ZIP_FILE%" -C "%STAGING%"
if errorlevel 1 goto failed_download
if not exist "%STAGING%\sonora-main\scripts\install-worker-rtx4050.sh" goto failed_download
if not exist "%SONORA_HOME%" mkdir "%SONORA_HOME%"
move "%STAGING%\sonora-main" "%SONORA_REPO%" >nul
if errorlevel 1 goto failed_download

del /q "%ZIP_FILE%" >nul 2>nul
rmdir /s /q "%STAGING%" >nul 2>nul

:installed_source
cd /d "%SONORA_REPO%"
if exist "%SONORA_REPO%\worker\.env" if exist "%SONORA_REPO%\worker\.rtx4050.env" goto restart_worker

echo.
echo [Sonora] Instalando ACE-Step y configurando tu RTX 4050.
echo Este proceso descargara software y modelos de IA de gran tamano.
echo El token privado solo se solicitara una vez y no se enviara a GitHub.
echo.
"%GIT_BASH%" -c "bash scripts/install-worker-rtx4050.sh"
if errorlevel 1 goto failed_setup
goto finished

:restart_worker
echo.
echo [Sonora] Iniciando el motor musical ya instalado...
"%GIT_BASH%" -c "bash scripts/start-worker-rtx4050.sh"
if errorlevel 1 goto failed_setup
goto finished

:missing_git
echo.
echo [ERROR] Falta Git for Windows, necesario para instalar ACE-Step.
echo Descarga: https://git-scm.com/downloads/win
goto finished

:missing_tools
echo.
echo [ERROR] Esta version de Windows no tiene curl.exe o tar.exe.
echo Actualiza Windows 11 y vuelve a intentar.
goto finished

:failed_download
echo.
echo [ERROR] No se pudo descargar o extraer Sonora.
echo Comprueba tu conexion a Internet y espacio libre.
if defined ZIP_FILE if exist "%ZIP_FILE%" del /q "%ZIP_FILE%" >nul 2>nul
goto finished

:failed_setup
echo.
echo [ERROR] El motor no pudo iniciarse. El mensaje anterior explica el motivo.
echo No se ha enviado ninguna cancion falsa a Sonora.

:finished
echo.
echo Puedes cerrar esta ventana. Para volver a iniciar el motor,
echo ejecuta otra vez este archivo con doble clic.
pause
endlocal
