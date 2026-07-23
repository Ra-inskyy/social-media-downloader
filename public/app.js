// DOM Elements
const videoUrlInput = document.getElementById('videoUrl');
const downloadBtn = document.getElementById('downloadBtn');
const pasteBtn = document.getElementById('pasteBtn');
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const errorText = document.getElementById('errorText');
const result = document.getElementById('result');
const thumbnail = document.getElementById('thumbnail');
const platformBadge = document.getElementById('platformBadge');
const videoTitle = document.getElementById('videoTitle');
const videoAuthor = document.getElementById('videoAuthor');
const videoDuration = document.getElementById('videoDuration');
const videoPlatform = document.getElementById('videoPlatform');
const formatList = document.getElementById('formatList');
const tabs = document.querySelectorAll('.tab');
const downloadLoading = document.getElementById('downloadLoading');
const downloadLoadingText = document.getElementById('downloadLoadingText');

// State
let currentVideoInfo = null;

// Platform Tab Filtering (visual only)
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const platform = tab.dataset.platform;
    if (platform === 'all') {
      videoUrlInput.placeholder = 'Paste link video di sini...';
    } else {
      const names = {
        youtube: 'YouTube',
        tiktok: 'TikTok',
        facebook: 'Facebook',
        instagram: 'Instagram',
        spotify: 'Spotify'
      };
      videoUrlInput.placeholder = `Paste link ${names[platform]} di sini...`;
    }
    videoUrlInput.focus();
  });
});

// Paste button
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    videoUrlInput.value = text;
    videoUrlInput.focus();
  } catch (err) {
    // Clipboard API might not be available
    videoUrlInput.focus();
    showError('Tidak dapat mengakses clipboard. Paste manual dengan Ctrl+V.');
  }
});

// Download button
downloadBtn.addEventListener('click', () => {
  handleDownload();
});

// Enter key on input
videoUrlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handleDownload();
  }
});

// Main download handler
async function handleDownload() {
  const url = videoUrlInput.value.trim();

  if (!url) {
    showError('Masukkan link video terlebih dahulu.');
    return;
  }

  if (!isValidUrl(url)) {
    showError('Link tidak valid. Masukkan URL yang benar.');
    return;
  }

  hideError();
  hideResult();
  showLoading();

  try {
    const response = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Gagal mendapatkan informasi video.');
    }

    currentVideoInfo = data;
    displayResult(data);
  } catch (err) {
    showError(err.message || 'Terjadi kesalahan. Coba lagi nanti.');
  } finally {
    hideLoading();
  }
}

