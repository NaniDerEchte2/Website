mega! 🎉 Das Ding läuft — jetzt kriegst du die **komplette Doku von 0 → 100**, damit auch ein\*e Noob das nachbauen kann. Ich pack alles in klare Schritte, mit Windows-PowerShell-Befehlen, Checks, erwarteten Antworten, Code (Server + Worker) und einer Troubleshooting-Sektion.

---

# Ziel

Einen **Remote-MCP-Server** mit **OAuth2/OIDC (Auth0)** hinter **Cloudflare Tunnel** bereitstellen, damit ChatGPT (Developer Mode) ihn als Connector nutzen kann.
Besonderheit: Ein **Cloudflare Worker** rewritet die Standard-OIDC-Endpoints zu deinem Host und implementiert **Dynamic Client Registration (DCR)** via Auth0 Management API.

---

# Architektur (Kurz)

```
ChatGPT (Connector)
    │
    │ 1) Well-known Discovery  ──────►  Cloudflare Worker  ─────────► Auth0 (Issuer)
    │                                (rewrites + /oidc/register)
    │
    │ 2) OAuth (Auth code + PKCE) ───►  Auth0
    │                                  (Audience: mcp-api)
    │
    │ 3) Token (Bearer) ─────────────►  Cloudflare Tunnel ──────────► FastMCP Server (/mcp)
```

---

# Voraussetzungen

* **Windows** (PowerShell) oder ähnlich
* **Python 3.11+** (venv empfohlen)
* **Cloudflare** Account, deine **Domain** liegt bei Cloudflare DNS
* **Auth0** Tenant
* **ChatGPT** (Pro/Team/Enterprise) + **Developer Mode** aktiviert

---

# Schritt 1 – MCP-Server lokal

## 1.1 Verzeichnis + venv + Pakete

```powershell
# Verzeichnis
mkdir C:\sites\dl-landing\mcp-server
cd C:\sites\dl-landing\mcp-server

# (optional) venv
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Pakete
pip install fastmcp
```

## 1.2 `server.py` anlegen (final)

> Dieser Server prüft JWTs gegen Auth0 (RS256, JWKS), akzeptiert Audience `mcp-api` **und** (zur Kompatibilität) die Resource-URL `https://dein-host/mcp`.
> Fürs Onboarding ist `ALLOW_DYNAMIC_AUDIENCE_DEV = True`. In Produktion ⇒ `False`.

