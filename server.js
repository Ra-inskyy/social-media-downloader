const express = require('express');
const cors = require('cors');
const path = require('path');
const ytdl = require('ytdl-core');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper: detect platform from URL
function detectPlatform(url) {
  if (/youtube\.com|youtu\.be|youtube\.shorts/i.test(url)) return 'youtube';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/facebook\.com|fb\.watch|fb\.gg/i.test(url)) return 'facebook';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/open\.spotify\.com/i.test(url)) return 'spotify';
  return null;
}

// Helper: extract Instagram shortcode from URL
function getInstagramShortcode(url) {
  const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

// Helper: check if ffmpeg is available
function hasFfmpeg() {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version']);
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

// Helper: check if yt-dlp is available (best YouTube downloader)
function hasYtDlp() {
  return new Promise((resolve) => {
    // First try 'yt-dlp' command directly
    const proc1 = spawn('yt-dlp', ['--version']);
    proc1.on('error', () => {
      // If not found, try python -m yt_dlp
      const proc2 = spawn('python', ['-m', 'yt_dlp', '--version']);
      proc2.on('error', () => resolve(false));
      proc2.on('close', (code) => resolve(code === 0));
    });
    proc1.on('close', (code) => resolve(code === 0));
  });
}

// Helper: check if spotdl is available
function hasSpotdl() {
  return new Promise((resolve) => {
    const proc = spawn('spotdl', ['--version']);
    proc.on('error', () => {
      // Fallback: try python -m spotdl
      const proc2 = spawn('python', ['-m', 'spotdl', '--version']);
      proc2.on('error', () => resolve(false));
      proc2.on('close', (code) => resolve(code === 0));
    });
    proc.on('close', (code) => resolve(code === 0));
  });
}

// Helper: detect Spotify URL type
function getSpotifyUrlType(url) {
  if (/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\//i.test(url)) return 'track';
  if (/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?album\//i.test(url)) return 'album';
  if (/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\//i.test(url)) return 'playlist';
  if (/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?artist\//i.test(url)) return 'artist';
  if (/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?show\//i.test(url)) return 'show';
  if (/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?episode\//i.test(url)) return 'episode';
  return null;
}

// Helper: get Spotify ID from URL
function getSpotifyId(url) {
  const match = url.match(/open\.spotify\.com\/(?:track|album|playlist)\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

// Helper: get video info using yt-dlp
function ytDlpGetInfo(url) {
  return new Promise((resolve, reject) => {
    // First try yt-dlp directly
    const proc = spawn('yt-dlp', ['-j', '--no-warnings', '--no-playlist', url]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });
    proc.on('error', () => {
      // Fallback to python -m yt_dlp
      const proc2 = spawn('python', ['-m', 'yt_dlp', '-j', '--no-warnings', '--no-playlist', url]);
      proc2.stdout.on('data', (data) => { stdout += data; });
      proc2.stderr.on('data', (data) => { stderr += data; });
      proc2.on('error', () => reject(new Error('yt-dlp not found')));
      proc2.on('close', (code) => {
        if (code === 0 && stdout) {
          try { resolve(JSON.parse(stdout)); }
          catch (e) { reject(new Error('Failed to parse yt-dlp output')); }
        } else {
          reject(new Error(stderr || 'yt-dlp failed'));
        }
      });
    });
    proc.on('close', (code) => {
      if (code === 0 && stdout) {
        try { resolve(JSON.parse(stdout)); }
        catch (e) { reject(new Error('Failed to parse yt-dlp output')); }
      } else {
        reject(new Error(stderr || 'yt-dlp failed'));
      }
    });
  });
}

// Helper: download video using yt-dlp and return file path
function ytDlpDownload(url, outputPath, format) {
  return new Promise((resolve, reject) => {
    // First try yt-dlp directly
    const proc = spawn('yt-dlp', ['-f', format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4', '-o', outputPath, '--no-warnings', '--no-playlist', url]);
    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data; });
    proc.on('error', () => {
      // Fallback to python -m yt_dlp
      const proc2 = spawn('python', ['-m', 'yt_dlp', '-f', format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4', '-o', outputPath, '--no-warnings', '--no-playlist', url]);
      proc2.stderr.on('data', (data) => { stderr += data; });
      proc2.on('error', () => reject(new Error('yt-dlp not found')));
      proc2.on('close', (code) => {
        if (code === 0) resolve(outputPath);
        else reject(new Error(stderr || 'yt-dlp download failed'));
      });
    });
    proc.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(stderr || 'yt-dlp download failed'));
    });
  });
}

// Helper: merge video + audio using ffmpeg
function mergeVideoAudio(videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath, '-i', audioPath,
      '-c:v', 'copy', '-c:a', 'aac', '-y', outputPath
    ]);
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

// Create ytdl agent with cookies support (optional)
function createYtdlAgent() {
  const cookiePath = path.join(__dirname, 'cookies.json');
  if (fs.existsSync(cookiePath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
      return ytdl.createAgent(cookies);
    } catch (e) {
      console.warn('Failed to load cookies.json:', e.message);
    }
  }
  return undefined;
}

// ==================== API: Get Video Info ====================
app.post('/api/info', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL diperlukan' });

    const platform = detectPlatform(url);
    if (!platform) return res.status(400).json({ error: 'Platform tidak didukung. Gunakan link dari YouTube, TikTok, Facebook, atau Instagram.' });

    let info = { platform, url };

    switch (platform) {
      case 'youtube':
        await getYoutubeInfo(url, info);
        break;
      case 'tiktok':
        await getTiktokInfo(url, info);
        break;
      case 'facebook':
        await getFacebookInfo(url, info);
        break;
      case 'instagram':
        await getInstagramInfo(url, info);
        break;
      case 'spotify':
        await getSpotifyInfo(url, info);
        break;
    }

    res.json(info);
  } catch (error) {
    console.error('Error getting info:', error.message);
    let errMsg = 'Gagal mendapatkan informasi. Coba lagi nanti.';
    // Pass custom specific errors to the frontend
    if (error.message && (error.message.includes('tidak didukung') || error.message.includes('tidak valid'))) {
      errMsg = error.message;
    }
    res.status(500).json({ error: errMsg });
  }
});

// YouTube info handler
async function getYoutubeInfo(url, info) {
  const ytDlpAvailable = await hasYtDlp();

  // Try yt-dlp first (most reliable)
  if (ytDlpAvailable) {
    try {
      const data = await ytDlpGetInfo(url);
      info.title = data.title || 'YouTube Video';
      info.thumbnail = data.thumbnail || '';
      info.duration = data.duration || 0;
      info.author = data.uploader || data.channel || '';

      // Build format list from yt-dlp
      info.formats = [];
      const seen = new Set();

      // Add best combined formats
      if (data.formats) {
        const videoFormats = data.formats
          .filter(f => f.vcodec !== 'none' && f.ext === 'mp4' && f.height)
          .sort((a, b) => (b.height || 0) - (a.height || 0));

        for (const f of videoFormats) {
          const label = `${f.height}p`;
          if (!seen.has(label) && seen.size < 5) {
            seen.add(label);
            info.formats.push({
              quality: label,
              format_id: f.format_id,
              type: f.acodec === 'none' ? 'video-only' : 'combined'
            });
          }
        }
      }

      // Fallback if no formats detected
      if (info.formats.length === 0) {
        info.formats = [
          { quality: '1080p', format_id: 'bestvideo[height<=1080]+bestaudio', type: 'combined' },
          { quality: '720p', format_id: 'bestvideo[height<=720]+bestaudio', type: 'combined' },
          { quality: '480p', format_id: 'bestvideo[height<=480]+bestaudio', type: 'combined' }
        ];
      }
      info.formats.push({ quality: 'Audio (MP3)', format_id: 'bestaudio', type: 'audio-only' });
      info.method = 'yt-dlp';
      return;
    } catch (e) {
      console.error('yt-dlp info failed:', e.message);
    }
  }

  // Fallback: try @distube/ytdl-core
  try {
    const agent = createYtdlAgent();
    const opts = agent ? { agent } : {};
    const ytInfo = await ytdl.getInfo(url, opts);
    info.title = ytInfo.videoDetails.title;
    info.thumbnail = ytInfo.videoDetails.thumbnails.pop().url;
    info.duration = parseInt(ytInfo.videoDetails.lengthSeconds);
    info.author = ytInfo.videoDetails.author.name;

    const combinedFormats = ytInfo.formats
      .filter(f => f.hasVideo && f.hasAudio && f.qualityLabel)
      .map(f => ({ quality: f.qualityLabel, itag: f.itag, type: 'combined' }))
      .filter((v, i, a) => a.findIndex(t => t.quality === v.quality) === i)
      .slice(0, 5);

    info.formats = combinedFormats;
    info.formats.push({ quality: 'Audio (MP3)', type: 'audio-only', itag: 140 });
    info.method = 'ytdl-core';
  } catch (ytErr) {
    console.error('ytdl-core info failed:', ytErr.message);
    info.title = 'YouTube Video';
    info.thumbnail = '';
    info.formats = [
      { quality: '1080p', format_id: 'bestvideo[height<=1080]+bestaudio', type: 'combined' },
      { quality: '720p', itag: 22, type: 'combined' },
      { quality: '360p', itag: 18, type: 'combined' },
      { quality: 'Audio (MP3)', itag: 140, type: 'audio-only' }
    ];
    info.method = 'fallback';
  }
}

// TikTok info handler
async function getTiktokInfo(url, info) {
  try {
    const tiktokResponse = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (tiktokResponse.data && tiktokResponse.data.data) {
      const data = tiktokResponse.data.data;
      info.title = data.title || 'TikTok Video';
      info.thumbnail = data.cover || data.origin_cover || '';
      info.author = data.author ? data.author.nickname : '';
      info.duration = data.duration || 0;
      info.formats = [];
      if (data.hdplay) info.formats.push({ quality: 'HD (Tanpa Watermark)', type: 'hd-no-wm' });
      if (data.play) info.formats.push({ quality: 'Normal (Tanpa Watermark)', type: 'no-wm' });
      if (data.wmplay) info.formats.push({ quality: 'Dengan Watermark', type: 'wm' });
      if (data.music) info.formats.push({ quality: 'Audio (MP3)', type: 'audio' });
    } else {
      info.title = 'TikTok Video';
      info.formats = [{ quality: 'HD (Tanpa Watermark)', type: 'hd-no-wm' }, { quality: 'Normal (Tanpa Watermark)', type: 'no-wm' }];
    }
  } catch (e) {
    info.title = 'TikTok Video';
    info.formats = [{ quality: 'HD (Tanpa Watermark)', type: 'hd-no-wm' }, { quality: 'Normal (Tanpa Watermark)', type: 'no-wm' }];
  }
}

// Facebook info handler
async function getFacebookInfo(url, info) {
  try {
    let mobileUrl = url.replace('www.facebook.com', 'm.facebook.com').replace('web.facebook.com', 'm.facebook.com');
    const fbResponse = await axios.get(mobileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      maxRedirects: 5
    });
    const html = fbResponse.data;
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    info.title = titleMatch ? titleMatch[1].replace(/\|.*Facebook.*$/i, '').replace(/-.*Facebook.*$/i, '').trim() : 'Facebook Video';
  } catch (e) {
    info.title = 'Facebook Video';
  }
  info.formats = [{ quality: 'HD (720p+)' }, { quality: 'SD (480p)' }];
}

// Instagram info handler
async function getInstagramInfo(url, info) {
  info.title = 'Instagram Video/Reel';
  info.thumbnail = '';
  info.formats = [{ quality: 'Original (Kualitas Terbaik)' }, { quality: 'Audio (MP3)', type: 'audio' }];
}

// Spotify info handler
async function getSpotifyInfo(url, info) {
  const urlType = getSpotifyUrlType(url);
  const spotifyId = getSpotifyId(url);
  info.spotifyType = urlType || 'track';

  if (['artist', 'show', 'episode'].includes(urlType)) {
    throw new Error(`Link tipe '${urlType}' tidak didukung. Harap gunakan link Track, Album, atau Playlist Spotify.`);
  }

  // Method 1: Try spotdl save to get metadata as JSON (ONLY FOR SINGLE TRACKS to avoid timeout)
  const spotdlAvailable = await hasSpotdl();
  if (spotdlAvailable && urlType === 'track') {
    try {
      const tmpFile = path.join(os.tmpdir(), `spotify_meta_${Date.now()}.spotdl`);
      await new Promise((resolve, reject) => {
        const args = ['save', url, '--save-file', tmpFile];
        const proc = spawn('spotdl', args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
        let stderr = '';
        proc.stderr.on('data', (data) => { stderr += data; });
        proc.on('error', () => {
          const proc2 = spawn('python', ['-m', 'spotdl', ...args], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
          proc2.stderr.on('data', (data) => { stderr += data; });
          proc2.on('error', () => reject(new Error('spotdl not found')));
          proc2.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(stderr || 'spotdl save failed'));
          });
        });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(stderr || 'spotdl save failed'));
        });
      });

      // Parse the .spotdl JSON file
      if (fs.existsSync(tmpFile)) {
        const raw = fs.readFileSync(tmpFile, 'utf-8');
        const tracks = JSON.parse(raw);
        fs.unlink(tmpFile, () => {});

        if (Array.isArray(tracks) && tracks.length > 0) {
          const first = tracks[0];
          info.title = first.name || 'Spotify Track';
          info.author = (first.artists || []).join(', ') || '';
          info.album = first.album_name || '';
          info.duration = first.duration || 0;
          info.thumbnail = first.cover_url || '';
        }
        info.method = 'spotdl';
      }
    } catch (e) {
      console.error('spotdl metadata failed:', e.message);
    }
  }

  // Method 2: Fallback - Spotify oEmbed for basic metadata
  if (!info.title || info.title === 'Spotify Track') {
    try {
      const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
      const resp = await axios.get(oembedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 10000
      });
      if (resp.data) {
        info.title = resp.data.title || 'Spotify Audio';
        info.thumbnail = resp.data.thumbnail_url || '';
        info.author = resp.data.description || '';
        if (!info.method) info.method = 'oembed';
      }
    } catch (e) {
      console.error('Spotify oEmbed failed:', e.message);
    }
  }

  // Set defaults if nothing worked
  if (!info.title) {
    const typeNames = { track: 'Spotify Track', album: 'Spotify Album', playlist: 'Spotify Playlist' };
    info.title = typeNames[urlType] || 'Spotify Audio';
  }
  if (!info.thumbnail) info.thumbnail = '';

  // Build format options
  info.formats = [];
  if (urlType === 'track') {
    info.formats.push({ quality: 'MP3 (320kbps)', type: 'mp3-high' });
    info.formats.push({ quality: 'MP3 (128kbps)', type: 'mp3-low' });
  } else {
    // Album/playlist
    const label = urlType === 'album' ? 'Album' : 'Playlist';
    const count = info.trackCount ? ` (${info.trackCount} lagu)` : '';
    info.formats.push({ quality: `Download ${label} MP3 (320kbps)${count}`, type: 'zip-high' });
    info.formats.push({ quality: `Download ${label} MP3 (128kbps)${count}`, type: 'zip-low' });
  }
}

