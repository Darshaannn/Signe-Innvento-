"""
SignBridge — generate_placeholder_clips.py
Generates animated placeholder MP4 clips for every word in the dictionaries.
Each clip shows a stylized signer character with smooth arm animations.
The arm motion pattern is determined by the word category for visual variety.

Usage:
    .venv\Scripts\python.exe generate_placeholder_clips.py
"""
import json
import os
import math
import numpy as np

try:
    import cv2
except ImportError:
    print("ERROR: opencv-python not found.")
    print("Run: .venv\\Scripts\\pip install opencv-python")
    exit(1)

# ── Output settings ────────────────────────────────────────────────────────────
WIDTH, HEIGHT = 480, 480
FPS = 30
DURATION_SEC = 2
TOTAL_FRAMES = FPS * DURATION_SEC

# ── Color palette (BGR) ────────────────────────────────────────────────────────
BG_TOP    = np.array([30, 20, 15], dtype=np.float32)     # dark warm charcoal
BG_BOTTOM = np.array([15, 10, 35], dtype=np.float32)     # deep navy
SKIN      = (180, 155, 210)   # warm skin tone (BGR)
SHIRT     = (176, 200, 0)     # teal shirt (BGR)
OUTLINE   = (120, 140, 0)
EYE_CLR   = (30, 30, 30)
TEXT_CLR  = (230, 240, 255)
ACCENT    = (176, 200, 0)     # green accent

# ── Word-category → arm animation patterns ────────────────────────────────────
# Each entry: list of keyframes [(left_shoulder_deg, left_elbow_deg, right_shoulder_deg, right_elbow_deg), t_frac]
PATTERNS = {
    "greet":     [(-30,  20,  30, -20, 0.0), (-30,  20,  80, -60, 0.4), (-30,  20,  30, -20, 1.0)],
    "emotion":   [(-20,  10, -20,  10, 0.0), (-60,  40,  60, -40, 0.3), (-20,  10, -20,  10, 1.0)],
    "question":  [(  0,  30,  0,  30, 0.0), ( 40,  50,  40,  50, 0.4), (  0,  30,  0,  30, 1.0)],
    "person":    [(-20,  10,  20, -10, 0.0), (-10,   5,  10,  -5, 0.5), (-20,  10,  20, -10, 1.0)],
    "food":      [( 20,  60, -20, -60, 0.0), ( 40,  80, -40, -80, 0.4), ( 20,  60, -20, -60, 1.0)],
    "place":     [(-10,  10,  10, -10, 0.0), (-40,  20,  40, -20, 0.5), (-10,  10,  10, -10, 1.0)],
    "time":      [(  0,   0,  60, -30, 0.0), (  0,   0, -30,  60, 0.5), (  0,   0,  60, -30, 1.0)],
    "number":    [(  0,   0, -80,  40, 0.0), (  0,   0, -80,  80, 0.3), (  0,   0, -80,  40, 1.0)],
    "health":    [( 60, -30,  60, -30, 0.0), ( 30, -10,  30, -10, 0.4), ( 60, -30,  60, -30, 1.0)],
    "action":    [(-40,  20,  40, -20, 0.0), ( 40, -20, -40,  20, 0.5), (-40,  20,  40, -20, 1.0)],
    "default":   [(-20,  10,  20, -10, 0.0), (-50,  30, -50,  30, 0.4), (-20,  10,  20, -10, 1.0)],
}