```python
# server.py
import logging, json, base64
from typing import Dict, List, Any, Iterable
from fastmcp import FastMCP
from fastmcp.server.auth import RemoteAuthProvider
from fastmcp.server.auth.providers.jwt import JWTVerifier

# =======================
# Fix-Konfiguration
# =======================
HOST = "0.0.0.0"
PORT = 8000
TRANSPORT = "http"  # "http" oder "sse"

# Öffentliche Basis-URL DEINES MCP-Servers (hinter CF-Tunnel) - inklusive /mcp
PUBLIC_BASE_URL = "https://mcp.naniderechte.cloud/mcp"

# Auth0/OIDC
AUTH_ISSUER   = "https://earlysalty.eu.auth0.com/"
AUTH_JWKS_URI = "https://earlysalty.eu.auth0.com/.well-known/jwks.json"

# Primär erlaubte Audiences (API-ID + Resource-URL)
PRIMARY_AUDIENCE   = "mcp-api"
SECONDARY_AUDIENCE = PUBLIC_BASE_URL

# ---- DEV/PROD-Schalter ----
# In DEV: Fallback erlaubt (nimmt die 'aud' aus dem Token dynamisch an, wenn signiert & Issuer passt)
ALLOW_DYNAMIC_AUDIENCE_DEV = True
# Claims im Log zeigen, um zu sehen was der Client wirklich sendet
DEBUG_LOG_CLAIMS = True

# =======================
# Demo-Daten
# =======================
DEMO_DOCS = [
    {
        "id": "doc-start",
        "title": "Startseite",
        "url": "https://example.local/start",
        "text": "Willkommen auf der DL Landing. Diese Seite zeigt Hero/Text/Links als Blöcke."
    },
    {
        "id": "doc-admin",
        "title": "Admin-Portal",
        "url": "https://example.local/admin",
        "text": "RBAC (OWNER/ADMIN/EDITOR/VIEWER), Audit-Logs, Block-Baukasten."
    }
]

# =======================
# Hilfsfunktionen (JWT peek)
# =======================
def _b64url_decode(seg: str) -> bytes:
    seg = seg.split('.')[0] if '.' in seg else seg
    pad = '=' * (-len(seg) % 4)
    return base64.urlsafe_b64decode(seg + pad)

def _peek_claims_unverified(jwt_token: str) -> dict:
    """Nur Debug: JWT Payload ohne Verifikation dekodieren (kein Sicherheitscheck!)."""
    try:
        parts = jwt_token.split('.')
        if len(parts) < 2:
            return {}
        payload = json.loads(_b64url_decode(parts[1]).decode('utf-8'))
        return {
            "iss": payload.get("iss"),
            "aud": payload.get("aud"),
            "azp": payload.get("azp"),
            "sub": payload.get("sub"),
            "scope": payload.get("scope"),
        }
    except Exception:
        return {}

def _as_list(aud) -> Iterable[str]:
    if aud is None:
        return []
    if isinstance(aud, str):
        return [aud]
    if isinstance(aud, (list, tuple)):
        return [str(x) for x in aud]
    return [str(aud)]

# =======================
# Verifier
# =======================
class MultiAudienceVerifier(JWTVerifier):
    """
    Prüft erst gegen definierte Audiences, und wenn erlaubt, nimmt in DEV
    die dynamische 'aud' aus dem Token (z. B. Client-ID) an.
    """
    def __init__(self, jwks_uri: str, issuer: str, base_audiences: Iterable[str]):
        primary = next(iter(base_audiences))
        super().__init__(jwks_uri=jwks_uri, issuer=issuer.rstrip("/"), audience=primary)
        self._audiences = list(base_audiences)
        self._log = logging.getLogger("mcp")

    def verify(self, token: str):
        if DEBUG_LOG_CLAIMS and token:
            claims = _peek_claims_unverified(token)
            if claims:
                self._log.info(
                    f"DEBUG token claims: iss={claims.get('iss')} "
                    f"aud={claims.get('aud')} azp={claims.get('azp')} "
                    f"sub={claims.get('sub')} scope={claims.get('scope')}"
                )

        # 1) Fixe Audiences probieren
        last_err = None
        for aud in self._audiences:
            try:
                self.audience = aud
                verified = super().verify(token)
                if aud == PRIMARY_AUDIENCE:
                    self._log.info("Auth OK with audience=mcp-api")
                elif aud == SECONDARY_AUDIENCE:
                    self._log.info("Auth OK with audience=PUBLIC_BASE_URL (resource-style)")
                return verified
            except Exception as e:
                last_err = e

        # 2) DEV-Fallback: dynamische 'aud' aus dem Token zulassen
        if ALLOW_DYNAMIC_AUDIENCE_DEV and token:
            claims = _peek_claims_unverified(token)
            for aud in _as_list(claims.get("aud")):
                try:
                    self.audience = aud
                    verified = super().verify(token)
                    self._log.warning(f"DEV-ONLY: Auth OK with dynamic audience '{aud}'. "
                                      f"In PROD abschalten und korrekte audience erzwingen.")
                    return verified
                except Exception as e:
                    last_err = e

        if last_err:
            raise last_err
        raise Exception("token verification failed")

# =======================
# Auth-Provider
# =======================
def build_auth_provider() -> RemoteAuthProvider:
    verifier = MultiAudienceVerifier(
        jwks_uri=AUTH_JWKS_URI,
        issuer=AUTH_ISSUER,
        base_audiences=[PRIMARY_AUDIENCE, SECONDARY_AUDIENCE],
    )
    return RemoteAuthProvider(
        token_verifier=verifier,
        authorization_servers=[AUTH_ISSUER.rstrip("/")],
        base_url=PUBLIC_BASE_URL.rstrip("/"),
    )

# =======================
# MCP-Server
# =======================
def mk_server() -> FastMCP:
    mcp = FastMCP(
        name="dl-mcp",
        instructions=("search liefert Resultate als JSON-Array (id,title,url). "
                      "fetch liefert das vollständige Dokument mit text und metadata."),
        auth=build_auth_provider(),
    )

    @mcp.tool()
    async def search(query: str) -> Dict[str, List[Dict[str, Any]]]:
        q = (query or "").lower()
        results = []
        for d in DEMO_DOCS:
            hay = f"{d['title']} {d['text']}".lower()
            if q in hay:
                results.append({"id": d["id"], "title": d["title"], "url": d["url"]})
        return {"results": results}

    @mcp.tool()
    async def fetch(id: str) -> Dict[str, Any]:
        doc = next((d for d in DEMO_DOCS if d["id"] == id), None)
        if not doc:
            raise ValueError("not_found")
        return {
            "id": doc["id"],
            "title": doc["title"],
            "text": doc["text"],
            "url": doc["url"],
            "metadata": {"source": "demo"}
        }

    return mcp

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    log = logging.getLogger("mcp")
    server = mk_server()
    if TRANSPORT not in ("http", "sse"):
        raise ValueError("TRANSPORT must be 'http' or 'sse'")
    log.info(f"Starting MCP server on {HOST}:{PORT} with transport={TRANSPORT}")
    server.run(transport=TRANSPORT, host=HOST, port=PORT)
```

