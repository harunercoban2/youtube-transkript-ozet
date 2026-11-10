/* YouTube Transkript + Özet — content script
 * 1) Transkripti YouTube'un kendi altyazı verisinden (captionTracks → timedtext) çeker.
 *    Olmazsa sayfadaki "Transkripti göster" panelinden okur.
 * 2) "Özetle" butonu: prompt panoya kopyalanır ve ChatGPT / Claude yeni sekmede açılır.
 *    Kısa metinlerde prompt URL ile (?q=) doğrudan doldurulur; uzunlarda Ctrl/Cmd+V yeterlidir.
 */
(() => {
  'use strict';

  const PANEL_ID = 'yto-panel';
  const URL_PREFILL_LIMIT = 7000; // encode edilmiş prompt bu uzunluğu aşarsa ?q= yerine panoya kopyala

  const DEFAULTS = {
    promptTemplate:
      'Aşağıdaki YouTube videosunun transkriptini Türkçe olarak özetle.\n' +
      '- Önce 2-3 cümlelik genel özet ver.\n' +
      '- Sonra ana noktaları madde madde sırala.\n' +
      '- Varsa önemli sonuç, öneri veya çıkarımları ayrıca belirt.\n\n' +
      'Başlık: {title}\nURL: {url}\n\nTranskript:\n{transcript}',
    includeTimestamps: false,
    preferredLang: 'tr',
    target: 'chatgpt'
  };

  const TARGETS = {
    chatgpt: { label: 'ChatGPT', base: 'https://chatgpt.com/', q: (p) => `https://chatgpt.com/?q=${encodeURIComponent(p)}` },
    claude:  { label: 'Claude',  base: 'https://claude.ai/new', q: (p) => `https://claude.ai/new?q=${encodeURIComponent(p)}` }
  };

  let settings = { ...DEFAULTS };
  let state = { videoId: null, tracks: [], segments: [], loading: false };

  /* ---------- yardımcılar ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const getVideoId = () => new URL(location.href).searchParams.get('v');
  const getTitle = () =>
    ($('h1.ytd-watch-metadata yt-formatted-string')?.textContent ||
      $('meta[name="title"]')?.content ||
      document.title.replace(/ - YouTube$/, '')).trim();

  function fmtTime(sec) {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULTS, (v) => { settings = { ...DEFAULTS, ...v }; resolve(settings); });
      } catch { resolve(settings); }
    });
  }

  // "ytInitialPlayerResponse = {...}" içindeki JSON'u süslü parantez eşleyerek çıkarır
  function extractJson(html, marker) {
    const i = html.indexOf(marker);
    if (i < 0) return null;
    let start = html.indexOf('{', i);
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let j = start; j < html.length; j++) {
      const c = html[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; } } }
    }
    return null;
  }

  /* ---------- transkript kaynakları ---------- */
  async function fetchCaptionTracks(videoId) {
    // SPA gezinmesinde sayfa içindeki ytInitialPlayerResponse bayatlar; taze HTML çekiyoruz.
    // location.origin: m.youtube.com'da www'ye istek CORS'a takılır.
    const res = await fetch(`${location.origin}/watch?v=${encodeURIComponent(videoId)}&hl=tr`, { credentials: 'include' });
    const html = await res.text();
    const pr = extractJson(html, 'ytInitialPlayerResponse');
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return tracks.map((t) => ({
      baseUrl: t.baseUrl,
      lang: t.languageCode,
      name: t.name?.simpleText || t.name?.runs?.map((r) => r.text).join('') || t.languageCode,
      auto: t.kind === 'asr'
    }));
  }

  function pickTrack(tracks) {
    const pref = (settings.preferredLang || 'tr').toLowerCase();
    return (
      tracks.find((t) => t.lang.toLowerCase().startsWith(pref) && !t.auto) ||
      tracks.find((t) => t.lang.toLowerCase().startsWith(pref)) ||
      tracks.find((t) => !t.auto) ||
      tracks[0]
    );
  }

  async function fetchTimedText(track) {
    // 1) json3
    try {
      const r = await fetch(track.baseUrl + '&fmt=json3', { credentials: 'include' });
      const txt = await r.text();
      if (txt.trim()) {
        const data = JSON.parse(txt);
        const segs = (data.events || [])
          .filter((e) => e.segs)
          .map((e) => ({ t: (e.tStartMs || 0) / 1000, text: e.segs.map((s) => s.utf8).join('').replace(/\s+/g, ' ').trim() }))
          .filter((s) => s.text);
        if (segs.length) return segs;
      }
    } catch { /* xml'e düş */ }
    // 2) xml
    const r = await fetch(track.baseUrl, { credentials: 'include' });
    const xml = await r.text();
    if (!xml.trim()) return [];
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return [...doc.querySelectorAll('text')]
      .map((n) => ({ t: parseFloat(n.getAttribute('start') || '0'), text: n.textContent.replace(/\s+/g, ' ').trim() }))
      .filter((s) => s.text);
  }

  // Yedek: YouTube'un kendi transkript panelini açıp DOM'dan oku
  // Eski (ytd-transcript-segment-renderer) ve 2026 sonu yeni (transcript-segment-view-model) yapı
  const SEGMENT_SEL = 'ytd-transcript-segment-renderer, transcript-segment-view-model';
  const TS_SEL = '.segment-timestamp, .ytwTranscriptSegmentViewModelTimestamp';
  const TEXT_SEL = '.segment-text, .ytAttributedStringHost';

  async function scrapeTranscriptPanel() {
    let items = document.querySelectorAll(SEGMENT_SEL);
    if (!items.length) {
      const btn =
        $('ytd-video-description-transcript-section-renderer button') ||
        [...document.querySelectorAll('button')].find((b) => /transkript|transcript/i.test(b.getAttribute('aria-label') || b.textContent));
      if (!btn) return [];
      btn.click();
      for (let i = 0; i < 40 && !items.length; i++) { await sleep(250); items = document.querySelectorAll(SEGMENT_SEL); }
    }
    return [...items].map((el) => {
      const ts = el.querySelector(TS_SEL)?.textContent.trim() || '0:00';
      const parts = ts.split(':').map(Number);
      const t = parts.every(Number.isFinite) ? parts.reduce((a, b) => a * 60 + b, 0) : 0;
      return { t, text: (el.querySelector(TEXT_SEL)?.textContent || '').replace(/\s+/g, ' ').trim() };
    }).filter((s) => s.text);
  }

  async function loadTranscript(trackIndex = null) {
    const videoId = getVideoId();
    if (!videoId || state.loading) return;
    state.loading = true;
    setStatus('Transkript alınıyor…');
    try {
      // Beklerken kullanıcı başka videoya geçerse eski sonucu yeni videoya yazma
      const stale = () => getVideoId() !== videoId;
      if (state.videoId !== videoId || !state.tracks.length) {
        const tracks = await fetchCaptionTracks(videoId);
        if (stale()) return;
        state.videoId = videoId;
        state.tracks = tracks;
        renderTrackSelect();
      }
      let segs = [];
      if (state.tracks.length) {
        const track = (trackIndex != null && state.tracks[trackIndex]) || pickTrack(state.tracks);
        const sel = $('#yto-track'); if (sel) sel.value = String(state.tracks.indexOf(track));
        segs = await fetchTimedText(track);
        if (stale()) return;
      }
      if (!segs.length) {
        setStatus('Altyazı verisi alınamadı, sayfadaki transkript paneli deneniyor…');
        segs = await scrapeTranscriptPanel();
        if (stale()) return;
      }
      state.videoId = videoId;
      state.segments = segs;
      if (!segs.length) { setStatus('Bu videoda transkript bulunamadı.', true); }
      else setStatus(`${segs.length} satır · ${transcriptText().length.toLocaleString('tr-TR')} karakter`);
      renderTranscript();
    } catch (e) {
      console.error('[YTÖ]', e);
      setStatus('Hata: ' + (e.message || e), true);
    } finally { state.loading = false; }
  }

  function transcriptText(withTs = settings.includeTimestamps) {
    return state.segments.map((s) => (withTs ? `[${fmtTime(s.t)}] ${s.text}` : s.text)).join(withTs ? '\n' : ' ');
  }

  function buildPrompt() {
    // Tek geçiş + fonksiyonlu replace: metindeki "$&", "$$" gibi diziler özel anlam kazanmaz,
    // başlıkta geçen "{transcript}" gibi yer tutucular ikinci kez değiştirilmez.
    const values = {
      title: getTitle(),
      url: `https://www.youtube.com/watch?v=${state.videoId}`,
      transcript: transcriptText()
    };
    return (settings.promptTemplate || DEFAULTS.promptTemplate)
      .replace(/\{(title|url|transcript)\}/g, (_, k) => values[k]);
  }

  /* ---------- eylemler ---------- */
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    }
  }

  async function summarize(targetKey) {
    if (!state.segments.length) { setStatus('Önce transkript alınmalı.', true); return; }
    const target = TARGETS[targetKey] || TARGETS.chatgpt;
    const prompt = buildPrompt();
    await copy(prompt);
    const url = target.q(prompt);
    if (url.length <= URL_PREFILL_LIMIT) {
      window.open(url, '_blank');
      setStatus(`${target.label} açıldı, prompt otomatik dolduruldu (panoya da kopyalandı).`);
    } else {
      window.open(target.base, '_blank');
      setStatus(`Prompt panoya kopyalandı → ${target.label} sekmesinde Ctrl/Cmd+V yapıp gönderin.`);
    }
  }

  function download() {
    if (!state.segments.length) return;
    const blob = new Blob([`${getTitle()}\nhttps://www.youtube.com/watch?v=${state.videoId}\n\n${transcriptText(true)}`], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${getTitle().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)} - transkript.txt`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function seekTo(sec) {
    const v = $('video.html5-main-video'); if (v) { v.currentTime = sec; v.play?.(); }
  }

  /* ---------- arayüz ---------- */
  function setStatus(msg, isErr = false) {
    const el = $('#yto-status'); if (!el) return;
    el.textContent = msg; el.classList.toggle('yto-err', isErr);
  }

  function renderTrackSelect() {
    const sel = $('#yto-track'); if (!sel) return;
    sel.innerHTML = '';
    if (!state.tracks.length) { sel.hidden = true; return; }
    sel.hidden = false;
    state.tracks.forEach((t, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = t.name + (t.auto ? ' (otomatik)' : '');
      sel.appendChild(o);
    });
  }

  function renderTranscript() {
    const box = $('#yto-transcript'); if (!box) return;
    box.innerHTML = '';
    const frag = document.createDocumentFragment();
    state.segments.forEach((s) => {
      const row = document.createElement('div'); row.className = 'yto-row';
      const ts = document.createElement('button'); ts.className = 'yto-ts'; ts.textContent = fmtTime(s.t); ts.title = 'Bu ana git';
      ts.addEventListener('click', () => seekTo(s.t));
      const tx = document.createElement('span'); tx.textContent = s.text;
      row.append(ts, tx); frag.appendChild(row);
    });
    box.appendChild(frag);
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="yto-head">
        <span class="yto-title">📝 Transkript + Özet</span>
        <select id="yto-track" title="Altyazı dili" hidden></select>
        <button id="yto-toggle" class="yto-icon" title="Daralt/Genişlet">▾</button>
      </div>
      <div class="yto-body">
        <div class="yto-actions">
          <button id="yto-load" class="yto-btn">Transkripti Al</button>
          <button id="yto-sum-chatgpt" class="yto-btn yto-primary">ChatGPT'de Özetle</button>
          <button id="yto-sum-claude" class="yto-btn yto-primary">Claude'da Özetle</button>
          <button id="yto-copy-prompt" class="yto-btn">Promptu Kopyala</button>
          <button id="yto-copy" class="yto-btn">Transkripti Kopyala</button>
          <button id="yto-dl" class="yto-btn">.txt İndir</button>
        </div>
        <div id="yto-status" class="yto-status">Transkripti almak için butona basın.</div>
        <div id="yto-transcript" class="yto-transcript"></div>
      </div>`;

    panel.querySelector('#yto-load').addEventListener('click', () => loadTranscript());
    panel.querySelector('#yto-track').addEventListener('change', (e) => loadTranscript(Number(e.target.value)));
    panel.querySelector('#yto-sum-chatgpt').addEventListener('click', () => summarize('chatgpt'));
    panel.querySelector('#yto-sum-claude').addEventListener('click', () => summarize('claude'));
    panel.querySelector('#yto-copy-prompt').addEventListener('click', async () => {
      if (!state.segments.length) return setStatus('Önce transkript alınmalı.', true);
      await copy(buildPrompt()); setStatus('Prompt panoya kopyalandı.');
    });
    panel.querySelector('#yto-copy').addEventListener('click', async () => {
      if (!state.segments.length) return setStatus('Önce transkript alınmalı.', true);
      await copy(transcriptText(true)); setStatus('Transkript panoya kopyalandı.');
    });
    panel.querySelector('#yto-dl').addEventListener('click', download);
    panel.querySelector('#yto-toggle').addEventListener('click', (e) => {
      panel.classList.toggle('yto-collapsed');
      e.target.textContent = panel.classList.contains('yto-collapsed') ? '▸' : '▾';
    });
    return panel;
  }

  async function mount() {
    if (!location.pathname.startsWith('/watch')) { $('#' + PANEL_ID)?.remove(); return; }
    // Yerleşim: sağ sütunun (öneriler) en üstü; yoksa videonun altı
    let host = null;
    for (let i = 0; i < 40 && !host; i++) { host = $('#secondary-inner') || $('#secondary') || $('#below'); if (!host) await sleep(250); }
    if (!host) return;
    let panel = $('#' + PANEL_ID);
    if (!panel) panel = buildPanel();
    if (panel.parentElement !== host) host.prepend(panel);

    const vid = getVideoId();
    if (vid !== state.videoId) {
      state = { videoId: null, tracks: [], segments: [], loading: false };
      renderTrackSelect(); renderTranscript(); setStatus('Transkripti almak için butona basın.');
    }
  }

  /* ---------- başlat ---------- */
  loadSettings().then(mount);
  document.addEventListener('yt-navigate-finish', () => setTimeout(mount, 300));
  try {
    chrome.storage.onChanged.addListener((changes) => {
      for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
    });
  } catch { /* yok say */ }
})();
