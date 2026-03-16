/**
 * SignBridge — renderer/overlay.js
 * Renderer process: UI logic, sign queue player, settings.
 */

"use strict";

// ─── Global error handlers — catch anything that slips through ────────────────
window.onerror = (msg, src, line, col, err) => {
  showError(`JS Error: ${msg} (${src}:${line})`);
  console.error("[SignBridge] Uncaught error:", err);
  return true; // prevent default console error
};

window.onunhandledrejection = (event) => {
  showError(`Unhandled promise: ${event.reason}`);
  console.error("[SignBridge] Unhandled rejection:", event.reason);
  event.preventDefault();
};

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  settings:      {},
  dictionary:    {},
  signQueue:     [],       // [{ word, clipRelPath }, ...]
  isPlaying:     false,
  isCapturing:   false,
  captureMode:   null,     // 'sox' | 'mic-only' | null
  micStream:     null,     // optional mic stream for visualiser only
  micContext:    null,
  micAnalyser:   null,
  vizRafId:      null,
  settingsOpen:  false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const signVideo          = $("sign-video");
const avatarPlaceholder  = $("avatar-placeholder");
const subtitleEl         = $("subtitle");
const unknownWordEl      = $("unknown-word");
const queueIndicator     = $("queue-indicator");
const transcriptText     = $("transcript-text");
const settingsPanel      = $("settings-panel");
const statusDot          = $("status-dot");
const errorToast         = $("error-toast");
const vizCanvas          = $("viz-canvas");

const setLanguage  = $("set-language");
const setSize      = $("set-size");
const setOpacity   = $("set-opacity");
const setSpeed     = $("set-speed");
const setSubtitles = $("set-subtitles");

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    showError(`Init failed: ${err.message}`);
    console.error("[SignBridge] Init error:", err);
  });
});

async function init() {
  // Load persisted settings
  state.settings = await window.signBridge.getSettings();
  applySettings(state.settings);
  populateSettingsUI(state.settings);

  // Load sign dictionary
  await loadDictionary(state.settings.signLanguage);

  // Register IPC listeners from main process
  window.signBridge.onTranscription(handleTranscription);
  window.signBridge.onWhisperError(handleWhisperError);
  window.signBridge.onOpenSettings(openSettings);
  window.signBridge.onCaptureStatus(handleCaptureStatus);

  // Build queue dot indicators
  renderQueueDots(0);

  // Wire UI buttons
  $("btn-settings").addEventListener("click", toggleSettings);
  $("btn-audio").addEventListener("click",    toggleAudioCapture);
  $("btn-hide").addEventListener("click",     () => window.signBridge.hideOverlay());
  $("btn-close").addEventListener("click",    () => window.signBridge.closeApp());
  $("btn-save-settings").addEventListener("click", saveSettings);

  // Settings live preview
  if (setOpacity) {
    setOpacity.addEventListener("input", () => {
      const app = document.getElementById("app");
      if (app) app.style.opacity = setOpacity.value;
    });
  }

  console.log("[SignBridge] Renderer ready. No getUserMedia desktop capture.");
}

// ─── Dictionary ───────────────────────────────────────────────────────────────
async function loadDictionary(language) {
  try {
    state.dictionary = await window.signBridge.loadDictionary(language);
    const count = Object.keys(state.dictionary).length;
    console.log(`[SignBridge] Loaded ${language} dictionary (${count} words).`);
  } catch (err) {
    console.error("[SignBridge] loadDictionary error:", err);
    state.dictionary = {};
  }
}

// ─── Audio capture control ────────────────────────────────────────────────────
async function toggleAudioCapture() {
  if (state.isCapturing) {
    stopCapture();
  } else {
    startCapture();
  }
}

function startCapture() {
  console.log("[SignBridge] Requesting main process to start audio capture.");
  setUICapturing(true, "starting");
  transcriptText.textContent = "Starting audio capture…";

  // Tell main process to start SoX recording
  window.signBridge.startCapture();

  // Optionally start a mic visualiser (purely cosmetic, never blocks)
  startMicVisualiser().catch(() => {});
}

function stopCapture() {
  console.log("[SignBridge] Requesting main process to stop audio capture.");
  window.signBridge.stopCapture();
  stopMicVisualiser();
  setUICapturing(false);
  transcriptText.textContent = "Paused.";
}

function handleCaptureStatus(status) {
  console.log("[SignBridge] Capture status:", status);

  if (status.active) {
    state.isCapturing  = true;
    state.captureMode  = status.mode;
    setUICapturing(true, status.mode);
    setStatus("active");
    transcriptText.textContent = "Listening…";
    return;
  }

  state.isCapturing = false;
  state.captureMode = null;
  setUICapturing(false);
  stopMicVisualiser();

  switch (status.mode) {
    case "sox-missing":
      setStatus("error");
      showError("SoX not found. Please install SoX and add it to PATH.", 8000);
      transcriptText.textContent = "SoX not installed.";
      break;

    case "mic-unavailable":
      setStatus("error");
      showError(status.error || "Audio capture unavailable.", 6000);
      transcriptText.textContent = "Audio unavailable.";
      break;

    case "error":
      setStatus("error");
      showError(`Audio error: ${status.error || "unknown"}`, 5000);
      transcriptText.textContent = "Audio error.";
      break;

    case "stopped":
    default:
      setStatus("idle");
      transcriptText.textContent = "Stopped.";
      break;
  }
}