## 1.3 Starten

```powershell
.\.venv\Scripts\Activate.ps1
python .\server.py
```

Erwartete Logs (Beispiele):

* `Uvicorn running on http://0.0.0.0:8000`
* `Created new transport with session ID: ...` (wenn ein Client korrekt eine Session eröffnet)
* `Auth OK with audience=mcp-api` (bei erfolgreicher Token-Verifikation)

---

# Schritt 2 – Cloudflare Tunnel

Ziel: `mcp.naniderechte.cloud` → **lokal 127.0.0.1:8000**

1. **cloudflared** installieren (Windows Service ist ok).
2. In **Cloudflare Dashboard → Zero Trust → Tunnels**:

   * **Route / Hostname**:

     * **Hostname**: `mcp.naniderechte.cloud`
     * **Service**: `http://127.0.0.1:8000`
   * Speichern.

> Test:
>
> ```powershell
> iwr https://mcp.naniderechte.cloud/__worker  # kommt später vom Worker; bis dahin 404 ok
> ```

---

# Schritt 3 – Auth0 einrichten

## 3.1 Custom API (Resource Server)

* **APIs → Create API**

  * Name: `DL MCP API`
  * Identifier: `mcp-api`  ← **genau so**
  * Signing: `RS256`
  * Scopes: (optional; zum Start keine)

> **Wichtig:** Das Token, das ChatGPT erhält, muss eine **aud** = `mcp-api` haben.

## 3.2 M2M-App für DCR-Proxy

* **Applications → Create Application**

  * Name: `MCP DCR Proxy`
  * Type: **Machine to Machine**
* **M2M App → APIs → Authorize**:

  * **Auth0 Management API**: Scopes mindestens
    `create:clients` (+empfohlen `read:clients`)
  * (Kein Grant für `mcp-api` nötig – DCR nutzt Management API, nicht deine Custom API)

> Diese M2M-App liefert **Client ID/Secret** für den Worker, damit er `/oidc/register` bedienen kann.

---

# Schritt 4 – Cloudflare Worker (OIDC-Proxy)

## 4.1 Worker erstellen

* **Workers & Pages → Create → Worker**
* Name: `mcp-wellknown-rewrite`
* **Routes**: `mcp.naniderechte.cloud/*`

