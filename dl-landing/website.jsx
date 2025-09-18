import React, { useEffect, useMemo, useState } from "react";

/**
 * Deadlock Community – Landingpage SPA
 * --------------------------------------------------------
 * ✅ Features
 * - Modern, responsive landing page
 * - Hash-based routing (no server setup required)
 * - Pages: Home, Guides, News, Videos, About (easily extendable)
 * - Forum-like posts (guides/news) with tags + search
 * - Simple page builder (create custom pages) – saved in localStorage
 * - YouTube video gallery (paste a YouTube URL)
 * - Newsletter signup (stores locally; integrate Mailchimp/Brevo easily)
 * - Discord CTA + optional Discord server widget embed
 * - Simple site-wide Settings: GA4 ID, Discord Invite URL, Discord Widget ID
 * - Google Analytics 4 opt-in: injects GA4 only if configured
 * - Minimal design using Tailwind utility classes
 *
 * 🛠 How to extend
 * - Add new routes: add to NAV_ITEMS + add a case in <Router />
 * - Add starter posts/videos: edit INITIAL_CONTENT below
 * - Plug real newsletter backend: hook newsletterSubmit() to your API
 * - Enable GA4: open ⚙️ Settings → set Measurement ID (e.g., G-XXXXXXX)
 * - Embed Discord widget: set Widget ID in ⚙️ Settings
 *
 * ⚡ Deploy
 * - As a single-page app, can be served by any static host (Nginx, Netcup).
 * - If you export this component into an index.html with React, you’re done.
 */

// ------------------------- Utilities -------------------------
const NAV_ITEMS = [
  { label: "Home", path: "#/" },
  { label: "Guides", path: "#/guides" },
  { label: "News", path: "#/news" },
  { label: "Videos", path: "#/videos" },
  { label: "About", path: "#/about" },
];

const STORAGE_KEYS = {
  customPages: "dl_custom_pages_v1",
  posts: "dl_posts_v1",
  videos: "dl_videos_v1",
  newsletter: "dl_newsletter_emails_v1",
  settings: "dl_site_settings_v1",
};

function cls(...parts) {
  return parts.filter(Boolean).join(" ");
}

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash;
}

function useLocalStorage(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);
  return [state, setState];
}

