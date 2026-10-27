// Leser ferdigbygde JSON-filer fra data/ (lages av scripts/bygg-data.mjs) og spiller klipp.
const $ = id => document.getElementById(id);
const audio = $("audio");
const tabData = new Map();   // fane-id -> {items}
let INDEX = null;
let activeTab = null;
let current = null;          // {tab, idx}
let typeFilter = "";
let queue = [], qi = -1;     // queue: [{tr, tab, idx}]
let seqMode = false;

const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const tracksOf = item => (item.tracks || []).filter(t => !typeFilter || t.g === typeFilter);
const typeName = g => (INDEX.typer || {})[g] || g;

async function loadTab(id) {
  if (!tabData.has(id)) {
    const r = await fetch("data/" + id + ".json");
    tabData.set(id, await r.json());
  }
  return tabData.get(id);
}

// ---------- Faner og liste ----------

function renderTabs() {
  const box = $("tabs");
  box.innerHTML = "";
  for (const f of INDEX.faner) {
    const b = el("button", null, f.label);
    b.setAttribute("role", "tab");
    b.dataset.id = f.id;
    b.setAttribute("aria-selected", f.id === activeTab);
    b.addEventListener("click", () => setTab(f.id));
    box.appendChild(b);
  }
}

function renderTypeOptions() {
  const f = INDEX.faner.find(x => x.id === activeTab);
  const sel = $("type");
  if (typeFilter && !f.typer.includes(typeFilter)) typeFilter = "";
  sel.innerHTML = "";
  sel.appendChild(new Option("Alle verktyper", ""));
  for (const t of f.typer) sel.appendChild(new Option(typeName(t), t));
  sel.value = typeFilter;
  sel.hidden = f.typer.length < 2;
}

async function setTab(id, openId) {
  activeTab = id;
  for (const b of $("tabs").children) b.setAttribute("aria-selected", b.dataset.id === id);
  renderTypeOptions();
  $("list").innerHTML = "";
  $("era").textContent = "Laster …";
  const data = await loadTab(id);
  if (activeTab !== id) return;
  $("era").textContent = data.era;
  renderList();
  if (openId) {
    const idx = data.items.findIndex(i => i.id === openId);
    if (idx >= 0) openComposer(id, idx, false);
  }
}

function visibleIdxs() {
  const data = tabData.get(activeTab);
  const f = norm($("filter").value);
  return data.items.map((it, i) => {
    if (it.h) return -1;
    if (f && !norm(it.n + " " + it.l + " " + it.m).includes(f)) return -1;
    if (typeFilter && !tracksOf(it).length) return -1;
    return i;
  }).filter(i => i >= 0);
}

function renderList() {
  const data = tabData.get(activeTab);
  if (!data) return;
  const ul = $("list");
  ul.innerHTML = "";
  const show = new Set(visibleIdxs());
  const filtering = $("filter").value || typeFilter;
  data.items.forEach((it, idx) => {
    if (it.h) {
      if (filtering) return;
      const h = el("li", "ghead");
      h.append(el("span", null, it.h), el("small", null, it.s));
      ul.appendChild(h);
      return;
    }
    if (!show.has(idx)) return;
    const n = tracksOf(it).length;
    const b = el("button");
    if (current && current.tab === activeTab && current.idx === idx) b.setAttribute("aria-current", "true");
    b.append(el("span", "cname", it.n), el("span", "cstat" + (n ? "" : " none"), n ? n + " klipp" : "ingen"), el("span", "cmeta", it.l + (it.m ? " · " + it.m : "")));
    b.addEventListener("click", () => { stopSequence(); openComposer(activeTab, idx, true); });
    const li = el("li");
    li.appendChild(b);
    ul.appendChild(li);
  });
  if (!ul.children.length) ul.appendChild(el("li", "era", "Ingen treff."));
}

// ---------- Scenen ----------

