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
  settings: {},
  dictionary: {},
  signQueue: [],       // [{ word, clipRelPath }, ...]
  isPlaying: false,
  isCapturing: false,
  captureMode: null,     // 'sox' | 'mic-only' | null
  micStream: null,     // optional mic stream for visualiser only
  micContext: null,
  micAnalyser: null,
  vizRafId: null,
  settingsOpen: false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const avatarCanvas = $("avatar-canvas");
const signVideo = $("sign-video");
let avatar = null;
const avatarPlaceholder = $("avatar-placeholder");
const subtitleEl = $("subtitle");
const unknownWordEl = $("unknown-word");
const queueIndicator = $("queue-indicator");
const transcriptText = $("transcript-text");
const settingsPanel = $("settings-panel");
const statusDot = $("status-dot");
const errorToast = $("error-toast");
const vizCanvas = $("viz-canvas");

const btnSettings = $("btn-settings");
const btnAudioMic = $("btn-audio-mic");
const btnAudioSys = $("btn-audio-sys");
const btnHide = $("btn-hide");
const btnClose = $("btn-close");

const onboardingModal = $("onboarding-modal");
const btnFinishOnboarding = $("btn-finish-onboarding");

const setLanguage = $("set-language");
const setSize = $("set-size");
const setOpacity = $("set-opacity");
const setSpeed = $("set-speed");
const setSubtitles = $("set-subtitles");

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    showError(`Init failed: ${err.message}`);
    console.error("[SignBridge] Init error:", err);
  });
});