// ─── Optional mic visualiser (cosmetic only, no desktop capture) ───────────────
async function startMicVisualiser() {
  if (!vizCanvas) return;
  try {
    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 16000 },
      video: false,
    });

    state.micContext  = new AudioContext();
    state.micAnalyser = state.micContext.createAnalyser();
    state.micAnalyser.fftSize = 256;

    const source = state.micContext.createMediaStreamSource(state.micStream);
    source.connect(state.micAnalyser);

    drawVizFrame();
    vizCanvas.style.display = "block";
  } catch (err) {
    if (vizCanvas) vizCanvas.style.display = "none";
    console.log("[SignBridge] Mic visualiser unavailable:", err.message);
  }
}

function stopMicVisualiser() {
  if (state.vizRafId) { cancelAnimationFrame(state.vizRafId); state.vizRafId = null; }
  if (state.micStream) {
    try { state.micStream.getTracks().forEach((t) => t.stop()); } catch {}
    state.micStream = null;
  }
  if (state.micContext) {
    try { state.micContext.close(); } catch {}
    state.micContext  = null;
    state.micAnalyser = null;
  }
  if (vizCanvas) vizCanvas.style.display = "none";
}

function drawVizFrame() {
  if (!state.micAnalyser || !vizCanvas) return;
  const ctx    = vizCanvas.getContext("2d");
  const width  = vizCanvas.width;
  const height = vizCanvas.height;
  const data   = new Uint8Array(state.micAnalyser.frequencyBinCount);
  state.micAnalyser.getByteFrequencyData(data);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(0, 229, 176, 0.7)";
  const barW = width / data.length * 2.5;
  let x = 0;
  for (let i = 0; i < data.length; i++) {
    const barH = (data[i] / 255) * height;
    ctx.fillRect(x, height - barH, barW - 1, barH);
    x += barW;
  }
  state.vizRafId = requestAnimationFrame(drawVizFrame);
}

// ─── Transcription handler ────────────────────────────────────────────────────
function handleTranscription(result) {
  try {
    if (!result || !result.text) return;
    const rawText = result.text.trim();
    if (!rawText) return;

    console.log("[SignBridge] Transcription:", rawText);

    const words = rawText
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, "")
      .split(/\s+/)
      .filter(Boolean);

    if (words.length === 0) return;

    transcriptText.innerHTML = words
      .map((w) => `<span class="${state.dictionary[w] ? "matched" : "unmatched"}">${w}</span>`)
      .join(" ");

    for (const word of words) {
      const clipRelPath = state.dictionary[word];
      if (clipRelPath) {
        state.signQueue.push({ word, clipRelPath });
      }
    }

    renderQueueDots(state.signQueue.length);
    if (!state.isPlaying) playNextSign();
  } catch (err) {
    console.error("[SignBridge] handleTranscription error:", err);
  }
}

// ─── Sign queue player ────────────────────────────────────────────────────────
async function playNextSign() {
  if (state.signQueue.length === 0) {
    state.isPlaying = false;
    showPlaceholder(true);
    hideSubtitle();
    renderQueueDots(0);
    return;
  }

  state.isPlaying = true;
  const { word, clipRelPath } = state.signQueue.shift();
  renderQueueDots(state.signQueue.length);

  try {
    const absPath = await window.signBridge.resolveClipPath(clipRelPath);
    const fileUrl = "file:///" + absPath.replace(/\\/g, "/").replace(/^\/+/, "");

    showPlaceholder(false);
    signVideo.classList.add("visible");
    signVideo.src          = fileUrl;
    signVideo.playbackRate = parseFloat(state.settings.avatarSpeed) || 1;
    signVideo.load();

    if (state.settings.subtitlesEnabled) showSubtitle(word);
    hideUnknownWord();

    const safetyTimer = setTimeout(() => {
      try { signVideo.pause(); } catch {}
      hideSubtitle();
      playNextSign();
    }, 8000);

    signVideo.onended = () => {
      clearTimeout(safetyTimer);
      hideSubtitle();
      playNextSign();
    };

    try {
      await signVideo.play();
      clearTimeout(safetyTimer);
      signVideo._safetyTimer = setTimeout(() => {
        try { signVideo.pause(); } catch {}
        hideSubtitle();
        playNextSign();
      }, 8000);
    } catch (playErr) {
      clearTimeout(safetyTimer);
      console.warn(`[SignBridge] Cannot play clip for "${word}":`, playErr.message);
      showUnknownWord();
      hideSubtitle();
      await sleep(500);
      playNextSign();
    }
  } catch (err) {
    console.error("[SignBridge] playNextSign error:", err);
    hideSubtitle();
    await sleep(500);
    playNextSign();
  }
}