// Super-light Markdown-ish renderer (headings, bold, italics, code, lists)
function renderLiteMarkdown(md) {
  if (!md) return null;
  let html = md
    .replace(/^###\s(.+)$/gm, "<h3>$1</h3>")
    .replace(/^##\s(.+)$/gm, "<h2>$1</h2>")
    .replace(/^#\s(.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^\-\s(.+)$/gm, "<li>$1</li>");
  // wrap loose <li> with <ul>
  html = html.replace(/(<li>.*<\/li>\n?)+/gs, (m) => `<ul class="list-disc pl-6 space-y-1">${m}</ul>`);
  html = html.replace(/\n/g, "<br/>");
  return <div className="prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------------------- Starter Content ----------------------
const INITIAL_CONTENT = {
  posts: [
    {
      id: crypto.randomUUID(),
      type: "guide",
      title: "Erste Schritte auf dem Deadlock-Discord",
      tags: ["getting-started", "rollen", "voice"],
      body: `# Willkommen!\n\n**So legst du los:**\n- Lies die Regeln\n- Hol dir Rollen über #rollen\n- Tritt Voice-Channels bei – Matchmaking-Helfer läuft\n\n*Tipp:* Stelle dich in Steam auf **Online**, damit unsere Live-Status-Tools dich perfekt erfassen.`,
      createdAt: Date.now() - 86400000 * 5,
    },
    {
      id: crypto.randomUUID(),
      type: "news",
      title: "Fun Turnier – Ankündigung",
      tags: ["tournament", "events"],
      body: `## Fun Cup am Samstag\n\n- Check-in 17:30\n- Start 18:00\n- Stream auf Twitch, Highlights auf YT\n\nMelde dich im #events Channel an!`,
      createdAt: Date.now() - 86400000 * 2,
    },
  ],
  videos: [
    {
      id: crypto.randomUUID(),
      title: "Coaching Basics für Low Elo",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      createdAt: Date.now() - 86400000 * 3,
    },
  ],
  customPages: [
    {
      id: crypto.randomUUID(),
      title: "Coaching & Förderung",
      slug: "coaching",
      content: `# Coaching & Förderung\n\nWir fördern **aktive Members** mit 1:1-Feedback, VOD-Reviews und **Scrim-Organisation**.\n\n- Bewerbe dich im #coaching Kanal\n- Trainingszeiten: Mi & So 20:00\n- Anforderungen: Freundlich, Lernbereitschaft, Mic`,
    },
  ],
};

// ------------------------ Analytics -------------------------
function useGA(measurementId) {
  useEffect(() => {
    if (!measurementId) return;
    // Inject GA4
    if (!window.dataLayer) window.dataLayer = [];
    function gtag(){ window.dataLayer.push(arguments); }
    // Create script tag once
    const existing = document.getElementById("ga4-script");
    if (!existing) {
      const s = document.createElement("script");
      s.id = "ga4-script";
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
      document.head.appendChild(s);
    }
    // Config
    gtag("js", new Date());
    gtag("config", measurementId);
  }, [measurementId]);
}

// ------------------------- Layout ---------------------------
function Container({ children }) {
  return <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">{children}</div>;
}

function Badge({ children }) {
  return <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-white/10 border border-white/10">{children}</span>;
}

function Card({ title, subtitle, children, footer }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-sm hover:shadow transition">
      {title && (
        <div className="mb-2">
          <h3 className="text-lg font-semibold">{title}</h3>
          {subtitle && <p className="text-sm text-white/70">{subtitle}</p>}
        </div>
      )}
      <div className="text-white/90">{children}</div>
      {footer && <div className="mt-4 text-sm text-white/70">{footer}</div>}
    </div>
  );
}

function Hero({ onOpenSettings, inviteUrl }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-700/50 via-slate-900 to-black p-8 md:p-14">
      <div className="absolute -top-20 -left-20 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl"/>
      <div className="absolute -bottom-16 -right-16 h-64 w-64 rounded-full bg-fuchsia-500/10 blur-3xl"/>
      <div className="relative">
        <div className="flex items-center gap-2 mb-4">
          <Badge>Deutsche Deadlock Community</Badge>
          <button onClick={onOpenSettings} className="text-xs underline text-white/70 hover:text-white">⚙️ Einstellungen</button>
        </div>
        <h1 className="text-3xl md:text-5xl font-extrabold leading-tight">Deadlock – Community Hub</h1>
        <p className="mt-4 max-w-2xl text-white/80">Events, Guides, Coaching, Turniere & News – zentral an einem Ort. Baue Skill, finde Teams und bleib up-to-date.</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a href={inviteUrl || "#"} className={cls(
            "rounded-xl px-5 py-2.5 text-sm font-semibold",
            inviteUrl ? "bg-indigo-500 hover:bg-indigo-400" : "bg-zinc-700 cursor-not-allowed"
          )}>
            Discord beitreten
          </a>
          <a href="#/guides" className="rounded-xl px-5 py-2.5 text-sm font-semibold border border-white/20 hover:bg-white/10">Guides lesen</a>
          <a href="#/videos" className="rounded-xl px-5 py-2.5 text-sm font-semibold border border-white/20 hover:bg-white/10">Videos ansehen</a>
        </div>
      </div>
    </div>
  );
}

function Nav({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 backdrop-blur bg-black/40 border-b border-white/10">
      <Container>
        <div className="flex h-14 items-center justify-between">
          <a href="#/" className="font-bold tracking-tight">DL<span className="text-indigo-400">Hub</span></a>
          <nav className="hidden md:flex items-center gap-6">
            {items.map((it) => (
              <a key={it.path} href={it.path} className="text-sm text-white/80 hover:text-white">{it.label}</a>
            ))}
          </nav>
          <button className="md:hidden text-white/80" onClick={() => setOpen((v) => !v)} aria-label="Toggle Menu">☰</button>
        </div>
        {open && (
          <div className="md:hidden pb-3">
            {items.map((it) => (
              <a key={it.path} href={it.path} className="block py-2 text-white/80 hover:text-white">{it.label}</a>
            ))}
          </div>
        )}
      </Container>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-white/10 py-10 text-sm text-white/60">
      <Container>
        <div className="flex flex-col md:flex-row gap-2 items-center justify-between">
          <div>© {new Date().getFullYear()} Deadlock Community Deutsch</div>
          <div className="flex items-center gap-4">
            <a className="hover:text-white" href="#/impressum">Impressum</a>
            <a className="hover:text-white" href="#/datenschutz">Datenschutz</a>
          </div>
        </div>
      </Container>
    </footer>
  );
}

// ------------------------- Content --------------------------
function SearchInput({ query, setQuery }) {
  return (
    <input
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Suche nach Titeln oder #tags"
      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
    />
  );
}

function PostList({ posts }) {
  const [query, setQuery] = useState("");
  const q = query.toLowerCase();
  const filtered = posts.filter((p) =>
    p.title.toLowerCase().includes(q) || p.tags.some((t) => ("#" + t).includes(q))
  );
  const sorted = [...filtered].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SearchInput query={query} setQuery={setQuery} />
        <Badge>{sorted.length} Einträge</Badge>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {sorted.map((p) => (
          <Card key={p.id} title={p.title} subtitle={`${formatDate(p.createdAt)} • ${p.type.toUpperCase()}`}>
            <div className="mb-2">{renderLiteMarkdown(p.body)}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {p.tags.map((t) => (
                <Badge key={t}>#{t}</Badge>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString();
  } catch { return ""; }
}

function Newsletter({ onSubmit }) {
  const [email, setEmail] = useState("");
  const [ok, setOk] = useState(null);
  return (
    <Card title="Newsletter" subtitle="Guides, Events & Patchnotes">
      <form
        className="flex flex-col sm:flex-row gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const success = onSubmit?.(email);
          setOk(!!success);
          if (success) setEmail("");
        }}
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="deine@mail.de"
          className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold hover:bg-indigo-400">Abonnieren</button>
      </form>
      {ok === true && <p className="mt-2 text-emerald-400">Danke! Du bekommst bald Post 📬</p>}
      {ok === false && <p className="mt-2 text-rose-400">Ups, das hat nicht geklappt.</p>}
    </Card>
  );
}

function VideoEmbed({ url }) {
  // Support youtu.be and youtube.com URLs
  const id = useMemo(() => {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "");
      if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
    } catch {}
    return null;
  }, [url]);
  if (!id) return <div className="text-sm text-white/70">Ungültige YouTube-URL</div>;
  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl border border-white/10">
      <iframe
        className="h-full w-full"
        src={`https://www.youtube.com/embed/${id}`}
        title="YouTube video player"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}

function VideoGallery({ videos }) {
  const sorted = [...videos].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {sorted.map((v) => (
        <Card key={v.id} title={v.title} subtitle={formatDate(v.createdAt)}>
          <VideoEmbed url={v.url} />
        </Card>
      ))}
    </div>
  );
}

function DiscordWidget({ widgetId }) {
  if (!widgetId) return null;
  return (
    <div className="mt-6 rounded-xl overflow-hidden border border-white/10">
      <iframe
        src={`https://discord.com/widget?id=${widgetId}&theme=dark`}
        width="100%"
        height="400"
        allowTransparency={true}
        frameBorder="0"
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
      />
    </div>
  );
}

function PageBuilder({ addPage }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [content, setContent] = useState("");
  return (
    <Card title="Seite erstellen" subtitle="Leichter Baukasten – Markdown light">
      <div className="grid gap-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
        <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="Slug (z.B. coaching)" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="# Überschrift\nDein Inhalt **fett** *kursiv*\n- Liste\n`Code`" rows={6} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
        <div className="flex gap-2">
          <button onClick={() => { if (!title || !slug) return; addPage({ title, slug, content }); setTitle(""); setSlug(""); setContent(""); }} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold hover:bg-indigo-400">Speichern</button>
          <a href={`#/${slug}`} className="rounded-xl border border-white/20 px-4 py-2 text-sm hover:bg-white/10">Vorschau</a>
        </div>
      </div>
    </Card>
  );
}

function ContentEditor({ addPost, addVideo }) {
  const [tab, setTab] = useState("post");
  const [post, setPost] = useState({ title: "", type: "guide", tags: "", body: "" });
  const [video, setVideo] = useState({ title: "", url: "" });

  return (
    <Card title="Content hinzufügen" subtitle="Guides/News oder Videos">
      <div className="mb-3 flex gap-2">
        <button onClick={() => setTab("post")} className={cls("rounded-lg px-3 py-1 text-sm", tab === "post" ? "bg-white/15" : "bg-white/5")}>Post</button>
        <button onClick={() => setTab("video")} className={cls("rounded-lg px-3 py-1 text-sm", tab === "video" ? "bg-white/15" : "bg-white/5")}>Video</button>
      </div>
      {tab === "post" ? (
        <div className="grid gap-3">
          <input value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value })} placeholder="Titel" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
          <select value={post.type} onChange={(e) => setPost({ ...post, type: e.target.value })} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
            <option value="guide">Guide</option>
            <option value="news">News</option>
          </select>
          <input value={post.tags} onChange={(e) => setPost({ ...post, tags: e.target.value })} placeholder="Tags (kommagetrennt)" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
          <textarea value={post.body} onChange={(e) => setPost({ ...post, body: e.target.value })} placeholder="Inhalt (Markdown light)" rows={6} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
          <button onClick={() => { if (!post.title) return; addPost(post); setPost({ title: "", type: "guide", tags: "", body: "" }); }} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold hover:bg-indigo-400">Post speichern</button>
        </div>
      ) : (
        <div className="grid gap-3">
          <input value={video.title} onChange={(e) => setVideo({ ...video, title: e.target.value })} placeholder="Titel" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
          <input value={video.url} onChange={(e) => setVideo({ ...video, url: e.target.value })} placeholder="YouTube URL" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
          <button onClick={() => { if (!video.title || !video.url) return; addVideo(video); setVideo({ title: "", url: "" }); }} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold hover:bg-indigo-400">Video speichern</button>
        </div>
      )}
    </Card>
  );
}

