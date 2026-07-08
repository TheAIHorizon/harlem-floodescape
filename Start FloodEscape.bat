@echo off
rem Harlem FloodEscape launcher — serves the app on localhost (works offline).
rem Browsers block ES modules and data files from file://, so we serve over http.
cd /d "%~dp0app"
start "" http://localhost:8123/
python -m http.server 8123
