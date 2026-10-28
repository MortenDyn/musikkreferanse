// Skann et konsertprogram: tekstgjenkjenning (Tesseract.js) kjører på telefonen, uten server og uten kostnad.
// Teksten sammenlignes med komponistene i data/, og hvert verk slås opp i dataene eller i iTunes.
// Bruker hjelpefunksjonene og spilleren fra app.js.
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
// I disse fanene er navnene ofte vanlige ord eller grupper, så hele navnet må stå i teksten
const FULL_NAME_TABS = new Set(["world", "elektronisk"]);
// Etternavn som også er vanlige ord eller navn; krever fornavn eller initial i samme linje
const COMMON = new Set(["john", "fine", "hall", "berlin", "shaw", "glass", "cage", "adams", "williams", "diamond", "berger", "carter", "herman", "porter", "brown", "barry", "shore", "berg", "lopez", "kitt", "levi", "ross", "paul", "bock", "kern", "rota", "lambert", "styne"]);
// Stavemåter som avviker for mye til å fanges av feiltoleransen
const ALIAS = {
  tsjajkovskij: ["tchaikovsky", "tschaikowsky", "tsjaikovskij", "tchaikovski"],
  sjostakovitsj: ["shostakovich", "schostakowitsch", "chostakovitch"],
  rakhmaninov: ["rachmaninoff", "rachmaninow"],
  prokofjev: ["prokofiev", "prokofieff", "prokofjew"],
  stravinskij: ["stravinsky", "strawinsky"],
  handel: ["haendel"],
};
// Norske og tyske verkbetegnelser oversettes til engelsk, som er språket i iTunes og Open Opus
const TERMS = [
  [/\b(klaver|klavier|piano)(konsert|konzert)\b/g, "piano concerto"],
  [/\b(fiolin|violin)(konsert|konzert)\b/g, "violin concerto"],
  [/\b(cello|violoncello)(konsert|konzert)\b/g, "cello concerto"],
  [/\b(klarinett|klarinetten)(konsert|konzert)\b/g, "clarinet concerto"],
  [/\b(trompet|trompeten)(konsert|konzert)\b/g, "trumpet concerto"],
  [/\b(obo|oboen)(konsert|konzert)\b/g, "oboe concerto"],
  [/\b(fløyte|floten)(konsert|konzert)\b/g, "flute concerto"],
  [/\bhorn(konsert|konzert)\b/g, "horn concerto"],
  [/\b(stryke|streich)kvartett\b|\bstreichquartett\b/g, "string quartet"],
  [/\b(klaver|klavier)(kvintett|quintett)\b/g, "piano quintet"],
  [/\b(klaver|klavier)trio\b/g, "piano trio"],
  [/\b(klaver|klavier)sonate\b/g, "piano sonata"],
  [/\b(fiolin|violin)sonate\b/g, "violin sonata"],
  [/\bcellosonate\b/g, "cello sonata"],
  [/\b(symfoni(en)?|sinfonie|symphonie)\b/g, "symphony"],
  [/\b(konsert|konzert)\b/g, "concerto"],
  [/\b([a-zæø]{4,})(konsert|konzert)\b/g, "$1 concerto"],
  [/\b(ouverture|ouverture|uvertyre)\b/g, "overture"],
  [/\bsonate\b/g, "sonata"],
  [/\b(messe)\b/g, "mass"],
  [/\brekviem\b/g, "requiem"],
  [/\bnr\b/g, "no"],
];
const STOP = new Set(["in", "the", "of", "and", "for", "no", "op", "major", "minor", "flat", "sharp", "a", "b", "c", "d", "e", "f", "g", "h", "de", "la", "le", "les", "der", "die", "das", "und", "en", "et", "il", "di", "i", "og", "fra", "til", "for", "med", "av", "bwv", "kv", "d", "hwv", "rv"]);

let composers = null;        // [{tab, idx, it, names, sur, first, surOk}]
let scanPieces = [];