// ==================== API: Download Video ====================
app.all('/api/download', async (req, res) => {
  // Disable timeout because downloading playlists can take many minutes
  req.setTimeout(0);
  res.setTimeout(0);

  try {
    const data = { ...req.query, ...req.body };
    const { url, platform, itag, quality, format_id } = data;
    if (!url) return res.status(400).json({ error: 'URL diperlukan' });

    switch (platform) {
      case 'youtube':
        await downloadYoutube(url, quality, itag, format_id, res);
        break;
      case 'tiktok':
        await downloadTiktok(url, quality, res);
        break;
      case 'facebook':
        await downloadFacebook(url, quality, res);
        break;
      case 'instagram':
        await downloadInstagram(url, quality, res);
        break;
      case 'spotify':
        await downloadSpotify(url, quality, res);
        break;
      default:
        res.status(400).json({ error: 'Platform tidak didukung.' });
    }
  } catch (error) {
    console.error('Download error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Terjadi kesalahan saat mendownload. Coba lagi nanti.' });
    }
  }
});

// YouTube download handler
async function downloadYoutube(url, quality, itag, format_id, res) {
  const ytDlpAvailable = await hasYtDlp();

  // Priority 1: Use yt-dlp (most reliable, no "video dibatasi" issues)
  if (ytDlpAvailable) {
    try {
      const tmpDir = os.tmpdir();
      const timestamp = Date.now();
      const outputPath = path.join(tmpDir, `yt_${timestamp}.mp4`);

      let format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';

      if (quality && quality.includes('Audio')) {
        const audioPath = path.join(tmpDir, `yt_audio_${timestamp}.mp3`);
        await new Promise((resolve, reject) => {
          const proc = spawn('yt-dlp', [
            '-f', 'bestaudio',
            '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0',
            '-o', audioPath, '--no-playlist', url
          ]);
          proc.on('error', reject);
          proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('audio extraction failed')));
        });

        res.header('Content-Disposition', 'attachment; filename="youtube_audio.mp3"');
        res.header('Content-Type', 'audio/mpeg');
        const stream = fs.createReadStream(audioPath);
        stream.pipe(res);
        stream.on('end', () => fs.unlink(audioPath, () => {}));
        return;
      }

      // Select format based on quality
      if (format_id) {
        format = format_id;
      } else if (quality) {
        const height = parseInt(quality);
        if (height) {
          format = `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`;
        }
      }

      await ytDlpDownload(url, outputPath, format);

      res.header('Content-Disposition', 'attachment; filename="youtube_video.mp4"');
      res.header('Content-Type', 'video/mp4');
      const stream = fs.createReadStream(outputPath);
      stream.pipe(res);
      stream.on('end', () => fs.unlink(outputPath, () => {}));
      return;
    } catch (e) {
      console.error('yt-dlp download failed:', e.message);
      // Fall through to ytdl-core
    }
  }

  // Priority 2: Fallback to @distube/ytdl-core
  try {
    const agent = createYtdlAgent();
    const opts = agent ? { agent } : {};

    if (quality && quality.includes('Audio')) {
      res.header('Content-Disposition', 'attachment; filename="youtube_audio.mp3"');
      res.header('Content-Type', 'audio/mpeg');
      ytdl(url, { ...opts, quality: 'highestaudio' }).pipe(res);
      return;
    }

    const selectedItag = itag || 'highest';
    res.header('Content-Disposition', 'attachment; filename="youtube_video.mp4"');
    res.header('Content-Type', 'video/mp4');
    ytdl(url, { ...opts, quality: selectedItag, filter: 'audioandvideo' }).pipe(res);
  } catch (ytErr) {
    console.error('ytdl-core download failed:', ytErr.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Gagal mendownload video YouTube. Install yt-dlp untuk hasil terbaik: pip install yt-dlp' });
    }
  }
}

