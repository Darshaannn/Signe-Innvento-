/**
 * SignBridge — overlay.js
 * Renderer process: audio capture, sign queue player, settings UI.
 * Runs in Electron renderer (Chromium); accesses main process only
 * through the window.signBridge bridge exposed by preload.js.
 */

"use strict";

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  settings: {},
  dictionary: {},
  signQueue: [],       // Array of { word, clipPath } objects
  isPlaying: false,
  isCapturing: false,
  audioStream: null,
  audioContext: null,
  processor: null,
  settingsOpen: false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const signVideo = $("sign-video");
const avatarPlaceholder = $("avatar-placeholder");
const subtitleEl = $("subtitle");
const unknownWordEl = $("unknown-word");
const queueIndicator = $("queue-indicator");
const transcriptText = $("transcript-text");
const settingsPanel = $("settings-panel");
const statusDot = $("status-dot");
const errorToast = $("error-toast");

// Settings inputs
const setLanguage = $("set-language");
const setSize = $("set-size");
const setOpacity = $("set-opacity");
const setSpeed = $("set-speed");
const setSubtitles = $("set-subtitles");

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Load saved settings
  state.settings = await window.signBridge.getSettings();
  applySettings(state.settings);
  populateSettingsUI(state.settings);

  // Load sign dictionary
  await loadDictionary(state.settings.signLanguage);

  // Start listening for transcriptions from main
  window.signBridge.onTranscription(handleTranscription);
  window.signBridge.onWhisperError(handleWhisperError);
  window.signBridge.onOpenSettings(() => openSettings());

  // Build queue indicator dots
  renderQueueDots(0);

  // Wire up UI buttons
  $("btn-settings").addEventListener("click", toggleSettings);
  $("btn-audio").addEventListener("click", toggleAudioCapture);
  $("btn-hide").addEventListener("click", () => window.signBridge.hideOverlay());
  $("btn-close").addEventListener("click", () => window.signBridge.closeApp());
  $("btn-save-settings").addEventListener("click", saveSettings);

  // Settings live preview
  setOpacity.addEventListener("input", () => {
    document.getElementById("app").style.opacity = setOpacity.value;
  });

  console.log("[SignBridge] Renderer ready.");
}

// ─── Dictionary ───────────────────────────────────────────────────────────────
async function loadDictionary(language) {
  state.dictionary = await window.signBridge.loadDictionary(language);
  const count = Object.keys(state.dictionary).length;
  console.log(`[SignBridge] Loaded ${language} dictionary (${count} words).`);
}

// ─── Audio capture ────────────────────────────────────────────────────────────
async function startAudioCapture() {
  try {
    let stream;

    // Try desktop loopback first, fall back to mic
    try {
      const sourceId = await window.signBridge.getDesktopAudioSource();

      if (sourceId) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceId,
            }
          },
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceId,
            }
          }
        });
        // Stop video tracks — we only want audio
        stream.getVideoTracks().forEach((t) => t.stop());
      } else {
        throw new Error("No desktop source ID");
      }
    } catch (desktopErr) {
      console.warn("[SignBridge] Desktop capture failed, falling back to mic:", desktopErr.message);
      // FALLBACK — just use microphone
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
    }

    state.audioStream = stream;
    state.audioContext = new AudioContext({ sampleRate: 16000 });
    const source = state.audioContext.createMediaStreamSource(stream);

    const BUFFER_SIZE = 4096;
    state.processor = state.audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    let pcmBuffer = new Float32Array(0);
    const CHUNK_SAMPLES = 16000 * 2;

    state.processor.onaudioprocess = (e) => {
      const channelData = e.inputBuffer.getChannelData(0);
      const combined = new Float32Array(pcmBuffer.length + channelData.length);
      combined.set(pcmBuffer);
      combined.set(channelData, pcmBuffer.length);
      pcmBuffer = combined;

      if (pcmBuffer.length >= CHUNK_SAMPLES) {
        const chunk = pcmBuffer.slice(0, CHUNK_SAMPLES);
        pcmBuffer = pcmBuffer.slice(CHUNK_SAMPLES);
        sendAudioChunk(chunk);
      }
    };

    source.connect(state.processor);
    state.processor.connect(state.audioContext.destination);

    state.isCapturing = true;
    setStatus("active");
    $("btn-audio").textContent = "⏸";
    $("btn-audio").title = "Stop audio capture";
    transcriptText.textContent = "Listening…";

    console.log("[SignBridge] Audio capture started.");

  } catch (err) {
    // NEVER let this crash the app — always catch
    console.error("[SignBridge] Audio capture error:", err);
    showError(`Audio error: ${err.message}`);
    setStatus("error");
    state.isCapturing = false;
  }
}

