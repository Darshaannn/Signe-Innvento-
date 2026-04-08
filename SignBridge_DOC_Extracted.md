
SIGNBRIDGE
Real-Time Sign Language Overlay Desktop App
Complete Project Documentation
Designed for Deaf-Mute Individuals
ISL • ASL • BSL Support

Version 1.0  •  2024  •  SignBridge Project

1. What Is SignBridge?
SignBridge is a Windows desktop accessibility application designed specifically for deaf-mute individuals who use sign language. It runs as a floating, always-on-top transparent overlay on the user’s screen. While the user watches any video — YouTube, Netflix, Zoom calls, VLC, local files, anything — SignBridge listens to the audio playing on the computer, converts speech to text in real time, and displays the corresponding sign language gestures through an animated avatar inside the overlay panel.

The user does not need to switch apps, pause their video, or use any other tool. The overlay sits on top of everything, can be dragged to any corner of the screen, resized to any size, and works over fullscreen content.

Core Mission
To make any audio-visual content instantly accessible to deaf-mute individuals through real-time sign language translation — without requiring content creators or streaming platforms to do anything differently.

1.1 The Problem It Solves
Deaf-mute individuals who rely on sign language face a major barrier: most video content — news, movies, educational videos, live streams, video calls — has no sign language interpretation. Subtitles exist but require literacy and are often delayed or inaccurate. Sign language interpreters are expensive and unavailable in real time for most content.

SignBridge solves this by acting as a universal sign language interpreter that works on any content, on any platform, in real time.

1.2 Who It Is For
Deaf-mute individuals who use ISL (Indian Sign Language), ASL, or BSL
Families and caregivers of deaf-mute individuals
Educational institutions serving hearing-impaired students
Anyone learning sign language who wants real-time practice


2. How SignBridge Works
The entire pipeline from audio to sign language runs in under 2 seconds. Here is the complete flow step by step:

2.1 The Complete Pipeline
Stage
What Happens
Stage 1: Audio Source
System audio plays from speakers (YouTube video, Netflix, Zoom call, VLC, etc.)
Stage 2: Audio Capture
SignBridge captures the audio using SoX or the mic package directly from Windows audio drivers
Stage 3: Chunking
Audio is collected in 2-second chunks of raw PCM data (16kHz, 16-bit, mono)
Stage 4: Transcription
Each 2-second chunk is sent to Whisper (Python) which converts speech to text
Stage 5: Dictionary Lookup
Each transcribed word is looked up in the ISL/ASL/BSL dictionary JSON file
Stage 6: Sign Queue
Matched words are added to a sign queue and played one at a time
Stage 7: Display
The corresponding .mp4 clip or avatar animation plays in the overlay with subtitle

2.2 Audio Capture Strategy
SignBridge uses a deliberate design choice: all audio capture happens in the Electron main process using Node.js, NOT in the browser renderer window. This is critical because:

Why Not WebRTC / getUserMedia?
Using getUserMedia with desktop capture in the Electron renderer causes an immediate crash on Windows (exit code -1073741819) due to a GPU/graphics context conflict in Chromium’s WebRTC pipeline. This was the first major bug encountered and required a complete architecture change.

The solution: the renderer sends a simple IPC message (start-capture) to the main process. The main process runs the actual audio recording using SoX or the mic npm package. Audio bytes are piped directly to the Whisper Python process without ever going through the renderer.

2.3 Speech Recognition
SignBridge uses OpenAI’s Whisper model running completely locally on the user’s machine. No internet connection is required for transcription. The model used is ‘small’ which balances speed and accuracy well for real-time use. Key Whisper settings:
Model size: small (good accuracy, fast enough for real-time)
Device: CPU (works on all machines; CUDA optional for GPU acceleration)
VAD filter: enabled (skips silent audio segments automatically)
Language: auto-detect (works with Hindi, English, and other languages)
Beam size: 3 (balanced speed vs accuracy)