const words = s => norm(s).replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9æø]+/g, " ").trim().split(" ").filter(Boolean);
const surnameVariants = n => {
  const base = norm(n.replace(/\([^)]*\)/g, "")).split(/[^a-z0-9æø]+/).filter(Boolean).pop() || "";
  const umlaut = words(n.replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ä/g, "ae")).pop() || "";
  return [...new Set([base, umlaut, ...(ALIAS[base] || [])])];
};

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// OCR bytter ofte ut en bokstav; lange navn tåler en eller to feil
// Navnet slik iTunes og YouTube kjenner det (Tchaikovsky, ikke Tsjajkovskij)
const searchName = c => { const s = (ALIAS[c.sur[0]] || [c.sur[0]])[0]; return s[0].toUpperCase() + s.slice(1); };
const nearly = (tok, sur) => tok === sur || (sur.length >= 6 && lev(tok, sur) <= (sur.length >= 9 ? 2 : 1));

async function buildComposers() {
  if (composers) return composers;
  await Promise.all(INDEX.faner.map(f => loadTab(f.id)));
  composers = [];
  for (const f of INDEX.faner) tabData.get(f.id).items.forEach((it, idx) => {
    if (it.h) return;
    const w = words(it.n);
    const sur = surnameVariants(it.n);
    composers.push({
      tab: f.id, idx, it, full: w.join(" "), sur, first: w.slice(0, -1),
      surOk: !FULL_NAME_TABS.has(f.id) && !it.n.includes("&") && sur[0].length >= 4 && w.length <= 4,
    });
  });
  return composers;
}

// Finner komponisten i en linje: helt navn først, ellers etternavn (med feiltoleranse)
function findComposer(line) {
  const toks = words(line);
  if (!toks.length) return null;
  const padded = " " + toks.join(" ") + " ";
  let best = null;
  for (const c of composers) {
    let score = 0;
    if (padded.includes(" " + c.full + " ")) score = 10;
    else if (c.surOk && toks.some(t => c.sur.some(s => nearly(t, s)))) {
      // Fornavn eller initialer i samme linje skiller J.S. Bach fra C.P.E. Bach
      const hint = c.first.filter(f => toks.includes(f) || toks.includes(f[0])).length;
      if (COMMON.has(c.sur[0]) && !hint) continue;
      score = 1 + hint;
    }
    if (score > (best?.score || 0)) best = { ...c, score };
  }
  return best;
}

const isMovement = l => /^\s*([IVX]+|\d+)[.)]\s/.test(l) || /^\s*(pause|intervall?|intermission)\b/i.test(l);
const letters = s => (s.match(/\p{L}/gu) || []).length;

// Tar bort navnet, årstall og skilletegn så bare verktittelen står igjen
function workPart(line, c) {
  const drop = new Set([...words(c.it.n), ...c.sur, ...c.first.map(f => f[0])]);
  const kept = line.replace(/\(?\b1\d{3}\s*[–-]\s*(1\d{3}|\d{2})?\b\)?/g, " ").split(/\s+/)
    .filter(w => { const n = words(w); return !n.length || !n.every(x => drop.has(x) || c.sur.some(s => nearly(x, s))); });
  return kept.join(" ").replace(/^[\s:;,.–—-]+|[\s:;,–—-]+$/g, "").replace(/^\(\s*\)$/, "").trim();
}

function parseProgram(text) {
  const pieces = [], loose = [];
  let last = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (letters(line) < 3) continue;
    const c = findComposer(line);
    if (c) {
      const w = workPart(line, c);
      last = { c, work: letters(w) >= 3 ? w : "" };
      pieces.push(last);
    } else if (last && !last.work && !isMovement(line)) last.work = line;
    else if (!isMovement(line)) loose.push(line);
  }
  return { pieces, loose };
}

