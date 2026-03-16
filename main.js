/**
 * SignBridge — main.js
 * Electron main process: overlay window, tray icon, IPC handlers,
 * Python whisper child process management.
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, systemPreferences, desktopCapturer, session } = require('electron')

// ─── SAFE MODE: MINIMAL FLAGS ───────────────────────────────────────────────
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')

const os = require('os')
const path = require('path')
const tmpCache = path.join(os.tmpdir(), 'signbridge-cache')
app.commandLine.appendSwitch('disk-cache-dir', tmpCache)

const { spawn } = require('child_process')
const fs = require('fs')
const Store = require('electron-store')

// ─── Persistence ────────────────────────────────────────────────────────────
const store = new Store({
  defaults: {
    overlayOpacity: 1.0, 
    overlaySize: 'medium',
    signLanguage: 'ISL',
    avatarSpeed: 1,
    subtitlesEnabled: true,
    windowBounds: { x: 80, y: 80, width: 380, height: 420 },
  },
})

// ─── Globals ─────────────────────────────────────────────────────────────────
let overlayWindow = null
let tray = null
let whisperProcess = null
let isOverlayVisible = true
const isDev = process.argv.includes('--dev')

// ─── Overlay window sizes ────────────────────────────────────────────────────
const SIZES = {
  small:  { width: 280, height: 320 },
  medium: { width: 380, height: 420 },
  large:  { width: 500, height: 560 },
}

// ─── Create the floating overlay window ─────────────────────────────────────
function createOverlayWindow() {
  const savedBounds = store.get('windowBounds')
  const sizeKey = store.get('overlaySize')
  const size = SIZES[sizeKey] || SIZES.medium

  overlayWindow = new BrowserWindow({
    x: savedBounds.x,
    y: savedBounds.y,
    width: size.width,
    height: size.height,
    minWidth: 220,
    minHeight: 260,
    transparent: false, // SAFE MODE: No transparency
    frame: true,       // SAFE MODE: Standard frame
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false, // SAFE MODE: Show in taskbar
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'))

  // ─── Crash recovery (Slower loop for debugging) ──────────────────────────
  overlayWindow.webContents.on('render-process-gone', (event, details) => {
    console.error(`[CRASH] Renderer process gone (Safe Mode): ${details.reason} (code: ${details.exitCode})`)
    // Longer recovery timeout to give user time to read terminal
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        console.log('[SignBridge] Attempting renderer recovery (5s delay)...')
        overlayWindow.reload()
      }
    }, 5000)
  })

  overlayWindow.on('unresponsive', () => {
    console.warn('[SignBridge] Renderer unresponsive — manual reload recommended')
  })

  overlayWindow.on('moved', saveBounds)
  overlayWindow.on('resized', saveBounds)
  overlayWindow.on('closed', () => { overlayWindow = null })

  if (isDev) {
    overlayWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

function saveBounds() {
  if (!overlayWindow) return
  try {
    store.set('windowBounds', overlayWindow.getBounds())
  } catch (e) {
    console.error('[SignBridge] Failed to save bounds:', e)
  }
}

// ─── Tray ────────────────────────────────────────────────────────────────────
function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png')
    const trayIcon = fs.existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath)
      : nativeImage.createEmpty()

    tray = new Tray(trayIcon)
    tray.setToolTip('SignBridge — Sign Language Overlay')
    updateTrayMenu()
    tray.on('double-click', toggleOverlay)
  } catch (e) {
    console.error('[SignBridge] Failed to create tray:', e)
  }
}

function updateTrayMenu() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: isOverlayVisible ? 'Hide Overlay' : 'Show Overlay', click: toggleOverlay },
    { label: 'Settings', click: () => { if (overlayWindow) { showOverlay(); overlayWindow.webContents.send('open-settings') } } },
    { type: 'separator' },
    { label: 'Quit SignBridge', click: () => app.quit() },
  ]))
}

function toggleOverlay() { isOverlayVisible ? hideOverlay() : showOverlay() }
function showOverlay()   { if (!overlayWindow) createOverlayWindow(); overlayWindow.show(); isOverlayVisible = true; updateTrayMenu() }
function hideOverlay()   { if (overlayWindow) overlayWindow.hide(); isOverlayVisible = false; updateTrayMenu() }

// ─── Whisper process ─────────────────────────────────────────────────────────
function startWhisperProcess() {
  const scriptPath = path.join(__dirname, 'whisper_server.py')
  if (!fs.existsSync(scriptPath)) {
    console.error('[Whisper] whisper_server.py not found')
    return
  }

  const pythonBin = process.platform === 'win32' ? 'py' : 'python3'

  try {
    whisperProcess = spawn(pythonBin, [scriptPath])

    whisperProcess.stdout.on('data', (data) => {
      try {
        const result = JSON.parse(data.toString())
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send('transcription', result)
        }
      } catch (e) { }
    })

    whisperProcess.stderr.on('data', (data) => {
      console.error('[Whisper]', data.toString().trim())
    })

    whisperProcess.on('close', (code) => {
      console.log('[Whisper] exited with code:', code)
      whisperProcess = null
    })

    whisperProcess.on('error', (err) => {
      console.error('[Whisper] failed to start:', err.message)
    })

    console.log(`[SignBridge] Whisper process started (PID: ${whisperProcess.pid})`)
  } catch (e) {
    console.error('[SignBridge] Failed to spawn Whisper:', e)
  }
}

function stopWhisperProcess() {
  if (whisperProcess) {
    try { whisperProcess.kill() } catch (e) {}
    whisperProcess = null
  }
}

// ─── IPC handlers ────────────────────────────────────────────────────────────
ipcMain.on('audio-chunk', (_event, buffer) => {
  if (whisperProcess && whisperProcess.stdin && !whisperProcess.stdin.destroyed) {
    try {
      const len = Buffer.alloc(4)
      len.writeUInt32LE(buffer.length, 0)
      whisperProcess.stdin.write(len)
      whisperProcess.stdin.write(buffer)
    } catch (e) {
      console.error('[SignBridge] Failed to write audio chunk:', e.message)
    }
  }
})

ipcMain.handle('get-settings', () => ({
  overlayOpacity:  1.0,
  overlaySize:     store.get('overlaySize'),
  signLanguage:    store.get('signLanguage'),
  avatarSpeed:     store.get('avatarSpeed'),
  subtitlesEnabled: store.get('subtitlesEnabled'),
}))

ipcMain.handle('save-settings', (_event, settings) => {
  try {
    store.set(settings)
    if (overlayWindow) {
      if (settings.overlaySize) {
        const s = SIZES[settings.overlaySize] || SIZES.medium
        overlayWindow.setSize(s.width, s.height)
      }
    }
    return true
  } catch (e) {
    console.error('[SignBridge] Failed to save settings:', e)
    return false
  }
})

ipcMain.handle('load-dictionary', (_event, language) => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'dictionaries', `${language}.json`), 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    console.error(`[SignBridge] Failed to load dictionary '${language}':`, e.message)
    return {}
  }
})

ipcMain.handle('resolve-clip-path', (_event, relativePath) => {
  try { return path.join(__dirname, relativePath) }
  catch (e) { return '' }
})

ipcMain.handle('get-desktop-audio-source', async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false })
    return sources.length > 0 ? sources[0].id : null
  } catch (e) {
    console.error('[SignBridge] Failed to get desktop source:', e)
    return null
  }
})

ipcMain.on('overlay-hide',   () => hideOverlay())
ipcMain.on('overlay-close',  () => app.quit())
ipcMain.on('start-whisper',  () => { if (!whisperProcess) startWhisperProcess() })
ipcMain.on('stop-whisper',   () => stopWhisperProcess())

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.on('ready', async () => {
  try {
    if (process.platform === 'darwin') {
      const granted = await systemPreferences.askForMediaAccess('microphone')
      if (!granted) console.warn('[SignBridge] Microphone access denied.')
    }

    createOverlayWindow()
    createTray()
    startWhisperProcess()
  } catch (e) {
    console.error('[SignBridge] Error during app ready:', e)
  }
})

app.on('before-quit', () => {
  app.isQuitting = true
  stopWhisperProcess()
})

app.on('window-all-closed', () => { })

app.on('activate', () => {
  if (!overlayWindow) createOverlayWindow()
})
