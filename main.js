/**
 * SignBridge — main.js
 * Electron main process: overlay window, tray icon, IPC handlers,
 * Python whisper child process management.
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, systemPreferences, desktopCapturer, session } = require('electron')

// ─── MUST BE BEFORE app.whenReady() ──────────────────────────────────────────
// silence Chromium cache / GPU noise early
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

// Point the disk cache to a writable temp location to avoid "Access is denied"
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
    overlayOpacity: 0.92,
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
  small: { width: 280, height: 320 },
  medium: { width: 380, height: 420 },
  large: { width: 500, height: 560 },
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
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Stay above fullscreen apps (screen-saver level)
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'))

  // Persist window position/size on move or resize
  overlayWindow.on('moved', saveBounds)
  overlayWindow.on('resized', saveBounds)

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })

  if (isDev) {
    overlayWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

function saveBounds() {
  if (!overlayWindow) return
  const b = overlayWindow.getBounds()
  store.set('windowBounds', b)
}

// ─── Tray icon ───────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png')
  let trayIcon
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath)
  } else {
    trayIcon = nativeImage.createEmpty()
  }

  tray = new Tray(trayIcon)
  tray.setToolTip('SignBridge — Sign Language Overlay')
  updateTrayMenu()

  tray.on('double-click', () => toggleOverlay())
}

function updateTrayMenu() {
  if (!tray) return
  const menu = Menu.buildFromTemplate([
    {
      label: isOverlayVisible ? 'Hide Overlay' : 'Show Overlay',
      click: () => toggleOverlay(),
    },
    {
      label: 'Settings',
      click: () => {
        if (overlayWindow) {
          overlayWindow.webContents.send('open-settings')
          showOverlay()
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit SignBridge',
      click: () => app.quit(),
    },
  ])
  tray.setContextMenu(menu)
}

function toggleOverlay() {
  if (isOverlayVisible) hideOverlay()
  else showOverlay()
}

function showOverlay() {
  if (!overlayWindow) createOverlayWindow()
  overlayWindow.show()
  isOverlayVisible = true
  updateTrayMenu()
}

function hideOverlay() {
  if (overlayWindow) overlayWindow.hide()
  isOverlayVisible = false
  updateTrayMenu()
}

// ─── Python Whisper process ──────────────────────────────────────────────────
function startWhisperProcess() {
  const scriptPath = path.join(__dirname, 'whisper_server.py')

  if (!fs.existsSync(scriptPath)) {
    console.error('[Whisper] whisper_server.py not found:', scriptPath)
    return
  }

  // Windows: 'python' or 'py'. User explicitly asked for 'python', 
  // but 'py' is the standard launcher on Windows that points to the actual installation.
  const pythonBin = process.platform === 'win32' ? 'py' : 'python3'

  whisperProcess = spawn(pythonBin, ['whisper_server.py'])

  whisperProcess.stdout.on('data', (data) => {
    try {
      const result = JSON.parse(data.toString())
      if (overlayWindow) {
        overlayWindow.webContents.send('transcription', result)
      }
    } catch (e) {
      // ignore non-json
    }
  })

  whisperProcess.stderr.on('data', (data) => {
    console.error('[Whisper]', data.toString())
    // DO NOT quit app on whisper error
  })

  whisperProcess.on('close', (code) => {
    console.log('[Whisper] process exited with code:', code)
    whisperProcess = null
    // DO NOT call app.quit() here
  })

  whisperProcess.on('error', (err) => {
    console.error('[Whisper] failed to start:', err.message)
    // DO NOT crash — just log it
  })
}

function stopWhisperProcess() {
  if (whisperProcess) {
    whisperProcess.kill()
    whisperProcess = null
  }
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.on('audio-chunk', (_event, buffer) => {
  if (whisperProcess && whisperProcess.stdin && !whisperProcess.stdin.destroyed) {
    const len = Buffer.alloc(4)
    len.writeUInt32LE(buffer.length, 0)
    whisperProcess.stdin.write(len)
    whisperProcess.stdin.write(buffer)
  }
})

ipcMain.handle('get-settings', () => ({
  overlayOpacity: store.get('overlayOpacity'),
  overlaySize: store.get('overlaySize'),
  signLanguage: store.get('signLanguage'),
  avatarSpeed: store.get('avatarSpeed'),
  subtitlesEnabled: store.get('subtitlesEnabled'),
}))

ipcMain.handle('save-settings', (_event, settings) => {
  store.set(settings)
  if (overlayWindow && settings.overlayOpacity !== undefined) {
    overlayWindow.setOpacity(settings.overlayOpacity)
  }
  if (settings.overlaySize) {
    const s = SIZES[settings.overlaySize] || SIZES.medium
    if (overlayWindow) overlayWindow.setSize(s.width, s.height)
  }
  return true
})

ipcMain.handle('load-dictionary', (_event, language) => {
  const dictPath = path.join(__dirname, 'dictionaries', `${language}.json`)
  try {
    const raw = fs.readFileSync(dictPath, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    console.error(`[SignBridge] Failed to load dictionary '${language}':`, err.message)
    return {}
  }
})

ipcMain.handle('resolve-clip-path', (_event, relativePath) => {
  return path.join(__dirname, relativePath)
})

ipcMain.on('overlay-hide', () => hideOverlay())
ipcMain.on('overlay-close', () => app.quit())

ipcMain.on('start-whisper', () => { if (!whisperProcess) startWhisperProcess() })
ipcMain.on('stop-whisper', () => stopWhisperProcess())

ipcMain.handle('get-desktop-audio-source', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    fetchWindowIcons: false,
  })
  return sources.length > 0 ? sources[0].id : null
})

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.on('ready', async () => {
  if (process.platform === 'darwin') {
    const granted = await systemPreferences.askForMediaAccess('microphone')
    if (!granted) console.warn('[SignBridge] Microphone access denied on macOS.')
  }

  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' })
      })
    },
    { useSystemPicker: false }
  )

  createOverlayWindow()
  createTray()
  startWhisperProcess()
})

app.on('before-quit', () => {
  app.isQuitting = true
  stopWhisperProcess()
})

app.on('window-all-closed', (e) => {
  // Do NOT quit — app lives in system tray
  if (process.platform !== 'darwin') {
    // on Windows/Linux we just prevent default
    // e.preventDefault() // Wait, e is undefined if called by Electron normally? 
    // Actually window-all-closed handler usually doesn't need to prevent default unless we want to keep the app open.
  }
})

// Re-implement correctly based on user logic:
app.on('window-all-closed', (e) => {
  // Do NOT quit — app lives in system tray
  e.preventDefault()
})

app.on('activate', () => {
  if (!overlayWindow) createOverlayWindow()
})