function SettingsModal({ open, onClose, settings, setSettings }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-zinc-900 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Einstellungen</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white">✕</button>
        </div>
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm text-white/70">Discord Invite URL</span>
            <input value={settings.inviteUrl || ""} onChange={(e) => setSettings({ ...settings, inviteUrl: e.target.value })} placeholder="https://discord.gg/…" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-white/70">Discord Widget ID</span>
            <input value={settings.widgetId || ""} onChange={(e) => setSettings({ ...settings, widgetId: e.target.value })} placeholder="Server-ID für Embed" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-white/70">Google Analytics 4 Measurement ID</span>
            <input value={settings.gaId || ""} onChange={(e) => setSettings({ ...settings, gaId: e.target.value })} placeholder="G-XXXXXXXXXX" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
          </label>
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="rounded-xl border border-white/20 px-4 py-2 text-sm hover:bg-white/10">Schließen</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------- Pages ---------------------------
function HomePage({ inviteUrl, posts, videos, widgetId, onNewsletter }) {
  return (
    <>
      <Hero onOpenSettings={() => (window.location.hash = "#/settings")} inviteUrl={inviteUrl} />
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card title="Aktuell" subtitle="Letzte News & Guides">
            <div className="grid gap-4">
              {posts.slice(0, 3).map((p) => (
                <div key={p.id} className="rounded-xl border border-white/10 bg-white/0 p-4">
                  <div className="text-xs text-white/60 mb-1">{formatDate(p.createdAt)} • {p.type.toUpperCase()}</div>
                  <div className="font-semibold mb-1">{p.title}</div>
                  <div className="text-sm text-white/80 line-clamp-4">{renderLiteMarkdown(p.body)}</div>
                </div>
              ))}
              <div>
                <a href="#/news" className="text-sm underline text-white/80 hover:text-white">Alle News</a>
                <span className="px-2 text-white/40">·</span>
                <a href="#/guides" className="text-sm underline text-white/80 hover:text-white">Alle Guides</a>
              </div>
            </div>
          </Card>
          <Card title="Videospotlight" subtitle="Coaching, Matches, Highlights">
            {videos[0] ? <VideoEmbed url={videos[0].url} /> : <div className="text-white/70 text-sm">Noch keine Videos.</div>}
          </Card>
        </div>
        <div className="space-y-6">
          <Newsletter onSubmit={onNewsletter} />
          <Card title="Warum wir?" subtitle="Community mit Plan">
            <ul className="list-disc pl-6 space-y-1 text-white/80 text-sm">
              <li>Strukturierte Events & Turniere</li>
              <li>Coaching & Förderung für Low Elo</li>
              <li>Live-Status Bots & Tools</li>
              <li>Faire Moderation, klare Regeln</li>
            </ul>
          </Card>
        </div>
      </div>
      <DiscordWidget widgetId={widgetId} />
    </>
  );
}

function GuidesPage({ posts }) {
  const guides = posts.filter((p) => p.type === "guide");
  return (
    <>
      <h2 className="text-2xl font-bold mb-4">Guides</h2>
      <PostList posts={guides} />
    </>
  );
}

function NewsPage({ posts }) {
  const news = posts.filter((p) => p.type === "news");
  return (
    <>
      <h2 className="text-2xl font-bold mb-4">News</h2>
      <PostList posts={news} />
    </>
  );
}

function VideosPage({ videos }) {
  return (
    <>
      <h2 className="text-2xl font-bold mb-4">Videos</h2>
      <VideoGallery videos={videos} />
    </>
  );
}

function AboutPage() {
  return (
    <>
      <h2 className="text-2xl font-bold mb-2">Über die Community</h2>
      <p className="text-white/80">Wir sind die größte deutsche Deadlock Community – mit Fokus auf Fairness, Skill Growth und Events. Unser Ziel: ein Zuhause für Spieler aller Ranks, inkl. Förderung für Low Elo.</p>
      <div className="mt-6 grid md:grid-cols-2 gap-4">
        <Card title="Was wir bieten">
          <ul className="list-disc pl-6 space-y-1 text-white/80 text-sm">
            <li>Turniere (Fun & Sweat), Streams & Highlights</li>
            <li>Guides, Coaching & Feedback</li>
            <li>Teamfindung & Scrims</li>
            <li>Aktive Mods & klare Regeln</li>
          </ul>
        </Card>
        <Card title="Kontakt">
          <p className="text-white/80 text-sm">Am besten über Discord. Für Kooperationen: <a className="underline" href="mailto:contact@your-domain.tld">contact@your-domain.tld</a></p>
        </Card>
      </div>
    </>
  );
}

function LegalPage({ title }) {
  return (
    <>
      <h2 className="text-2xl font-bold mb-2">{title}</h2>
      <p className="text-white/80 text-sm">Hier kannst du dein Impressum / Datenschutz einfügen. Verwende den Baukasten unten, um Seiten anzulegen, oder tausche diese Komponente gegen deine jurischen Texte aus.</p>
    </>
  );
}

function CustomPage({ content, title }) {
  return (
    <>
      <h2 className="text-2xl font-bold mb-4">{title}</h2>
      {renderLiteMarkdown(content)}
    </>
  );
}

// --------------------------- Router --------------------------
function Router({ route, state, actions }) {
  const path = route.replace(/^#\//, "");
  const [seg1] = path.split("/");

  switch (seg1) {
    case "":
      return (
        <HomePage
          inviteUrl={state.settings.inviteUrl}
          posts={state.posts}
          videos={state.videos}
          widgetId={state.settings.widgetId}
          onNewsletter={actions.newsletterSubmit}
        />
      );
    case "guides":
      return <GuidesPage posts={state.posts} />;
    case "news":
      return <NewsPage posts={state.posts} />;
    case "videos":
      return <VideosPage videos={state.videos} />;
    case "about":
      return <AboutPage />;
    case "impressum":
      return <LegalPage title="Impressum" />;
    case "datenschutz":
      return <LegalPage title="Datenschutz" />;
    case "settings":
      return (
        <SettingsModal
          open={true}
          onClose={() => (window.location.hash = "#/")}
          settings={state.settings}
          setSettings={actions.setSettings}
        />
      );
    default: {
      const page = state.customPages.find((p) => p.slug === seg1);
      if (page) return <CustomPage title={page.title} content={page.content} />;
      return <div className="text-white/70">Seite nicht gefunden.</div>;
    }
  }
}

// --------------------------- App -----------------------------
export default function App() {
  // Persistent state
  const [posts, setPosts] = useLocalStorage(STORAGE_KEYS.posts, INITIAL_CONTENT.posts);
  const [videos, setVideos] = useLocalStorage(STORAGE_KEYS.videos, INITIAL_CONTENT.videos);
  const [customPages, setCustomPages] = useLocalStorage(STORAGE_KEYS.customPages, INITIAL_CONTENT.customPages);
  const [newsletter, setNewsletter] = useLocalStorage(STORAGE_KEYS.newsletter, []);
  const [settings, setSettings] = useLocalStorage(STORAGE_KEYS.settings, {
    gaId: "",
    inviteUrl: "",
    widgetId: "",
  });

  // Analytics
  useGA(settings.gaId);

  // Routing
  const route = useHashRoute();

  // Actions
  const addPage = (page) => setCustomPages((p) => [...p, { id: crypto.randomUUID(), ...page }]);
  const addPost = (post) => setPosts((p) => [
    ...p,
    {
      id: crypto.randomUUID(),
      title: post.title,
      type: post.type || "guide",
      tags: (post.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
      body: post.body || "",
      createdAt: Date.now(),
    },
  ]);
  const addVideo = (video) => setVideos((v) => [...v, { id: crypto.randomUUID(), title: video.title, url: video.url, createdAt: Date.now() }]);
  const newsletterSubmit = (email) => {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false;
    setNewsletter((n) => Array.from(new Set([...n, email.toLowerCase()])));
    // 🔌 Integrate your backend here (Mailchimp/Brevo/Sendy)
    return true;
  };

  const state = { posts, videos, customPages, newsletter, settings };
  const actions = { setSettings, newsletterSubmit };

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-slate-900 to-black text-white">
      {/* Tailwind CDN (for canvas preview). In a real app, include Tailwind at build time. */}
      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet" />

      <Nav items={[...NAV_ITEMS, ...customPages.map((p) => ({ label: p.title, path: `#/${p.slug}` }))]} />
      <main className="py-8">
        <Container>
          <Router route={route} state={{ ...state, customPages }} actions={{ ...actions, addPage, addPost, addVideo }} />

          {/* Admin/Baukasten */}
          <div className="mt-10 grid md:grid-cols-2 gap-6">
            <ContentEditor addPost={addPost} addVideo={addVideo} />
            <PageBuilder addPage={addPage} />
          </div>

          {/* Developer helper: export newsletter emails */}
          <div className="mt-6 text-xs text-white/60">
            Gesammelte Newsletter-E-Mails: {newsletter.length}
          </div>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
