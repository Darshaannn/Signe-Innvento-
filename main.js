/**
 * SignBridge — main.js
 * Electron main process: overlay window, tray icon, IPC handlers,
 * Python whisper child process management.
 */

// ─── Silence Chromium cache / GPU noise BEFORE app is ready ──────────────────
// These flags suppress the "Unable to move cache / GPU Cache Creation failed"
// errors that appear on Windows when Electron can't write to its default cache
// directory (common in restricted/roaming-profile environments).
const { app } = require("electron");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
// Point the disk cache to a writable temp location to avoid "Access is denied"
const os = require("os");
const tmpCache = require("path").join(os.tmpdir(), "signbridge-cache");
app.commandLine.appendSwitch("disk-cache-dir", tmpCache);

const {
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  systemPreferences,
  desktopCapturer,
  session,
} = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const Store = require("electron-store");

// ─── Persistence ────────────────────────────────────────────────────────────
const store = new Store({
  defaults: {
    overlayOpacity: 0.92,
    overlaySize: "medium",
    signLanguage: "ISL",
    avatarSpeed: 1,
    subtitlesEnabled: true,
    windowBounds: { x: 80, y: 80, width: 380, height: 420 },
  },
});

// ─── Globals ─────────────────────────────────────────────────────────────────
let overlayWindow = null;
let tray = null;
let whisperProcess = null;
let isOverlayVisible = true;
const isDev = process.argv.includes("--dev");

// ─── Overlay window sizes ────────────────────────────────────────────────────
const SIZES = {
  small: { width: 280, height: 320 },
  medium: { width: 380, height: 420 },
  large: { width: 500, height: 560 },
};

// ─── Create the floating overlay window ─────────────────────────────────────
function createOverlayWindow() {
  const savedBounds = store.get("windowBounds");
  const sizeKey = store.get("overlaySize");
  const size = SIZES[sizeKey] || SIZES.medium;

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
      sandbox: false, // required for contextBridge preload
    },
  });

  // Stay above fullscreen apps (screen-saver level)
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  overlayWindow.loadFile(path.join(__dirname, "renderer", "overlay.html"));

  // Persist window position/size on move or resize
  overlayWindow.on("moved", saveBounds);
  overlayWindow.on("resized", saveBounds);

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  // ── DevTools: only open in --dev mode ─────────────────────────────────────
  // FIX: removed the unconditional openDevTools() call that was opening a
  // detached DevTools window on every launch regardless of the --dev flag.
  if (isDev) {
    overlayWindow.webContents.openDevTools({ mode: "detach" });
  }
}

function saveBounds() {
  if (!overlayWindow) return;
  const b = overlayWindow.getBounds();
  store.set("windowBounds", b);
}

// ─── Tray icon ───────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, "assets", "tray-icon.png");
  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    // Fallback: empty icon (tray shows a blank slot — acceptable for MVP)
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("SignBridge — Sign Language Overlay");
  updateTrayMenu();

  tray.on("double-click", () => toggleOverlay());
}

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: isOverlayVisible ? "Hide Overlay" : "Show Overlay",
      click: () => toggleOverlay(),
    },
    {
      label: "Settings",
      click: () => {
        if (overlayWindow) {
          overlayWindow.webContents.send("open-settings");
          showOverlay();
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit SignBridge",
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
}

function toggleOverlay() {
  if (isOverlayVisible) hideOverlay();
  else showOverlay();
}

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

// ─── Python Whisper process ──────────────────────────────────────────────────
function startWhisperProcess() {
  const scriptPath = path.join(__dirname, "whisper_server.py");

  if (!fs.existsSync(scriptPath)) {
    console.error("[SignBridge] whisper_server.py not found:", scriptPath);
    return;
  }

  // Windows: 'py' launcher works with any Python 3.x installation.
  // macOS / Linux: 'python3'.
  const pythonBin = process.platform === "win32" ? "py" : "python3";

  whisperProcess = spawn(pythonBin, [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  whisperProcess.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const result = JSON.parse(line);
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send("transcription", result);
        }
      } catch {
        // Non-JSON Python output (startup messages, warnings) — safe to ignore
        if (isDev) console.log("[Whisper stdout]", line);
      }
    }
  });

  whisperProcess.stderr.on("data", (data) => {
    // Always log stderr so Whisper model-load progress is visible in terminal
    console.log("[Whisper]", data.toString().trimEnd());
  });

  whisperProcess.on("exit", (code) => {
    console.log(`[SignBridge] Whisper process exited (code ${code})`);
    whisperProcess = null;
    if (!app.isQuitting) {
      setTimeout(startWhisperProcess, 3000);
    }
  });

  whisperProcess.on("error", (err) => {
    console.error("[SignBridge] Failed to start Whisper:", err.message);
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("whisper-error", err.message);
    }
  });

  console.log("[SignBridge] Whisper process started (PID:", whisperProcess.pid, ")");
}