# ── Keyword → pattern mapping ─────────────────────────────────────────────────
def get_pattern(word):
    w = word.lower()
    GREET = {"hello","hi","hey","goodbye","bye","please","thank","thanks","sorry","excuse"}
    EMOTION = {"happy","sad","angry","love","hate","fear","scared","worried","excited","tired","bored","confused","good","bad","fine","great","wonderful"}
    QUESTION = {"what","where","when","how","who","why","which","understand"}
    PERSON = {"friend","family","mother","mom","father","dad","sister","brother","child","baby","son","daughter","husband","wife","teacher","student","doctor","nurse","police","man","woman","boy","girl","person","people","deaf","hearing","interpreter"}
    FOOD = {"water","food","eat","eating","drink","drinking","hungry","thirsty","milk","rice","bread","fruit","cooking","cook"}
    PLACE = {"home","house","hospital","school","college","office","market","shop","road","city","village","airport","india","delhi","mumbai","bangalore","chennai","kolkata"}
    TIME = {"time","today","tomorrow","yesterday","morning","afternoon","evening","night","day","week","month","year","now","later","soon","always","never","sometimes","again","before","after"}
    NUMBER = {"one","two","three","four","five","six","seven","eight","nine","ten","twenty","fifty","hundred","thousand","first","second","third"}
    HEALTH = {"pain","hurt","sick","ill","fever","cough","cold","headache","medicine","emergency","call","ambulance"}
    ACTION = {"go","come","wait","stop","help","name","my","your","sign","language","work","run","walk","sit","stand","open","close","give","take","see","look","hear","speak","talk","write","read","learn","study","teach","play","buy","sell","pay","show","find","meet","try","start","finish","clean","bring","send"}
    if w in GREET: return PATTERNS["greet"]
    if w in EMOTION: return PATTERNS["emotion"]
    if w in QUESTION: return PATTERNS["question"]
    if w in PERSON: return PATTERNS["person"]
    if w in FOOD: return PATTERNS["food"]
    if w in PLACE: return PATTERNS["place"]
    if w in TIME: return PATTERNS["time"]
    if w in NUMBER: return PATTERNS["number"]
    if w in HEALTH: return PATTERNS["health"]
    if w in ACTION: return PATTERNS["action"]
    return PATTERNS["default"]

# ── Math helpers ───────────────────────────────────────────────────────────────
def lerp(a, b, t): return a + (b - a) * t
def ease(t): return t * t * (3 - 2 * t)  # smoothstep

def interpolate_pose(pattern, t_frac):
    """Return (ls, le, rs, re) angles at fractional time t_frac."""
    if len(pattern) < 2: return pattern[0][:4]
    # Find surrounding keyframes
    for i in range(len(pattern) - 1):
        k0 = pattern[i];  k1 = pattern[i + 1]
        t0 = k0[4];       t1 = k1[4]
        if t0 <= t_frac <= t1:
            local = ease((t_frac - t0) / (t1 - t0)) if t1 > t0 else 1.0
            return tuple(lerp(k0[j], k1[j], local) for j in range(4))
    return pattern[-1][:4]

# ── Draw background gradient ───────────────────────────────────────────────────
def make_background():
    bg = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    for y in range(HEIGHT):
        t = y / HEIGHT
        color = BG_TOP * (1 - t) + BG_BOTTOM * t
        bg[y, :] = color.astype(np.uint8)
    return bg

# ── Draw body parts ───────────────────────────────────────────────────────────
def draw_rounded_rect(img, x, y, w, h, r, color, thickness=-1):
    cv2.rectangle(img, (x + r, y), (x + w - r, y + h), color, thickness)
    cv2.rectangle(img, (x, y + r), (x + w, y + h - r), color, thickness)
    cv2.circle(img, (x + r, y + r), r, color, thickness)
    cv2.circle(img, (x + w - r, y + r), r, color, thickness)
    cv2.circle(img, (x + r, y + h - r), r, color, thickness)
    cv2.circle(img, (x + w - r, y + h - r), r, color, thickness)

def draw_arm(img, ox, oy, shoulder_deg, elbow_deg, arm_len=55, is_left=True):
    s_rad = math.radians(shoulder_deg + 90)
    e_rad = s_rad + math.radians(elbow_deg)
    ex = int(ox + math.cos(s_rad) * arm_len)
    ey = int(oy + math.sin(s_rad) * arm_len)
    hx = int(ex + math.cos(e_rad) * arm_len)
    hy = int(ey + math.sin(e_rad) * arm_len)
    # Upper arm (shirt color)
    cv2.line(img, (ox, oy), (ex, ey), SHIRT, 14, cv2.LINE_AA)
    # Lower arm (skin)
    cv2.line(img, (ex, ey), (hx, hy), SKIN, 11, cv2.LINE_AA)
    # Hand
    cv2.circle(img, (hx, hy), 10, SKIN, -1, cv2.LINE_AA)
    cv2.circle(img, (hx, hy), 10, OUTLINE, 1, cv2.LINE_AA)

