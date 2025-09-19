Mega – hier ist die **Step-by-Step-Anleitung** für einen frisch aufgesetzten Windows-Server (IIS) – so bekommst du deine Landingpage **zuverlässig** online. Ich habe alles so geschrieben, dass du es 1:1 abarbeiten kannst (inkl. Copy-Paste-Befehle).

---

# 0) Voraussetzungen & Überblick

* Du hast die Projektdateien lokal irgendwo, z. B. `C:\Users\<Du>\Documents\GitHub\Website`.
* Wir deployen **nur den Build-Output** nach `C:\sites\dl-landing`.
* Webserver: **IIS** (nicht Caddy/Apache).
* Domain: **earlysalty.de** (+ optional **[www.earlysalty.de](http://www.earlysalty.de)**).
* Ziel: **HTTP 80** + **HTTPS 443**, **http→https** und **www→non-www** per **URL Rewrite**.

---

# 1) Einmalige Server-Einrichtung

## 1.1 Node.js installieren (zum Bauen)

* Lade **Node.js LTS** (Windows x64) und installiere.
* Test in PowerShell:

```powershell
node -v
npm -v
```

## 1.2 IIS + WAS aktivieren

PowerShell **als Administrator**:

```powershell
# (Nur Windows Server) – IIS & WAS Features
Install-WindowsFeature `
  Web-Server, `
  Web-Static-Content, `
  Web-Default-Doc, `
  Web-Http-Errors, `
  Web-Http-Logging, `
  Web-Filtering, `
  Web-Mgmt-Console, `
  WAS, `
  WAS-Process-Model, `
  WAS-Config-APIs `
  -IncludeManagementTools

# Dienste automatisch & starten
Set-Service WAS   -StartupType Automatic
Set-Service W3SVC -StartupType Automatic
Start-Service WAS
Start-Service W3SVC
```

> Falls ein Feature-Name abweicht:
> `Get-WindowsFeature *WAS*` zeigt die genauen Bezeichnungen an.

## 1.3 URL Rewrite Modul installieren (wichtig für saubere Redirects)

> Wenn du Chocolatey hast:

```powershell
choco install urlrewrite -y
iisreset /noforce
```

Check:

```powershell
Import-Module WebAdministration
Get-WebGlobalModule | ? Name -eq 'RewriteModule'
```

(Es muss eine Zeile `RewriteModule` erscheinen.)

## 1.4 Andere Webserver stoppen/deaktivieren (z. B. Caddy)

```powershell
# Prüfe Port 80
netstat -ano | findstr :80
# Prozess zu PID ermitteln
tasklist /FI "PID eq <PID>"
# Caddy o.ä. beenden und deaktivieren
Stop-Service caddy -Force -ErrorAction SilentlyContinue
Set-Service  caddy -StartupType Disabled
```

## 1.5 Firewall öffnen

```powershell
netsh advfirewall firewall add rule name="IIS_HTTP_80"  dir=in action=allow protocol=TCP localport=80
netsh advfirewall firewall add rule name="IIS_HTTPS_443" dir=in action=allow protocol=TCP localport=443
```

---

# 2) Projekt bauen (Production Build)

## 2.1 Build erzeugen

```powershell
cd "C:\Users\<DEIN-NAME>\Documents\GitHub\Website"
npm install
npm run build    # erzeugt .\dist mit index.html + assets\index-<hash>.js
```

## 2.2 Zielordner für Deployment

```powershell
# sauberer Zielpfad außerhalb von C:\Users
Remove-Item "C:\sites\dl-landing" -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path "C:\sites\dl-landing" | Out-Null

# nur den Build kopieren
robocopy ".\dist" "C:\sites\dl-landing" /MIR
```

## 2.3 (Robust) Tailwind-CSS lokal ablegen (keine CDN-Abhängigkeit)

```powershell
Invoke-WebRequest "https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" `
  -OutFile "C:\sites\dl-landing\assets\tailwind.min.css"

# CSS-Link in index.html ergänzen (nach <head>)
$idx = "C:\sites\dl-landing\index.html"
(Get-Content $idx) -replace '<head>', '<head>`r`n  <link rel="stylesheet" href="/assets/tailwind.min.css" />' |
  Set-Content $idx -Encoding UTF8
```

---

# 3) IIS-Site anlegen

## 3.1 Website erstellen (falls noch nicht vorhanden)

```powershell
Import-Module WebAdministration

# Neue Site – NUR wenn sie noch nicht existiert
New-Website -Name "dl-landing" -Port 80 -HostHeader earlysalty.de `
  -PhysicalPath "C:\sites\dl-landing" -Force

# www-Host hinzufügen
New-WebBinding -Name "dl-landing" -Protocol http -Port 80 -IPAddress * -HostHeader www.earlysalty.de
```

## 3.2 Berechtigungen (ACLs)

```powershell
# Leserechte für IIS-Gruppen/AppPool
icacls "C:\sites\dl-landing" /grant "IIS_IUSRS:(OI)(CI)(RX)" /T
icacls "C:\sites\dl-landing" /grant "IIS AppPool\dl-landing:(OI)(CI)(RX)" /T
# (optional) IUSR, falls nötig:
icacls "C:\sites\dl-landing" /grant "IUSR:(OI)(CI)(RX)" /T
```

## 3.3 Anonyme Authentifizierung aktivieren

```powershell
Set-WebConfigurationProperty -pspath 'IIS:\Sites\dl-landing' `
  -filter "system.webServer/security/authentication/anonymousAuthentication" `
  -name enabled -value $true
```

---

# 4) HTTPS-Zertifikate (Let’s Encrypt via win-acme)

1. Stelle sicher, dass **A-Records** für `earlysalty.de` und `www.earlysalty.de` auf deine Server-IP zeigen.
2. **wacs.exe** (win-acme) als Admin starten → **Create new certificate (simple)** → beide Bindings auswählen → **Installation: IIS**.

Check danach:

```powershell
Get-WebBinding -Name "dl-landing"
# Erwartet zusätzlich:
# https *:443:earlysalty.de
# https *:443:www.earlysalty.de
```

---

# 5) Saubere Redirects (ohne Loops) via URL Rewrite

## 5.1 HTTP→HTTPS & www→non-www (Empfehlung)

> Ersetzt **nicht** die ganze Datei – du legst sie genauso ab.
> **HTTP Redirect Feature** in IIS muss **deaktiviert** sein.

```powershell
$xml = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <!-- (1) Nur HTTP -> HTTPS -->
        <rule name="Force HTTPS" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="off" ignoreCase="true" />
          </conditions>
          <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
        </rule>

        <!-- (2) WWW -> non-WWW (falls du non-www willst) -->
        <rule name="WWW to non-WWW" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="on" ignoreCase="true" />
            <add input="{HTTP_HOST}" pattern="^www\.earlysalty\.de$" />
          </conditions>
          <action type="Redirect" url="https://earlysalty.de/{R:1}" redirectType="Permanent" />
        </rule>

        <!-- Alternative: non-WWW -> WWW (stattdessen diese aktivieren und obige deaktivieren)
        <rule name="non-WWW to WWW" enabled="false" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="on" ignoreCase="true" />
            <add input="{HTTP_HOST}" pattern="^earlysalty\.de$" />
          </conditions>
          <action type="Redirect" url="https://www.earlysalty.de/{R:1}" redirectType="Permanent" />
        </rule>
        -->
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
"@
[IO.File]::WriteAllText("C:\sites\dl-landing\web.config", $xml, [Text.UTF8Encoding]::new($false))

# HTTP Redirect Feature vorsichtshalber ausschalten (kein Loop)
Set-WebConfigurationProperty -pspath 'IIS:\Sites\dl-landing' `
  -filter "system.webServer/httpRedirect" -name "enabled" -value $false

# Site neu starten
Stop-Website  "dl-landing"
Start-Website "dl-landing"
```

---

# 6) Funktionstest

## 6.1 Server-seitiger Smoke-Test (liefert die richtige Datei?)

```powershell
Invoke-WebRequest "http://earlysalty.de" -UseBasicParsing |
  Select-Object -ExpandProperty Content |
  Select-String "assets/index-.*\.js"
```

Es sollte eine Zeile mit `assets/index-…js` erscheinen.

## 6.2 Browser-Test

* `http://earlysalty.de/ping` → **301** auf `https://earlysalty.de/ping`
* `http://www.earlysalty.de/ping` → **301** auf `https://earlysalty.de/ping`
* Seite öffnen, **Strg+F5**, F12 → **Network** prüfen:
  `/assets/index-…js` **200 OK**, `/assets/tailwind.min.css` **200 OK**.

---

# 7) Inhalte pflegen (ohne Code)

* Oben rechts **⚙️ Einstellungen**:

  * **Discord Invite URL** (z. B. `https://discord.gg/...`)
  * **Discord Widget ID** (Server-ID, Widget in Discord aktivieren)
  * **GA4 Measurement ID** (z. B. `G-XXXXXXX`)
* Unten: **Content hinzufügen** (Guides/News/Videos) & **Seite erstellen**.
* Hinweis: Standardmäßig speichert die App Inhalte im **localStorage** des Browsers.

---

# 8) Update-/Redeploy-Checkliste (wenn du später Code änderst)

```powershell
cd "C:\Users\<DEIN-NAME>\Documents\GitHub\Website"
npm run build
robocopy ".\dist" "C:\sites\dl-landing" /MIR
Stop-Website  "dl-landing"
Start-Website "dl-landing"
```

> Prüfe danach wieder mit `Invoke-WebRequest … | Select-String "assets/index-.*\.js"`.

---

# 9) Troubleshooting (häufige Fehler & Fixes)

**Portkonflikt (0x80070020 / „in use“)**

* `netstat -ano | findstr :80` → `tasklist /FI "PID eq <PID>"`
* Fremdserver stoppen (z. B. `Stop-Service caddy`), Default Web Site stoppen/Binding auf 80 entfernen.

**401.3 Zugriff verweigert (ACL)**

* Ordner **außerhalb** von `C:\Users` nutzen: `C:\sites\dl-landing`
* ACLs setzen:

```powershell
icacls "C:\sites\dl-landing" /grant "IIS_IUSRS:(OI)(CI)(RX)" /T
icacls "C:\sites\dl-landing" /grant "IIS AppPool\dl-landing:(OI)(CI)(RX)" /T
icacls "C:\sites\dl-landing" /grant "IUSR:(OI)(CI)(RX)" /T
```

* Anonyme Auth aktivieren (siehe oben).

**500.19 „doppelter defaultDocument / index.html“**

* Keine eigene `defaultDocument`-Einträge setzen oder **`<clear/>`** verwenden.
* Notfalls `web.config` löschen (wenn nur Static/Hash-Routing).
* Für Redirects **URL Rewrite** nutzen, **nicht** das HTTP Redirect Feature mit Variablen.

**500.19 „ungültiges XML“**

* In `web.config` dürfen **keine** PowerShell-Marker `@'` / `'@` stehen.
* Datei exakt wie oben schreiben (UTF-8 ohne BOM).

**„Weiße Seite“**

* Prüfe `/assets/index-…js` (404? → falsch deployed).
* Tailwind-CSS lokal einbinden (Schritt 2.3).
* **Strg+F5** (Cache). Dev-Imports wie `/src/main.jsx` dürfen **nicht** im Build stehen.

---

# 10) Bonus: alles in einem Mini-Script (Bootstrap)

> Für neu aufgesetzte Server (mit Chocolatey):

```powershell
# Als Admin ausführen – Pfade/Domains anpassen!
$proj = "C:\Users\<DU>\Documents\GitHub\Website"
$dest = "C:\sites\dl-landing"
$domain = "earlysalty.de"

Install-WindowsFeature Web-Server,Web-Static-Content,Web-Default-Doc,Web-Http-Errors,Web-Http-Logging,Web-Filtering,Web-Mgmt-Console,WAS,WAS-Process-Model,WAS-Config-APIs -IncludeManagementTools
Set-Service WAS -StartupType Automatic; Set-Service W3SVC -StartupType Automatic
Start-Service WAS; Start-Service W3SVC

choco install urlrewrite -y
iisreset /noforce

Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $dest | Out-Null
cd $proj; npm install; npm run build
robocopy "$proj\dist" $dest /MIR

Invoke-WebRequest "https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" -OutFile "$dest\assets\tailwind.min.css"
$idx = "$dest\index.html"
(Get-Content $idx) -replace '<head>', '<head>`r`n  <link rel="stylesheet" href="/assets/tailwind.min.css" />' | Set-Content $idx -Encoding UTF8

Import-Module WebAdministration
if (-not (Get-Website | ? Name -eq "dl-landing")) {
  New-Website -Name "dl-landing" -Port 80 -HostHeader $domain -PhysicalPath $dest -Force
  New-WebBinding -Name "dl-landing" -Protocol http -Port 80 -IPAddress * -HostHeader "www.$domain"
}
icacls $dest /grant "IIS_IUSRS:(OI)(CI)(RX)" /T
icacls $dest /grant "IIS AppPool\dl-landing:(OI)(CI)(RX)" /T
icacls $dest /grant "IUSR:(OI)(CI)(RX)" /T

$xml = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="Force HTTPS" stopProcessing="true">
          <match url="(.*)" />
          <conditions><add input="{HTTPS}" pattern="off" ignoreCase="true" /></conditions>
          <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
        </rule>
        <rule name="WWW to non-WWW" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="on" ignoreCase="true" />
            <add input="{HTTP_HOST}" pattern="^www\.$domain$" />
          </conditions>
          <action type="Redirect" url="https://$domain/{R:1}" redirectType="Permanent" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
"@
[IO.File]::WriteAllText("$dest\web.config", $xml, [Text.UTF8Encoding]::new($false))

Stop-Website "dl-landing"; Start-Website "dl-landing"
```

> Danach nur noch **win-acme** (`wacs.exe`) laufen lassen, Zertifikate installieren, fertig.

---

Wenn du magst, speicher ich dir diese Anleitung als **README.md** ins Projekt (oder als **.ps1** Setup-Script), damit du beim nächsten Neuaufsetzen alles direkt zur Hand hast.