2.4 Sign Language Matching
After transcription, words are processed through a pipeline:
Text is lowercased and punctuation is stripped
Each word is looked up in the active dictionary (ISL.json, ASL.json, or BSL.json)
Matched words are added to a sign queue
Unmatched words are shown as text briefly
Signs play sequentially, one at a time, from the queue
A subtitle shows the word below the avatar while the sign plays


3. Technology Stack
SignBridge uses a carefully chosen set of technologies, each picked for a specific reason:

3.1 Core Technologies
Technology
Purpose & Why It Was Chosen
Electron v28
Desktop shell. Allows building Windows/Mac/Linux apps using web technologies. Provides always-on-top transparent windows, system tray, IPC, and file system access.
Node.js
Runtime for the Electron main process. Handles audio capture, file I/O, child process management, and IPC.
Python 3.9+
Runs the Whisper speech recognition model. Python was chosen because faster-whisper only has a Python API.
faster-whisper
Optimized version of OpenAI Whisper. Runs on CPU with int8 quantization for fast inference without a GPU.
SoX v14.4.2
Audio capture tool. Records raw PCM audio from Windows audio devices. Required by node-record-lpcm16.
node-record-lpcm16
npm package that wraps SoX for audio recording in Node.js.
electron-store
Persists user settings (language, opacity, size, speed) between app restarts.
Vanilla JS
No React or jQuery. The renderer is plain HTML/CSS/JS for simplicity and performance.

3.2 Supporting Tools
Tool
Purpose
VB-Cable
Virtual audio loopback driver. Routes system audio so SoX can capture what is playing on speakers.
opencv-python
Used to generate placeholder sign clips. Creates .mp4 files with word text on teal background.
numpy
Required by faster-whisper and opencv for audio/image array processing.
electron-builder
Packages the app into a Windows .exe installer, Mac .dmg, or Linux AppImage.
Git + GitHub
Version control. Repository: github.com/Darshaannn/Signe-Innvento-


4. Complete File Structure
Every file in the project and what it does:

4.1 Root Files
File
Description
main.js
Electron main process. Creates the overlay window, manages the system tray, handles all IPC messages, spawns the Python Whisper process, and runs audio capture via SoX.
preload.js
Electron preload script. Creates a secure bridge (contextBridge) between the main process and renderer. The renderer can ONLY access functions explicitly exposed here.
package.json
Node.js project config. Lists all dependencies, defines npm scripts (start, dev, build), and configures electron-builder for packaging.
whisper_server.py
Python child process. Reads length-prefixed PCM audio chunks from stdin, transcribes using faster-whisper, and writes JSON results to stdout.
generate_placeholder_clips.py
Utility script. Generates placeholder .mp4 sign clips for all words in ISL.json using opencv. Used for testing before real clips are available.
README.md
Setup and usage instructions for developers.
.gitignore
Excludes node_modules, __pycache__, dist, and clips from Git.

4.2 Renderer Folder
File
Description
renderer/overlay.html
The floating overlay UI shell. Contains the avatar area, subtitle element, queue indicator dots, transcript display, settings panel, and control buttons.
renderer/overlay.js
Renderer process logic. Handles sign queue playback, settings UI, dictionary loading, transcription display, and communication with main process via window.signBridge.
renderer/overlay.css
All visual styling. Dark teal glassmorphic design, toggle switches, sliders, queue dot animations, and responsive sizing.

4.3 Dictionaries Folder
File
Description
dictionaries/ISL.json
Indian Sign Language dictionary. Maps 100 common words to their clip file paths. Format: { "hello": "clips/ISL/hello.mp4" }
dictionaries/ASL.json
American Sign Language dictionary. Currently a placeholder — to be filled in Phase 3.
dictionaries/BSL.json
British Sign Language dictionary. Currently a placeholder — to be filled in Phase 3.

4.4 Clips Folder
Folder
Description
clips/ISL/
Contains .mp4 sign clips for ISL. 92 placeholder clips generated by generate_placeholder_clips.py. Real ISL clips from ISLRTC will replace these.
clips/ASL/
Empty. Will contain ASL sign clips in Phase 3.
clips/BSL/
Empty. Will contain BSL sign clips in Phase 3.