function stopAudioCapture() {
  if (state.processor) {
    state.processor.disconnect();
    state.processor = null;
  }
  if (state.audioContext) {
    state.audioContext.close();
    state.audioContext = null;
  }
  if (state.audioStream) {
    state.audioStream.getTracks().forEach((t) => t.stop());
    state.audioStream = null;
  }
  state.isCapturing = false;
  setStatus("idle");
  $("btn-audio").textContent = "▶";
  $("btn-audio").title = "Start audio capture";
  transcriptText.textContent = "Paused.";
  console.log("[SignBridge] Audio capture stopped.");
}

async function toggleAudioCapture() {
  if (state.isCapturing) {
    stopAudioCapture();
    window.signBridge.stopWhisper();
  } else {
    try {
      await window.signBridge.startWhisper();
      await startAudioCapture();
    } catch (err) {
      console.error("[SignBridge] Failed to start:", err);
      showError("Could not start. Check console for details.");
      setStatus("error");
    }
  }
}

/**
 * Convert Float32 PCM to Int16 and send to main process.
 * Whisper expects 16-bit PCM @ 16000 Hz mono.
 */
function sendAudioChunk(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  // Send as plain ArrayBuffer — no Buffer needed in renderer
  window.signBridge.sendAudioChunk(int16.buffer);
}