// Display result
function displayResult(info) {
  // Set thumbnail
  if (info.thumbnail) {
    thumbnail.src = info.thumbnail;
    thumbnail.alt = info.title;
  } else {
    thumbnail.src = generatePlaceholderThumbnail(info.platform);
    thumbnail.alt = info.title;
  }

  // Platform badge
  const platformNames = {
    youtube: 'YouTube',
    tiktok: 'TikTok',
    facebook: 'Facebook',
    instagram: 'Instagram',
    spotify: 'Spotify'
  };
  platformBadge.textContent = platformNames[info.platform] || info.platform;

  // Video details
  videoTitle.textContent = info.title || 'Video';
  videoAuthor.textContent = info.author || '';

  // Duration
  if (info.duration) {
    videoDuration.textContent = formatDuration(info.duration);
    videoDuration.classList.remove('hidden');
  } else {
    videoDuration.classList.add('hidden');
  }

  // Platform tag
  videoPlatform.textContent = platformNames[info.platform];

  // Spotify-specific: show album and track count
  if (info.platform === 'spotify') {
    let authorText = info.author || '';
    if (info.album) authorText += (authorText ? ' • ' : '') + info.album;
    if (info.trackCount) authorText += ` • ${info.trackCount} lagu`;
    videoAuthor.textContent = authorText;
  }

  // Format buttons
  formatList.innerHTML = '';
  if (info.formats && info.formats.length > 0) {
    info.formats.forEach(format => {
      const btn = document.createElement('button');
      btn.className = 'format-btn';
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7,10 12,15 17,10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        ${format.quality || format.type || 'Download'}
      `;
      btn.addEventListener('click', () => startDownload(info, format));
      formatList.appendChild(btn);
    });
  } else {
    const btn = document.createElement('button');
    btn.className = 'format-btn';
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7,10 12,15 17,10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download
    `;
    btn.addEventListener('click', () => startDownload(info, {}));
    formatList.appendChild(btn);
  }

  showResult();
}

// Start download
async function startDownload(info, format) {
  try {
    const params = new URLSearchParams({
      url: info.url,
      platform: info.platform,
      itag: format.itag || '',
      quality: format.quality || ''
    });

    // Show download loading indicator
    hideError();
    if (info.platform === 'spotify') {
      const isCollection = format.type && (format.type.includes('zip'));
      if (isCollection) {
        downloadLoadingText.innerHTML = 'Sedang memproses playlist di server... ⏳<br><small style="font-size: 0.8em; opacity: 0.8;">Pop-up download browser akan muncul otomatis setelah server selesai.</small>';
      } else {
        downloadLoadingText.innerHTML = 'Memproses lagu dari Spotify... 🎵';
      }
    } else {
      downloadLoadingText.innerHTML = 'Memproses video... ⏳';
    }
    downloadLoading.classList.remove('hidden');

    // Disable buttons temporarily to prevent double-click spam
    const formatBtns = formatList.querySelectorAll('.format-btn');
    formatBtns.forEach(btn => { btn.disabled = true; btn.style.opacity = '0.5'; });

    // Trigger native browser download
    window.location.href = '/api/download?' + params.toString();

    // Re-enable buttons and hide loading after a reasonable time 
    // since we cannot detect exactly when a native attachment download finishes
    setTimeout(() => {
      downloadLoading.classList.add('hidden');
      formatBtns.forEach(btn => { btn.disabled = false; btn.style.opacity = '1'; });
    }, 5000);

  } catch (err) {
    showError(err.message || 'Gagal memulai download.');
    downloadLoading.classList.add('hidden');
  }
}

// Utility Functions
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hrs}:${String(remainMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function generatePlaceholderThumbnail(platform) {
  // Return a data URI placeholder SVG
  const colors = {
    youtube: '#FF0000',
    tiktok: '#00f2ea',
    facebook: '#1877F2',
    instagram: '#E4405F',
    spotify: '#1DB954'
  };
  const color = colors[platform] || '#667eea';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <rect width="320" height="180" fill="#1a1a2e"/>
    <circle cx="160" cy="90" r="30" fill="${color}" opacity="0.3"/>
    ${info && info === 'spotify' ? 
      '<path d="M148 80 C148 80, 160 75, 172 80 M146 90 C146 90, 160 84, 174 90 M144 100 C144 100, 160 93, 176 100" stroke="' + color + '" stroke-width="3" fill="none" stroke-linecap="round"/>' :
      '<polygon points="150,75 150,105 175,90" fill="' + color + '"/>'
    }
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// UI Helpers
function showLoading() {
  loading.classList.remove('hidden');
}

function hideLoading() {
  loading.classList.add('hidden');
}

function showError(message) {
  errorText.textContent = message;
  error.classList.remove('hidden');
  // Auto-hide after 5 seconds
  setTimeout(() => hideError(), 5000);
}

function hideError() {
  error.classList.add('hidden');
}

function showResult() {
  result.classList.remove('hidden');
}

function hideResult() {
  result.classList.add('hidden');
}

// Auto-detect pasted URL
videoUrlInput.addEventListener('paste', () => {
  setTimeout(() => {
    const url = videoUrlInput.value.trim();
    if (url && isValidUrl(url)) {
      // Auto-select the matching platform tab
      const platformMap = [
        { pattern: /youtube\.com|youtu\.be/i, platform: 'youtube' },
        { pattern: /tiktok\.com/i, platform: 'tiktok' },
        { pattern: /facebook\.com|fb\.watch/i, platform: 'facebook' },
        { pattern: /instagram\.com/i, platform: 'instagram' },
        { pattern: /open\.spotify\.com/i, platform: 'spotify' }
      ];

      for (const { pattern, platform } of platformMap) {
        if (pattern.test(url)) {
          tabs.forEach(t => {
            t.classList.toggle('active', t.dataset.platform === platform);
          });
          break;
        }
      }
    }
  }, 100);
});
