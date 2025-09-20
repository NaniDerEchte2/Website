import logging, json, base64, os, shutil
from pathlib import Path
from typing import Dict, List, Any, Iterable
from urllib.parse import urlsplit

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

# ORIGIN korrekt aus der URL parsen (keine String-Splits!)
_parts = urlsplit(PUBLIC_BASE_URL)
PUBLIC_ORIGIN = f"{_parts.scheme}://{_parts.netloc}"

# Auth0/OIDC
AUTH_ISSUER   = "https://earlysalty.eu.auth0.com/"
AUTH_JWKS_URI = "https://earlysalty.eu.auth0.com/.well-known/jwks.json"

# Primär erlaubte Audiences (API-ID + Resource-URL)
PRIMARY_AUDIENCE   = "mcp-api"
SECONDARY_AUDIENCE = PUBLIC_BASE_URL

# ---- DEV/PROD-Schalter ----
ALLOW_DYNAMIC_AUDIENCE_DEV = True
DEBUG_LOG_CLAIMS = True

# =======================
# Filesystem-Sandbox
# =======================
FS_BASE = Path(r"C:\sites\dl-landing").resolve()

def _safe_path(rel: str) -> Path:
    p = (FS_BASE / rel).resolve()
    if os.path.commonpath([str(p), str(FS_BASE)]) != str(FS_BASE):
        raise ValueError("path_outside_base")
    return p

def _b64url_decode(seg: str) -> bytes:
    seg = seg.split('.')[0] if '.' in seg else seg
    pad = '=' * (-len(seg) % 4)
    return base64.urlsafe_b64decode(seg + pad)

def _peek_claims_unverified(jwt_token: str) -> dict:
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

class MultiAudienceVerifier(JWTVerifier):
    def __init__(self, jwks_uri: str, issuer: str, base_audiences: Iterable[str]):
        primary = next(iter(base_audiences))
        super().__init__(jwks_uri=jwks_uri, issuer=issuer, audience=primary)
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
        last_err = None
        for aud in self._audiences:
            try:
                self.audience = aud
                verified = super().verify(token)
                return verified
            except Exception as e:
                last_err = e
        if ALLOW_DYNAMIC_AUDIENCE_DEV and token:
            claims = _peek_claims_unverified(token)
            for aud in _as_list(claims.get("aud")):
                try:
                    self.audience = aud
                    verified = super().verify(token)
                    self._log.warning(f"DEV-ONLY: Auth OK with dynamic audience '{aud}'.")
                    return verified
                except Exception as e:
                    last_err = e
        if last_err:
            raise last_err
        raise Exception("token verification failed")

def build_auth_provider() -> RemoteAuthProvider:
    verifier = MultiAudienceVerifier(
        jwks_uri=AUTH_JWKS_URI,
        issuer=AUTH_ISSUER,
        base_audiences=[PRIMARY_AUDIENCE, SECONDARY_AUDIENCE],
    )
    return RemoteAuthProvider(
        token_verifier=verifier,
        # Wichtig: Authorization-Server = ORIGIN deines Proxys (ohne /mcp)
        authorization_servers=[PUBLIC_ORIGIN],
        base_url=PUBLIC_BASE_URL.rstrip("/"),
    )

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

