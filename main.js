/**
 * SignBridge — main.js
 * Electron main process: overlay window, tray icon, IPC handlers,
 * Python whisper child process, and MAIN-PROCESS audio capture.
 *
 * ── Audio capture strategy ───────────────────────────────────────────────────
 * We do NOT use getUserMedia / WebRTC desktop capture in the renderer.
 * That approach crashes the renderer on Windows (exit code -1073741819) due to
 * a GPU/graphics context conflict triggered by Chromium's WebRTC pipeline.
 *
 * Instead: node-record-lpcm16 (which shells out to SoX) runs entirely in the
 * Electron MAIN process. The renderer just sends start-capture / stop-capture
 * IPC messages. Audio bytes are piped directly to whisper_server.py stdin here.
 */

// ─── Suppress Chromium cache / GPU noise BEFORE app is ready ─────────────────
const { app } = require("electron");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

const os   = require("os");
const path = require("path");
const tmpCache = path.join(os.tmpdir(), "signbridge-cache");
app.commandLine.appendSwitch("disk-cache-dir", tmpCache);

// ─── Remaining requires ───────────────────────────────────────────────────────
const {
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  systemPreferences,
  session,
  desktopCapturer,
} = require("electron");

const { spawn }  = require("child_process");
const fs         = require("fs");
const Store      = require("electron-store");

// node-record-lpcm16 — graceful require so the app starts even if not installed
let recorder = null;
try {
  recorder = require("node-record-lpcm16");
} catch {
  console.warn(
    "[SignBridge] node-record-lpcm16 not found. Run: npm install node-record-lpcm16\n" +
    "             Audio capture will be unavailable until it is installed."
  );
}

// ─── Persistence ─────────────────────────────────────────────────────────────
const store = new Store({
  defaults: {
    overlayOpacity:   0.92,
    overlaySize:      "medium",
    signLanguage:     "ISL",
    avatarSpeed:      1,
    subtitlesEnabled: true,
    windowBounds:     { x: 80, y: 80, width: 380, height: 420 },
  },
});

// ─── Globals ──────────────────────────────────────────────────────────────────
let overlayWindow    = null;
let tray             = null;
let whisperProcess   = null;
let recordingSession = null;   // active node-record-lpcm16 Recording object
let isOverlayVisible = true;
const isDev = process.argv.includes("--dev");

// ─── Window sizes ─────────────────────────────────────────────────────────────
const SIZES = {
  small:  { width: 280, height: 320 },
  medium: { width: 380, height: 420 },
  large:  { width: 500, height: 560 },
};

// ─── Overlay window ───────────────────────────────────────────────────────────
function createOverlayWindow() {
  const savedBounds = store.get("windowBounds");
  const sizeKey     = store.get("overlaySize");
  const size        = SIZES[sizeKey] || SIZES.medium;

  overlayWindow = new BrowserWindow({
    x: savedBounds.x,
    y: savedBounds.y,
    width: size.width,
    height: size.height,
    minWidth: 220,
    minHeight: 260,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile(path.join(__dirname, "renderer", "overlay.html"));

  overlayWindow.on("moved", saveBounds);
  overlayWindow.on("resized", saveBounds);
  overlayWindow.on("closed", () => { overlayWindow = null; });

  if (isDev) {
    overlayWindow.webContents.openDevTools({ mode: "detach" });
  }
}

function saveBounds() {
  if (!overlayWindow) return;
  try {
    store.set("windowBounds", overlayWindow.getBounds());
  } catch (e) {
    console.error("[SignBridge] Failed to save bounds:", e);
  }
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  try {
    const iconPath = path.join(__dirname, "assets", "tray-icon.png");
    const trayIcon = fs.existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath)
      : nativeImage.createEmpty();

    tray = new Tray(trayIcon);
    tray.setToolTip("SignBridge — Sign Language Overlay");
    updateTrayMenu();
    tray.on("double-click", toggleOverlay);
  } catch (e) {
    console.error("[SignBridge] Failed to create tray:", e);
  }
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: isOverlayVisible ? "Hide Overlay" : "Show Overlay", click: toggleOverlay },
    {
      label: "Settings",
      click: () => {
        if (overlayWindow) {
          showOverlay();
          overlayWindow.webContents.send("open-settings");
        }
      }
    },
    { type: "separator" },
    { label: "Quit SignBridge", click: () => app.quit() },
  ]));
}

