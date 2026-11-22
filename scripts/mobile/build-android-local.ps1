<#
.SYNOPSIS
  Builds the Colabonate Android debug APK locally (no GitHub Actions / artifact
  quota involved).

.DESCRIPTION
  Mirrors .github/workflows/mobile-build.yml:
    1. tokens:build            (tokens.css is gitignored; Vite fails without it)
    2. colabonate-app build    (SPA bundle -> apps/colabonate-app/dist)
    3. cap sync android        (copies dist into android/app/src/main/assets/public)
    4. gradlew assembleDebug   (-> android/app/build/outputs/apk/debug/app-debug.apk)

  VITE_API_URL MUST be an absolute URL for an APK: the Capacitor WebView serves
  the bundle from https://localhost, so the web default (VITE_API_URL='' ->
  relative /api via the nginx proxy) cannot resolve. See ADR-190 (mobile) and
  ADR-387 D3 (platform Lightning address).

  Vite loads env from `envDir: root` (the repo root), and process env wins over
  .env files -- so the VITE_ values below override the repo-root .env.production.

  Toolchain (portable, no admin) expected at:
    JAVA_HOME    = <...>\dev-tools\jdk\jdk-21.x
    ANDROID_HOME = <...>\dev-tools\android-sdk   (platform android-36,
                   build-tools 36.0.0, platform-tools)
  Install once:
    - Temurin 21: https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse
    - cmdline-tools: https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip
      -> %ANDROID_HOME%\cmdline-tools\latest\
      -> sdkmanager --sdk_root=$env:ANDROID_HOME --licenses
      -> sdkmanager --sdk_root=$env:ANDROID_HOME "platform-tools" "platforms;android-36" "build-tools;36.0.0"
  Override JAVA_HOME / ANDROID_HOME env vars if yours live elsewhere.

.EXAMPLE
  powershell -File scripts/mobile/build-android-local.ps1
.EXAMPLE
  powershell -File scripts/mobile/build-android-local.ps1 -ApiBaseUrl https://colabonate.app -LnAddress platform@example.com
#>
[CmdletBinding()]
param(
  [string]$ApiBaseUrl = 'https://colabonate.app',
  [string]$LnAddress  = 'pay@colabonate.app',
  [string]$AdminPubkey = '96013e999b18179e88452455144b438b1e078e1fbcd1a2e7d26c3f8975b0376b',
  [string]$JdkHome     = $env:JAVA_HOME,
  [string]$AndroidSdk  = $env:ANDROID_HOME,
  [switch]$SkipWebBuild
)

# 'Stop' would turn every native-command stderr line (e.g. the harmless
# "npm warn Unknown project config" from npx) into a terminating
# NativeCommandError under PowerShell 5.1. Use explicit exit-code checks instead.
$ErrorActionPreference = 'Continue'

function Invoke-Native([string]$Label, [scriptblock]$Command) {
  Write-Host "== $Label =="
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE)" }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $repoRoot
try {
  if (-not $JdkHome -or -not (Test-Path (Join-Path $JdkHome 'bin\java.exe'))) {
    $guess = Get-ChildItem 'C:\Users\*\dev-tools\jdk\jdk-21*' -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($guess) { $JdkHome = $guess.FullName }
  }
  if (-not $JdkHome) { throw 'JAVA_HOME not set and no JDK 21 found. See the header for the portable install.' }

  if (-not $AndroidSdk -or -not (Test-Path (Join-Path $AndroidSdk 'platforms\android-36'))) {
    $AndroidSdk = 'C:\Users\<you>\dev-tools\android-sdk'
  }
  if (-not (Test-Path (Join-Path $AndroidSdk 'platforms\android-36'))) {
    throw "Android SDK with platforms;android-36 not found (ANDROID_HOME=$AndroidSdk). See the header."
  }

  $env:JAVA_HOME = $JdkHome
  $env:ANDROID_HOME = $AndroidSdk
  $env:ANDROID_SDK_ROOT = $AndroidSdk
  $env:PATH = "$JdkHome\bin;$AndroidSdk\platform-tools;$env:PATH"

  # `cap` resolves the platform package from the repo root, but @capacitor/android
  # is a devDep of apps/colabonate-app only. Junction it in (node_modules is
  # gitignored) instead of `pnpm add -wD`, which would dirty package.json/lockfile.
  foreach ($pkg in @('android', 'core')) {
    $link = "node_modules\@capacitor\$pkg"
    if (-not (Test-Path $link)) {
      $item = Get-Item "apps\colabonate-app\node_modules\@capacitor\$pkg" -ErrorAction SilentlyContinue
      if (-not $item) { throw "@capacitor/$pkg not installed in apps/colabonate-app. Run: npx pnpm install" }
      $target = if ($item.Target) { $item.Target } else { $item.FullName }
      New-Item -ItemType Junction -Path $link -Target $target -Force | Out-Null
      Write-Host "linked @capacitor/$pkg"
    }
  }

  if (-not $SkipWebBuild) {
    Invoke-Native 'tokens:build' { npx pnpm tokens:build }

    $env:VITE_API_URL = $ApiBaseUrl
    $env:VITE_PROJECT_LN_ADDRESS = $LnAddress
    $env:VITE_ADMIN_PUBKEY = $AdminPubkey
    $env:VITE_CASHU_ENABLED = 'true'
    Invoke-Native "app build (VITE_API_URL=$ApiBaseUrl, VITE_PROJECT_LN_ADDRESS=$LnAddress)" { npx pnpm --filter colabonate-app build }
  }

  if (-not (Test-Path 'android')) {
    Invoke-Native 'cap add android' { npx cap add android }
  }
  Invoke-Native 'cap sync android' { npx cap sync android }
  Invoke-Native 'gradlew assembleDebug' { & 'android\gradlew.bat' -p android assembleDebug --no-daemon }

  $apk = Join-Path $repoRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
  if (-not (Test-Path $apk)) { throw "Build finished but $apk is missing." }
  $f = Get-Item $apk
  Write-Host ("`nAPK: {0} ({1:N1} MB)" -f $f.FullName, ($f.Length / 1MB))
  Write-Host 'Install: adb install -r "<apk>"  (or sideload the file on the device)'
}
finally {
  Pop-Location
}