function workWords(t) {
  let s = norm(t).replace(/\b(i|in)\s+[a-h](is|es|s)?[- ]?(moll|dur|major|minor)\b/g, " ")
    .replace(/\b[a-h](is|es)?-(moll|dur)\b/g, " ").replace(/[()«»"“”:;,.]/g, " ");
  for (const [re, en] of TERMS) s = s.replace(re, en);
  return s.split(/\s+/).filter(w => w.length > 1 && !STOP.has(w) || /^\d+$/.test(w));
}
function matchScore(ww, text) {
  const t = " " + norm(text).replace(/[^a-z0-9æø]+/g, " ") + " ";
  const named = ww.filter(w => !/^\d+$/.test(w));
  if (named.length && !named.some(w => t.includes(w))) return 0;
  return ww.filter(w => t.includes(/^\d+$/.test(w) ? " " + w + " " : w)).length / ww.length;
}

// Sportittelen teller først; albumtittelen bare når ingen spor treffer (ellers blir hele «Piano Concerto»-albumet med)
function bestMatches(ww, tracks) {
  for (const text of [tr => [tr.w, tr.t].join(" "), tr => [tr.w, tr.t, tr.c].join(" ")]) {
    const hits = tracks.map(tr => [tr, matchScore(ww, text(tr))]).filter(x => x[1] >= 0.6)
      .sort((a, b) => b[1] - a[1] || a[0].t.localeCompare(b[0].t)).map(x => x[0]);
    if (hits.length) return hits;
  }
  return [];
}

let lastItunes = 0;
async function itunesSearch(term) {
  // iTunes tåler rundt 20 kall i minuttet; litt luft mellom kallene holder for et helt program
  const wait = lastItunes + 1500 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastItunes = Date.now();
  const r = await fetch("https://itunes.apple.com/search?country=NO&media=music&entity=song&limit=25&term=" + encodeURIComponent(term));
  if (!r.ok) throw new Error("iTunes svarte " + r.status);
  return ((await r.json()).results || []).filter(r => r.wrapperType === "track" && r.previewUrl)
    .map(r => ({ t: r.trackName, a: r.artistName, c: r.collectionName, y: r.releaseDate ? +r.releaseDate.slice(0, 4) : undefined, p: r.previewUrl, i: r.artworkUrl100, u: r.trackViewUrl }));
}

async function resolvePiece(p) {
  const tracks = p.c.it.tracks || [];
  const ww = workWords(p.work);
  p.tracks = [];
  if (ww.length) {
    p.tracks = bestMatches(ww, tracks);
    if (!p.tracks.length) {
      try {
        p.tracks = bestMatches(ww, await itunesSearch(searchName(p.c) + " " + ww.join(" ")));
      } catch { p.offline = true; }
    }
  }
  p.exact = p.tracks.length > 0;
  p.tracks = (p.exact ? p.tracks : tracks).slice(0, p.exact ? 5 : 3);
}

// ---------- Visning ----------

function openScan() {
  stopSequence();
  current = null;
  history.replaceState(null, "", "#" + activeTab);
  renderList();
  const stage = $("stage");
  stage.innerHTML = "";
  const head = el("div");
  head.append(el("h2", null, "Skann program"), el("p", "sub", "Ta bilde av et konsertprogram. Teksten leses på telefonen og sammenlignes med komponistene i listene."));
  const pick = el("section", "scanpick");
  const label = el("label", "btn primary", "Ta bilde eller velg bilde");
  const input = el("input");
  input.type = "file"; input.accept = "image/*"; input.className = "vh";
  input.addEventListener("change", () => input.files[0] && runOcr(input.files[0]));
  label.appendChild(input);
  pick.append(label, el("p", "note", "Første gang lastes tekstgjenkjenningen ned (ca. 10 MB). Etterpå går det raskere."));
  const status = el("p", "note");
  status.id = "scanStatus";
  status.setAttribute("aria-live", "polite");
  const edit = el("section");
  const ta = el("textarea");
  ta.id = "scanText"; ta.rows = 7; ta.spellcheck = false;
  ta.placeholder = "Eller skriv programmet her, gjerne én linje per verk.\nGrieg: Klaverkonsert i a-moll\nSibelius: Symfoni nr. 2";
  ta.setAttribute("aria-label", "Tekst fra programmet");
  const go = el("button", "btn", "Finn musikk");
  go.addEventListener("click", () => findMusic(ta.value));
  edit.append(el("h3", null, "Tekst fra programmet"), ta, go);
  const out = el("div", "scanout");
  out.id = "scanResult";
  stage.append(head, pick, status, edit, out);
  stage.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function runOcr(file) {
  const status = $("scanStatus");
  try {
    status.textContent = "Laster tekstgjenkjenning …";
    if (!window.Tesseract) await new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = TESSERACT; s.onload = ok; s.onerror = () => fail(new Error("Fikk ikke lastet tekstgjenkjenningen. Er du på nett?"));
      document.head.appendChild(s);
    });
    const img = await shrink(file);
    const worker = await Tesseract.createWorker(["nor", "eng"], 1, {
      logger: m => {
        if (m.status === "recognizing text") status.textContent = "Leser teksten … " + Math.round(m.progress * 100) + " %";
        else if (/loading|initializ/.test(m.status)) status.textContent = "Gjør klar tekstgjenkjenning …";
      },
    });
    const { data } = await worker.recognize(img);
    await worker.terminate();
    $("scanText").value = data.text.trim();
    status.textContent = "Ferdig. Rett gjerne feil i teksten og trykk «Finn musikk» igjen.";
    findMusic(data.text);
  } catch (e) {
    status.textContent = e.message || "Noe gikk galt under lesingen.";
  }
}

// Store mobilbilder gjøres mindre; det går raskere og gir like god gjenkjenning
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function findMusic(text) {
  const out = $("scanResult");
  out.innerHTML = "";
  if (!text.trim()) return;
  out.appendChild(el("p", "note", "Leter …"));
  await buildComposers();
  const { pieces, loose } = parseProgram(text);
  scanPieces = pieces;
  for (const p of pieces) await resolvePiece(p);
  out.innerHTML = "";
  if (!pieces.length) out.appendChild(el("div", "empty", "Fant ingen kjente komponister i teksten. Sjekk stavemåten, eller søk på linjene nedenfor."));
  else {
    const all = el("button", "btn primary", "Spill programmet");
    all.addEventListener("click", () => {
      const list = scanQueue();
      const firsts = pieces.map(p => list.findIndex(e => e.tr === p.tracks[0])).filter(i => i >= 0);
      if (firsts.length) playList(firsts.map(i => list[i]), 0);
    });
    out.appendChild(all);
  }
  for (const p of pieces) out.appendChild(renderPiece(p));
  if (loose.length) out.appendChild(renderLoose(loose));
}

// Alle klipp i programrekkefølge, så avspillingen fortsetter gjennom hele konserten
const scanQueue = () => scanPieces.flatMap(p => p.tracks.map(tr => ({ tr, tab: p.c.tab, idx: p.c.idx })));

function renderPiece(p) {
  const box = el("section", "piece");
  const who = el("button", "plink", p.c.it.n);
  who.title = "Åpne komponisten";
  who.addEventListener("click", () => setTab(p.c.tab, p.c.it.id));
  box.append(who, el("div", "pwork", p.work || "Verk ikke funnet i teksten"));
  if (!p.exact && p.work) box.appendChild(el("p", "note", p.offline ? "Fikk ikke søkt i iTunes. Her er andre klipp av komponisten." : "Fant ikke dette verket. Her er andre klipp av komponisten."));
  if (p.tracks.length) {
    const wrap = el("div", "tracks");
    for (const t of p.tracks) wrap.appendChild(trackButton(t, () => {
      stopSequence();
      const list = scanQueue();
      playList(list, list.findIndex(e => e.tr === t));
    }));
    box.appendChild(wrap);
  }
  const vids = (p.c.it.video || []).slice(0, 3);
  if (vids.length) box.appendChild(videoGrid(vids));
  box.appendChild(youtubeLink(searchName(p.c) + " " + p.work));
  return box;
}

function youtubeLink(q) {
  const a = el("a", "ylink", "Søk på YouTube: " + q.trim());
  a.href = "https://www.youtube.com/results?search_query=" + encodeURIComponent(q.trim());
  a.target = "_blank"; a.rel = "noopener";
  return a;
}

// Linjer uten kjent komponist kan søkes opp én og én
function renderLoose(lines) {
  const d = el("details", "loose");
  d.appendChild(el("summary", null, "Andre linjer i teksten (" + lines.length + "). Trykk for å søke."));
  const chips = el("div", "chips");
  const res = el("div", "tracks");
  for (const l of lines) {
    const c = el("button", "chip", l);
    c.addEventListener("click", async () => {
      res.innerHTML = "";
      res.appendChild(el("p", "note", "Søker etter «" + l + "» …"));
      let found = [];
      try { found = (await itunesSearch(l)).slice(0, 6); } catch {}
      res.innerHTML = "";
      if (!found.length) res.appendChild(el("p", "note", "Ingen klipp i iTunes for «" + l + "»."));
      const list = found.map(tr => ({ tr, who: l }));
      found.forEach((t, i) => res.appendChild(trackButton(t, () => { stopSequence(); playList(list, i); })));
      res.appendChild(youtubeLink(l));
      markPlaying();
    });
    chips.appendChild(c);
  }
  d.append(chips, res);
  return d;
}

$("scan").addEventListener("click", openScan);