// TikTok download handler
async function downloadTiktok(url, quality, res) {
  try {
    const tiktokResponse = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    if (tiktokResponse.data && tiktokResponse.data.data) {
      const data = tiktokResponse.data.data;
      let videoUrl = null;

      if (quality && quality.includes('Audio')) {
        // Audio only - try music first
        videoUrl = data.music;
        if (videoUrl) {
          const stream = await axios({ method: 'get', url: videoUrl, responseType: 'stream' });
          res.header('Content-Disposition', 'attachment; filename="tiktok_audio.mp3"');
          res.header('Content-Type', 'audio/mpeg');
          stream.data.pipe(res);
          return;
        }
        // Fallback: try audio from video if available
        if (data.audio) {
          videoUrl = data.audio;
          const stream = await axios({ method: 'get', url: videoUrl, responseType: 'stream' });
          res.header('Content-Disposition', 'attachment; filename="tiktok_audio.mp3"');
          res.header('Content-Type', 'audio/mpeg');
          stream.data.pipe(res);
          return;
        }
        res.status(500).json({ error: 'Audio tidak tersedia.' });
        return;
      } else if (quality && quality.includes('HD')) {
        videoUrl = data.hdplay || data.play;
      } else if (quality && quality.includes('Dengan Watermark')) {
        videoUrl = data.wmplay;
      } else {
        // "Normal (Tanpa Watermark)" atau default → pakai data.play (tanpa watermark)
        videoUrl = data.play || data.hdplay;
      }

      if (videoUrl) {
        const stream = await axios({ method: 'get', url: videoUrl, responseType: 'stream' });
        res.header('Content-Disposition', 'attachment; filename="tiktok_video.mp4"');
        res.header('Content-Type', 'video/mp4');
        stream.data.pipe(res);
      } else {
        res.status(500).json({ error: 'Gagal mendownload video TikTok.' });
      }
    } else {
      res.status(500).json({ error: 'Gagal mendownload video TikTok.' });
    }
  } catch (e) {
    console.error('TikTok download error:', e.message);
    res.status(500).json({ error: 'Gagal mendownload video TikTok. Coba lagi nanti.' });
  }
}