function openComposer(tab, idx, autoplay) {
  current = { tab, idx };
  const item = tabData.get(tab).items[idx];
  history.replaceState(null, "", "#" + tab + "/" + item.id);
  if (tab === activeTab) renderList();
  const stage = $("stage");
  stage.innerHTML = "";
  const head = el("div");
  head.append(el("h2", null, item.n), el("p", "sub", item.l + (item.m ? " · " + item.m : "")));
  stage.appendChild(head);

  const tracks = tracksOf(item);

  if (item.works && item.works.length) {
    const sec = el("section");
    sec.appendChild(el("h3", null, "Sentrale verk"));
    const chips = el("div", "chips");
    for (const w of item.works) {
      if (typeFilter && w.g !== typeFilter) continue;
      const first = tracks.findIndex(t => t.w === w.t);
      const c = el("button", "chip", w.t);
      c.appendChild(el("small", null, typeName(w.g)));
      if (first < 0) { c.disabled = true; c.title = "Fant ikke klipp av dette verket"; }
      else c.addEventListener("click", () => { stopSequence(); playList(tracks.map(tr => ({ tr, tab, idx })), first); });
      chips.appendChild(c);
    }
    if (chips.children.length) { sec.appendChild(chips); stage.appendChild(sec); }
  }

  if (item.video && item.video.length) {
    const sec = el("section");
    sec.appendChild(el("h3", null, "Video"));
    const grid = el("div", "videos");
    for (const v of item.video) {
      const b = el("button", "vthumb");
      const img = el("img");
      img.alt = ""; img.loading = "lazy";
      img.src = "https://i.ytimg.com/vi/" + v.id + "/mqdefault.jpg";
      b.append(img, el("span", null, v.t));
      b.addEventListener("click", () => showVideo(v));
      grid.appendChild(b);
    }
    sec.appendChild(grid);
    stage.appendChild(sec);
  }

  if (!tracks.length) {
    stage.appendChild(el("div", "empty", typeFilter
      ? "Ingen klipp av typen «" + typeName(typeFilter) + "» for denne komponisten."
      : "Fant ingen klipp i iTunes. Prøv en annen, eller søk direkte i Apple Music eller Spotify."));
    return;
  }
  const sec = el("section");
  sec.appendChild(el("h3", null, "Klipp"));
  const wrap = el("div", "tracks");
  tracks.forEach((t, i) => {
    const b = el("button", "track");
    b.dataset.i = i;
    const img = el("img");
    img.alt = ""; img.loading = "lazy"; img.src = t.i || "";
    const info = el("div", "tinfo");
    info.append(el("div", "ttitle", t.t), el("div", "tsub", [t.a, t.c, t.y].filter(Boolean).join(" · ")));
    b.append(img, info, el("span", "tag", typeName(t.g)));
    b.addEventListener("click", () => { stopSequence(); playList(tracks.map(tr => ({ tr, tab, idx })), i); });
    wrap.appendChild(b);
  });
  sec.appendChild(wrap);
  stage.appendChild(sec);
  if (autoplay) playList(tracks.map(tr => ({ tr, tab, idx })), 0);
  else markPlaying();
}

function showVideo(v) {
  audio.pause();
  const stage = $("stage");
  stage.querySelector(".vbox")?.remove();
  const box = el("div", "vbox");
  box.style.display = "grid"; box.style.gap = "8px";
  const frame = el("div", "vframe");
  const f = el("iframe");
  f.src = "https://www.youtube-nocookie.com/embed/" + v.id + "?autoplay=1&rel=0";
  f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  f.allowFullscreen = true;
  f.title = v.t;
  frame.appendChild(f);
  const close = el("button", "btn vclose", "Lukk video");
  close.addEventListener("click", () => box.remove());
  box.append(frame, close);
  stage.children[0].after(box);
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------- Avspilling ----------

function playList(list, i) {
  queue = list;
  playAt(i);
}

function playAt(i) {
  if (!queue.length) return;
  qi = (i + queue.length) % queue.length;
  const { tr, tab, idx } = queue[qi];
  $("stage").querySelector(".vbox")?.remove();
  audio.src = tr.p;
  audio.play().catch(() => {});
  const who = tabData.get(tab).items[idx].n;
  $("nowTitle").textContent = tr.t;
  $("nowSub").textContent = (seqMode ? who + " · " : "") + tr.a;
  const link = $("nowLink");
  link.href = tr.u || "#";
  link.hidden = !tr.u;
  // I sekvensmodus følger scenen med til neste komponist
  if (seqMode && (!current || current.tab !== tab || current.idx !== idx)) openComposer(tab, idx, false);
  markPlaying();
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: tr.t, artist: tr.a, album: who, artwork: tr.i ? [{ src: tr.i, sizes: "100x100" }] : [] });
  }
}