def mk_server() -> FastMCP:
    mcp = FastMCP(
        name="dl-mcp",
        instructions=("search liefert Resultate als JSON-Array (id,title,url). "
                      "fetch liefert das vollständige Dokument mit text und metadata."),
        auth=build_auth_provider(),
    )

    # ---- Demo-Tools ----
    @mcp.tool()
    async def search(query: str) -> Dict[str, List[Dict[str, Any]]]:
        """Mini-Volltextsuche über Demo-Dokumente."""
        q = (query or "").lower()
        results = []
        for d in DEMO_DOCS:
            hay = f"{d['title']} {d['text']}".lower()
            if q in hay:
                results.append({"id": d["id"], "title": d["title"], "url": d["url"]})
        return {"results": results}

    @mcp.tool()
    async def fetch(id: str) -> Dict[str, Any]:
        """Dokument inklusive Text & Metadaten laden."""
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

    # ---- Filesystem-Tools (Sandbox: FS_BASE)
    @mcp.tool()
    async def fs_list(path: str = ".", glob: str = "*") -> Dict[str, Any]:
        """Dateien/Ordner im Workspace auflisten."""
        base = _safe_path(path)
        if not base.exists():
            return {"exists": False, "items": []}
        items = []
        for p in base.glob(glob):
            items.append({
                "path": str(p.relative_to(FS_BASE)),
                "is_dir": p.is_dir(),
                "size": p.stat().st_size if p.is_file() else None,
            })
        return {"exists": True, "items": items}

    @mcp.tool()
    async def fs_stat(path: str) -> Dict[str, Any]:
        """Metadaten einer Datei/eines Ordners."""
        p = _safe_path(path)
        if not p.exists():
            return {"exists": False}
        st = p.stat()
        return {
            "exists": True,
            "is_dir": p.is_dir(),
            "size": st.st_size if p.is_file() else None,
            "mtime": st.st_mtime,
            "path": str(p.relative_to(FS_BASE)),
        }

    @mcp.tool()
    async def fs_read(path: str, binary: bool = False, encoding: str = "utf-8") -> Dict[str, Any]:
        """Datei lesen (Text oder Base64 bei Binär)."""
        p = _safe_path(path)
        if not p.exists() or not p.is_file():
            raise ValueError("not_found")
        if binary:
            data = p.read_bytes()
            return {"binary": True, "base64": base64.b64encode(data).decode("ascii")}
        else:
            text = p.read_text(encoding=encoding, errors="replace")
            return {"binary": False, "text": text}

    @mcp.tool()
    async def fs_write(path: str, content: str, binary: bool = False,
                       mode: str = "w", encoding: str = "utf-8") -> Dict[str, Any]:
        """Datei schreiben/erstellen (parents werden angelegt)."""
        p = _safe_path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        if binary:
            data = base64.b64decode(content.encode("ascii"))
            with open(p, "wb") as f:
                f.write(data)
        else:
            with open(p, mode, encoding=encoding, errors="replace") as f:
                f.write(content)
        return {"ok": True, "path": str(p.relative_to(FS_BASE))}

    @mcp.tool()
    async def fs_mkdir(path: str, exist_ok: bool = True) -> Dict[str, Any]:
        """Ordner anlegen (mkdir -p)."""
        p = _safe_path(path)
        p.mkdir(parents=True, exist_ok=exist_ok)
        return {"ok": True}

    @mcp.tool()
    async def fs_delete(path: str, recursive: bool = False) -> Dict[str, Any]:
        """Datei/Ordner löschen (optional rekursiv)."""
        p = _safe_path(path)
        if not p.exists():
            return {"ok": True, "deleted": False}
        if p.is_dir():
            if recursive:
                shutil.rmtree(p)
            else:
                p.rmdir()
        else:
            p.unlink()
        return {"ok": True, "deleted": True}

    @mcp.tool()
    async def fs_move(src: str, dst: str, overwrite: bool = False) -> Dict[str, Any]:
        """Datei/Ordner verschieben/umbenennen."""
        s = _safe_path(src)
        d = _safe_path(dst)
        d.parent.mkdir(parents=True, exist_ok=True)
        if d.exists() and not overwrite:
            raise ValueError("destination_exists")
        shutil.move(str(s), str(d))
        return {"ok": True}

    @mcp.tool()
    async def fs_copy(src: str, dst: str, overwrite: bool = False) -> Dict[str, Any]:
        """Datei/Ordner kopieren."""
        s = _safe_path(src)
        d = _safe_path(dst)
        d.parent.mkdir(parents=True, exist_ok=True)
        if d.exists() and not overwrite:
            raise ValueError("destination_exists")
        if s.is_dir():
            shutil.copytree(s, d, dirs_exist_ok=overwrite)
        else:
            shutil.copy2(s, d)
        return {"ok": True}

    return mcp

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    log = logging.getLogger("mcp")
    server = mk_server()
    if TRANSPORT not in ("http", "sse"):
        raise ValueError("TRANSPORT must be 'http' or 'sse'")
    log.info(f"Starting MCP server on {HOST}:{PORT} with transport={TRANSPORT}")
    server.run(transport=TRANSPORT, host=HOST, port=PORT)