5. IPC Architecture (How Parts Talk to Each Other)
Electron separates code into two processes for security: the main process (Node.js, full system access) and the renderer process (Chromium browser, sandboxed). They communicate via IPC (Inter-Process Communication). Here is every IPC channel in SignBridge:

5.1 Renderer to Main (ipcRenderer.send / invoke)
Channel
What It Does
start-capture
Tells main to start SoX audio recording and begin piping to Whisper
stop-capture
Tells main to stop SoX recording cleanly
start-whisper
Tells main to spawn the Python Whisper child process
stop-whisper
Tells main to kill the Python process
audio-chunk (legacy)
Sends raw audio buffer from renderer to main for Whisper (deprecated in favor of main-process capture)
get-settings (invoke)
Requests saved settings from electron-store. Returns settings object.
save-settings (invoke)
Saves updated settings to electron-store. Also updates window opacity and size live.
load-dictionary (invoke)
Requests the JSON dictionary for a given language (ISL/ASL/BSL)
resolve-clip-path (invoke)
Converts a relative clip path to absolute file system path
get-desktop-audio-source (invoke)
Gets the desktop capture source ID (legacy, no longer used for capture)
overlay-hide
Hides the overlay window to system tray
overlay-close
Quits the entire application

5.2 Main to Renderer (webContents.send)
Channel
What It Does
transcription
Sends transcription result { text, segments, language } from Whisper to renderer
whisper-error
Sends error message string when Whisper process crashes
open-settings
Tells renderer to open the settings panel (triggered from tray menu)
capture-status
Sends { active: bool, mode: string, error?: string } when capture state changes


6. Installation & Setup (Step by Step)
Follow these steps in exact order on a Windows 10/11 machine:

6.1 Prerequisites
Node.js v18+
Download from nodejs.org
Install with default settings
Verify: open PowerShell and run: node -v

Python 3.9+
Download from python.org
During install, check “Add Python to PATH”
Verify: py --version

SoX v14.4.2
Download from sourceforge.net/projects/sox
Install to C:\Program Files (x86)\sox-14-4-2
Add to Windows PATH via System Environment Variables
Verify in a new PowerShell window: sox --version

VB-Cable (for system audio capture)
Download from vb-audio.com/Cable
Run installer as Administrator
Restart PC after installation
Open Sound Settings > Recording > set CABLE Output as default recording device

6.2 Project Setup
# Clone or download the project
cd signbridge

# Install Node.js dependencies
npm install

# Install Python dependencies
pip install faster-whisper numpy opencv-python

# Test Whisper works
py whisper_server.py --test
# Should print: [SignBridge] Whisper model ready.

6.3 Generate Placeholder Clips
Since real ISL sign clips require recording, placeholder clips are generated for testing:
py generate_placeholder_clips.py
This creates 92 .mp4 files in clips/ISL/, one for each word in ISL.json. Each clip shows the word as white text on a dark teal background for 2 seconds.

6.4 Running the App
# Normal mode
npm start

# Development mode (with DevTools window)
npm run dev

Important for Windows
If the app crashes with GPU errors on startup, this is a known Windows driver issue. The app already includes flags to disable GPU acceleration (app.disableHardwareAcceleration()). If crashes persist, run: npm start --no-sandbox


7. Current Project Status

Component
Status
Notes
Electron overlay window
Working
Transparent, always-on-top, draggable, resizable
System tray icon
Working
Show/hide/quit from tray right-click menu
Settings panel
Working
Language, opacity, size, speed, subtitles all persist
Whisper Python process
Working
Spawns on start, auto-restarts on crash, JSON stdout
ISL dictionary (100 words)
Working
All 100 words mapped to clip paths
Placeholder clips (92 files)
Working
Generated via opencv, all play correctly
Sign queue player
Working
Sequential playback, subtitles, safety timeouts
Audio capture (SoX)
In Progress
SoX installed but Intel SST driver incompatibility
Audio capture (mic package)
In Progress
Alternative being tested: npm install mic
Real ISL sign clips
Pending
Need to source from ISLRTC or record manually
2D cartoon avatar
Pending
Phase 2 — Canvas-based animated character
ASL dictionary + clips
Pending
Phase 3
BSL dictionary + clips
Pending
Phase 3
VB-Cable system audio
Pending
Phase 3 — capture YouTube/Netflix audio
Windows installer (.exe)
Pending
Phase 4 — electron-builder packaging