// Facebook download handler
async function downloadFacebook(url, quality, res) {
  try {
    let hdUrl = null;
    let sdUrl = null;

    const cleanFbUrl = (u) => {
      if (!u) return null;
      return u.replace(/\\u0025/g, '%').replace(/\\\//g, '/').replace(/\\u003C/g, '<')
        .replace(/\\u003E/g, '>').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
    };

    const allPatterns = [
      /browser_native_hd_url":"([^"]+)"/,
      /browser_native_sd_url":"([^"]+)"/,
      /playable_url_quality_hd":"([^"]+)"/,
      /playable_url":"([^"]+)"/,
      /"hd_src":"([^"]+)"/,
      /"sd_src":"([^"]+)"/,
      /hd_src_no_ratelimit":"([^"]+)"/,
      /sd_src_no_ratelimit":"([^"]+)"/,
      /video_url":"([^"]+)"/,
      /"contentUrl":"([^"]+)"/,
      /og:video"\s*content="([^"]+)"/,
      /og:video:url"\s*content="([^"]+)"/
    ];

    const extractFromHtml = (html) => {
      for (const pattern of allPatterns) {
        const match = html.match(pattern);
        if (match) {
          const cleaned = cleanFbUrl(match[1]);
          if (cleaned) {
            const isHd = pattern.source.includes('hd') || pattern.source.includes('HD') || pattern.source.includes('quality_hd');
            if (isHd) { if (!hdUrl) hdUrl = cleaned; }
            else { if (!sdUrl) sdUrl = cleaned; }
          }
        }
      }
    };

    // Method 1: mbasic.facebook.com
    try {
      let mbasicUrl = url.replace(/www\.facebook\.com|web\.facebook\.com|m\.facebook\.com/i, 'mbasic.facebook.com');
      const resp = await axios.get(mbasicUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
        maxRedirects: 5
      });
      extractFromHtml(resp.data);
      // mbasic specific: look for video redirect link
      const mbasicMatch = resp.data.match(/<a[^>]*href="(\/video_redirect\/[^"]+)"/i);
      if (mbasicMatch && !sdUrl) {
        sdUrl = 'https://mbasic.facebook.com' + mbasicMatch[1].replace(/&amp;/g, '&');
      }
    } catch (e) {}

    // Method 2: m.facebook.com
    if (!hdUrl && !sdUrl) {
      try {
        let mobileUrl = url.replace(/www\.facebook\.com|web\.facebook\.com|mbasic\.facebook\.com/i, 'm.facebook.com');
        const resp = await axios.get(mobileUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
          maxRedirects: 5
        });
        extractFromHtml(resp.data);
      } catch (e) {}
    }

    // Method 3: Desktop
    if (!hdUrl && !sdUrl) {
      try {
        const resp = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          maxRedirects: 5
        });
        extractFromHtml(resp.data);
      } catch (e) {}
    }

    // Method 4: yt-dlp fallback for Facebook
    if (!hdUrl && !sdUrl) {
      const ytDlpAvailable = await hasYtDlp();
      if (ytDlpAvailable) {
        try {
          const tmpDir = os.tmpdir();
          const outputPath = path.join(tmpDir, `fb_${Date.now()}.mp4`);
          await ytDlpDownload(url, outputPath, 'best[ext=mp4]/best');
          res.header('Content-Disposition', 'attachment; filename="facebook_video.mp4"');
          res.header('Content-Type', 'video/mp4');
          const stream = fs.createReadStream(outputPath);
          stream.pipe(res);
          stream.on('end', () => fs.unlink(outputPath, () => {}));
          return;
        } catch (e) {
          console.error('yt-dlp fb failed:', e.message);
        }
      }
    }

    // Select quality and download
    let videoUrl = null;
    if (quality && quality.includes('HD')) videoUrl = hdUrl || sdUrl;
    else if (quality && quality.includes('SD')) videoUrl = sdUrl || hdUrl;
    else videoUrl = hdUrl || sdUrl;

    if (videoUrl) {
      const stream = await axios({
        method: 'get', url: videoUrl, responseType: 'stream', maxRedirects: 10,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.facebook.com/' }
      });
      res.header('Content-Disposition', 'attachment; filename="facebook_video.mp4"');
      res.header('Content-Type', 'video/mp4');
      stream.data.pipe(res);
    } else {
      res.status(500).json({ error: 'Gagal mengekstrak video Facebook. Install yt-dlp untuk hasil terbaik: pip install yt-dlp' });
    }
  } catch (e) {
    console.error('Facebook download error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Gagal mendownload video Facebook.' });
  }
}

// Instagram download handler
async function downloadInstagram(url, quality, res) {
  try {
    let videoUrl = null;
    const shortcode = getInstagramShortcode(url);

    // Method 1: Embed page
    if (shortcode) {
      try {
        const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/`;
        const resp = await axios.get(embedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          maxRedirects: 5
        });
        const match = resp.data.match(/"video_url":"([^"]+)"/) || resp.data.match(/video_url\\?":\\?"([^"\\]+)/);
        if (match) videoUrl = match[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      } catch (e) {}
    }

    // Method 2: GraphQL
    if (!videoUrl && shortcode) {
      try {
        const gqlUrl = `https://www.instagram.com/graphql/query/?query_hash=b3055c01b4b222b8a47dc12b090e4e64&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;
        const resp = await axios.get(gqlUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (resp.data?.data?.shortcode_media?.video_url) videoUrl = resp.data.data.shortcode_media.video_url;
      } catch (e) {}
    }

    // Method 3: __a=1 API
    if (!videoUrl) {
      try {
        const cleanUrl = url.replace(/\/$/, '').split('?')[0];
        const resp = await axios.get(`${cleanUrl}/?__a=1&__d=dis`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)', 'X-IG-App-ID': '936619743392459' },
          maxRedirects: 5
        });
        if (resp.data?.graphql?.shortcode_media?.video_url) videoUrl = resp.data.graphql.shortcode_media.video_url;
        else if (resp.data?.items?.[0]?.video_versions) videoUrl = resp.data.items[0].video_versions[0].url;
      } catch (e) {}
    }

    // Method 4: Page scrape
    if (!videoUrl) {
      try {
        const resp = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          maxRedirects: 5
        });
        const match = resp.data.match(/"video_url":"([^"]+)"/) ||
                      resp.data.match(/contentUrl":\s*"([^"]+)"/) ||
                      resp.data.match(/og:video:secure_url"\s*content="([^"]+)"/) ||
                      resp.data.match(/og:video"\s*content="([^"]+)"/);
        if (match) videoUrl = match[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      } catch (e) {}
    }

    // Method 5: yt-dlp fallback
    if (!videoUrl) {
      const ytDlpAvailable = await hasYtDlp();
      if (ytDlpAvailable) {
        try {
          const tmpDir = os.tmpdir();
          const outputPath = path.join(tmpDir, `ig_${Date.now()}.mp4`);
          await ytDlpDownload(url, outputPath, 'best[ext=mp4]/best');
          res.header('Content-Disposition', 'attachment; filename="instagram_video.mp4"');
          res.header('Content-Type', 'video/mp4');
          const stream = fs.createReadStream(outputPath);
          stream.pipe(res);
          stream.on('end', () => fs.unlink(outputPath, () => {}));
          return;
        } catch (e) { console.error('yt-dlp ig failed:', e.message); }
      }
    }

    // Handle audio extraction
    if (quality && quality.includes('Audio') && videoUrl) {
      const ffmpegAvailable = await hasFfmpeg();
      if (ffmpegAvailable) {
        const tmpDir = os.tmpdir();
        const ts = Date.now();
        const inputPath = path.join(tmpDir, `ig_in_${ts}.mp4`);
        const outputPath = path.join(tmpDir, `ig_aud_${ts}.mp3`);
        const dl = await axios({ method: 'get', url: videoUrl, responseType: 'stream', maxRedirects: 5 });
        await new Promise((resolve, reject) => { const ws = fs.createWriteStream(inputPath); dl.data.pipe(ws); ws.on('finish', resolve); ws.on('error', reject); });
        await new Promise((resolve, reject) => {
          const proc = spawn('ffmpeg', ['-i', inputPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', '-y', outputPath]);
          proc.on('error', reject);
          proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg failed')));
        });
        res.header('Content-Disposition', 'attachment; filename="instagram_audio.mp3"');
        res.header('Content-Type', 'audio/mpeg');
        const stream = fs.createReadStream(outputPath);
        stream.pipe(res);
        stream.on('end', () => { fs.unlink(inputPath, () => {}); fs.unlink(outputPath, () => {}); });
        return;
      }
      res.status(500).json({ error: 'Ekstrak audio memerlukan ffmpeg.' });
      return;
    }

    if (videoUrl) {
      const stream = await axios({
        method: 'get', url: videoUrl, responseType: 'stream', maxRedirects: 10,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.instagram.com/' }
      });
      res.header('Content-Disposition', 'attachment; filename="instagram_video.mp4"');
      res.header('Content-Type', 'video/mp4');
      stream.data.pipe(res);
    } else {
      res.status(500).json({ error: 'Gagal mengekstrak video Instagram. Install yt-dlp untuk hasil terbaik: pip install yt-dlp' });
    }
  } catch (e) {
    console.error('Instagram download error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Gagal mendownload video Instagram.' });
  }
}

// Spotify download handler
async function downloadSpotify(url, quality, res) {
  const urlType = getSpotifyUrlType(url);
  const isCollection = urlType === 'album' || urlType === 'playlist';
  const bitrate = (quality && quality.includes('128')) ? '128' : '320';

  const spotdlAvailable = await hasSpotdl();
  const ytDlpAvailable = await hasYtDlp();

  // Method 1: spotdl (best for Spotify)
  if (spotdlAvailable) {
    try {
      const tmpDir = path.join(os.tmpdir(), `spotify_${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      await new Promise((resolve, reject) => {
        const args = [
          'download', url,
          '--output', path.join(tmpDir, '{title} - {artist}.{output-ext}'),
          '--format', 'mp3',
          '--bitrate', bitrate === '320' ? 'disable' : '128k',
          '--no-cache'
        ];
        console.log(`[Spotify] Downloading: ${url} (${bitrate}kbps)`);
        const proc = spawn('spotdl', args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
        let stderr = '';
        proc.stdout.on('data', (data) => { 
          const msg = data.toString().trim();
          if (msg) console.log(`[Spotify] ${msg}`);
        });
        proc.stderr.on('data', (data) => { stderr += data; });
        proc.on('error', () => {
          // Fallback: python -m spotdl
          const proc2 = spawn('python', ['-m', 'spotdl', ...args], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
          proc2.stdout.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) console.log(`[Spotify] ${msg}`);
          });
          proc2.stderr.on('data', (data) => { stderr += data; });
          proc2.on('error', () => reject(new Error('spotdl not found')));
          proc2.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(stderr || 'spotdl download failed'));
          });
        });
        proc.on('close', (code) => {
          if (code === 0) {
            console.log(`[Spotify] Download selesai!`);
            resolve();
          }
          else reject(new Error(stderr || 'spotdl download failed'));
        });
      });

      // Find downloaded files
      const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.mp3'));
      if (files.length === 0) {
        throw new Error('No MP3 files were downloaded');
      }

      if (files.length === 1 && !isCollection) {
        // Single track — stream directly
        const filePath = path.join(tmpDir, files[0]);
        const safeFilename = files[0].replace(/[^a-zA-Z0-9._\- ]/g, '_');
        res.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
        res.header('Content-Type', 'audio/mpeg');
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        stream.on('end', () => {
          // Cleanup
          fs.rm(tmpDir, { recursive: true, force: true }, () => {});
        });
      } else {
        // Multiple tracks — zip them
        const zipFilename = `spotify_${urlType}_${Date.now()}.zip`;
        res.header('Content-Disposition', `attachment; filename="${zipFilename}"`);
        res.header('Content-Type', 'application/zip');

        const archive = new archiver.ZipArchive({ zlib: { level: 1 } }); // Fast compression
        archive.pipe(res);

        for (const file of files) {
          archive.file(path.join(tmpDir, file), { name: file });
        }

        archive.on('end', () => {
          fs.rm(tmpDir, { recursive: true, force: true }, () => {});
        });

        archive.finalize();
      }
      return;
    } catch (e) {
      console.error('spotdl download failed:', e.message);
      // Fall through to yt-dlp
    }
  }

  // Method 2: yt-dlp fallback (works for some Spotify URLs)
  if (ytDlpAvailable) {
    try {
      const tmpDir = os.tmpdir();
      const timestamp = Date.now();
      const audioPath = path.join(tmpDir, `spotify_${timestamp}.mp3`);

      await new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', [
          '-f', 'bestaudio',
          '--extract-audio', '--audio-format', 'mp3',
          '--audio-quality', bitrate === '320' ? '0' : '5',
          '-o', audioPath, '--no-playlist', url
        ]);
        let stderr = '';
        proc.stderr.on('data', (data) => { stderr += data; });
        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(stderr || 'yt-dlp spotify download failed'));
        });
      });

      res.header('Content-Disposition', 'attachment; filename="spotify_audio.mp3"');
      res.header('Content-Type', 'audio/mpeg');
      const stream = fs.createReadStream(audioPath);
      stream.pipe(res);
      stream.on('end', () => fs.unlink(audioPath, () => {}));
      return;
    } catch (e) {
      console.error('yt-dlp spotify failed:', e.message);
    }
  }

  // No tools available
  if (!res.headersSent) {
    res.status(500).json({
      error: 'Download Spotify memerlukan spotdl atau yt-dlp. Install: pip install spotdl'
    });
  }
}

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const server = app.listen(PORT, async () => {
  console.log(`\n=== SaveMedia Server ===`);
  console.log(`Server berjalan di http://localhost:${PORT}\n`);

  const ffmpegOk = await hasFfmpeg();
  const ytDlpOk = await hasYtDlp();
  const spotdlOk = await hasSpotdl();

  console.log(`[Tools Status]`);
  console.log(`  ffmpeg:  ${ffmpegOk ? 'Tersedia' : 'Tidak ditemukan (install: https://ffmpeg.org/download.html)'}`);
  console.log(`  yt-dlp:  ${ytDlpOk ? 'Tersedia' : 'Tidak ditemukan (install: pip install yt-dlp)'}`);
  console.log(`  spotdl:  ${spotdlOk ? 'Tersedia' : 'Tidak ditemukan (install: pip install spotdl)'}`);
  console.log('');

  if (ytDlpOk) {
    console.log('[YouTube] Menggunakan yt-dlp - semua video bisa didownload');
  } else {
    console.log('[YouTube] Menggunakan ytdl-core - beberapa video mungkin dibatasi');
    console.log('          Install yt-dlp untuk fix: pip install yt-dlp');
  }

  if (spotdlOk) {
    console.log('[Spotify] spotdl tersedia - download lagu, album, playlist');
  } else if (ytDlpOk) {
    console.log('[Spotify] Menggunakan yt-dlp fallback (install spotdl untuk hasil terbaik)');
  } else {
    console.log('[Spotify] Tidak tersedia - install: pip install spotdl');
  }

  if (ffmpegOk) {
    console.log('[Quality] HD/4K tersedia untuk YouTube');
  } else {
    console.log('[Quality] Install ffmpeg untuk kualitas lebih tinggi');
  }
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EACCES') {
    console.error(`\n[ERROR] Port ${PORT} diblokir oleh sistem (EACCES).`);
    console.error(`Coba jalankan dengan port lain: set PORT=9000 && node server.js\n`);
  } else if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERROR] Port ${PORT} sudah dipakai aplikasi lain.`);
    console.error(`Coba jalankan dengan port lain: set PORT=9000 && node server.js\n`);
  } else {
    console.error('\n[ERROR] Gagal start server:', err.message);
  }
  process.exit(1);
});