## 4.2 Worker-Code (final)

```js
// mcp-wellknown-rewrite/index.js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const PUBLIC_BASE = url.origin; // https://mcp.naniderechte.cloud
    const AUTH0_ISSUER = `https://${env.AUTH0_DOMAIN}`;
    const A0 = {
      wellKnown: `${AUTH0_ISSUER}/.well-known/openid-configuration`,
      wellKnownAS: `${AUTH0_ISSUER}/.well-known/oauth-authorization-server`,
      authorize: `${AUTH0_ISSUER}/authorize`,
      token: `${AUTH0_ISSUER}/oauth/token`,
      mgmtToken: `${AUTH0_ISSUER}/oauth/token`,
      mgmtClients: `${AUTH0_ISSUER}/api/v2/clients`,
      jwks: `${AUTH0_ISSUER}/.well-known/jwks.json`
    };

    // Health
    if (url.pathname === "/__worker") {
      return json({ ok: true, v: 5 });
    }

    // 1) MCP Resource Discovery unter /mcp/.well-known/...
    if (url.pathname === "/mcp/.well-known/oauth-protected-resource") {
      return json({
        resource: `${PUBLIC_BASE}/mcp`,
        authorization_servers: [AUTH0_ISSUER],
        scopes_supported: [],
        bearer_methods_supported: ["header"],
      });
    }

    // 2) Well-knowns an Root: auf DEINE Proxy-Endpunkte umschreiben
    if (
      url.pathname === "/.well-known/openid-configuration" ||
      url.pathname === "/.well-known/openid-configuration/mcp" ||
      url.pathname === "/.well-known/oauth-authorization-server" ||
      url.pathname === "/.well-known/oauth-authorization-server/mcp"
    ) {
      const src = url.pathname.includes("oauth-authorization-server")
        ? A0.wellKnownAS
        : A0.wellKnown;

      const res = await fetch(src, { cf: { cacheTtl: 60, cacheEverything: true } });
      const data = await res.json();

      // Nur Endpunkte überschreiben – Issuer/JWKS bleiben Auth0
      data.authorization_endpoint = `${PUBLIC_BASE}/authorize`;
      data.token_endpoint = `${PUBLIC_BASE}/oauth/token`;
      data.registration_endpoint = `${PUBLIC_BASE}/oidc/register`;

      return json(data, { headers: corsJson() });
    }

    // 3) /authorize: resource → audience mappen
    if (url.pathname === "/authorize") {
      const q = urlSearchToObject(url.searchParams);
      const resource = q.resource || q.audience || `${PUBLIC_BASE}/mcp`;
      // Ziel-Audience für dein Token:
      q.audience = env.AUTH0_AUDIENCE || "mcp-api";
      q.resource = resource;

      // Minimal-Scopes
      const scopes = new Set(`${q.scope || ""} openid offline_access`.trim().split(/\s+/).filter(Boolean));
      q.scope = Array.from(scopes).join(" ");

      const authUrl = new URL(A0.authorize);
      Object.entries(q).forEach(([k, v]) => authUrl.searchParams.set(k, v));
      return Response.redirect(authUrl.toString(), 302);
    }

    // 4) Token-Endpoint Proxy
    if (url.pathname === "/oauth/token") {
      const body = await request.arrayBuffer();
      const prox = await fetch(A0.token, {
        method: "POST",
        headers: copyHeaders(request.headers, ["content-type"]),
        body,
      });
      return new Response(prox.body, { status: prox.status, headers: corsJson(prox.headers) });
    }

    // 5) Dynamic Client Registration (DCR) via Management API
    if (url.pathname === "/oidc/register" && request.method === "POST") {
      const mgmtToken = await getMgmtToken(env, A0);
      if (!mgmtToken) return json({ error: "mgmt_token_failed" }, { status: 500 });

      const req = await request.json().catch(() => ({}));
      const payload = {
        name: req.client_name || "MCP Auto Client",
        app_type: "regular_web",
        oidc_conformant: true,
        token_endpoint_auth_method: req.token_endpoint_auth_method || "none",
        grant_types: ["authorization_code", "refresh_token"],
        callbacks: req.redirect_uris || ["https://oauth.openai.com/native"],
        web_origins: ["https://chat.openai.com", "https://chatgpt.com"],
      };

      const create = await fetch(A0.mgmtClients, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${mgmtToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!create.ok) {
        const text = await create.text();
        return json({ error: "dcr_failed", status: create.status, body: text }, { status: 400 });
      }

      const cli = await create.json();
      return json({
        client_name: cli.name,
        client_id: cli.client_id,
        client_secret: cli.client_secret, // bei "none" ungenutzt
        redirect_uris: payload.callbacks,
        token_endpoint_auth_method: payload.token_endpoint_auth_method,
      }, { status: 201 });
    }

    // Alles andere: an Origin (Tunnel → MCP-Server)
    return fetch(request);
  }
};