signVideo.addEventListener("playing", () => {
  clearTimeout(signVideo._safetyTimer);
});

// ─── UI helpers ───────────────────────────────────────────────────────────────
function showPlaceholder(show) {
  if (avatarPlaceholder) avatarPlaceholder.classList.toggle("hidden", !show);
  signVideo.classList.toggle("visible", !show);
}

function showSubtitle(word) {
  if (!subtitleEl) return;
  subtitleEl.textContent = word;
  subtitleEl.classList.add("visible");
}

function hideSubtitle() {
  if (subtitleEl) subtitleEl.classList.remove("visible");
}

function showUnknownWord() {
  if (!unknownWordEl) return;
  unknownWordEl.classList.add("visible");
  setTimeout(() => unknownWordEl.classList.remove("visible"), 1200);
}

function hideUnknownWord() {
  if (unknownWordEl) unknownWordEl.classList.remove("visible");
}

function renderQueueDots(count) {
  if (!queueIndicator) return;
  queueIndicator.innerHTML = "";
  const MAX = 5;
  for (let i = 0; i < MAX; i++) {
    const dot = document.createElement("div");
    dot.className = "queue-dot" + (i < Math.min(count, MAX) ? " filled" : "");
    queueIndicator.appendChild(dot);
  }
}

function setStatus(mode) {
  if (!statusDot) return;
  statusDot.className = "status-dot";
  if (mode === "active") statusDot.classList.add("active");
  if (mode === "error")  statusDot.classList.add("error");
}

let errorToastTimer = null;
function showError(msg, duration = 5000) {
  if (!errorToast) { console.error("[SignBridge Toast]", msg); return; }
  errorToast.textContent = msg;
  errorToast.classList.add("visible");
  clearTimeout(errorToastTimer);
  errorToastTimer = setTimeout(() => errorToast.classList.remove("visible"), duration);
}

function handleWhisperError(msg) {
  showError(`Whisper error: ${msg}`);
  setStatus("error");
}

function setUICapturing(active, mode) {
  const btn = $("btn-audio");
  if (!btn) return;
  state.isCapturing = active;
  if (!active) {
    btn.textContent = "▶";
    btn.title       = "Start audio capture";
    setStatus("idle");
    return;
  }
  if (mode === "starting") {
    btn.textContent = "…";
    btn.title       = "Starting…";
  } else {
    btn.textContent = "⏸";
    btn.title       = "Capturing — click to stop";
    setStatus("active");
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function toggleSettings() { state.settingsOpen ? closeSettings() : openSettings(); }
function openSettings() {
  if (settingsPanel) settingsPanel.classList.add("open");
  const btn = $("btn-settings");
  if (btn) btn.classList.add("settings-active");
  state.settingsOpen = true;
}
function closeSettings() {
  if (settingsPanel) settingsPanel.classList.remove("open");
  const btn = $("btn-settings");
  if (btn) btn.classList.remove("settings-active");
  state.settingsOpen = false;
}

function populateSettingsUI(s) {
  if (setLanguage)  setLanguage.value    = s.signLanguage   || "ISL";
  if (setSize)      setSize.value        = s.overlaySize    || "medium";
  if (setOpacity)   setOpacity.value     = s.overlayOpacity || 0.92;
  if (setSpeed)     setSpeed.value       = String(s.avatarSpeed || 1);
  if (setSubtitles) setSubtitles.checked = s.subtitlesEnabled !== false;
}

async function saveSettings() {
  try {
    const newSettings = {
      signLanguage:     setLanguage  ? setLanguage.value        : state.settings.signLanguage,
      overlaySize:      setSize      ? setSize.value             : state.settings.overlaySize,
      overlayOpacity:   setOpacity   ? parseFloat(setOpacity.value) : state.settings.overlayOpacity,
      avatarSpeed:      setSpeed     ? parseFloat(setSpeed.value)   : state.settings.avatarSpeed,
      subtitlesEnabled: setSubtitles ? setSubtitles.checked         : state.settings.subtitlesEnabled,
    };
    await window.signBridge.saveSettings(newSettings);
    if (newSettings.signLanguage !== state.settings.signLanguage) {
      await loadDictionary(newSettings.signLanguage);
    }
    state.settings = { ...state.settings, ...newSettings };
    applySettings(state.settings);
    closeSettings();
  } catch (err) {
    showError(`Failed to save settings: ${err.message}`);
  }
}

function applySettings(s) {
  const appEl = document.getElementById("app");
  if (appEl)    appEl.style.opacity = s.overlayOpacity || 0.92;
  if (signVideo) signVideo.playbackRate = s.avatarSpeed || 1;
}

// ─── Utility ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
