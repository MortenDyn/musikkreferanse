// Henter sentrale verk (Open Opus), lydklipp (iTunes) og videoer (YouTube) for alle fanene
// i lister.mjs og skriver ferdige JSON-filer til docs/data/. Ingen KI er involvert.
//
// Bruk:  node scripts/bygg-data.mjs [--fane barokk,film] [--maks 50] [--frisk] [--uten-video]
// Miljø: YOUTUBE_API_KEY   nøkkel til YouTube Data API v3 (uten den hoppes video over)
//        VIDEO_MAKS        maks antall YouTube-søk per kjøring (standard 90, kvoten er ~100/døgn)
//        MAKS_ALDER_DAGER  hvor gamle lagrede spor kan være før de hentes på nytt (standard 60)
//        ITUNES_PAUSE_MS   pause mellom iTunes-kall (standard 3200; iTunes tåler ca. 20 kall/min)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { TABS, TYPES } from "./lister.mjs";

const root = new URL("../", import.meta.url);
const OUT = new URL("docs/data/", root);
const CACHE = new URL("cache/", root);

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i < 0 ? null : (args[i + 1] ?? ""); };
const ONLY = arg("--fane")?.split(",");
const MAX_FETCH = +(arg("--maks") ?? Infinity);
const FRESH = args.includes("--frisk");
const NO_VIDEO = args.includes("--uten-video");
const YT_KEY = process.env.YOUTUBE_API_KEY;
const VIDEO_MAX = +(process.env.VIDEO_MAKS ?? 90);
const MAX_AGE = (+(process.env.MAKS_ALDER_DAGER ?? 60)) * 864e5;
const ITUNES_PAUSE = +(process.env.ITUNES_PAUSE_MS ?? 3200);

const TRACKS_PER = 15, WORKS_PER = 6, TRACKS_PER_WORK = 2;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const slug = s => norm(s).replace(/ /g, "-");
const surnameOf = q => norm(q).split(" ").pop();

// ---------- HTTP ----------

let lastItunes = 0;
async function itunes(path) {
  const url = "https://itunes.apple.com/" + path + (path.includes("?") ? "&" : "?") + "country=NO";
  for (let attempt = 1; attempt <= 5; attempt++) {
    const wait = lastItunes + ITUNES_PAUSE - Date.now();
    if (wait > 0) await sleep(wait);
    lastItunes = Date.now();
    const res = await fetch(url).catch(() => null);
    if (res?.ok) return res.json();
    // 403/429 betyr at iTunes struper oss; vent stadig lenger
    console.warn(`  iTunes ${res?.status ?? "nettfeil"}, venter ${attempt * 30} s`);
    await sleep(attempt * 30000);
  }
  throw new Error("iTunes svarer ikke: " + url);
}

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(res.status + " " + url), { status: res.status, body: await res.text() });
  return res.json();
}

// ---------- Verktype ----------

const TYPE_RULES = [
  ["scene", /\b(opera|operetta|oper|ballet|ballett|aria|act [ivx0-9]+|akt|recitativ|recitative|singspiel|zarzuela|musical)\b/],
  ["vokal", /\b(mass|messe|missa|requiem|lied|lieder|songs?|motet|motets|cantata|kantate|oratorio|magnificat|stabat|psalms?|choir|chorus|choral|kyrie|gloria|ave maria|vespers?|madrigals?|chanson|hymn|antiphon)\b/],
  ["orkester", /\b(concerto|concertos|konsert|concertino)\b/],
  ["kammer", /\b(quartet|quartets|quintet|quintets|trio|trios|sextet|septet|octet|violin sonata|cello sonata|sonata for (violin|cello|flute|viola|clarinet|oboe)|string|duo)\b/],
  ["klaver", /\b(piano|klaver|prelude|preludes|etude|etudes|nocturne|nocturnes|mazurka|mazurkas|polonaise|waltz|valse|impromptu|ballade|intermezzo|bagatelle|harpsichord|cembalo|clavier|keyboard|toccata|fugue|organ|orgel|goldberg|well tempered|partita|lyric pieces|gymnopedie|gnossienne)\b/],
  ["orkester", /\b(symphony|symphonie|sinfonia|symfoni|overture|ouverture|suite|orchestra|orchestral|tone poem|symphonic|serenade|rhapsody|divertimento|march)\b/]
];
const OPENOPUS_TYPE = { Keyboard: "klaver", Orchestral: "orkester", Chamber: "kammer", Stage: "scene", Vocal: "vokal" };

