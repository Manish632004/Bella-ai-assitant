@echo off
REM BELLA - launch WITHOUT admin elevation.
REM Windows denies microphone + screen capture to elevated (admin) Chromium
REM processes; this drops the elevation so voice and vision always work.
runas /trustlevel:0x20000 "cmd /c cd /d C:\Bella_Assistant\bella-old && npx electron ."
