@echo off
REM ===================================================================
REM  Ansum Transport — APK build (no Gradle)
REM ===================================================================
REM  Pipeline: aapt2 compile/link -> javac -> d8 -> merge dex into APK
REM            -> zipalign -> apksigner
REM
REM  Requires:
REM    * ANDROID_HOME pointing at an SDK with build-tools + platforms
REM    * A JDK on PATH (javac, keytool) with JAVA_HOME set
REM    * Python 3 on PATH (for merge.py)
REM
REM  Signing: uses keystore.jks in this folder. The keystore and its
REM  password must NEVER be committed — anyone holding them can sign a
REM  fake update for an app that is already installed.
REM ===================================================================
setlocal enabledelayedexpansion

set HERE=%~dp0
cd /d "%HERE%"

if "%ANDROID_HOME%"=="" (
  echo [ERROR] ANDROID_HOME is not set.
  exit /b 1
)

REM --- pick build-tools: prefer 34.0.0, fall back to the newest available ---
set BT=%ANDROID_HOME%\build-tools\34.0.0
if not exist "%BT%\aapt2.exe" (
  for /f "delims=" %%d in ('dir /b /ad /o-n "%ANDROID_HOME%\build-tools" 2^>nul') do (
    if exist "%ANDROID_HOME%\build-tools\%%d\aapt2.exe" set "BT=%ANDROID_HOME%\build-tools\%%d"
  )
)
echo [info] build-tools = %BT%

set PLATFORM=%ANDROID_HOME%\platforms\android-34
if not exist "%PLATFORM%\android.jar" (
  for /f "delims=" %%d in ('dir /b /ad /o-n "%ANDROID_HOME%\platforms" 2^>nul') do (
    if exist "%ANDROID_HOME%\platforms\%%d\android.jar" set "PLATFORM=%ANDROID_HOME%\platforms\%%d"
  )
)
echo [info] platform    = %PLATFORM%

set OUT=build
set APK=build\app-unsigned.apk
set ALIGNED=build\app-aligned.apk
set FINAL=..\Ansum-Transport-v1.3.apk

if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%\res-c" 2>nul
mkdir "%OUT%\classes" 2>nul
mkdir "%OUT%\dex" 2>nul

REM ---------- 1. compile resources ----------
echo.
echo [1/7] aapt2 compile
"%BT%\aapt2.exe" compile --dir res -o "%OUT%\res-c.zip"
if errorlevel 1 goto :fail

REM ---------- 2. link resources + manifest ----------
echo.
echo [2/7] aapt2 link
"%BT%\aapt2.exe" link ^
  -o "%APK%" ^
  -I "%PLATFORM%\android.jar" ^
  --manifest AndroidManifest.xml ^
  --java "%OUT%\gen" ^
  --min-sdk-version 26 ^
  --target-sdk-version 34 ^
  -R "%OUT%\res-c.zip" ^
  --auto-add-overlay
if errorlevel 1 goto :fail

REM ---------- 3. compile java ----------
echo.
echo [3/7] javac
dir /s /b src\*.java "%OUT%\gen\*.java" > "%OUT%\sources.txt" 2>nul
javac --release 11 -encoding UTF-8 -bootclasspath "%PLATFORM%\android.jar" ^
  -classpath "%PLATFORM%\android.jar" -d "%OUT%\classes" @"%OUT%\sources.txt"
if errorlevel 1 goto :fail

REM ---------- 4. dex ----------
echo.
echo [4/7] d8
call "%BT%\d8.bat" --min-api 26 --lib "%PLATFORM%\android.jar" ^
  --output "%OUT%\dex" "%OUT%\classes"
if errorlevel 1 goto :fail

REM ---------- 5. merge dex into apk, add res/drawable images ----------
echo.
echo [5/7] merge dex
python merge.py "%APK%" "%OUT%\dex\classes.dex"
if errorlevel 1 goto :fail

REM ---------- 6. zipalign ----------
echo.
echo [6/7] zipalign
"%BT%\zipalign.exe" -f -p 4 "%APK%" "%ALIGNED%"
if errorlevel 1 goto :fail

REM ---------- 7. sign ----------
echo.
echo [7/7] apksigner
if not exist keystore.jks (
  echo [warn] keystore.jks not found - creating a new one.
  keytool -genkeypair -v -keystore keystore.jks -alias ansumbus ^
    -keyalg RSA -keysize 2048 -validity 10000 ^
    -storepass ansumbus -keypass ansumbus ^
    -dname "CN=Ansum Bus, OU=Ansum, O=Ansum, L=Hong Kong, ST=Hong Kong, C=HK"
)
call "%BT%\apksigner.bat" sign ^
  --ks keystore.jks --ks-key-alias ansumbus ^
  --ks-pass pass:ansumbus --key-pass pass:ansumbus ^
  --out "%FINAL%" "%ALIGNED%"
if errorlevel 1 goto :fail

call "%BT%\apksigner.bat" verify "%FINAL%"
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo  OK -^> %FINAL%
echo ============================================================
exit /b 0

:fail
echo.
echo [FAILED] see the error above.
exit /b 1