8. Bugs Encountered & How They Were Fixed
This section documents every major bug discovered during development and the solution applied:

Bug 1: Renderer Crash on Play Button (Exit Code -1073741819)
Root Cause
Using navigator.mediaDevices.getUserMedia with chromeMediaSource: desktop in the Electron renderer process triggers a GPU/graphics context crash on Windows. The crash code 0xC0000005 is a Windows access violation in the GPU process.
Fix: Completely removed all getUserMedia desktop capture from the renderer. Moved all audio capture to the main process using SoX spawned as a child process. The renderer now only sends IPC messages.

Bug 2: App Closing on window-all-closed Event
Root Cause
The code had e.preventDefault() inside the window-all-closed handler. This event is NOT cancellable in Electron — calling preventDefault() on it throws a silent error and destabilizes the app.
Fix: Removed e.preventDefault(). The app stays alive because we never call app.quit() when the window closes — the tray keeps it running.

Bug 3: setDisplayMediaRequestHandler with audio: loopback
Root Cause
The audio: loopback option in setDisplayMediaRequestHandler is only supported on Windows 11 with specific Electron builds. On Windows 10 or other configurations it crashes the renderer process exactly 3-4 seconds after clicking play.
Fix: Removed setDisplayMediaRequestHandler entirely from main.js. Audio capture now uses SoX directly.

Bug 4: SoX “No Default Audio Device”
Root Cause
SoX cannot find the audio device when launched by Electron because the PATH environment variable inside Electron’s child processes does not include the SoX installation directory.
Fix: Hardcoded the SoX PATH in the spawn call: PATH: process.env.PATH + “;C:\\Program Files (x86)\\sox-14-4-2”. Also tried explicit device name: Microphone Array (Intel® Smart Sound Technology (Intel® SST)).

Bug 5: Buffer.from() Not Available in Renderer
Root Cause
The renderer uses contextIsolation: true which means Node.js globals like Buffer are not available. Calling Buffer.from(int16.buffer) in overlay.js throws a ReferenceError.
Fix: Changed to pass int16.buffer (plain ArrayBuffer) directly instead of wrapping in Buffer.from().

Bug 6: GPU Cache Access Denied on Windows
Root Cause
Electron tries to write GPU shader cache to a protected Windows directory and gets access denied. This causes the entire app to crash with SIGINT.
Fix: Added app.commandLine.appendSwitch(‘disk-cache-dir’, tmpCache) pointing to the OS temp directory. Also added --disable-gpu and --no-sandbox flags.


9. Development Roadmap

Phase 1 — Core Pipeline (COMPLETED)
Electron overlay window with transparent always-on-top frame
Whisper Python process with length-prefixed stdin protocol
ISL dictionary with 100 words
Sign queue player with video clip playback
Settings panel with persistence
System tray with show/hide/quit
Placeholder clip generator (92 clips via opencv)

Phase 2 — Fix Audio Capture (IN PROGRESS)
Resolve Intel SST microphone driver incompatibility with SoX
Test mic npm package as alternative to SoX
Test ffmpeg as alternative audio capture backend
Confirm full end-to-end pipeline: speech → text → sign clip

Phase 3 — 2D Cartoon Avatar
Design simple cartoon character (head, shoulders, arms, hands)
Build Canvas-based avatar engine in renderer/avatar.js
Create keyframe animations for 10 core signs (hello, yes, no, thank you, please, help, water, food, good, bad)
Smooth interpolation between sign animations
Fallback: fingerspelling animation for unknown words
Replace video element with canvas element in overlay.html