async function init() {
  window.onerror = (msg, url, lineNo, columnNo, error) => {
    showError(`Error: ${msg} (Line: ${lineNo})`);
    console.error("[SignBridge UI Error]", msg, error);
    return false;
  };
  console.log("[SignBridge] Initializing renderer...");

  // 1. Load user settings
  try {
    state.settings = await window.signBridge.getSettings();
    applySettings(state.settings);
    populateSettingsUI(state.settings);
  } catch (e) {
    console.error("[SignBridge] Failed to load settings:", e);
    state.settings = {};
  }

  // 2. Wire Button Events (Early so they are always interactive)
  if (btnSettings) btnSettings.onclick = toggleSettings;
  if (btnAudioMic) btnAudioMic.onclick = toggleMicCapture;
  if (btnAudioSys) btnAudioSys.onclick = toggleSystemCapture;
  if (btnHide) btnHide.onclick = () => window.signBridge.hideOverlay();
  if (btnClose) btnClose.onclick = () => window.signBridge.closeApp();
  const btnSave = $("btn-save-settings");
  if (btnSave) btnSave.onclick = saveSettings;

  // 3. Setup Onboarding
  const shouldShowOnboarding = !state.settings.onboardingComplete;
  if (onboardingModal && shouldShowOnboarding) {
    onboardingModal.style.display = "flex";
    onboardingModal.classList.remove("hidden");
  } else if (onboardingModal) {
    onboardingModal.style.display = "none";
    onboardingModal.classList.add("hidden");
  }

  if (btnFinishOnboarding) {
    btnFinishOnboarding.onclick = async () => {
      console.log("[SignBridge] Onboarding finished.");
      // Immediately hide the modal
      if (onboardingModal) {
        onboardingModal.style.display = "none";
        onboardingModal.classList.add("hidden");
      }
      // Save the flag directly to avoid any form-reading issues
      try {
        state.settings.onboardingComplete = true;
        await window.signBridge.saveSettings({ onboardingComplete: true });
        console.log("[SignBridge] onboardingComplete saved.");
      } catch (e) {
        console.error("[SignBridge] Failed to save onboarding state:", e);
      }
    };
  }


  // 4. Initialize Engine components
  try {
    const canvas = document.getElementById("avatar-canvas");
    if (canvas && typeof AvatarRenderer !== "undefined") {
      avatar = new AvatarRenderer(canvas);
      avatar.start();
    }
  } catch (e) {
    console.error("[SignBridge] Failed to init AvatarRenderer:", e);
  }
  await changeLanguage(state.settings.signLanguage || "ISL");
  renderQueueDots(0);

  // 5. Set up IPC listeners with error safety
  try {
    window.signBridge.onTranscription(handleTranscription);
    window.signBridge.onWhisperError(handleWhisperError);
    window.signBridge.onOpenSettings(openSettings);
    window.signBridge.onCaptureStatus(handleCaptureStatus);

    const volumeBar = $("volume-meter-bar");
    window.signBridge.onVolumeLevel((level) => {
      if (volumeBar) {
        const percent = Math.min(100, Math.round(level * 100));
        volumeBar.style.width = `${percent}%`;
        if (level < 0.01) {
          setTimeout(() => { if (volumeBar.style.width !== "0%") volumeBar.style.width = "0%"; }, 300);
        }
      }
    });
  } catch (err) {
    console.error("[SignBridge] Failed to setup IPC listeners:", err);
  }


  // Settings live preview...
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

// ─── Audio Capture Flow ───────────────────────────────────────────────────────
let captureToggleLock = false;

function toggleMicCapture() {
  if (captureToggleLock) return; // prevent rapid double-click
  captureToggleLock = true;
  setTimeout(() => { captureToggleLock = false; }, 1000); // 1 second debounce

  if (state.isCapturing && state.captureMode === "mic") {
    stopCapture();
  } else {
    if (state.isCapturing) stopCapture();
    startMicCapture();
  }
}

function toggleSystemCapture() {
  if (captureToggleLock) return;
  captureToggleLock = true;
  setTimeout(() => { captureToggleLock = false; }, 1000);

  if (state.isCapturing && state.captureMode === "system") {
    stopCapture();
  } else {
    if (state.isCapturing) stopCapture();
    startSystemCapture();
  }
}

function startMicCapture() {
  console.log("[SignBridge] Starting mic capture.");
  state.isCapturing = true;   // set BEFORE IPC so toggle checks work immediately
  state.captureMode = "mic";
  setUICapturing(true, "mic");
  if (transcriptText) transcriptText.textContent = "Listening…";
  setStatus("active");
  window.signBridge.startCapture();
}

function startSystemCapture() {
  console.log("[SignBridge] Starting system audio capture.");
  state.isCapturing = true;
  state.captureMode = "system";
  setUICapturing(true, "system");
  if (transcriptText) transcriptText.textContent = "Listening (system audio)…";
  setStatus("active");
  if (window.signBridge.startSystemCapture) {
    window.signBridge.startSystemCapture();
  } else {
    window.signBridge.startCapture();
  }
}


function stopCapture() {
  console.log("[SignBridge] Stopping Python audio capture.");
  window.signBridge.stopCapture();

  handleCaptureStatus({ active: false, mode: "stopped" });
}

function handleCaptureStatus(status) {
  console.log("[SignBridge] Capture status:", status);

  if (status.active) {
    state.isCapturing = true;
    state.captureMode = status.mode;
    setUICapturing(true, status.mode);
    setStatus("active");
    transcriptText.textContent = "Listening…";
    return;
  }

  state.isCapturing = false;
  state.captureMode = null;
  setUICapturing(false);

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

// Visualiser frame loop (kept to draw visualizer bars based on state.micAnalyser)
function drawVizFrame() {
  if (!state.micAnalyser || !vizCanvas) return;
  const ctx = vizCanvas.getContext("2d");
  const width = vizCanvas.width;
  const height = vizCanvas.height;
  const data = new Uint8Array(state.micAnalyser.frequencyBinCount);
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
    if (!result || !result.text) {
      console.log("[SignBridge] Empty result received");
      return;
    }
    const rawText = result.text.trim();
    if (!rawText) {
      transcriptText.textContent = "Listening...";
      return;
    }

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
      state.signQueue.push({ word, clipRelPath: clipRelPath || null });
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
    hideSubtitle();
    renderQueueDots(0);
    return;
  }

  state.isPlaying = true;
  const { word } = state.signQueue.shift();
  renderQueueDots(state.signQueue.length);

  try {
    if (state.settings.subtitlesEnabled) showSubtitle(word);
    hideUnknownWord();

    if (avatar) {
      avatar.setSpeed(parseFloat(state.settings.avatarSpeed) || 1);

      // Look up animation data (fallback to idle if not found)
      let key = word.toLowerCase().replace(/\s+/g, "_");
      if (key === "thank" || key === "thanks") key = "thank_you";
      const signData = window.SIGN_POSES ? window.SIGN_POSES[key] : null;

      if (signData) {
        avatar.transitionTo(word, signData.duration || 400);
      } else {
        // Unknown word, display label but no animation
        avatar.transitionTo(word, 200);
      }

      // Wait for the sign to finish (transition + holdTime) before playing next
      const totalTime = (signData?.duration || 400) + (signData?.holdTime || 1000);

      setTimeout(() => {
        hideSubtitle();
        playNextSign();
      }, totalTime / (parseFloat(state.settings.avatarSpeed) || 1));

    } else {
      setTimeout(() => { hideSubtitle(); playNextSign(); }, 1500);
    }
  } catch (err) {
    console.error("[SignBridge] playNextSign error:", err);
    hideSubtitle();
    setTimeout(playNextSign, 500);
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function showPlaceholder(show) {
  // Not used in AvatarRenderer mode since it idles automatically
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
  if (mode === "error") statusDot.classList.add("error");
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

function setUICapturing(isCapturing, mode = null) {
  state.isCapturing = !!isCapturing;
  if (!btnAudioMic || !btnAudioSys) return;

  if (isCapturing) {
    setStatus("active");
    if (mode === "mic" || mode === "mic-webrtc") {
      btnAudioMic.innerHTML = "⏹";
      btnAudioSys.innerHTML = "🖥️";
      btnAudioMic.classList.add("active");
      btnAudioSys.classList.remove("active");
    } else if (mode === "system") {
      btnAudioSys.innerHTML = "⏹";
      btnAudioMic.innerHTML = "🎤";
      btnAudioSys.classList.add("active");
      btnAudioMic.classList.remove("active");
    } else {
      btnAudioMic.innerHTML = "⏸";
      btnAudioSys.innerHTML = "⏸";
    }
  } else {
    setStatus("idle");
    btnAudioMic.innerHTML = "🎤";
    btnAudioSys.innerHTML = "🖥️";
    btnAudioMic.classList.remove("active");
    btnAudioSys.classList.remove("active");
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

async function changeLanguage(lang) {
  try {
    const dict = await window.signBridge.loadDictionary(lang);
    if (dict) {
      state.dictionary = dict;
      console.log(`[SignBridge] Swapped dictionary to ${lang} (${Object.keys(dict).length} words)`);
      return true;
    }
  } catch (e) {
    console.error(`[SignBridge] Failed to change language to ${lang}:`, e);
  }
  return false;
}

function populateSettingsUI(s) {
  if (setLanguage) setLanguage.value = s.signLanguage || "ISL";
  if (setSize) setSize.value = s.overlaySize || "medium";
  if (setOpacity) setOpacity.value = s.overlayOpacity || 0.92;
  if (setSpeed) setSpeed.value = String(s.avatarSpeed || 1);
  if (setSubtitles) setSubtitles.checked = s.subtitlesEnabled !== false;
}

async function saveSettings() {
  console.log("[SignBridge] Saving settings to main process...", state.settings);
  try {
    const s = {
      signLanguage: (setLanguage && setLanguage.value) ? setLanguage.value : (state.settings.signLanguage || "ISL"),
      overlaySize: (setSize && setSize.value) ? setSize.value : (state.settings.overlaySize || "medium"),
      overlayOpacity: (setOpacity && setOpacity.value) ? parseFloat(setOpacity.value) : (state.settings.overlayOpacity || 0.92),
      avatarSpeed: (setSpeed && setSpeed.value) ? parseFloat(setSpeed.value) : (state.settings.avatarSpeed || 1),
      subtitlesEnabled: setSubtitles ? setSubtitles.checked : (state.settings.subtitlesEnabled !== false),
      onboardingComplete: !!state.settings.onboardingComplete
    };

    console.log("[SignBridge] Compiled settings object:", s);
    await window.signBridge.saveSettings(s);
    state.settings = s;
    applySettings(s);
    closeSettings();
    console.log("[SignBridge] Settings saved to disk.");
  } catch (err) {
    console.error("[SignBridge] Failed to save settings:", err);
    showError(`Failed to save settings: ${err.message}`);
  }
}

function applySettings(s) {
  const appEl = document.getElementById("app");
  if (appEl) appEl.style.opacity = s.overlayOpacity || 0.92;
  if (avatar) avatar.setSpeed(s.avatarSpeed || 1);
  if (signVideo) signVideo.playbackRate = s.avatarSpeed || 1;
}

// ─── Utility ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
