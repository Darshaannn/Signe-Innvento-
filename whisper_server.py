#!/usr/bin/env python3
"""
SignBridge — whisper_server.py
Reads length-prefixed 16-bit PCM audio chunks from stdin,
transcribes them with faster-whisper, and writes JSON results to stdout.

Protocol (stdin):
  Each audio chunk is prefixed with a 4-byte little-endian uint32
  indicating the number of bytes that follow (raw int16 PCM, 16 kHz mono).

Protocol (stdout):
  One JSON object per line:
    { "text": "hello world", "segments": [...], "language": "en" }

Run standalone for testing:
  python whisper_server.py --test
"""

import sys
import os
import json
import struct
import numpy as np
import argparse
import logging

# ── Suppress faster-whisper / ctranslate2 noisy logs ────────────────────────
logging.basicConfig(level=logging.ERROR)
os.environ.setdefault("CT2_VERBOSE", "0")

try:
    from faster_whisper import WhisperModel
except ImportError:
    sys.stderr.write(
        "[SignBridge] faster-whisper not found. Install with:\n"
        "  pip install faster-whisper\n"
    )
    sys.exit(1)

# ── Constants ─────────────────────────────────────────────────────────────────
SAMPLE_RATE  = 16_000       # Hz — must match renderer audio capture
MODEL_SIZE   = "tiny"       # "tiny"=fastest, "base"=balanced, "small"=accurate
DEVICE       = "cpu"        # "cpu" | "cuda" — change to "cuda" if GPU available
COMPUTE      = "int8"       # "int8" is fastest on CPU; use "float16" for GPU
CHUNK_SECS   = 1            # seconds of audio per transcription (lower = faster)


def load_model():
    sys.stderr.write(f"[SignBridge] Loading Whisper model '{MODEL_SIZE}' on {DEVICE}…\n")
    model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE)
    sys.stderr.write("[SignBridge] Whisper model ready.\n")
    return model


def read_chunk(stream) -> bytes | None:
    """
    Read one length-prefixed chunk from stream.
    Returns raw bytes or None on EOF.
    """
    header = stream.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("<I", header)
    if length == 0:
        return b""
    data = b""
    remaining = length
    while remaining > 0:
        chunk = stream.read(remaining)
        if not chunk:
            return None
        data += chunk
        remaining -= len(chunk)
    return data


def pcm_bytes_to_float32(raw: bytes) -> np.ndarray:
    """Convert raw int16 little-endian bytes to float32 in [-1, 1]."""
    audio_int16 = np.frombuffer(raw, dtype=np.int16)
    return audio_int16.astype(np.float32) / 32768.0


def transcribe_chunk(model: WhisperModel, audio: np.ndarray) -> dict:
    """Run Whisper on a float32 audio array, return result dict."""
    segments, info = model.transcribe(
        audio,
        language="en",          # force English — avoids language detection overhead
        beam_size=1,            # greedy decoding — fastest, slightly less accurate
        best_of=1,              # no candidates sampling needed
        temperature=0,          # deterministic, no temperature sampling
        vad_filter=True,        # skip silent regions
        condition_on_previous_text=False,  # no context carry-over = faster
        vad_parameters={
            "min_silence_duration_ms": 200,  # shorter silence = more responsive
            "speech_pad_ms": 100,            # less padding = less delay
            "threshold": 0.4,               # lower threshold = more sensitive
        },
    )

    text_parts = []
    seg_list   = []
    for seg in segments:
        text_parts.append(seg.text.strip())
        seg_list.append({
            "start": round(seg.start, 2),
            "end":   round(seg.end, 2),
            "text":  seg.text.strip(),
        })

    return {
        "text":     " ".join(text_parts).strip(),
        "segments": seg_list,
        "language": info.language,
        "probability": round(info.language_probability, 3),
    }


import threading
import queue

try:
    import sounddevice as sd
except ImportError:
    sys.stderr.write("[SignBridge] sounddevice not found. Run: pip install sounddevice\n")
    sys.exit(1)

is_capturing = False
capture_mode = "mic"

def find_system_audio_device():
    try:
        devices = sd.query_devices()
        for i, dev in enumerate(devices):
            name = dev.get('name', '').lower()
            channels = dev.get('max_input_channels', 0)
            if channels > 0 and ('cable output' in name or 'stereo mix' in name):
                return i
    except Exception as e:
        sys.stderr.write(f"[SignBridge] Error querying devices: {e}\n")
    return None

