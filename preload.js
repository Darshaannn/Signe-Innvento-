/**
 * SignBridge — preload.js
 * Secure bridge between Electron main process and renderer.
 * Exposes only the exact APIs the renderer needs — nothing else.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("signBridge", {
  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),

  // ── Dictionary ────────────────────────────────────────────────────────────
  loadDictionary: (language) => ipcRenderer.invoke("load-dictionary", language),

  // ── Clip path resolution ──────────────────────────────────────────────────
  resolveClipPath: (relativePath) =>
    ipcRenderer.invoke("resolve-clip-path", relativePath),

  // ── Audio ─────────────────────────────────────────────────────────────────
  sendAudioChunk: (buffer) => ipcRenderer.send("audio-chunk", buffer),
  getDesktopAudioSource: () => ipcRenderer.invoke("get-desktop-audio-source"),

  // ── Whisper control ───────────────────────────────────────────────────────
  startWhisper: () => ipcRenderer.send("start-whisper"),
  stopWhisper: () => ipcRenderer.send("stop-whisper"),

  // ── Window controls ───────────────────────────────────────────────────────
  hideOverlay: () => ipcRenderer.send("overlay-hide"),
  closeApp: () => ipcRenderer.send("overlay-close"),

  // ── Event listeners (main → renderer) ────────────────────────────────────
  onTranscription: (callback) => {
    ipcRenderer.on("transcription", (_event, data) => callback(data));
  },
  onWhisperError: (callback) => {
    ipcRenderer.on("whisper-error", (_event, msg) => callback(msg));
  },
  onOpenSettings: (callback) => {
    ipcRenderer.on("open-settings", () => callback());
  },

  // ── Cleanup: remove all listeners for a channel ───────────────────────────
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
