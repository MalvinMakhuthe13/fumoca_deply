/**
 * FUMOCA Social Hub v80
 * ════════════════════════════════════════════════════════════════════════════
 * Everything needed to make a splat travel across social platforms,
 * documents, and messaging apps — as an interactive widget, a teaser video,
 * or a rich link preview.
 *
 * Channels supported:
 *   - WhatsApp  (rich link preview + deep link)
 *   - Instagram (teaser video download + Story sticker guide)
 *   - Facebook  (Open Graph embed)
 *   - Twitter/X (summary_large_image card)
 *   - LinkedIn  (article embed)
 *   - Email     (HTML embed + fallback image)
 *   - SMS/iMessage (short link)
 *   - Microsoft Office (PowerPoint / Word embed iframe snippet)
 *   - Google Docs / Slides (link card instructions)
 *   - QR code (for physical signage)
 *
 * Design principle: each channel gets the richest experience it supports.
 * Where interactive 3D isn't possible, we fall back to the teaser video.
 * Where video isn't possible, we fall back to the thumbnail with a CTA link.
 * ════════════════════════════════════════════════════════════════════════════
 */

// ── Config ────────────────────────────────────────────────────────────────────

const FUMOC_BASE = (() => {
  // Try to read from config, fall back to origin
  return window.FUMOCA_BASE_URL
    || window._fumocaConfig?.baseUrl
    || location.origin;
})();

// ── Link builders ─────────────────────────────────────────────────────────────

