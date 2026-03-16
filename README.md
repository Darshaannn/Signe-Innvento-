# SignBridge 🤟

> Real-time sign language overlay for the desktop.  
> Captures system audio → speech-to-text via Whisper → displays ISL/ASL/BSL signs as a floating overlay above any application.

Designed for deaf-mute users who rely on sign language.

---

## Architecture overview

```
System Audio  →  Renderer (Web Audio API, loopback)
                  │  PCM chunks (stdin)
                  ▼
            whisper_server.py  (faster-whisper)
                  │  JSON transcript (stdout)
                  ▼
            main.js  (Electron IPC)
                  │  transcription event
                  ▼
            overlay.js  →  dictionary lookup  →  mp4 clip queue  →  <video>
```

---

## Prerequisites

### 1. Node.js & npm
- Download from https://nodejs.org (v18 or later recommended)
- Verify: `node -v && npm -v`

### 2. Python 3.9+
- Download from https://python.org
- Verify: `python --version` (Windows) or `python3 --version` (macOS/Linux)

### 3. System audio loopback device

| Platform | Tool | Notes |
|----------|------|-------|
| **Windows** | [VB-Audio Virtual Cable](https://vb-audio.com/Cable/) (free) or [Voicemeeter](https://vb-audio.com/Voicemeeter/) | Set your app's audio output AND the SignBridge audio input to the virtual cable. |
| **macOS** | [BlackHole 2ch](https://existential.audio/blackhole/) (free, open-source) | Create a Multi-Output Device in Audio MIDI Setup combining your speakers + BlackHole. |
| **Linux** | PulseAudio module-loopback | `pactl load-module module-loopback` |

---

## Installation

### Step 1 — Clone / unzip and install Node dependencies

```bash
cd signbridge
npm install
```

### Step 2 — Install Python dependencies

```bash
# Windows
pip install faster-whisper numpy

# macOS / Linux
pip3 install faster-whisper numpy
```

> **GPU acceleration (optional):** If you have an NVIDIA GPU:
> ```bash
> pip install faster-whisper numpy
> pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
> ```
> Then in `whisper_server.py` change `DEVICE = "cpu"` → `DEVICE = "cuda"` and `COMPUTE = "int8"` → `COMPUTE = "float16"`.

### Step 3 — Test Whisper

```bash
# Windows
python whisper_server.py --test

# macOS / Linux
python3 whisper_server.py --test
```

You should see: `[SignBridge] Whisper model ready.` followed by a test result.

---

## Adding sign clips

Sign clips are **not bundled** — you must supply `.mp4` files yourself.

### Folder structure

```
signbridge/
└── clips/
    ├── ISL/
    │   ├── hello.mp4
    │   ├── thank_you.mp4
    │   └── ...
    ├── ASL/
    └── BSL/
```

### Where to get ISL clips

- **ISLRTC** (Indian Sign Research & Training Centre): https://islrtc.nic.in  
- **SignBSL.com** has a searchable BSL dictionary with video  
- **ASL University**: https://www.lifeprint.com — downloadable reference videos  
- **ASLPRO**: https://www.aslpro.com

> Clip naming must exactly match the values in `dictionaries/ISL.json`  
> (e.g. `clips/ISL/hello.mp4`). You can edit the JSON to match whatever filenames you have.

### Adding your own words

Edit `dictionaries/ISL.json`:
```json
{
  "newword": "clips/ISL/newword.mp4"
}
```

---

## Running

```bash
npm start
```

The overlay will appear in the top-left corner of your screen.

### Development mode (with DevTools)
```bash
npm run dev
```

---

## Using the overlay

| Control | Action |
|---------|--------|
| **Drag** the title bar | Move the overlay anywhere |
| **Resize** corner/edges | Resize the panel |
| **▶ button** | Start / stop audio capture |
| **⚙ button** | Open settings |
| **— button** | Hide to system tray |
| **✕ button** | Quit app |
| **Tray icon** (right-click) | Show / Hide / Settings / Quit |

---

## Settings

| Setting | Options |
|---------|---------|
| Sign Language | ISL / ASL / BSL |
| Overlay Size | Small / Medium / Large |
| Opacity | Slider 30% → 100% |
| Sign Speed | 0.5× / 1× / 1.5× / 2× |
| Subtitles | On / Off |

Settings are persisted automatically via `electron-store`.

---

## Building distributables

```bash
# Windows installer + portable
npm run build:win

# macOS .dmg
npm run build:mac

# Linux AppImage + .deb
npm run build:linux
```

Output goes to `dist/`.

---

## macOS differences vs Windows

| Area | Windows | macOS |
|------|---------|-------|
| Loopback audio | VB-Audio Virtual Cable / WASAPI | BlackHole 2ch |
| Python binary | `python` | `python3` |
| Microphone permission | Not required | Prompted by OS on first launch |
| App region | `setAlwaysOnTop("screen-saver")` works | Same API, same behaviour |
| Build output | `.exe` NSIS installer | `.dmg` |

---

## Troubleshooting

**"Audio capture failed"**  
→ Install a loopback audio device (see Prerequisites section).  
→ On Windows, ensure the virtual cable is set as the recording input.

**"Whisper model ready" never appears / app hangs on start**  
→ Run `python whisper_server.py --test` in terminal to see Python errors directly.  
→ Confirm `faster-whisper` is installed: `pip show faster-whisper`

**Signs don't play (placeholder stays)**  
→ The clip file is missing. Check `clips/ISL/<word>.mp4` exists.  
→ The app logs "Could not play clip" to DevTools console — enable with `npm run dev`.

**App doesn't stay above fullscreen (YouTube, Netflix browser)**  
→ On Windows this should work with `setAlwaysOnTop(true, "screen-saver")`.  
→ On macOS, set "Displays have separate Spaces" ON in Mission Control settings.

---

## Project structure

```
signbridge/
├── main.js                # Electron main process
├── preload.js             # Secure contextBridge
├── package.json
├── whisper_server.py      # Python faster-whisper child process
├── renderer/
│   ├── overlay.html       # Overlay UI shell
│   ├── overlay.js         # Renderer logic
│   └── overlay.css        # Overlay styles
├── dictionaries/
│   ├── ISL.json           # ~100 ISL words
│   ├── ASL.json           # Placeholder
│   └── BSL.json           # Placeholder
└── clips/
    └── ISL/               # Add .mp4 files here
```

---

## Roadmap / future ideas

- [ ] Fingerspelling fallback for unknown words (A–Z clips)  
- [ ] 3D avatar using Three.js or ReadyPlayerMe  
- [ ] Phrase-level signs (multi-word idioms)  
- [ ] Community-contributed clip packs  
- [ ] On-device model download UI (auto-fetch Whisper weights)  
- [ ] Haptic feedback integration (USB vibration bands)

---

## License

MIT — see LICENSE.