// ------- helpers -------
function json(obj, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(obj), { ...init, headers });
}
function corsJson(srcHeaders) {
  const h = new Headers(srcHeaders || {});
  h.set("content-type", "application/json; charset=utf-8");
  return h;
}
function copyHeaders(h, allow) {
  const out = new Headers();
  allow.forEach(k => { if (h.get(k)) out.set(k, h.get(k)); });
  return out;
}
function urlSearchToObject(sp) {
  const o = {};
  for (const [k, v] of sp.entries()) o[k] = v;
  return o;
}
async function getMgmtToken(env, A0) {
  const body = {
    grant_type: "client_credentials",
    client_id: env.AUTH0_CLIENT_ID,
    client_secret: env.AUTH0_CLIENT_SECRET,
    audience: `https://${env.AUTH0_DOMAIN}/api/v2/`,
  };
  const res = await fetch(A0.mgmtToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token;
}
```

## 4.3 Worker Variablen/Secrets setzen

**Variables and Secrets**:

* `AUTH0_DOMAIN` = `earlysalty.eu.auth0.com`
* `AUTH0_AUDIENCE` = `mcp-api`
* `AUTH0_CLIENT_ID` = **Client ID der M2M-App „MCP DCR Proxy“**
* `AUTH0_CLIENT_SECRET` = **Secret der M2M-App** (als **Secret** anlegen)
* `PUBLIC_BASE` = `https://mcp.naniderechte.cloud`

**Route**: `mcp.naniderechte.cloud/*` (bereits gesetzt)

**Smoke-Test**:

```powershell
iwr https://mcp.naniderechte.cloud/__worker | % Content
# {"ok":true,"v":5}

(iwr https://mcp.naniderechte.cloud/.well-known/openid-configuration | ConvertFrom-Json).authorization_endpoint
# https://mcp.naniderechte.cloud/authorize

(iwr https://mcp.naniderechte.cloud/.well-known/oauth-authorization-server | ConvertFrom-Json).token_endpoint
# https://mcp.naniderechte.cloud/oauth/token

iwr https://mcp.naniderechte.cloud/mcp/.well-known/oauth-protected-resource | % Content
# {"resource":"https://mcp.naniderechte.cloud/mcp", ...}
```

**DCR-Test** (optional):

```powershell
$body = '{"application_type":"web","redirect_uris":["https://oauth.openai.com/native"],"token_endpoint_auth_method":"none"}'
iwr -Method POST https://mcp.naniderechte.cloud/oidc/register -ContentType 'application/json' -Body $body
# StatusCode: 201, JSON enthält client_id, token_endpoint_auth_method usw.
```

---

# Schritt 5 – End-to-End-Tests

## 5.1 Manuelle Tokenprobe (nur zum Debuggen)

**M2M-Token** für `mcp-api` holen (zum Testen, nicht was ChatGPT benutzt):

```powershell
$resp = Invoke-RestMethod -Method POST https://earlysalty.eu.auth0.com/oauth/token `
  -ContentType 'application/json' `
  -Body (@{
    grant_type    = 'client_credentials'
    client_id     = '<DEINE_M2M_CLIENT_ID>'        # MCP DCR Proxy
    client_secret = '<DEIN_SECRET>'
    audience      = 'mcp-api'
  } | ConvertTo-Json)

$token = $resp.access_token
$token
```

**Nur für Funktionsprobe** (ChatGPT macht später Auth Code + PKCE):

```powershell
# erwarten: JSON-RPC Fehler "Missing session ID" => Auth ok, nur keine Session
Invoke-WebRequest https://mcp.naniderechte.cloud/mcp `
  -Headers @{ Accept='text/event-stream'; Authorization="Bearer $token" } `
  -Method GET
```

Server-Log bei erfolgreicher Verifikation:

* `Auth OK with audience=mcp-api`
* Bei manuellem GET ohne vorherige Session: `Bad Request: Missing session ID` (erwartet)

## 5.2 ChatGPT Connector hinzufügen

* In ChatGPT: **Settings → Connectors → Advanced → Developer mode** aktivieren
* „**Add custom MCP server**“

  * **Server URL**: `https://mcp.naniderechte.cloud/mcp`
  * Allowed tools: `search`, `fetch`
  * Approval: z. B. „never“ (zum Testen)
* Chat öffnen, Connector auswählen, z. B. Prompt: “search cats”

**Erwartung in Server-Logs**:

* `POST /mcp 200 OK` (Session erzeugt)
* `GET /mcp 200 OK`
* `Processing request of type ListToolsRequest`
* evtl. `DELETE /mcp 200 OK` beim Session-Close

---

# Troubleshooting (Fehler → Ursache → Fix)

**`invalid_token | Authentication required`**

* Ursache: Kein/ungültiger `Authorization: Bearer` Header bei `/mcp`.
* Fix: Worker muss Header durchlassen (er tut’s: `return fetch(request)`); Client muss Token mitsenden.
* Test: `Invoke-WebRequest https://mcp.naniderechte.cloud/debug/echo -Headers @{ Authorization="Bearer <token>" }`

**`Bearer token rejected for client google-oauth2|...` (Server-Log)**

* Ein Token mit falscher **aud** wurde geschickt (z. B. Social-ID-Token, kein Access-Token für `mcp-api`).
* Fix: Worker /authorize setzt `audience = mcp-api`. Stelle sicher, dass ChatGPT wirklich den Proxypfad nutzt (Well-Known ok).

**`dynamic client registration is disabled`**

* Das war, bevor der Worker `/oidc/register` implementierte. Mit dem Worker verschwindet das (DCR via Mgmt API).

**404 auf Well-Known unter `/mcp`**

* Behebt der Worker mit `/mcp/.well-known/oauth-protected-resource`.

**`Bad Request: Missing session ID` (bei GET /mcp)**

* Normal bei manuellen Tests ohne vorherigen Session-`POST`. ChatGPT macht das automatisch.

**`Client is not authorized to access "mcp-api"`**

* Die M2M-App „MCP DCR Proxy“ wollte `aud=mcp-api` (Client Credentials) – nicht nötig fürs End-to-End.
  Für DCR brauchst du **Management-API Scopes** (mind. `create:clients`). Für manuelle M2M-Tests mit `aud=mcp-api` müsstest du die App der API **explizit authorisieren** – ist aber optional.

---

# Sicherheit (Production-Härtung)

* In `server.py`: `ALLOW_DYNAMIC_AUDIENCE_DEV = False` setzen.
* In Auth0 Custom API ggf. **RBAC** + Scopes aktivieren; Worker könnte `scope` reduzieren.
* Worker-Route nur für deinen Subdomain-Host.
* Cloudflare **Access** vor den Tunnel setzen (optional).
* Management-Scopes im M2M-Client auf Minimum (`create:clients` reicht oft).
* Secrets rotieren (Cloudflare Worker Secret + M2M Secret).

---

# Checkliste „läuft“

* `https://mcp.naniderechte.cloud/__worker` → `{"ok":true,"v":5}`
* `/.well-known/openid-configuration` → `authorization_endpoint` zeigt auf `https://mcp.naniderechte.cloud/authorize`
* `/.well-known/oauth-authorization-server` → `token_endpoint` zeigt auf `https://mcp.naniderechte.cloud/oauth/token`
* `/mcp/.well-known/oauth-protected-resource` → `resource` = `https://mcp.naniderechte.cloud/mcp`
* Server-Start: `Uvicorn running ...`
* ChatGPT Connector: `POST /mcp 200`, `GET /mcp 200`, `ListToolsRequest` im Log

absolut — ich lass die Doku sonst **1:1** wie vorher und ergänze nur den fehlenden Schritt für die **M2M-Autorisierung deiner Custom API (`mcp-api`) in Auth0**.

---

# ➕ Ergänzung (Auth0: API → Machine-to-Machine Applications)

Damit **Client-Credentials-Tokens** für `mcp-api` ausgegeben werden (z. B. für deine manuellen Tests mit PowerShell oder spätere Service-to-Service-Aufrufe), musst du in Auth0 die entsprechenden **Applications** für deine **Custom API `mcp-api`** autorisieren:

1. **Auth0 → APIs → „DL MCP API“ (Identifier: `mcp-api`) → Tab „Machine to Machine Applications“**

2. Stelle den **Toggle auf „Authorized“** für die Apps, die per **client\_credentials** auf `mcp-api` zugreifen sollen. In deinem Setup:

   * ✅ **MCP DCR Proxy** (`Client ID: BMAfh8o5B8Bjn9E1a42xtUHWKTeAz3pW`) — **empfohlen/benötigt**, wenn du wie gezeigt M2M-Tokens gegen `mcp-api` ziehst (z. B. zum Debuggen).
   * ✅ **DL MCP API (Test Application)** (`Client ID: 3BnfI0rx5iHCLK3UaiTnRnvAW0r1hBKn`) — **falls** du sie für M2M-Tests nutzt.

   (In deiner Liste waren z. B. auch mehrere **„ChatGPT“**-Apps. **Diese müssen hier nicht autorisiert** werden, denn ChatGPT nutzt für Benutzer-Flows **Authorization Code + PKCE**, nicht Client Credentials. Es schadet nicht, sie hier „Unauthorized“ zu lassen.)

3. **Check** (optional, wie in der Doku gezeigt):

   ```powershell
   $resp = Invoke-RestMethod -Method POST https://earlysalty.eu.auth0.com/oauth/token `
     -ContentType 'application/json' `
     -Body (@{
       grant_type    = 'client_credentials'
       client_id     = '<AUTHORIZED_APP_CLIENT_ID>'     # z. B. MCP DCR Proxy
       client_secret = '<SECRET>'
       audience      = 'mcp-api'
     } | ConvertTo-Json)

   $token = $resp.access_token
   # aud im Payload muss "mcp-api" sein
   Invoke-WebRequest https://mcp.naniderechte.cloud/mcp `
     -Headers @{ Accept='text/event-stream'; Authorization="Bearer $token" } -Method GET
   ```

   Erwartung: kein `invalid_token`; bei direktem GET ohne Session ggf. „Missing session ID“ (okay).

> **Wichtig zur Einordnung**
>
> * **Pflicht** ist diese Autorisierung **nur** für **M2M/Client-Credentials** gegen `mcp-api` (z. B. deine PowerShell-Tests).
> * Für den regulären ChatGPT-Flow (Auth Code + PKCE, Audience `mcp-api`) ist **keine** M2M-Autorisierung der ChatGPT-Apps nötig. Dafür sorgt unser Worker mit den umgeschriebenen **Well-Known**-Endpoints und `/authorize`-Rewrite (Audience-Mapping).