function _viewerUrl(splatId, params = {}) {
  const url = new URL(`${FUMOC_BASE}/viewer.html`);
  url.searchParams.set('id', splatId);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

function _showroomUrl(splatId, params = {}) {
  const url = new URL(`${FUMOC_BASE}/showroom.html`);
  url.searchParams.set('splatId', splatId);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

function _embedUrl(token) {
  return `${FUMOC_BASE}/embed/viewer.html?token=${token}`;
}

// ── QR code ───────────────────────────────────────────────────────────────────

function qrUrl(targetUrl, size = 280) {
  return `https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encodeURIComponent(targetUrl)}&choe=UTF-8`;
}

// ── Open Graph / meta tags ────────────────────────────────────────────────────

/**
 * Returns the set of <meta> tags needed for rich link previews on Facebook,
 * Twitter/X, LinkedIn, iMessage, WhatsApp, Slack, Discord, etc.
 * Inject these into the <head> of your viewer / showroom / public-preview page.
 */
function ogMetaTags(record) {
  const id          = record.id;
  const title       = record.title       || 'Interactive 3D View';
  const description = record.description || 'Explore this Gaussian Splat in 3D — powered by FUMOCA';
  const thumbnail   = record.thumbnail_url || '';
  const viewUrl     = _showroomUrl(id);

  return [
    // Open Graph (Facebook, WhatsApp, LinkedIn, Discord, Slack)
    `<meta property="og:type"        content="website" />`,
    `<meta property="og:url"         content="${viewUrl}" />`,
    `<meta property="og:title"       content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image"       content="${thumbnail}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    // Twitter / X card
    `<meta name="twitter:card"        content="summary_large_image" />`,
    `<meta name="twitter:title"       content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image"       content="${thumbnail}" />`,
    // Apple iMessage
    `<link rel="apple-touch-icon" href="${thumbnail}" />`,
    // Canonical
    `<link rel="canonical" href="${viewUrl}" />`,
  ].join('\n');
}

// ── Share targets ─────────────────────────────────────────────────────────────

/**
 * Each function returns a { label, emoji, url, instructions?, action } object.
 * `action` is one of: 'open' (navigate), 'copy', 'download', 'native'.
 */

function whatsapp(record) {
  const url  = _showroomUrl(record.id);
  const text = `${record.title || 'Check this out'} — view in 3D: ${url}`;
  return {
    label: 'WhatsApp',
    emoji: '💬',
    url: `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`,
    action: 'open',
    note: 'Opens WhatsApp with a rich link preview that shows the 3D thumbnail.',
  };
}

function facebook(record) {
  const url = _showroomUrl(record.id);
  return {
    label: 'Facebook',
    emoji: '👍',
    url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    action: 'open',
    note: 'Shares with your Open Graph thumbnail. Works in posts, stories, and groups.',
  };
}

function twitter(record) {
  const url  = _showroomUrl(record.id);
  const text = record.title ? `${record.title} — view in 3D` : 'Check out this 3D capture';
  return {
    label: 'X / Twitter',
    emoji: '𝕏',
    url: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    action: 'open',
  };
}

function linkedin(record) {
  const url = _showroomUrl(record.id);
  return {
    label: 'LinkedIn',
    emoji: '💼',
    url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    action: 'open',
    note: 'Best for real estate and commercial listings — shows full rich preview card.',
  };
}

function smsShare(record) {
  const url  = _showroomUrl(record.id);
  const text = `${record.title || 'View in 3D'}: ${url}`;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const sep   = isIOS ? '&' : '?';
  return {
    label: 'SMS / iMessage',
    emoji: '📱',
    url: `sms:${sep}body=${encodeURIComponent(text)}`,
    action: 'open',
    note: 'iMessage will show the preview card. Android SMS shows a plain link.',
  };
}

function emailShare(record, options = {}) {
  const url  = _showroomUrl(record.id);
  const subject = options.subject || `3D View: ${record.title || 'FUMOCA Experience'}`;
  const bodyText = [
    options.intro || 'Hi,',
    '',
    `I wanted to share this interactive 3D view with you:`,
    `${record.title || 'FUMOCA 3D Experience'}`,
    '',
    `👉 View it here: ${url}`,
    '',
    record.description || '',
    '',
    '---',
    `Powered by FUMOCA — ${FUMOC_BASE}`,
  ].join('\n');

  return {
    label: 'Email',
    emoji: '📧',
    url: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`,
    action: 'open',
  };
}

function instagramGuide(record) {
  // Instagram doesn't support direct share via URL — guide the user
  return {
    label: 'Instagram',
    emoji: '📸',
    action: 'guide',
    steps: [
      'Download the teaser video using the Download button below.',
      'Open Instagram → create a new Reel or Story.',
      'Select the downloaded video.',
      'Add a link sticker pointing to: ' + _showroomUrl(record.id),
      'Post — viewers tap the sticker to open the full 3D experience.',
    ],
    note: 'Instagram Stories with link stickers work best for 9:16 vertical videos.',
  };
}

// ── Office / document embeds ──────────────────────────────────────────────────

/**
 * officePowerPointSnippet — instructions for embedding in PowerPoint.
 * PowerPoint supports web embeds via Insert → Online Video → paste URL.
 * The viewer iframe loads inside the slide.
 */
function officePowerPointSnippet(record, embedToken) {
  const embedSrc = embedToken ? _embedUrl(embedToken) : _viewerUrl(record.id);
  return {
    label: 'PowerPoint',
    emoji: '📊',
    action: 'guide',
    embedUrl: embedSrc,
    steps: [
      'Copy the embed URL below.',
      'In PowerPoint: Insert → Online Video → paste the URL.',
      'Resize the video placeholder to fill the slide.',
      'The viewer renders live during your presentation (requires internet).',
      'For offline presentations: use the teaser video instead.',
    ],
    iframeHtml: `<iframe src="${embedSrc}" width="1280" height="720" style="border:none;" allow="autoplay;fullscreen" title="${record.title || '3D View'}"></iframe>`,
    embedUrl: embedSrc,
  };
}

function officeWordSnippet(record, embedToken) {
  const url  = _showroomUrl(record.id);
  const embedSrc = embedToken ? _embedUrl(embedToken) : null;
  return {
    label: 'Word / Google Docs',
    emoji: '📄',
    action: 'guide',
    steps: [
      'In Word: Insert → Link → paste the URL below. The thumbnail image will appear.',
      'In Google Docs: Insert → Smart Chip → paste the URL. A preview card appears.',
      'For richer embedding in Google Slides: Insert → Video → paste the embed URL.',
    ],
    shareUrl: url,
    embedUrl: embedSrc,
  };
}

// ── Native Share API ──────────────────────────────────────────────────────────

async function nativeShare(record, file = null) {
  if (!navigator.share) return false;

  const shareData = {
    title: record.title || '3D View',
    text:  record.description || 'Interactive 3D experience powered by FUMOCA',
    url:   _showroomUrl(record.id),
  };

  // Include the .fumoc file if available (iOS/Android will offer to AirDrop / save it)
  if (file && navigator.canShare?.({ files: [file] })) {
    shareData.files = [file];
  }

  try {
    await navigator.share(shareData);
    return true;
  } catch (err) {
    if (err.name !== 'AbortError') console.warn('[SocialHub] native share failed:', err);
    return false;
  }
}

// ── UI: share panel ───────────────────────────────────────────────────────────

function buildSharePanel(record, options = {}) {
  const {
    embedToken = null,
    teaserBlob  = null,  // if a teaser video has been recorded
    fumocBlob   = null,  // if a .fumoc file has been exported
    containerId = null,
  } = options;

  const container = containerId
    ? document.getElementById(containerId)
    : (() => {
        const el = document.createElement('div');
        el.id = 'fumocSharePanel';
        document.body.appendChild(el);
        return el;
      })();

  if (!container) return;

  const showroomLink  = _showroomUrl(record.id);
  const igGuide       = instagramGuide(record);
  const ppSnippet     = officePowerPointSnippet(record, embedToken);
  const wordSnippet   = officeWordSnippet(record, embedToken);

  container.innerHTML = `
    <style>
      #fumocSharePanel, .fumoc-share-inner {
        font-family: 'DM Sans', system-ui, sans-serif;
      }
      .fsp-title {
        font-size: 13px; font-weight: 700; color: rgba(255,255,255,.4);
        text-transform: uppercase; letter-spacing: .08em; margin-bottom: 10px;
      }
      .fsp-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
        gap: 8px; margin-bottom: 16px;
      }
      .fsp-chip {
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        padding: 10px 6px; border-radius: 14px;
        background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.09);
        cursor: pointer; color: #fff; font-size: 11px; font-weight: 600;
        transition: background .15s; text-align: center;
      }
      .fsp-chip:hover { background: rgba(255,255,255,.13); }
      .fsp-chip .fsp-emoji { font-size: 22px; }
      .fsp-section { margin-bottom: 16px; }
      .fsp-guide {
        background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.08);
        border-radius: 12px; padding: 12px 14px; font-size: 12px;
        color: rgba(255,255,255,.65); line-height: 1.7;
      }
      .fsp-guide ol { padding-left: 18px; margin-top: 6px; }
      .fsp-guide li { margin-bottom: 4px; }
      .fsp-field {
        width: 100%; padding: 8px 10px; border-radius: 10px; margin-top: 8px;
        background: rgba(0,0,0,.4); border: 1px solid rgba(255,255,255,.1);
        color: #c8ff00; font-size: 11px; font-family: monospace; resize: none;
        word-break: break-all;
      }
      .fsp-btn {
        width: 100%; padding: 10px; border-radius: 12px; margin-top: 6px;
        background: rgba(200,255,0,.15); border: 1px solid rgba(200,255,0,.3);
        color: #c8ff00; font-weight: 700; font-size: 12px; cursor: pointer;
        transition: background .15s;
      }
      .fsp-btn:hover { background: rgba(200,255,0,.25); }
      .fsp-qr { display: block; width: 120px; height: 120px; border-radius: 10px; margin: 8px 0; }
      .fsp-note { font-size: 11px; color: rgba(255,255,255,.35); margin-top: 6px; line-height: 1.5; }
    </style>
    <div class="fumoc-share-inner">
      <div class="fsp-section">
        <div class="fsp-title">Share directly</div>
        <div class="fsp-grid">
          <div class="fsp-chip" data-share="whatsapp"><span class="fsp-emoji">💬</span>WhatsApp</div>
          <div class="fsp-chip" data-share="facebook"><span class="fsp-emoji">👍</span>Facebook</div>
          <div class="fsp-chip" data-share="twitter"><span class="fsp-emoji">𝕏</span>Twitter</div>
          <div class="fsp-chip" data-share="linkedin"><span class="fsp-emoji">💼</span>LinkedIn</div>
          <div class="fsp-chip" data-share="sms"><span class="fsp-emoji">📱</span>SMS</div>
          <div class="fsp-chip" data-share="email"><span class="fsp-emoji">📧</span>Email</div>
          ${navigator.share ? `<div class="fsp-chip" data-share="native"><span class="fsp-emoji">🔗</span>More…</div>` : ''}
        </div>
      </div>

      <div class="fsp-section">
        <div class="fsp-title">Copy link</div>
        <textarea class="fsp-field" rows="2" readonly>${showroomLink}</textarea>
        <button class="fsp-btn" id="fspCopyLink">⎘ Copy Link</button>
      </div>

      <div class="fsp-section">
        <div class="fsp-title">📸 Instagram</div>
        <div class="fsp-guide">
          <ol>${igGuide.steps.map(s => `<li>${s}</li>`).join('')}</ol>
        </div>
        ${teaserBlob ? `<button class="fsp-btn" id="fspDownloadTeaser">⬇ Download Teaser Video</button>` : ''}
      </div>

      <div class="fsp-section">
        <div class="fsp-title">📊 PowerPoint / Slides</div>
        <div class="fsp-guide">
          <ol>${ppSnippet.steps.map(s => `<li>${s}</li>`).join('')}</ol>
        </div>
        <textarea class="fsp-field" rows="2" readonly>${ppSnippet.embedUrl}</textarea>
        <button class="fsp-btn" id="fspCopyEmbedUrl">⎘ Copy Embed URL</button>
      </div>

      <div class="fsp-section">
        <div class="fsp-title">📄 Word / Google Docs</div>
        <div class="fsp-guide">
          <ol>${wordSnippet.steps.map(s => `<li>${s}</li>`).join('')}</ol>
        </div>
        <textarea class="fsp-field" rows="2" readonly>${wordSnippet.shareUrl}</textarea>
        <button class="fsp-btn" id="fspCopyDocLink">⎘ Copy Link for Docs</button>
      </div>

      <div class="fsp-section">
        <div class="fsp-title">📱 QR Code</div>
        <img class="fsp-qr" src="${qrUrl(showroomLink)}" alt="QR Code" />
        <div class="fsp-note">Scan to open the 3D experience on any phone. Print on listings, brochures, or signage.</div>
      </div>

      ${fumocBlob ? `
      <div class="fsp-section">
        <div class="fsp-title">📦 Export .fumoc file</div>
        <div class="fsp-guide">
          The .fumoc file bundles the splat, hotspots, tour, and thumbnail into one portable file.
          Any app supporting the FUMOC format can open it.
        </div>
        <button class="fsp-btn" id="fspDownloadFumoc">⬇ Download .fumoc</button>
      </div>` : ''}
    </div>
  `;

  // Wire up events
  container.querySelectorAll('.fsp-chip[data-share]').forEach(chip => {
    chip.addEventListener('click', () => {
      const ch = chip.dataset.share;
      let target;
      if (ch === 'whatsapp') target = whatsapp(record);
      else if (ch === 'facebook') target = facebook(record);
      else if (ch === 'twitter') target = twitter(record);
      else if (ch === 'linkedin') target = linkedin(record);
      else if (ch === 'sms') target = smsShare(record);
      else if (ch === 'email') target = emailShare(record);
      else if (ch === 'native') { nativeShare(record); return; }
      if (target?.url) window.open(target.url, '_blank', 'noopener');
    });
  });

  function _copyText(text, btn) {
    navigator.clipboard?.writeText(text).catch(() => {});
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = btn._orig; }, 2000);
  }

  const copyLink = container.querySelector('#fspCopyLink');
  if (copyLink) { copyLink._orig = copyLink.textContent; copyLink.addEventListener('click', () => _copyText(showroomLink, copyLink)); }

  const copyEmbed = container.querySelector('#fspCopyEmbedUrl');
  if (copyEmbed) { copyEmbed._orig = copyEmbed.textContent; copyEmbed.addEventListener('click', () => _copyText(ppSnippet.embedUrl, copyEmbed)); }

  const copyDoc = container.querySelector('#fspCopyDocLink');
  if (copyDoc) { copyDoc._orig = copyDoc.textContent; copyDoc.addEventListener('click', () => _copyText(wordSnippet.shareUrl, copyDoc)); }

  const dlTeaser = container.querySelector('#fspDownloadTeaser');
  if (dlTeaser && teaserBlob) {
    dlTeaser.addEventListener('click', () => {
      const url = URL.createObjectURL(teaserBlob);
      const a = document.createElement('a');
      a.href = url; a.download = `${record.id}-teaser.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  }

  const dlFumoc = container.querySelector('#fspDownloadFumoc');
  if (dlFumoc && fumocBlob) {
    dlFumoc.addEventListener('click', () => {
      const url = URL.createObjectURL(fumocBlob);
      const a = document.createElement('a');
      a.href = url; a.download = `${record.title || record.id}.fumoc`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  }

  return container;
}

// ── Inject OG meta into current page ─────────────────────────────────────────

function injectOgMeta(record) {
  // Remove existing OG meta
  document.querySelectorAll('meta[property^="og:"],meta[name^="twitter:"]').forEach(el => el.remove());
  const temp = document.createElement('div');
  temp.innerHTML = ogMetaTags(record);
  Array.from(temp.children).forEach(el => document.head.appendChild(el));
}

// ── Public API ────────────────────────────────────────────────────────────────

const FumocSocialHub = {
  // Share channel builders
  whatsapp, facebook, twitter, linkedin, smsShare, emailShare, instagramGuide,
  // Document embed
  officePowerPointSnippet, officeWordSnippet,
  // Utilities
  qrUrl, ogMetaTags, injectOgMeta, nativeShare,
  // URL helpers
  showroomUrl: _showroomUrl, viewerUrl: _viewerUrl, embedUrl: _embedUrl,
  // UI
  buildSharePanel,
};

window.FumocSocialHub = FumocSocialHub;
export default FumocSocialHub;
