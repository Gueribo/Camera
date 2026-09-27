(function () {
  'use strict';

  const video = document.getElementById('video');
  const canvas = document.getElementById('guideCanvas');
  const ctx = canvas.getContext('2d');
  const viewport = document.getElementById('viewport');
  const stageArea = document.getElementById('stageArea');
  const installBtn = document.getElementById('installBtn');
  const flash = document.getElementById('flash');
  const arReadout = document.getElementById('arReadout');
  const guideReadout = document.getElementById('guideReadout');
  const orientRow = document.getElementById('orientRow');
  const stateOverlay = document.getElementById('stateOverlay');
  const stateMessage = document.getElementById('stateMessage');
  const stateRetry = document.getElementById('stateRetry');
  const previewBar = document.getElementById('previewBar');
  const previewThumb = document.getElementById('previewThumb');
  const downloadLink = document.getElementById('downloadLink');
  const dismissPreview = document.getElementById('dismissPreview');
  const shutterBtn = document.getElementById('shutter');
  const switchCamBtn = document.getElementById('switchCam');
  const includeGuidesBtn = document.getElementById('includeGuidesBtn');

  const GUIDE_NAMES = {
    thirds: 'Rule of Thirds',
    phi: 'Phi Grid',
    spiral: 'Golden Spiral',
    diagonal: 'Diagonal Method',
    symmetry: 'Symmetry',
    frame: 'Center & Frame',
    none: 'No guide'
  };

  const state = {
    guide: 'thirds',
    orient: 0,
    color: '#e8a33d',
    opacity: 0.85,
    facing: 'environment',
    includeGuidesInPhoto: true,
    stream: null,
    aspect: 'full'
  };

  const ASPECT_VALUES = {
    'full': null,
    '1:1': 1,
    '4:3': 4 / 3,
    '3:2': 3 / 2,
    '16:9': 16 / 9
  };

  // ---------------- camera lifecycle ----------------
  function showState(msg, showRetry) {
    stateMessage.textContent = msg;
    stateRetry.style.display = showRetry ? '' : 'none';
    stateOverlay.classList.add('visible');
  }
  function hideState() {
    stateOverlay.classList.remove('visible');
  }

  async function startCamera() {
    hideState();
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showState("Ce navigateur ne permet pas d'accéder à la caméra ici. Ouvre cette page en HTTPS (ex. via Netlify) plutôt qu'en local sans certificat.", false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: state.facing,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      state.stream = stream;
      video.srcObject = stream;
      await video.play();
      hideState();
      handleResize();
    } catch (err) {
      let msg = "Impossible d'accéder à la caméra.";
      if (err && err.name === 'NotAllowedError') {
        msg = 'Accès caméra refusé. Autorise la caméra pour ce site dans les réglages du navigateur, puis réessaie.';
      } else if (err && err.name === 'NotFoundError') {
        msg = "Aucune caméra détectée sur cet appareil.";
      } else if (err && err.name === 'NotReadableError') {
        msg = "La caméra est déjà utilisée par une autre application.";
      }
      showState(msg, true);
    }
  }

  stateRetry.addEventListener('click', startCamera);

  switchCamBtn.addEventListener('click', () => {
    state.facing = state.facing === 'environment' ? 'user' : 'environment';
    startCamera();
  });

  // ---------------- viewport letterboxing (aspect ratio) ----------------
  function applyAspect() {
    const target = ASPECT_VALUES[state.aspect];
    const containerW = stageArea.clientWidth;
    const containerH = stageArea.clientHeight;

    if (target === null) {
      viewport.style.width = '100%';
      viewport.style.height = '100%';
      viewport.classList.remove('letterboxed');
      return;
    }

    const containerAR = containerW / containerH;
    let w, h;
    if (containerAR > target) {
      h = containerH;
      w = h * target;
    } else {
      w = containerW;
      h = w / target;
    }
    viewport.style.width = Math.round(w) + 'px';
    viewport.style.height = Math.round(h) + 'px';
    viewport.classList.add('letterboxed');
  }

  document.querySelectorAll('.aspect-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.aspect-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.aspect = btn.dataset.aspect;
      handleResize();
    });
  });

  // ---------------- canvas sizing ----------------
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    arReadout.textContent = simplifyRatio(w / h);
    renderGuides();
  }

  function handleResize() {
    applyAspect();
    resizeCanvas();
  }
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', () => setTimeout(handleResize, 200));

  function simplifyRatio(ar) {
    const candidates = [[1, 1], [3, 2], [2, 3], [4, 3], [3, 4], [16, 9], [9, 16], [5, 4], [4, 5]];
    let best = candidates[0], bestDiff = Infinity;
    candidates.forEach(([a, b]) => {
      const diff = Math.abs(a / b - ar);
      if (diff < bestDiff) { bestDiff = diff; best = [a, b]; }
    });
    return bestDiff < 0.04 ? best[0] + ':' + best[1] : ar.toFixed(2) + ':1';
  }

  // ---------------- guide geometry (shared by live view + capture) ----------------
  function footOfPerpendicular(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = ((px - ax) * dx + (py - ay) * dy) / len2;
    return [ax + t * dx, ay + t * dy];
  }

  function goldenSpiral(W, H, orient) {
    const PHI = 1.6180339887;
    const gridX = [W * 0.382, W * 0.618];
    const gridY = [H * 0.382, H * 0.618];
    const variants = [
      { eye: [gridX[1], gridY[1]], corner: [0, 0] },
      { eye: [gridX[0], gridY[1]], corner: [W, 0] },
      { eye: [gridX[1], gridY[0]], corner: [0, H] },
      { eye: [gridX[0], gridY[0]], corner: [W, H] }
    ][orient];
    const [cx, cy] = variants.eye;
    const [sx, sy] = variants.corner;
    const dx = sx - cx, dy = sy - cy;
    const startR = Math.sqrt(dx * dx + dy * dy);
    const startAngle = Math.atan2(dy, dx);
    const b = Math.log(PHI) / (Math.PI / 2);
    const turns = 2.3;
    const steps = 140;
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * turns * Math.PI * 2;
      const angle = startAngle - t;
      const r = startR * Math.exp(-b * t);
      points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
    return { points, eye: [cx, cy], gridX, gridY };
  }

  function drawGuides(targetCtx, W, H, guide, orient, color, opacity) {
    targetCtx.save();
    targetCtx.globalAlpha = opacity;
    targetCtx.strokeStyle = color;
    targetCtx.fillStyle = color;
    const lw = Math.max(1, Math.min(W, H) * 0.0028);

    function line(x1, y1, x2, y2, w, alpha) {
      targetCtx.save();
      targetCtx.globalAlpha = opacity * (alpha === undefined ? 1 : alpha);
      targetCtx.lineWidth = w === undefined ? lw : w;
      targetCtx.beginPath();
      targetCtx.moveTo(x1, y1);
      targetCtx.lineTo(x2, y2);
      targetCtx.stroke();
      targetCtx.restore();
    }
    function dot(x, y, r) {
      targetCtx.beginPath();
      targetCtx.arc(x, y, r, 0, Math.PI * 2);
      targetCtx.fill();
    }

    if (guide === 'none') { targetCtx.restore(); return; }

    if (guide === 'thirds') {
      [W / 3, 2 * W / 3].forEach((x) => line(x, 0, x, H));
      [H / 3, 2 * H / 3].forEach((y) => line(0, y, W, y));
      [W / 3, 2 * W / 3].forEach((x) => [H / 3, 2 * H / 3].forEach((y) => dot(x, y, lw * 1.8)));
    } else if (guide === 'phi') {
      const xs = [W * 0.382, W * 0.618], ys = [H * 0.382, H * 0.618];
      xs.forEach((x) => line(x, 0, x, H));
      ys.forEach((y) => line(0, y, W, y));
      xs.forEach((x) => ys.forEach((y) => dot(x, y, lw * 1.8)));
    } else if (guide === 'spiral') {
      const { points, eye, gridX, gridY } = goldenSpiral(W, H, orient);
      gridX.forEach((x) => line(x, 0, x, H, lw * 0.7, 0.45));
      gridY.forEach((y) => line(0, y, W, y, lw * 0.7, 0.45));
      targetCtx.save();
      targetCtx.globalAlpha = opacity;
      targetCtx.lineWidth = lw;
      targetCtx.beginPath();
      points.forEach((p, i) => (i === 0 ? targetCtx.moveTo(p[0], p[1]) : targetCtx.lineTo(p[0], p[1])));
      targetCtx.stroke();
      targetCtx.restore();
      dot(eye[0], eye[1], lw * 2.2);
    } else if (guide === 'diagonal') {
      line(0, 0, W, H);
      const p1 = footOfPerpendicular(W, 0, 0, 0, W, H);
      line(W, 0, p1[0], p1[1]);
      const p2 = footOfPerpendicular(0, H, 0, 0, W, H);
      line(0, H, p2[0], p2[1]);
      dot(p1[0], p1[1], lw * 1.8);
      dot(p2[0], p2[1], lw * 1.8);
    } else if (guide === 'symmetry') {
      line(W / 2, 0, W / 2, H);
      line(0, H / 2, W, H / 2);
      line(0, 0, W, H, lw * 0.7, 0.4);
      line(W, 0, 0, H, lw * 0.7, 0.4);
    } else if (guide === 'frame') {
      const inset = Math.min(W, H) * 0.09;
      targetCtx.save();
      targetCtx.globalAlpha = opacity;
      targetCtx.lineWidth = lw;
      targetCtx.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset);
      targetCtx.restore();
      const c = Math.min(W, H) * 0.02;
      line(W / 2, H / 2 - c, W / 2, H / 2 + c);
      line(W / 2 - c, H / 2, W / 2 + c, H / 2);
    }

    targetCtx.restore();
  }

  function renderGuides() {
    const W = viewport.clientWidth, H = viewport.clientHeight;
    ctx.clearRect(0, 0, W, H);
    drawGuides(ctx, W, H, state.guide, state.orient, state.color, state.opacity);
    guideReadout.textContent = GUIDE_NAMES[state.guide];
    orientRow.classList.toggle('visible', state.guide === 'spiral');
  }

  // ---------------- controls ----------------
  document.querySelectorAll('.guide-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.guide-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.guide = btn.dataset.guide;
      renderGuides();
    });
  });

  document.querySelectorAll('.orient-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.orient-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.orient = parseInt(btn.dataset.orient, 10);
      renderGuides();
    });
  });

  document.querySelectorAll('.swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.color = btn.dataset.color;
      renderGuides();
    });
  });

  document.getElementById('opacitySlider').addEventListener('input', (e) => {
    state.opacity = e.target.value / 100;
    renderGuides();
  });

  includeGuidesBtn.addEventListener('click', () => {
    state.includeGuidesInPhoto = !state.includeGuidesInPhoto;
    includeGuidesBtn.style.color = state.includeGuidesInPhoto ? 'var(--amber)' : 'var(--text-dim)';
    includeGuidesBtn.style.borderColor = state.includeGuidesInPhoto ? 'var(--amber)' : 'var(--border)';
  });
  includeGuidesBtn.style.color = 'var(--amber)';
  includeGuidesBtn.style.borderColor = 'var(--amber)';

  // ---------------- capture ----------------
  function fireFlash() {
    flash.classList.remove('fire');
    void flash.offsetWidth;
    flash.classList.add('fire');
  }

  shutterBtn.addEventListener('click', () => {
    if (!video.videoWidth) return;
    fireFlash();

    const viewportAR = viewport.clientWidth / viewport.clientHeight;
    const videoW = video.videoWidth, videoH = video.videoHeight;
    const videoAR = videoW / videoH;

    let sx, sy, sw, sh;
    if (videoAR > viewportAR) {
      sh = videoH;
      sw = videoH * viewportAR;
      sx = (videoW - sw) / 2;
      sy = 0;
    } else {
      sw = videoW;
      sh = videoW / viewportAR;
      sx = 0;
      sy = (videoH - sh) / 2;
    }

    const maxW = 1920;
    const outW = Math.min(maxW, sw);
    const outH = outW / viewportAR;

    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const outCtx = out.getContext('2d');
    outCtx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);

    if (state.includeGuidesInPhoto) {
      drawGuides(outCtx, outW, outH, state.guide, state.orient, state.color, state.opacity);
    }

    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      previewThumb.src = url;
      downloadLink.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadLink.download = `framecraft-${stamp}.jpg`;
      previewBar.classList.add('visible');
    }, 'image/jpeg', 0.92);
  });

  dismissPreview.addEventListener('click', () => {
    previewBar.classList.remove('visible');
  });

  // ---------------- install prompt ----------------
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    installBtn.hidden = true;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });

  window.addEventListener('appinstalled', () => {
    installBtn.hidden = true;
    deferredPrompt = null;
  });

  // already installed / running standalone: never show the button
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
    installBtn.hidden = true;
  }

  // ---------------- boot ----------------
  video.addEventListener('loadedmetadata', handleResize);
  startCamera();
  handleResize();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