Phase 4 — Multi-Language Support
Fill ASL.json with 100 common ASL words
Fill BSL.json with 100 common BSL words
Generate placeholder clips for ASL and BSL
Source real sign clips from ASL University (lifeprint.com) and SignBSL.com
Language switching reloads dictionary and clip set instantly

Phase 5 — System Audio (VB-Cable)
Auto-detect VB-Cable installation on startup
Setup wizard: guides user through SoX and VB-Cable installation
Switch audio source between mic and system audio automatically
Capture YouTube, Netflix, Zoom audio without any browser extension

Phase 6 — Polish & Ship
First-run onboarding wizard
Latency optimization (target under 1.5 second end-to-end delay)
Electron-builder packaging: Windows .exe NSIS installer
Auto-update mechanism
Chrome browser extension version for YouTube/Netflix in browser
Mobile companion app (Flutter) using phone mic


10. Sign Language Resources
Where to get real sign language clips to replace the placeholders:

10.1 ISL (Indian Sign Language)
Source
Details
ISLRTC
islrtc.nic.in — Official Indian Sign Language Research and Training Centre. Free reference videos for all common ISL signs.
CDAC
cdac.in — Centre for Development of Advanced Computing. Has ISL datasets used in research.
IIT Madras
Academic ISL corpus. Contact research department for access.
ISLRTC YouTube
youtube.com/@ISLRTC — Hundreds of free ISL sign demonstration videos.

10.2 ASL (American Sign Language)
Source
Details
ASL University
lifeprint.com — Free ASL lessons and downloadable reference videos by Dr. Bill Vicars.
ASLPRO
aslpro.com — Searchable ASL dictionary with video.
Handspeak
handspeak.com — ASL dictionary with video clips.
SigningSavvy
signingsavvy.com — Subscription-based but high quality.

10.3 BSL (British Sign Language)
Source
Details
SignBSL
signbsl.com — Free searchable BSL dictionary with video.
BSL Zone
bslzone.co.uk — BSL TV channel with educational content.
Spread the Sign
spreadthesign.com — International sign language dictionary covering BSL and many others.

10.4 How to Add Clips
Download the sign video (any format)
Trim to just the sign gesture (2–4 seconds)
Convert to .mp4 if needed: ffmpeg -i input.mov output.mp4
Name it exactly matching the dictionary key: clips/ISL/hello.mp4
The dictionary entry should be: { "hello": "clips/ISL/hello.mp4" }
Restart the app — no code changes needed


11. Key Code Sections Explained

11.1 The Audio Protocol (main.js → whisper_server.py)
Audio is sent from Node.js to Python using a length-prefixed binary protocol over stdin/stdout:
// main.js: send chunk to Whisper
function sendChunkToWhisper(int16Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(int16Buffer.length, 0); // 4-byte length header
  whisperProcess.stdin.write(len);           // send header
  whisperProcess.stdin.write(int16Buffer);   // send audio data
}

# whisper_server.py: receive chunk
header = stream.read(4)                    # read 4-byte length
length = struct.unpack('<I', header)[0]    # parse as uint32 LE
data = stream.read(length)                 # read that many bytes

This protocol is reliable because it is self-framing: the receiver always knows exactly how many bytes to read.

11.2 The contextBridge (preload.js)
The preload script is the security layer between main and renderer. ONLY functions explicitly listed here are available to the renderer:
contextBridge.exposeInMainWorld('signBridge', {
  startCapture: () => ipcRenderer.send('start-capture'),
  stopCapture:  () => ipcRenderer.send('stop-capture'),
  getSettings:  () => ipcRenderer.invoke('get-settings'),
  onTranscription: (cb) => ipcRenderer.on('transcription', (_e, data) => cb(data)),
  // ... more methods
});

11.3 The Sign Queue (overlay.js)
Signs play one at a time from a queue to prevent overlap:
async function playNextSign() {
  if (state.signQueue.length === 0) {
    state.isPlaying = false;
    showPlaceholder(true);
    return;
  }
  state.isPlaying = true;
  const { word, clipRelPath } = state.signQueue.shift();
  signVideo.src = await window.signBridge.resolveClipPath(clipRelPath);
  signVideo.play();
  signVideo.onended = () => playNextSign(); // chain to next
}