function markPlaying() {
  const e = queue[qi];
  document.querySelectorAll(".track").forEach(b => {
    const t = current && tracksOf(tabData.get(current.tab).items[current.idx])[+b.dataset.i];
    b.classList.toggle("playing", !!e && t === e.tr);
  });
}

async function startSequence() {
  const data = await loadTab(activeTab);
  const list = [];
  for (const idx of visibleIdxs()) {
    const tr = tracksOf(data.items[idx])[0];
    if (tr) list.push({ tr, tab: activeTab, idx });
  }
  if (!list.length) return;
  seqMode = true;
  $("sequence").setAttribute("aria-pressed", "true");
  playList(list, 0);
}
function stopSequence() {
  seqMode = false;
  $("sequence").setAttribute("aria-pressed", "false");
}

function setIcon(playing) {
  $("playicon").innerHTML = playing ? '<path d="M3 2h4v12H3zM9 2h4v12H9z"/>' : '<path d="M4 2l10 6-10 6z"/>';
  $("play").setAttribute("aria-label", playing ? "Pause" : "Spill");
}

audio.addEventListener("play", () => setIcon(true));
audio.addEventListener("pause", () => setIcon(false));
audio.addEventListener("ended", () => {
  // Sekvensen stopper etter siste komponist; vanlig kø går rundt
  if (seqMode && qi === queue.length - 1) { stopSequence(); return; }
  playAt(qi + 1);
});
audio.addEventListener("timeupdate", () => {
  $("progress").style.width = audio.duration ? (audio.currentTime / audio.duration * 100) + "%" : "0";
});
$("play").addEventListener("click", () => {
  if (!audio.src) { startSequence(); return; }
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
});
$("next").addEventListener("click", () => playAt(qi + 1));
$("prev").addEventListener("click", () => playAt(audio.currentTime > 3 ? qi : qi - 1));
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("nexttrack", () => playAt(qi + 1));
  navigator.mediaSession.setActionHandler("previoustrack", () => playAt(qi - 1));
}

$("sequence").addEventListener("click", () => {
  if (seqMode) { stopSequence(); audio.pause(); } else startSequence();
});
$("random").addEventListener("click", () => {
  const idxs = visibleIdxs();
  if (!idxs.length) return;
  stopSequence();
  openComposer(activeTab, idxs[Math.floor(Math.random() * idxs.length)], true);
});
$("filter").addEventListener("input", renderList);
$("type").addEventListener("change", e => {
  typeFilter = e.target.value;
  renderList();
  if (current && current.tab === activeTab) openComposer(current.tab, current.idx, false);
});

// ---------- Oppstart ----------

(async () => {
  INDEX = await (await fetch("data/index.json")).json();
  const [tab, id] = decodeURIComponent(location.hash.slice(1)).split("/");
  activeTab = INDEX.faner.some(f => f.id === tab) ? tab : INDEX.faner[0].id;
  renderTabs();
  await setTab(activeTab, id);
  $("updated").textContent = "Data oppdatert " + new Date(INDEX.oppdatert).toLocaleDateString("no-NO", { day: "numeric", month: "long", year: "numeric" }) + ". Lydklipp fra iTunes, verkdata fra Open Opus, video fra YouTube.";
})();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
