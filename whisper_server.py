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
SAMPLE_RATE = 16_000        # Hz — must match renderer audio capture
MODEL_SIZE  = "small"       # "tiny" | "base" | "small" | "medium" | "large-v3"
DEVICE      = "cpu"         # "cpu" | "cuda" — change to "cuda" if GPU available
COMPUTE     = "int8"        # "int8" is fastest on CPU; use "float16" for GPU


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
        language=None,          # auto-detect
        beam_size=3,
        vad_filter=True,        # skip silent regions
        vad_parameters={
            "min_silence_duration_ms": 300,
            "speech_pad_ms": 200,
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


def run_server():
    model = load_model()
    stdin  = sys.stdin.buffer
    stdout = sys.stdout

    sys.stderr.write("[SignBridge] Whisper server listening on stdin…\n")

    while True:
        try:
            raw = read_chunk(stdin)
        except Exception as e:
            sys.stderr.write(f"[SignBridge] stdin read error: {e}\n")
            break

        if raw is None:
            # EOF — parent process closed stdin, exit cleanly
            sys.stderr.write("[SignBridge] stdin closed. Exiting.\n")
            break

        if len(raw) < 320:
            # Too short to be meaningful (< 10ms of audio) — skip
            continue

        audio = pcm_bytes_to_float32(raw)

        try:
            result = transcribe_chunk(model, audio)
        except Exception as e:
            sys.stderr.write(f"[SignBridge] Transcription error: {e}\n")
            continue

        if result["text"]:
            line = json.dumps(result, ensure_ascii=False)
            stdout.write(line + "\n")
            stdout.flush()


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