function stopWhisperProcess() {
  if (whisperProcess) {
    whisperProcess.kill();
    whisperProcess = null;
  }
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

// Audio chunk from renderer → Whisper stdin (length-prefixed binary protocol)
ipcMain.on("audio-chunk", (_event, buffer) => {
  if (whisperProcess && whisperProcess.stdin && !whisperProcess.stdin.destroyed) {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(buffer.length, 0);
    whisperProcess.stdin.write(len);
    whisperProcess.stdin.write(buffer);
  }
});

// Settings
ipcMain.handle("get-settings", () => ({
  overlayOpacity: store.get("overlayOpacity"),
  overlaySize: store.get("overlaySize"),
  signLanguage: store.get("signLanguage"),
  avatarSpeed: store.get("avatarSpeed"),
  subtitlesEnabled: store.get("subtitlesEnabled"),
}));

ipcMain.handle("save-settings", (_event, settings) => {
  store.set(settings);
  if (overlayWindow && settings.overlayOpacity !== undefined) {
    overlayWindow.setOpacity(settings.overlayOpacity);
  }
  if (settings.overlaySize) {
    const s = SIZES[settings.overlaySize] || SIZES.medium;
    if (overlayWindow) overlayWindow.setSize(s.width, s.height);
  }
  return true;
});

// Dictionary loader
ipcMain.handle("load-dictionary", (_event, language) => {
  const dictPath = path.join(__dirname, "dictionaries", `${language}.json`);
  try {
    const raw = fs.readFileSync(dictPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[SignBridge] Failed to load dictionary '${language}':`, err.message);
    return {};
  }
});

// Resolve a relative clip path to an absolute path for the renderer <video> tag
ipcMain.handle("resolve-clip-path", (_event, relativePath) => {
  return path.join(__dirname, relativePath);
});

// Window controls
ipcMain.on("overlay-hide", () => hideOverlay());
ipcMain.on("overlay-close", () => app.quit());

// Whisper lifecycle
ipcMain.on("start-whisper", () => { if (!whisperProcess) startWhisperProcess(); });
ipcMain.on("stop-whisper", () => stopWhisperProcess());

// Desktop audio source for loopback capture
ipcMain.handle("get-desktop-audio-source", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    fetchWindowIcons: false,
  });
  return sources.length > 0 ? sources[0].id : null;
});

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.on("ready", async () => {
  // macOS: request microphone access for audio capture
  if (process.platform === "darwin") {
    const granted = await systemPreferences.askForMediaAccess("microphone");
    if (!granted) console.warn("[SignBridge] Microphone access denied on macOS.");
  }

  // Let renderer capture desktop audio via getDisplayMedia / loopback
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
        callback({ video: sources[0], audio: "loopback" });
      });
    },
    { useSystemPicker: false }
  );

  createOverlayWindow();
  createTray();
  startWhisperProcess();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopWhisperProcess();
});

// Don't quit when all windows close — the app lives in the tray
app.on("window-all-closed", () => { /* intentionally empty */ });

app.on("activate", () => {
  if (!overlayWindow) createOverlayWindow();
});