def input_thread():
    """Read commands from stdin. Keeps running; ignores stdin close gracefully."""
    global is_capturing, capture_mode
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                # stdin closed - wait and try again (Electron may reconnect)
                import time
                time.sleep(0.5)
                continue
            cmd = line.strip()
            if not cmd:
                continue
            if cmd == "START" or cmd == "START_MIC":
                capture_mode = "mic"
                is_capturing = True
                sys.stderr.write("[SignBridge] Audio capture START (Mic)\n")
                sys.stderr.flush()
            elif cmd == "START_SYSTEM":
                capture_mode = "system"
                is_capturing = True
                sys.stderr.write("[SignBridge] Audio capture START (System)\n")
                sys.stderr.flush()
            elif cmd == "STOP":
                is_capturing = False
                sys.stderr.write("[SignBridge] Audio capture STOP\n")
                sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[SignBridge] input_thread error: {e}\n")
            sys.stderr.flush()
            import time
            time.sleep(0.1)

def run_server():
    model = load_model()
    t = threading.Thread(target=input_thread, daemon=True)
    t.start()

    sys.stderr.write("[SignBridge] Whisper server listening on stdin for commands…\n")
    sys.stderr.flush()
    
    q = queue.Queue()
    def audio_callback(indata, frames, time, status):
        if is_capturing:  # Only queue audio when actually capturing
            q.put(indata.copy())

    current_stream = None

    accumulated = np.zeros((0, 1), dtype=np.float32)

    while True:
        global is_capturing, capture_mode
        if is_capturing:
            if current_stream is None:
                device_id = None
                if capture_mode == "system":
                    device_id = find_system_audio_device()
                    if device_id is None:
                        sys.stderr.write("[SignBridge] System audio device not found, falling back to default mic.\n")
                
                try:
                    sys.stderr.write(f"[SignBridge] Opening {capture_mode} stream (samplerate={SAMPLE_RATE}, device={device_id})…\n")
                    current_stream = sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype='float32', callback=audio_callback, device=device_id)
                    current_stream.start()
                    sys.stderr.write(f"[SignBridge] {capture_mode.capitalize()} stream active.\n")
                except Exception as e:
                    sys.stderr.write(f"[SignBridge] CRITICAL: Failed to open {capture_mode} stream: {e}\n")
                    is_capturing = False
                    continue
        else:
            if current_stream is not None:
                current_stream.stop()
                current_stream.close()
                current_stream = None
                accumulated = np.zeros((0, 1), dtype=np.float32)
                # clear pending queue
                while not q.empty():
                    q.get()
        
        try:
            chunk = q.get(timeout=0.2)
        except queue.Empty:
            continue
            
        accumulated = np.vstack((accumulated, chunk))

        # Emit volume/level for UI feedback (throttled)
        import time
        if not hasattr(run_server, 'last_vol_time'):
            run_server.last_vol_time = 0
            
        now = time.time()
        if now - run_server.last_vol_time > 0.1: # 100ms throttle
            try:
                level = np.abs(chunk).mean()
                ui_level = min(1.0, level * 20) 
                if ui_level > 0.005:
                    sys.stdout.write(json.dumps({"type": "volume", "value": round(float(ui_level), 3)}) + "\n")
                    sys.stdout.flush()
                    run_server.last_vol_time = now
            except:
                pass

            
        if len(accumulated) >= SAMPLE_RATE * CHUNK_SECS:

            audio_chunk = accumulated[:SAMPLE_RATE * CHUNK_SECS, 0]
            accumulated = accumulated[SAMPLE_RATE * CHUNK_SECS:]
            
            try:
                result = transcribe_chunk(model, audio_chunk)
                if result["text"]:
                    line = json.dumps(result, ensure_ascii=False)
                    sys.stdout.write(line + "\n")
                    sys.stdout.flush()
            except Exception as e:
                sys.stderr.write(f"[SignBridge] Transcription error: {e}\n")


def run_test():
    """Smoke-test: generate 3s of silence and transcribe it."""
    sys.stderr.write("[SignBridge] Running self-test…\n")
    model = load_model()
    silence = np.zeros(SAMPLE_RATE * 3, dtype=np.float32)
    result = transcribe_chunk(model, silence)
    sys.stderr.write(f"[SignBridge] Test result: {result}\n")
    sys.stderr.write("[SignBridge] Test passed.\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SignBridge Whisper Server")
    parser.add_argument(
        "--test", action="store_true",
        help="Run a quick self-test then exit"
    )
    parser.add_argument(
        "--model", default=MODEL_SIZE,
        help=f"Whisper model size (default: {MODEL_SIZE})"
    )
    args = parser.parse_args()

    if args.model:
        MODEL_SIZE = args.model  # type: ignore[assignment]

    if args.test:
        run_test()
    else:
        run_server()
