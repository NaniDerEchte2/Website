// filename: mcp-wellknown-rewrite/index.js

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const PUBLIC_BASE = env.PUBLIC_BASE || url.origin; // z.B. https://mcp.naniderechte.cloud
    const AUTH0_ISSUER = `https://${env.AUTH0_DOMAIN}`;
    const A0 = {
      wellKnown: `${AUTH0_ISSUER}/.well-known/openid-configuration`,
      wellKnownAS: `${AUTH0_ISSUER}/.well-known/oauth-authorization-server`,
      authorize: `${AUTH0_ISSUER}/authorize`,
      token: `${AUTH0_ISSUER}/oauth/token`,
      mgmtToken: `${AUTH0_ISSUER}/oauth/token`,
      mgmtClients: `${AUTH0_ISSUER}/api/v2/clients`,
      jwks: `${AUTH0_ISSUER}/.well-known/jwks.json`,
    };

    // --- kleine Health/Version
    if (url.pathname === "/__worker") {
      return json({ ok: true, v: 6 });
    }

    // --- DEBUG: zeigt, ob Authorization-Header am Edge ankommt
    if (url.pathname === "/debug/echo") {
      const auth = request.headers.get("authorization") || "";
      return json({
        hasAuth: !!auth,
        authPrefix: auth.slice(0, 16),
        length: auth.length,
        ua: request.headers.get("user-agent") || "",
        path: url.pathname + url.search
      });
    }

    // ---- 1) MCP Resource-Discovery unter /mcp/.well-known/...
    if (url.pathname === "/mcp/.well-known/oauth-protected-resource") {
      return json({
        resource: `${PUBLIC_BASE}/mcp`,
        authorization_servers: [AUTH0_ISSUER],
        scopes_supported: [],
        bearer_methods_supported: ["header"],
      });
    }

    // ---- 2) Well-known auf Root (zeigt auf DEINE Proxy-Endpoints)
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

      data.authorization_endpoint = `${PUBLIC_BASE}/authorize`;
      data.token_endpoint = `${PUBLIC_BASE}/oauth/token`;
      data.registration_endpoint = `${PUBLIC_BASE}/oidc/register`;

      return json(data, { headers: corsJson() });
    }

    // ---- 3) /authorize → an Auth0, audience forcieren
    if (url.pathname === "/authorize") {
      const q = urlSearchToObject(url.searchParams);
      const resource = q.resource || q.audience || `${PUBLIC_BASE}/mcp`;

      q.audience = env.AUTH0_AUDIENCE || "mcp-api";
      q.resource = resource;

      const scopes = new Set(
        `${q.scope || ""} openid offline_access`.trim().split(/\s+/).filter(Boolean)
      );
      q.scope = Array.from(scopes).join(" ");

      const authUrl = new URL(A0.authorize);
      Object.entries(q).forEach(([k, v]) => authUrl.searchParams.set(k, v));
      return Response.redirect(authUrl.toString(), 302);
    }

    // ---- 4) Token passthrough
    if (url.pathname === "/oauth/token") {
      const body = await request.arrayBuffer();
      const prox = await fetch(A0.token, {
        method: "POST",
        headers: copyHeaders(request.headers, ["content-type"]),
        body,
      });
      return new Response(prox.body, {
        status: prox.status,
        headers: corsJson(prox.headers),
      });
    }

    // ---- 5) Dynamic Client Registration via Management API
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
          authorization: `Bearer ${mgmtToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!create.ok) {
        const text = await create.text();
        return json({ error: "dcr_failed", status: create.status, body: text }, { status: 400 });
      }

      const cli = await create.json();
      return json(
        {
          client_name: cli.name,
          client_id: cli.client_id,
          client_secret: cli.client_secret,
          redirect_uris: payload.callbacks,
          token_endpoint_auth_method: payload.token_endpoint_auth_method,
        },
        { status: 201 }
      );
    }

    // ---- 6) EXPLIZITES PASSTHROUGH (Authorization garantieren)
    // Wir bauen die Origin-URL exakt neu und übergeben Header/Body manuell.
    const originUrl = `${PUBLIC_BASE}${url.pathname}${url.search}`;
    const init = {
      method: request.method,
      headers: request.headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      redirect: "manual",
    };
    return fetch(originUrl, init);
  },
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
  allow.forEach((k) => {
    if (h.get(k)) out.set(k, h.get(k));
  });
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
