# SignBridge 🤟

An AI-powered Sign Language overlay that translates spoken audio into sign language video clips in real-time.

## 🚀 Key Improvements (v2 Architecture)

- **Main-Process Audio Capture**: Captures audio using SoX in the Node.js main process, bypassing the Chromium/WebRTC GPU crashes on Windows.
- **Robust Queue System**: Handles sign clip playback with safety timeouts to ensure continuous feedback.
- **GPU-Safe Startup**: Programmatically disables hardware acceleration to ensure stability on all Windows machines.

## 🛠️ Setup Instructions (REQUIRED)

### 1. Install SoX (Sound eXchange)
This app requires **SoX** to record audio from your machine.
1. Download the Windows installer from: [sox.sourceforge.net](https://sox.sourceforge.net/)
2. Install it (default: `C:\Program Files (x86)\sox-14-4-2`).
3. Add that folder to your **System PATH**.
4. Verify by running `sox --version` in a new terminal.

### 2. Audio Input Configuration
For desktop audio translation, you need a virtual loopback device like **VB-Cable**:
1. Download/Install [VB-Cable](https://vb-audio.com/Cable/).
2. Open Windows **Sound Settings → Recording**.
3. Set **CABLE Output** as your **DEFAULT Recording Device**.

### 3. Build & Run
```bash
# Install dependencies
npm install

# Run in development mode
npm run dev
```

## 📂 Features
- **Real-time Transcription**: Uses OpenAI's Faster-Whisper.
- **Always-on-Top Overlay**: Floating window with adjustable opacity.
- **Dynamic Queue**: Queues signs as you speak and plays them sequentially.
- **Settings Panel**: Customize sign language (ISL), speed, and subtitles.