function toggleOverlay() { isOverlayVisible ? hideOverlay() : showOverlay() }

function showOverlay() {
  if (!overlayWindow) createOverlayWindow();
  overlayWindow.show();
  isOverlayVisible = true;
  updateTrayMenu();
}

function hideOverlay() {
  if (overlayWindow) overlayWindow.hide();
  isOverlayVisible = false;
  updateTrayMenu();
}

// ─── Whisper process ──────────────────────────────────────────────────────────
function startWhisperProcess() {
  const scriptPath = path.join(__dirname, "whisper_server.py");
  if (!fs.existsSync(scriptPath)) {
    console.error("[SignBridge] whisper_server.py not found:", scriptPath);
    return;
  }

  const pythonBin = process.platform === "win32" ? "py" : "python3";
  try {
    whisperProcess = spawn(pythonBin, [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });

    whisperProcess.stdout.on("data", (data) => {
      for (const line of data.toString().split("\n").filter(Boolean)) {
        try {
          const result = JSON.parse(line);
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send("transcription", result);
          }
        } catch (e) {
          if (isDev) console.log("[Whisper stdout]", line);
        }
      }
    });

    whisperProcess.stderr.on("data", (data) => {
      console.error("[Whisper]", data.toString().trimEnd());
    });

    whisperProcess.on("exit", (code) => {
      console.log(`[SignBridge] Whisper exited (code ${code})`);
      whisperProcess = null;
      if (!app.isQuitting) {
        console.log("[SignBridge] Restarting Whisper in 3s...");
        setTimeout(startWhisperProcess, 3000);
      }
    });

    whisperProcess.on("error", (err) => {
      console.error("[SignBridge] Whisper spawn error:", err.message);
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send("whisper-error", err.message);
      }
    });

    console.log(`[SignBridge] Whisper started (PID: ${whisperProcess.pid})`);
  } catch (e) {
    console.error("[SignBridge] Failed to start Whisper:", e);
  }
}

function stopWhisperProcess() {
  if (whisperProcess) {
    try { whisperProcess.kill(); } catch (e) {}
    whisperProcess = null;
  }
}

// ─── Write one audio chunk to Whisper stdin (length-prefixed protocol) ────────
function sendChunkToWhisper(int16Buffer) {
  if (!whisperProcess || !whisperProcess.stdin || whisperProcess.stdin.destroyed) return;
  try {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(int16Buffer.length, 0);
    whisperProcess.stdin.write(len);
    whisperProcess.stdin.write(int16Buffer);
  } catch (e) {
    console.error("[SignBridge] Failed to send audio chunk to Whisper:", e.message);
  }
}

// ─── Main-process audio capture (node-record-lpcm16 + SoX) ───────────────────
const SAMPLE_RATE    = 16000;
const BYTES_PER_SAMPLE = 2; // int16
const CHUNK_SECONDS  = 2;
const CHUNK_BYTES    = SAMPLE_RATE * BYTES_PER_SAMPLE * CHUNK_SECONDS; // 64000

let audioAccumulator = Buffer.alloc(0);

function startMainProcessCapture() {
  if (recordingSession) {
    console.warn("[SignBridge] Capture already running.");
    return;
  }

  if (!recorder) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("capture-status", {
        active: false,
        mode: "mic-unavailable",
        error: "node-record-lpcm16 not installed. Run: npm install node-record-lpcm16",
      });
    }
    return;
  }

  console.log("[SignBridge] Starting main-process capture via SoX...");

  try {
    recordingSession = recorder.record({
      sampleRate: SAMPLE_RATE,
      channels: 1,
      audioType: "raw",
      encoding: "signed-integer",
      bits: 16,
      endian: "little",
      device: null,
      recorder: "sox",
      silence: 0,
    });

    audioAccumulator = Buffer.alloc(0);

    recordingSession.stream().on("data", (chunk) => {
      audioAccumulator = Buffer.concat([audioAccumulator, chunk]);
      while (audioAccumulator.length >= CHUNK_BYTES) {
        const chunkToSend = audioAccumulator.slice(0, CHUNK_BYTES);
        audioAccumulator = audioAccumulator.slice(CHUNK_BYTES);
        sendChunkToWhisper(chunkToSend);
      }
    });

    recordingSession.stream().on("error", (err) => {
      console.error("[SignBridge] Audio stream error:", err.message);
      stopMainProcessCapture();
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send("capture-status", {
          active: false,
          mode: "error",
          error: err.message,
        });
      }
    });

    recordingSession.stream().on("close", () => {
      console.log("[SignBridge] Audio stream closed.");
      recordingSession = null;
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send("capture-status", { active: false, mode: "stopped" });
      }
    });

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("capture-status", { active: true, mode: "sox" });
    }

  } catch (err) {
    console.error("[SignBridge] Failed to start capture:", err.message);
    recordingSession = null;
    const isSoxMissing = err.message.includes("ENOENT") || err.message.includes("spawn") || err.message.includes("sox");
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("capture-status", {
        active: false,
        mode: isSoxMissing ? "sox-missing" : "error",
        error: err.message,
      });
    }
  }
}