12. Troubleshooting Guide

Problem
Solution
App crashes immediately on npm start
Run with --no-sandbox --disable-gpu flags. Check that Node.js v18+ is installed.
App closes after clicking play button
SoX or mic capture is failing. Check terminal for [SoX] error messages. Verify sox --version works in PowerShell.
Audio error: unknown
No default recording device set. Go to Sound Settings > Recording and set your microphone as default.
sox: no default audio device
Intel SST driver incompatibility. Try using the mic npm package instead of SoX.
No sign found (clips not playing)
clips/ISL/ folder is empty. Run: py generate_placeholder_clips.py
Whisper model ready never appears
Python or faster-whisper not installed. Run: pip install faster-whisper numpy
py is not recognized
Python not in PATH. Reinstall Python with Add to PATH checked.
sox is not recognized
SoX not in PATH. Add C:\Program Files (x86)\sox-14-4-2 to System Environment Variables.
App works but no transcription appears
Whisper is loading the model (takes 10-30 seconds on first run). Wait and try speaking again.
Overlay disappears from screen
It moved off-screen. Delete electron-store data: %APPDATA%\signbridge then restart.


13. Next Immediate Steps
In priority order, here is exactly what to do next to move the project forward:

Step 1: Fix Audio Capture (Highest Priority)
The core pipeline works but audio capture is broken due to Intel SST driver issues with SoX. Next: install the mic npm package (npm install mic) and test it as an alternative to SoX. If mic works, the entire pipeline will be confirmed working end-to-end.

Step 2: Source Real ISL Clips
Replace the 92 placeholder clips with real ISL sign videos. Start with the 20 most common words: hello, thank you, yes, no, please, help, water, food, good, bad, sorry, name, what, where, how, need, want, learn, understand, repeat.

Step 3: Build 2D Cartoon Avatar
Replace the video element with a Canvas-based cartoon avatar. Start with a simple stick figure that moves arms to represent signs. Even a basic avatar is better than playing video clips.

Step 4: Set Up VB-Cable for System Audio
Once microphone capture works, set up VB-Cable to capture system audio (YouTube, Netflix, etc.). This is the key feature that makes SignBridge work for any content.

How to Test After Each Fix
Run: npm start
Click the play button ▶ in the overlay
Speak clearly: “hello yes no thank you please”
Watch the overlay — signs should play for matched words
Check terminal for any error messages
If working: the status dot turns green and “Listening…” appears at the bottom


14. GitHub & Project Collaboration

Detail
Value
Repository URL
github.com/Darshaannn/Signe-Innvento-
Branch
main
Language breakdown
JavaScript 55% • CSS 22.6% • HTML 12% • Python 10.4%
License
MIT
Current version
1.0.0
Commits
1 (initial)

To collaborate effectively: push all code changes to GitHub before asking for help. This allows the entire codebase to be reviewed at once rather than file by file.

# After making changes in Antigravity:
git add .
git commit -m "describe what you changed"
git push origin main


15. Summary
SignBridge is a real-time sign language overlay desktop app built with Electron, Python Whisper, SoX, and vanilla JavaScript. It was designed to solve a genuine accessibility problem: deaf-mute individuals who use sign language cannot easily follow audio-visual content without a human interpreter.

The core pipeline — audio capture → speech recognition → dictionary lookup → sign display — is fully built and functional. The main remaining challenge is audio capture compatibility with Intel Smart Sound Technology drivers on Windows 11, which is actively being resolved.

Once audio capture is fixed, the app will have a working end-to-end demo. The next major milestone is the 2D cartoon avatar (Phase 2) which will replace video clips with a proper animated character, making the app usable even without a library of pre-recorded sign clips.

Project Vision
SignBridge should eventually work on any platform, support ISL, ASL, and BSL, have a smooth animated avatar, and be distributable as a one-click installer. It should require zero configuration from the end user — install and it works.

— End of SignBridge Documentation —