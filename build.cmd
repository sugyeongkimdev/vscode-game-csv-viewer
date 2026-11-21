@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem 마지막 빌드 뒤로 작업 트리(.gitignore 대상 제외)가 바뀌었으면 패치 버전을 올리고, 아니면 같은 버전으로 다시 만든다.
rem 비교 기준은 작업 트리의 git tree 해시이고 .git\build-stamp에 남긴다. 실제 인덱스(스테이징)는 건드리지 않는다.
set "STAMP=%~dp0.git\build-stamp"
set "INDEX=%~dp0.git\build-index"
set "LAST="
set "BUMPED="

if not exist node_modules (
    call npm ci || goto :fail
)

rem 컴파일 오류면 버전을 올리기 전에 멈춘다.
call npm run compile || goto :fail

call :tree || goto :fail
if exist "%STAMP%" set /p LAST=<"%STAMP%"
for /f %%v in ('node -p "require('./package.json').version"') do set "OLDVER=%%v"

if "%TREE%"=="%LAST%" (
    echo [build] 바뀐 파일이 없어 %OLDVER% 버전으로 다시 빌드합니다.
) else (
    call npm version patch --no-git-tag-version || goto :fail
    set "BUMPED=1"
)

if not exist build mkdir build
call npm run package -- -o build/ || goto :fail

rem 올린 버전까지 들어간 상태를 남겨야 다음 실행에서 변경 없음으로 본다.
call :tree || goto :fail
>"%STAMP%" echo %TREE%

rem PATH의 code 명령은 Cursor가 먼저 잡히므로, 편집기마다 전체 경로로 불러 설치한다.
for /f %%v in ('node -p "require('./package.json').version"') do set "VER=%%v"
set "VSIX=build\vscode-game-csv-viewer-%VER%.vsix"
set "INSTALLED="
for %%c in ("%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd" "%LOCALAPPDATA%\Programs\cursor\resources\app\bin\cursor.cmd") do (
    if exist %%c (
        call %%c --install-extension "%VSIX%" --force || goto :installfail
        set "INSTALLED=1"
    )
)
if defined INSTALLED (
    echo [build] 설치 완료. 열려 있는 창에서 "Developer: Reload Window"를 실행하세요.
) else (
    echo [build] VS Code, Cursor를 찾지 못해 설치를 건너뜁니다. %VSIX% 파일을 직접 설치하세요.
)
echo [build] 완료
pause
exit /b 0

:tree
set "TREE="
set "GIT_INDEX_FILE=%INDEX%"
git read-tree HEAD && git add -A 2>nul && for /f %%t in ('git write-tree') do set "TREE=%%t"
del "%INDEX%" 2>nul
set "GIT_INDEX_FILE="
if not defined TREE exit /b 1
exit /b 0

:installfail
rem vsix는 이미 만들어졌으므로 버전은 되돌리지 않는다.
echo [build] %VSIX% 는 만들었지만 설치에 실패했습니다. 위 메시지를 확인하세요.
pause
exit /b 1

:fail
rem 빌드가 실패하면 올린 버전을 되돌린다. 안 그러면 다음 실행에서 버전이 한 번 더 올라간다.
if defined BUMPED call npm version %OLDVER% --no-git-tag-version --allow-same-version >nul
echo [build] 실패했습니다. 위 메시지를 확인하세요.
pause
exit /b 1