function stopMainProcessCapture() {
  if (!recordingSession) return;
  try {
    recordingSession.stop();
    console.log("[SignBridge] Audio capture stopped.");
  } catch (err) {
    console.warn("[SignBridge] Error stopping capture:", err.message);
  }
  recordingSession = null;
  audioAccumulator = Buffer.alloc(0);
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────
ipcMain.on("start-capture", () => {
  if (!whisperProcess) startWhisperProcess();
  startMainProcessCapture();
});

ipcMain.on("stop-capture", () => {
  stopMainProcessCapture();
});

ipcMain.on("audio-chunk", (_event, buffer) => {
  sendChunkToWhisper(buffer);
});

ipcMain.handle("get-settings", () => ({
  overlayOpacity: store.get("overlayOpacity") || 0.92,
  overlaySize: store.get("overlaySize") || "medium",
  signLanguage: store.get("signLanguage") || "ISL",
  avatarSpeed: store.get("avatarSpeed") || 1,
  subtitlesEnabled: store.get("subtitlesEnabled") !== false,
}));

ipcMain.handle("save-settings", (_event, settings) => {
  try {
    store.set(settings);
    if (overlayWindow && settings.overlayOpacity !== undefined) {
      overlayWindow.setOpacity(settings.overlayOpacity);
    }
    if (settings.overlaySize) {
      const s = SIZES[settings.overlaySize] || SIZES.medium;
      if (overlayWindow) overlayWindow.setSize(s.width, s.height);
    }
    return true;
  } catch (e) {
    console.error("[SignBridge] Failed to save settings:", e);
    return false;
  }
});

ipcMain.handle("load-dictionary", (_event, language) => {
  const dictPath = path.join(__dirname, "dictionaries", `${language}.json`);
  try {
    return JSON.parse(fs.readFileSync(dictPath, "utf8"));
  } catch (err) {
    console.error(`[SignBridge] Failed to load dictionary '${language}':`, err.message);
    return {};
  }
});

ipcMain.handle("resolve-clip-path", (_event, relativePath) => {
  return path.join(__dirname, relativePath);
});

ipcMain.handle("get-desktop-audio-source", async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ["screen"], fetchWindowIcons: false });
    return sources.length > 0 ? sources[0].id : null;
  } catch (e) {
    console.error("[SignBridge] Failed to get desktop source:", e);
    return null;
  }
});

ipcMain.on("overlay-hide", () => hideOverlay());
ipcMain.on("overlay-close", () => app.quit());
ipcMain.on("start-whisper", () => { if (!whisperProcess) startWhisperProcess(); });
ipcMain.on("stop-whisper", () => stopWhisperProcess());

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.on("ready", async () => {
  try {
    if (process.platform === "darwin") {
      const granted = await systemPreferences.askForMediaAccess("microphone");
      if (!granted) console.warn("[SignBridge] Microphone access denied.");
    }

    createOverlayWindow();
    createTray();
    startWhisperProcess();
  } catch (e) {
    console.error("[SignBridge] Error during app ready:", e);
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopMainProcessCapture();
  stopWhisperProcess();
});

app.on("window-all-closed", () => { });

app.on("activate", () => {
  if (!overlayWindow) createOverlayWindow();
});
