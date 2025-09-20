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
AUTH_ISSUER   = "https://earlysalty.eu.auth0.com/"  # WICHTIG: mit abschließendem /
AUTH_JWKS_URI = "https://earlysalty.eu.auth0.com/.well-known/jwks.json"

# Erlaubte Audiences
PRIMARY_AUDIENCE   = "mcp-api"
SECONDARY_AUDIENCE = PUBLIC_BASE_URL

# DEV-Features
ALLOW_DYNAMIC_AUDIENCE_DEV = True
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
# Helpers (JWT peek)
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
            "exp": payload.get("exp"),
            "iat": payload.get("iat"),
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
    Prüft zuerst fixe Audiences; in DEV optional 'aud' aus dem Token akzeptieren.
    Zusätzlich: sehr ausführliches Logging bei Fehlern.
    """
    def __init__(self, jwks_uri: str, issuer: str, base_audiences: Iterable[str]):
        # WICHTIG: issuer HIER NICHT rstrippen → exakt wie im Token (mit trailing /)
        primary = next(iter(base_audiences))
        super().__init__(jwks_uri=jwks_uri, issuer=issuer, audience=primary)
        self._audiences = list(base_audiences)
        self._log = logging.getLogger("mcp")

    def verify(self, token: str):
        # Debug-Claims anzeigen
        if DEBUG_LOG_CLAIMS and token:
            claims = _peek_claims_unverified(token)
            if claims:
                self._log.info(
                    "DEBUG token claims: iss=%s aud=%s azp=%s sub=%s scope=%s iat=%s exp=%s",
                    claims.get('iss'), claims.get('aud'), claims.get('azp'),
                    claims.get('sub'), claims.get('scope'),
                    claims.get('iat'), claims.get('exp')
                )

        # 1) Fixe Audiences probieren (mit Fehlerdetails)
        last_err = None
        for aud in self._audiences:
            try:
                self.audience = aud
                verified = super().verify(token)
                if aud == PRIMARY_AUDIENCE:
                    self._log.info("Auth OK with audience='%s'", aud)
                else:
                    self._log.info("Auth OK with audience='%s' (resource-style)", aud)
                return verified
            except Exception as e:
                last_err = e
                self._log.warning("Verify failed with audience='%s': %s", aud, e)

        # 2) DEV-Fallback
        if ALLOW_DYNAMIC_AUDIENCE_DEV and token:
            claims = _peek_claims_unverified(token)
            for aud in _as_list(claims.get("aud")):
                try:
                    self.audience = aud
                    verified = super().verify(token)
                    self._log.warning(
                        "DEV-ONLY: Auth OK with dynamic audience '%s'. "
                        "Bitte in PROD abschalten und korrekte audience erzwingen.", aud
                    )
                    return verified
                except Exception as e:
                    last_err = e
                    self._log.warning("Verify failed with dynamic audience='%s': %s", aud, e)

        # 3) Fehlgeschlagen → detailliert loggen
        if last_err:
            self._log.error("Bearer token rejected (final): %s", last_err)
            raise last_err
        raise Exception("token verification failed (no details)")

# =======================
# Auth-Provider
# =======================
def build_auth_provider() -> RemoteAuthProvider:
    verifier = MultiAudienceVerifier(
        jwks_uri=AUTH_JWKS_URI,
        issuer=AUTH_ISSUER,  # exakt mit trailing /
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