function guessType(text, fallback = "annet") {
  const t = norm(text);
  for (const [type, re] of TYPE_RULES) if (re.test(t)) return type;
  return fallback;
}

// ---------- iTunes ----------

function toTrack(r, g, w) {
  const tr = { t: r.trackName, a: r.artistName, c: r.collectionName, y: r.releaseDate ? +r.releaseDate.slice(0, 4) : undefined, p: r.previewUrl, i: r.artworkUrl100, u: r.trackViewUrl, g };
  if (w) tr.w = w;
  return tr;
}
const isTrack = r => r.wrapperType === "track" && r.previewUrl;

// Velger spor slik at ett album ikke tar over hele listen
function pickVaried(results, have, limit, perAlbum = 2) {
  const seen = new Set(have.map(t => norm(t.t)));
  const albums = new Map();
  const out = [];
  for (const r of results) {
    if (!isTrack(r) || out.length >= limit) continue;
    const k = norm(r.trackName);
    const n = albums.get(r.collectionId) || 0;
    if (seen.has(k) || n >= perAlbum) continue;
    seen.add(k); albums.set(r.collectionId, n + 1); out.push(r);
  }
  return out;
}

async function byArtist(q, genre) {
  // "id:123" peker direkte på en Apple-artist når navnet er tvetydig
  let artistId = q.startsWith("id:") ? q.slice(3) : null;
  if (!artistId) {
    const s = await itunes("search?term=" + encodeURIComponent(q) + "&entity=musicArtist&limit=50");
    const hits = (s.results || []).filter(a => norm(a.artistName) === norm(q));
    const re = new RegExp(genre || "Soundtrack|Classical");
    const hit = hits.find(a => re.test(a.primaryGenreName || "")) || hits[0];
    if (!hit) return [];
    artistId = hit.artistId;
  }
  const l = await itunes("lookup?id=" + artistId + "&entity=song&limit=100");
  return l.results || [];
}
async function byComposer(q) {
  const s = await itunes("search?term=" + encodeURIComponent(q) + "&media=music&entity=song&attribute=composerTerm&limit=100");
  return s.results || [];
}
async function byLooseTerm(q) {
  const sn = surnameOf(q);
  const s = await itunes("search?term=" + encodeURIComponent(q) + "&media=music&entity=song&limit=50");
  return (s.results || []).filter(r => norm([r.artistName, r.collectionName, r.trackName].join(" ")).includes(sn));
}