// ─── Transcription handler ────────────────────────────────────────────────────
function handleTranscription(result) {
  if (!result || !result.text) return;

  const rawText = result.text.trim();
  if (!rawText) return;

  console.log("[SignBridge] Transcription:", rawText);

  // Tokenise: lowercase, strip punctuation, split on whitespace
  const words = rawText
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  // Build rich transcript display with matched/unmatched spans
  const spans = words.map((word) => {
    const hasSign = !!state.dictionary[word];
    return `<span class="${hasSign ? "matched" : "unmatched"}">${word}</span>`;
  });
  transcriptText.innerHTML = spans.join(" ");

  // Queue matched words
  for (const word of words) {
    const clipRelPath = state.dictionary[word];
    if (clipRelPath) {
      state.signQueue.push({ word, clipRelPath });
    }
  }

  renderQueueDots(state.signQueue.length);

  if (!state.isPlaying) {
    playNextSign();
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

  // Resolve absolute path for the video element
  const absPath = await window.signBridge.resolveClipPath(clipRelPath);
  const fileUrl = `file://${absPath.replace(/\\/g, "/")}`;

  showPlaceholder(false);
  signVideo.classList.add("visible");

  signVideo.src = fileUrl;
  signVideo.playbackRate = parseFloat(state.settings.avatarSpeed) || 1;
  signVideo.load();

  if (state.settings.subtitlesEnabled) {
    showSubtitle(word);
  }

  hideUnknownWord();

  try {
    await signVideo.play();
  } catch (err) {
    console.warn("[SignBridge] Could not play clip:", err.message);
    // Clip may be missing — show "no sign" and move on
    showUnknownWord();
    hideSubtitle();
    await sleep(600);
    playNextSign();
    return;
  }

  // When clip ends, play next
  signVideo.onended = () => {
    hideSubtitle();
    playNextSign();
  };

  // Safety timeout: max 6s per sign regardless
  signVideo._safetyTimer = setTimeout(() => {
    signVideo.pause();
    hideSubtitle();
    playNextSign();
  }, 6000);
}

signVideo.addEventListener("playing", () => {
  // Clear previous safety timer when a new clip successfully plays
  clearTimeout(signVideo._safetyTimer);
  // Set fresh one
  signVideo._safetyTimer = setTimeout(() => {
    signVideo.pause();
    hideSubtitle();
    playNextSign();
  }, 8000);
});

// ─── UI helpers ───────────────────────────────────────────────────────────────
function showPlaceholder(show) {
  avatarPlaceholder.classList.toggle("hidden", !show);
  signVideo.classList.toggle("visible", !show);
}

function showSubtitle(word) {
  subtitleEl.textContent = word;
  subtitleEl.classList.add("visible");
}

function hideSubtitle() {
  subtitleEl.classList.remove("visible");
}

function showUnknownWord() {
  unknownWordEl.classList.add("visible");
  setTimeout(() => unknownWordEl.classList.remove("visible"), 1200);
}

function hideUnknownWord() {
  unknownWordEl.classList.remove("visible");
}

function renderQueueDots(count) {
  queueIndicator.innerHTML = "";
  const MAX_DOTS = 5;
  const show = Math.min(count, MAX_DOTS);
  for (let i = 0; i < MAX_DOTS; i++) {
    const dot = document.createElement("div");
    dot.className = "queue-dot" + (i < show ? " filled" : "");
    queueIndicator.appendChild(dot);
  }
}

function setStatus(mode) {
  statusDot.className = "status-dot";
  if (mode === "active") statusDot.classList.add("active");
  if (mode === "error") statusDot.classList.add("error");
  statusDot.title = { active: "Listening", error: "Error", idle: "Idle" }[mode] || "Idle";
}

function showError(msg, duration = 5000) {
  errorToast.textContent = msg;
  errorToast.classList.add("visible");
  setTimeout(() => errorToast.classList.remove("visible"), duration);
}

function handleWhisperError(msg) {
  showError(`Whisper error: ${msg}`);
  setStatus("error");
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function toggleSettings() {
  if (state.settingsOpen) {
    closeSettings();
  } else {
    openSettings();
  }
}

function openSettings() {
  settingsPanel.classList.add("open");
  $("btn-settings").classList.add("settings-active");
  state.settingsOpen = true;
}

function closeSettings() {
  settingsPanel.classList.remove("open");
  $("btn-settings").classList.remove("settings-active");
  state.settingsOpen = false;
}

function populateSettingsUI(s) {
  setLanguage.value = s.signLanguage || "ISL";
  setSize.value = s.overlaySize || "medium";
  setOpacity.value = s.overlayOpacity || 0.92;
  setSpeed.value = String(s.avatarSpeed || 1);
  setSubtitles.checked = s.subtitlesEnabled !== false;
}

async function saveSettings() {
  const newSettings = {
    signLanguage: setLanguage.value,
    overlaySize: setSize.value,
    overlayOpacity: parseFloat(setOpacity.value),
    avatarSpeed: parseFloat(setSpeed.value),
    subtitlesEnabled: setSubtitles.checked,
  };

  await window.signBridge.saveSettings(newSettings);
  state.settings = { ...state.settings, ...newSettings };

  // Reload dictionary if language changed
  if (newSettings.signLanguage !== state.settings.signLanguage) {
    await loadDictionary(newSettings.signLanguage);
  }

  applySettings(state.settings);
  closeSettings();
}

function applySettings(s) {
  // Opacity is applied at the window level by main.js
  // (we set it locally too for fast feedback)
  document.getElementById("app").style.opacity = s.overlayOpacity || 0.92;
  if (signVideo) {
    signVideo.playbackRate = s.avatarSpeed || 1;
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", init);
