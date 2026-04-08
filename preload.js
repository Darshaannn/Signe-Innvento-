/**
 * SignBridge — preload.js
 * Secure contextBridge between Electron main process and renderer.
 * Exposes ONLY the exact APIs the renderer needs — nothing else.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("signBridge", {

  // ── Settings ────────────────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),

  // ── Dictionary ──────────────────────────────────────────────────────────────
  loadDictionary: (language) => ipcRenderer.invoke("load-dictionary", language),

  // ── Clip path resolution ────────────────────────────────────────────────────
  resolveClipPath: (relativePath) => ipcRenderer.invoke("resolve-clip-path", relativePath),

  // ── Main-process audio capture (NEW — primary capture method) ───────────────
  // Renderer sends these; main process runs SoX and pipes audio to Whisper.
  // No getUserMedia / WebRTC / desktopCapturer in renderer at all for capture.
  startCapture: () => ipcRenderer.send("start-capture"),
  stopCapture: () => ipcRenderer.send("stop-capture"),

  // ── Legacy renderer-side audio (kept for compatibility) ─────────────────────
  sendAudioChunk: (buffer) => ipcRenderer.send("audio-chunk", buffer),
  getDesktopAudioSource: () => ipcRenderer.invoke("get-desktop-audio-source"),

  // ── Whisper lifecycle ────────────────────────────────────────────────────────
  startWhisper: () => ipcRenderer.send("start-whisper"),
  stopWhisper: () => ipcRenderer.send("stop-whisper"),

  // ── Window controls ──────────────────────────────────────────────────────────
  hideOverlay: () => ipcRenderer.send("overlay-hide"),
  closeApp: () => ipcRenderer.send("overlay-close"),

  // ── Event listeners: main → renderer ────────────────────────────────────────

  // Transcription result from Whisper: { text, segments, language }
  onTranscription: (cb) => {
    ipcRenderer.on("transcription", (_e, data) => cb(data));
  },

  // Whisper Python process error
  onWhisperError: (cb) => {
    ipcRenderer.on("whisper-error", (_e, msg) => cb(msg));
  },

  // Tray "Settings" click
  onOpenSettings: (cb) => {
    ipcRenderer.on("open-settings", () => cb());
  },

  // Audio capture status updates from main process (NEW)
  // Payload: { active: bool, mode: string, error?: string }
  onCaptureStatus: (cb) => {
    ipcRenderer.on("capture-status", (_e, status) => cb(status));
  },

  // Real-time audio volume level (0.0 to 1.0)
  onVolumeLevel: (cb) => {
    ipcRenderer.on("volume-level", (_e, level) => cb(level));
  },


  // ── Cleanup ──────────────────────────────────────────────────────────────────
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },

});
