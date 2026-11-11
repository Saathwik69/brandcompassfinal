@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 from https://nodejs.org/ and try again.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
  echo This project needs Node.js 24 or newer. Please update Node.js.
  pause
  exit /b 1
)
echo Open http://localhost:3000 and choose Explore the live demo.
node --env-file-if-exists=.env server.mjs
pause