def draw_signer(img, ls, le, rs, re):
    cx = WIDTH // 2
    head_y = int(HEIGHT * 0.28)
    torso_top = head_y + 38
    torso_h = 90
    shoulder_y = torso_top + 20
    spread = 42

    # Torso
    draw_rounded_rect(img, cx - 35, torso_top, 70, torso_h, 18, SHIRT)
    draw_rounded_rect(img, cx - 35, torso_top, 70, torso_h, 18, OUTLINE, 2)

    # Arms (draw before head so head overlaps)
    draw_arm(img, cx - spread, shoulder_y, ls, le, is_left=True)
    draw_arm(img, cx + spread, shoulder_y, rs, re, is_left=False)

    # Head
    cv2.circle(img, (cx, head_y), 34, SKIN, -1, cv2.LINE_AA)
    cv2.circle(img, (cx, head_y), 34, OUTLINE, 2, cv2.LINE_AA)

    # Eyes
    cv2.circle(img, (cx - 11, head_y - 7), 5, EYE_CLR, -1, cv2.LINE_AA)
    cv2.circle(img, (cx + 11, head_y - 7), 5, EYE_CLR, -1, cv2.LINE_AA)
    cv2.circle(img, (cx - 9, head_y - 8), 2, (255, 255, 255), -1)
    cv2.circle(img, (cx + 13, head_y - 8), 2, (255, 255, 255), -1)

    # Smile
    pts = np.array([[cx - 11, head_y + 8], [cx, head_y + 16], [cx + 11, head_y + 8]], dtype=np.int32)
    cv2.polylines(img, [pts.reshape(-1, 1, 2)], False, EYE_CLR, 2, cv2.LINE_AA)

def draw_text(img, word, frame_idx):
    label = word.upper().replace("_", " ")
    
    # Word label panel at bottom
    panel_h = 60
    panel_y = HEIGHT - panel_h
    overlay = img.copy()
    cv2.rectangle(overlay, (0, panel_y), (WIDTH, HEIGHT), (10, 8, 20), -1)
    cv2.addWeighted(overlay, 0.7, img, 0.3, 0, img)

    # Accent line
    pulse = int(3 + 2 * abs(math.sin(frame_idx * 0.15)))
    cv2.line(img, (0, panel_y), (WIDTH, panel_y), ACCENT, pulse)

    # Word text
    font_scale = min(1.4, 8.0 / max(len(label), 1))
    font_scale = max(0.6, font_scale)
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 2)
    tx = (WIDTH - tw) // 2
    ty = panel_y + (panel_h + th) // 2 - 4

    # Shadow
    cv2.putText(img, label, (tx + 2, ty + 2), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(img, label, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, font_scale, TEXT_CLR, 2, cv2.LINE_AA)

    # "ISL" badge in top-right corner
    badge = "SIGN"
    cv2.putText(img, badge, (WIDTH - 65, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.55, ACCENT, 2, cv2.LINE_AA)

# ── Generate one clip ─────────────────────────────────────────────────────────
BG_BASE = make_background()

def generate_clip(word, filepath):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    pattern = get_pattern(word)
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(filepath, fourcc, FPS, (WIDTH, HEIGHT))
    
    for i in range(TOTAL_FRAMES):
        t = i / (TOTAL_FRAMES - 1)
        frame = BG_BASE.copy()
        ls, le, rs, re = interpolate_pose(pattern, t)
        draw_signer(frame, ls, le, rs, re)
        draw_text(frame, word, i)
        out.write(frame)
    
    out.release()

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    total_generated = 0
    total_skipped = 0
    
    for lang in ["ISL", "ASL", "BSL"]:
        dict_path = os.path.join("dictionaries", f"{lang}.json")
        if not os.path.exists(dict_path):
            print(f"Skipping {lang}: dictionary not found.")
            continue

        with open(dict_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # Collect unique clip paths (skip null values)
        unique_clips = {}
        for key, value in data.items():
            if key == "_meta" or value is None:
                continue
            if value not in unique_clips:
                basename = os.path.basename(value)
                word_label = os.path.splitext(basename)[0].replace("_", " ")
                unique_clips[value] = word_label

        print(f"\n[{lang}] Found {len(unique_clips)} unique clips to generate/verify...")
        lang_count = 0

        for filepath, word_label in unique_clips.items():
            if os.path.exists(filepath) and os.path.getsize(filepath) > 10_000:
                # Check if it's the old-style tiny file (< 200KB = likely old placeholder)
                if os.path.getsize(filepath) > 200_000:
                    total_skipped += 1
                    continue
            
            generate_clip(word_label, filepath)
            lang_count += 1
            total_generated += 1
            print(f"  OK [{lang_count}/{len(unique_clips)}] {filepath}")

        print(f"[{lang}] Done — {lang_count} clips generated.")

    print(f"\n{'='*50}")
    print(f"Total generated: {total_generated}  |  Skipped (existing): {total_skipped}")
    print(f"{'='*50}")
