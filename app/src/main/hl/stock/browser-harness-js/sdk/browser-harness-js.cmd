@echo off
rem browser-harness-js Windows launcher — runs the bundled bash script under
rem Git for Windows' bash.exe. The script is POSIX-only (curl, nohup, /tmp,
rem bun bootstrap) so we delegate to bash rather than re-implement in cmd.exe.
rem
rem Discovery order:
rem   1. %BROWSER_HARNESS_JS_BASH% (explicit env override)
rem   2. %ProgramFiles%\Git\bin\bash.exe
rem   3. %ProgramFiles(x86)%\Git\bin\bash.exe
rem   4. %LocalAppData%\Programs\Git\bin\bash.exe   (per-user install)
rem
rem Without Git for Windows, exits 1 with a stderr hint so the agent sees a
rem clean error instead of triggering Windows' "Open with..." association
rem dialog on the extensionless bash script next to this file.

setlocal

set "SCRIPT_DIR=%~dp0"
set "BASH_SCRIPT=%SCRIPT_DIR%browser-harness-js"

if defined BROWSER_HARNESS_JS_BASH (
  if exist "%BROWSER_HARNESS_JS_BASH%" (
    "%BROWSER_HARNESS_JS_BASH%" "%BASH_SCRIPT%" %*
    exit /b %errorlevel%
  )
)

for %%P in (
  "%ProgramFiles%\Git\bin\bash.exe"
  "%ProgramFiles(x86)%\Git\bin\bash.exe"
  "%LocalAppData%\Programs\Git\bin\bash.exe"
) do (
  if exist %%P (
    %%P "%BASH_SCRIPT%" %*
    exit /b %errorlevel%
  )
)

>&2 echo browser-harness-js: bash.exe not found. Install Git for Windows from https://gitforwindows.org/ or set BROWSER_HARNESS_JS_BASH to a bash.exe path.
exit /b 1