const STOP = new Set(["in", "the", "of", "and", "for", "no", "op", "major", "minor", "flat", "sharp", "a", "b", "c", "d", "e", "f", "g", "de", "la", "le", "les", "der", "die", "das", "und", "en", "et", "il", "di"]);
// Toneart og sjeldne katalogsystemer (TrV, WoO, Hob …) gir sjelden treff i iTunes og fjernes
function simplifyTitle(t) {
  return t.replace(/\bin [A-G](?:[- ](?:flat|sharp))? (?:major|minor)\b/gi, "")
    .replace(/\b(?:TrV|WoO|Hob\.?|Sz\.?|BB|FP|JW|Wq|H\.|L\.|Op\. posth\.?)\s?[\w.:/]*\d[\w.:/]*/gi, "")
    .replace(/["“”«»]/g, "").replace(/[(),:;]/g, " ").replace(/\s+/g, " ").trim();
}
const keyWords = t => norm(simplifyTitle(t)).split(" ").filter(w => w.length > 1 && !STOP.has(w));

async function tracksForWork(q, work, have) {
  const all = keyWords(work.t);
  // Krev treff på ordene; numre (op. 44, BWV 988) teller bare når tittelen ikke har annet
  const words = all.filter(w => !/\d/.test(w)).length ? all.filter(w => !/\d/.test(w)) : all;
  if (!words.length) return [];
  const term = surnameOf(q) + " " + simplifyTitle(work.t);
  const s = await itunes("search?term=" + encodeURIComponent(term) + "&media=music&entity=song&limit=15");
  const matching = (s.results || []).filter(r => {
    const text = norm(r.trackName + " " + r.collectionName);
    return words.filter(w => text.includes(w)).length >= Math.ceil(words.length * 0.6);
  });
  return pickVaried(matching, have, TRACKS_PER_WORK, TRACKS_PER_WORK);
}

// ---------- Open Opus ----------

async function openOpusWorks(name, q) {
  try {
    const sn = surnameOf(q);
    const s = await json(`https://api.openopus.org/composer/list/search/${encodeURIComponent(sn)}.json`);
    const cands = s.composers || [];
    const want = [norm(name), norm(q)];
    const first = norm(q).split(" ")[0];
    const hit = cands.find(c => want.includes(norm(c.complete_name)))
      || cands.find(c => norm(c.complete_name).endsWith(sn) && norm(c.complete_name).startsWith(first));
    if (!hit) return [];
    const works = [];
    for (const list of ["Popular", "Recommended"]) {
      if (works.length >= WORKS_PER) break;
      const w = await json(`https://api.openopus.org/work/list/composer/${hit.id}/genre/${list}.json`).catch(() => ({}));
      for (const x of w.works || []) {
        if (works.length >= WORKS_PER) break;
        if (!works.some(y => y.t === x.title)) works.push({ t: x.title, g: OPENOPUS_TYPE[x.genre] || "annet" });
      }
    }
    return works;
  } catch (e) {
    console.warn("  Open Opus:", e.message);
    return [];
  }
}

// Merknader som "Kiss Me, Kate; Anything Goes" blir til verk det søkes etter
function worksFromNote(note, type) {
  // Semikolon skiller verk når titlene selv har komma («Kiss Me, Kate; Anything Goes»)
  return note.split(note.includes(";") ? ";" : /, (?=[A-ZÆØÅ])/).map(s => s.trim()).filter(s => s && !/^også\b/i.test(s)).map(t => ({ t, g: type }));
}

// ---------- Én komponist ----------

async function fetchEntry(tab, [name, , note, alt]) {
  const q = alt || name;
  const force = tab.forceType;
  let works = [], tracks = [];

  if (tab.mode === "composer" && !q.startsWith("id:")) {
    works = await openOpusWorks(name, q);
    if (!works.length && tab.noteWorks && note) works = worksFromNote(note, force || "annet");
    for (const w of works) {
      const found = await tracksForWork(q, w, tracks);
      w.n = found.length;
      tracks.push(...found.map(r => toTrack(r, force || w.g, w.t)));
    }
  }

  // Fyll opp med generelle søk
  const order = q.startsWith("id:") ? [byArtist]
    : tab.mode === "artist" ? [byArtist, byComposer, byLooseTerm] : [byComposer, byLooseTerm];
  for (const fn of order) {
    if (tracks.length >= TRACKS_PER) break;
    let res = [];
    try { res = await fn(q, tab.genre); } catch (e) { console.warn("  " + e.message); }
    // Komponistsøk gir ofte arrangementer og samleplater; når vi har sentrale verk, krev at navnet står i tittel eller album
    if (fn === byComposer && works.length) {
      const sn = surnameOf(q);
      res = res.filter(r => norm(r.trackName + " " + r.collectionName).includes(sn));
    }
    const picked = pickVaried(res, tracks, TRACKS_PER - tracks.length);
    tracks.push(...picked.map(r => toTrack(r, force || guessType(r.trackName + " " + r.collectionName, "annet"))));
  }
  return { at: Date.now(), works, tracks };
}

// ---------- YouTube ----------

function videoQuery(tab, [name, , note, alt], entry) {
  const q = alt && !alt.startsWith("id:") ? alt : name;
  const firstNote = (note || "").split(/[;,]/)[0].trim();
  if (tab.id === "film") return `${firstNote} ${q} film score`;
  if (tab.id === "musikaler") return `${firstNote} musical ${q}`;
  const stage = entry?.works?.find(w => w.g === "scene");
  if (stage) return `${stage.t} ${surnameOf(q)} opera`;
  if (entry?.works?.[0]) return `${q} ${simplifyTitle(entry.works[0].t)} live`;
  return `${q} live`;
}

const decode = s => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function youtube(query) {
  const url = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=3"
    + "&fields=items(id/videoId,snippet/title)&q=" + encodeURIComponent(query) + "&key=" + YT_KEY;
  const d = await json(url);
  return (d.items || []).map(x => ({ id: x.id.videoId, t: decode(x.snippet.title) }));
}

// ---------- Hovedløp ----------

async function load(name) {
  try { return JSON.parse(await readFile(new URL(name, CACHE), "utf8")); } catch { return {}; }
}
const save = (name, data) => writeFile(new URL(name, CACHE), JSON.stringify(data));

const keyOf = (tab, row) => tab.mode + ":" + slug(row[3] || row[0]);

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const tracksCache = await load("spor.json");
  const videoCache = await load("video.json");
  const tabs = TABS.filter(t => !ONLY || ONLY.includes(t.id));

  let fetched = 0;
  for (const tab of tabs) {
    for (const row of tab.items) {
      if (row[0].startsWith("#") || fetched >= MAX_FETCH) continue;
      const k = keyOf(tab, row);
      const old = tracksCache[k];
      if (!FRESH && old && Date.now() - old.at < MAX_AGE) continue;
      console.log(`[${tab.id}] ${row[0]}`);
      try {
        tracksCache[k] = await fetchEntry(tab, row);
        console.log(`  ${tracksCache[k].tracks.length} spor, ${tracksCache[k].works.length} sentrale verk`);
        fetched++;
        await save("spor.json", tracksCache);
      } catch (e) { console.warn("  hoppet over: " + e.message); }
    }
  }

  if (YT_KEY && !NO_VIDEO) {
    let searches = 0;
    outer: for (const tab of tabs) {
      for (const row of tab.items) {
        if (row[0].startsWith("#")) continue;
        const k = keyOf(tab, row);
        if (videoCache[k] || searches >= VIDEO_MAX) continue;
        const query = videoQuery(tab, row, tracksCache[k]);
        try {
          videoCache[k] = { at: Date.now(), q: query, v: await youtube(query) };
          searches++;
          console.log(`[video] ${row[0]}: ${videoCache[k].v.length} treff`);
          await save("video.json", videoCache);
        } catch (e) {
          console.warn(`[video] stopper: ${e.message} ${e.body?.slice(0, 200) ?? ""}`);
          break outer;
        }
      }
    }
  } else if (!NO_VIDEO) {
    console.log("YOUTUBE_API_KEY mangler, hopper over video.");
  }

  // Skriv alle faner fra cachen, også de som ikke ble hentet nå
  const index = { oppdatert: new Date().toISOString(), typer: TYPES, faner: [] };
  for (const tab of TABS) {
    const items = tab.items.map(row => {
      if (row[0].startsWith("#")) return { h: row[0].slice(1), s: row[1] };
      const k = keyOf(tab, row);
      const e = tracksCache[k] || { works: [], tracks: [] };
      const item = { id: slug(row[0]), n: row[0], l: row[1], m: row[2], works: e.works, tracks: e.tracks };
      if (videoCache[k]?.v?.length) item.video = videoCache[k].v;
      return item;
    });
    const types = [...new Set(items.flatMap(i => (i.tracks || []).map(t => t.g)))];
    index.faner.push({ id: tab.id, label: tab.label, era: tab.era, typer: Object.keys(TYPES).filter(t => types.includes(t)) });
    await writeFile(new URL(tab.id + ".json", OUT), JSON.stringify({ id: tab.id, label: tab.label, era: tab.era, items }));
  }
  await writeFile(new URL("index.json", OUT), JSON.stringify(index));
  console.log(`Ferdig. ${fetched} oppføringer hentet, ${index.faner.length} faner skrevet til docs/data/.`);
}

main().catch(e => { console.error(e); process.exit(1); });
