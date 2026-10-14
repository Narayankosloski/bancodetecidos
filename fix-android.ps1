$ErrorActionPreference = "Stop"
$appId = "com.narayan.meuapp"

function Run($cmd) {
  Write-Host ">> $cmd" -ForegroundColor Cyan
  Invoke-Expression $cmd
  if ($LASTEXITCODE -ne 0) { throw "Falhou: $cmd" }
}

if (-not (Test-Path "android\app\google-services.json")) {
  throw "Falta android\app\google-services.json (baixe no Firebase e coloque em android\app\)"
}
if (-not (Select-String -Path "android\app\google-services.json" -Pattern $appId -Quiet)) {
  Write-Warning "O package_name do google-services.json não bate com $appId"
}

# 1. mescla o plugin no capacitor.config.json (com backup)
Copy-Item capacitor.config.json capacitor.config.json.bak -Force
@'
const fs = require('fs');
const raw = fs.readFileSync('capacitor.config.json', 'utf8').replace(/^\uFEFF/, '');
const c = JSON.parse(raw);
c.plugins = c.plugins || {};
c.plugins.FirebaseAuthentication = { skipNativeAuth: true, providers: ['google.com'] };
fs.writeFileSync('capacitor.config.json', JSON.stringify(c, null, 2));
'@ | Set-Content merge-config.js -Encoding ASCII
Run "node merge-config.js"
Remove-Item merge-config.js

# 2. instala o plugin na mesma major do Capacitor
$capMajor = (node -p "require('@capacitor/core/package.json').version.split('.')[0]").Trim()
Run "npm i @capacitor-firebase/authentication@$capMajor firebase"

# 3. sincroniza o projeto Android
Run "npx cap sync android"

# 4. gera o APK de debug sem Android Studio
Push-Location android
Run ".\gradlew.bat clean assembleDebug"
Pop-Location

# 5. reinstala no celular via USB
adb uninstall $appId
Run "adb install -r android\app\build\outputs\apk\debug\app-debug.apk"

Write-Host "Pronto." -ForegroundColor Green