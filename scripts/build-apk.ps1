# Builds the BELLA Android companion APK without Gradle:
#   aapt2 (resources) -> javac -> d8 (dex) -> package -> zipalign -> apksigner
# Output: public/phone/bella.apk  (served at /api/phone/app.apk)
$ErrorActionPreference = "Stop"

$sdk     = "$env:LOCALAPPDATA\Android\Sdk"
# 33.0.2 on purpose: d8 in 34.x NPEs ("String.length") on class files from
# modern JDK javac. aapt2/zipalign/apksigner from 33 are fine for our needs.
$bt      = "$sdk\build-tools\33.0.2"
$platJar = "$sdk\platforms\android-34\android.jar"
if (-not (Test-Path $bt))          { throw "build-tools missing: $bt" }
if (-not (Test-Path $platJar))     { throw "platform missing: $platJar" }

$root    = $PSScriptRoot | Split-Path       # repo root
$appDir  = Join-Path $root "android-app"
$outApk  = Join-Path $root "public\phone\bella.apk"
# Oracle's javapath shim only exposes java/javac — find the real JDK for
# jar.exe / keytool.exe.
$jdkBin  = @(Get-ChildItem "C:\Program Files\Java" -Directory -Filter "jdk*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Where-Object { Test-Path "$($_.FullName)\bin\jar.exe" } |
    Select-Object -First 1).FullName + "\bin"
if (-not (Test-Path "$jdkBin\jar.exe")) { throw "JDK bin with jar.exe not found" }

# ---- 1. generated resources -------------------------------------------------
New-Item -ItemType Directory -Force -Path "$appDir\res\raw","$appDir\res\mipmap-xxhdpi","$appDir\libs" | Out-Null

# The CA cert lives encrypted on disk. Prefer the running server's public
# endpoint; otherwise decrypt it directly through the repo's own module.
$caText = (& curl.exe -s --max-time 3 "http://localhost:3000/api/phone/ca.crt") -join "`n"
if (-not $caText.Contains("BEGIN CERTIFICATE")) {
    $raw = & node "$root\node_modules\tsx\dist\cli.mjs" -e `
        "import('./bella/phonecerts.ts').then(async m => { await m.ensureCerts(); const p = m.caCertPem(); if(!p) throw new Error('no CA'); console.log(p); })"
    $lines = @($raw | ForEach-Object { [string]$_ })
    $start = [array]::IndexOf($lines, ($lines | Where-Object { $_ -like '*BEGIN CERTIFICATE*' } | Select-Object -First 1))
    $end   = [array]::IndexOf($lines, ($lines | Where-Object { $_ -like '*END CERTIFICATE*' }   | Select-Object -First 1))
    if ($start -ge 0 -and $end -gt $start) {
        $caText = ($lines[$start..$end] -join "`n")
    }
}
if (-not $caText.Contains("BEGIN CERTIFICATE")) {
    throw "Could not obtain BELLA's local CA certificate."
}
[IO.File]::WriteAllText("$appDir\res\raw\bella_ca.pem", $caText + "`n")

Copy-Item (Join-Path $root "public\phone\icon-192.png") "$appDir\res\mipmap-xxhdpi\ic_launcher.png" -Force

$zxing = Join-Path $appDir "libs\core-3.5.3.jar"
if (-not (Test-Path $zxing)) {
    Copy-Item "$env:TEMP\opencode\dls\zxing.jar" $zxing -Force
}

# ---- 2. clean build dir ------------------------------------------------------
$build = Join-Path $appDir "build"
Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$build\classes","$build\dex","$build\gen" | Out-Null

# ---- 3. resources via aapt2 --------------------------------------------------
& "$bt\aapt2.exe" compile --dir "$appDir\res" -o "$build\res.zip"
if ($LASTEXITCODE) { throw "aapt2 compile failed" }

& "$bt\aapt2.exe" link -o "$build\base.apk" `
    -I $platJar `
    --manifest "$appDir\AndroidManifest.xml" `
    -R "$build\res.zip" `
    --java "$build\gen" `
    --auto-add-overlay `
    --min-sdk-version 24 --target-sdk-version 34
if ($LASTEXITCODE) { throw "aapt2 link failed" }

# ---- 4. java sources -> class files ------------------------------------------
$sources = @(Get-ChildItem -Recurse "$appDir\src" -Filter *.java | ForEach-Object { $_.FullName })
$sources += Get-ChildItem -Recurse "$build\gen" -Filter *.java | ForEach-Object { $_.FullName }
& "$jdkBin\javac.exe" -source 11 -target 11 -encoding UTF-8 -nowarn `
    -classpath "$platJar;$zxing" `
    -d "$build\classes" `
    $sources
if ($LASTEXITCODE) { throw "javac failed" }

# ---- 5. dex -------------------------------------------------------------------
# Standalone r8 — build-tools' bundled d8 (33 & 34) crashes on class files
# from modern JDK javac ("String.length" NPE). r8 8.3.x handles them fine.
$r8jar = "$env:TEMP\opencode\dls\r8.jar"
if (-not (Test-Path $r8jar)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $r8jar) | Out-Null
    & curl.exe -sL -o $r8jar "https://dl.google.com/android/maven2/com/android/tools/r8/8.3.37/r8-8.3.37.jar"
}
$classFiles = Get-ChildItem -Recurse "$build\classes" -Filter *.class | ForEach-Object { $_.FullName }
# zxing passed BOTH ways: --lib (for resolution) and positional (so its
# classes actually get dexed INTO the apk).
& java -cp $r8jar com.android.tools.r8.D8 --release --min-api 24 `
    --lib $platJar --lib $zxing `
    --output "$build\dex" `
    $zxing `
    $classFiles
if ($LASTEXITCODE) { throw "d8 failed" }

# ---- 6. pack dex into apk -----------------------------------------------------
& "$jdkBin\jar.exe" uf "$build\base.apk" -C "$build\dex" classes.dex
if ($LASTEXITCODE) { throw "jar packaging failed" }

# ---- 7. align + sign ----------------------------------------------------------
& "$bt\zipalign.exe" -f -p 4 "$build\base.apk" "$build\aligned.apk"
if ($LASTEXITCODE) { throw "zipalign failed" }

$keystore = Join-Path $PSScriptRoot "bella-debug.keystore"
if (-not (Test-Path $keystore)) {
    & "$jdkBin\keytool.exe" -genkeypair -keystore $keystore -storepass bella123 `
        -keypass bella123 -alias bella -keyalg RSA -keysize 2048 -validity 10000 `
        -dname "CN=BELLA Companion, O=THE Manish AI"
    if ($LASTEXITCODE) { throw "keytool failed" }
}

& "$bt\apksigner.bat" sign --ks $keystore --ks-pass pass:bella123 `
    --key-pass pass:bella123 --ks-key-alias bella `
    --out $outApk "$build\aligned.apk"
if ($LASTEXITCODE) { throw "apksigner failed" }

& "$bt\apksigner.bat" verify $outApk
if ($LASTEXITCODE) { throw "signature verification failed" }

Write-Output ""
Write-Output "APK built: $outApk ($([math]::Round((Get-Item $outApk).Length/1MB,1)) MB)"
