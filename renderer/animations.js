/**
 * SignBridge — animations.js (Full Avatar Version)
 * Dictionary of all sign language poses and keyframes.
 * Defines the target joint angles (in radians) and finger states for each sign.
 */

// Common hand shapes (curl: 0=open, 1=fist)
const HAND = {
  FLAT: { spread: 0.1, curl: 0.0 },
  FIST: { spread: 0.0, curl: 0.9 },
  POINT: { spread: 0.0, curl: 0.9, indexExtended: true },
  PEACE: { spread: 0.3, curl: 0.9, indexExtended: true, middleExtended: true },
  CUP: { spread: 0.1, curl: 0.4 },
  CLAW: { spread: 0.6, curl: 0.5 },
  OK: { spread: 0.5, curl: 0.0, thumbIndexTouch: true },
  THUMB: { spread: 0.0, curl: 0.9, thumbExtended: true },
  FIVE: { spread: 0.8, curl: 0.0 },
};

const POSES = {
  // ── IDLE STATE ─────────────────────────────────────────────────────────────
  idle: {
    duration: 600,
    face: "neutral",
    joints: {
      l_shoulder: { angle: 0.2 },
      l_elbow: { angle: 0.1 },
      l_wrist: { angle: 0.0 },
      l_fingers: HAND.FLAT,
      r_shoulder: { angle: -0.2 },
      r_elbow: { angle: -0.1 },
      r_wrist: { angle: 0.0 },
      r_fingers: HAND.FLAT,
    }
  },

  // ── GREETINGS ──────────────────────────────────────────────────────────────
  hello: {
    duration: 400,
    holdTime: 800,
    face: "happy",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Right hand raised to head height, open palm
      r_shoulder: { angle: -1.6 },
      r_elbow: { angle: -0.4 },
      r_wrist: { angle: 0.2 },
      r_fingers: HAND.FIVE,
    },
    keyframes: [
      { t: 0.3, r_wrist: { angle: -0.2 } }, // wave left
      { t: 0.6, r_wrist: { angle: 0.4 } }, // wave right
      { t: 0.9, r_wrist: { angle: -0.1 } }, // wave left
    ]
  },
  goodbye: {
    duration: 400,
    holdTime: 900,
    face: "happy",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      r_shoulder: { angle: -1.4 }, r_elbow: { angle: -0.4 }, r_wrist: { angle: 0.0 }, r_fingers: HAND.FLAT,
    },
    keyframes: [
      { t: 0.0, r_fingers: HAND.FLAT },
      { t: 0.3, r_fingers: { spread: 0, curl: 0.6 } },
      { t: 0.6, r_fingers: HAND.FLAT },
      { t: 0.9, r_fingers: { spread: 0, curl: 0.6 } },
    ]
  },
  please: {
    duration: 400,
    holdTime: 900,
    face: "neutral",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Flat right hand on chest
      r_shoulder: { angle: -0.8 },
      r_elbow: { angle: -1.8 },
      r_wrist: { angle: 0.0 },
      r_fingers: HAND.FLAT,
    },
    keyframes: [
      { t: 0.0, r_shoulder: { angle: -0.8 }, r_elbow: { angle: -1.8 } }, // center
      { t: 0.5, r_shoulder: { angle: -0.6 }, r_elbow: { angle: -1.6 } }, // circle up/right
      { t: 1.0, r_shoulder: { angle: -0.8 }, r_elbow: { angle: -1.8 } }, // return
    ]
  },
  thank_you: {
    duration: 300,
    holdTime: 700,
    face: "happy",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Hand starts at chin
      r_shoulder: { angle: -1.2 }, r_elbow: { angle: -1.8 }, r_wrist: { angle: -0.2 }, r_fingers: HAND.FLAT,
    },
    keyframes: [
      { t: 0.5, r_shoulder: { angle: -0.8 }, r_elbow: { angle: -0.8 }, r_wrist: { angle: 0.2 } }, // move forward/down
    ]
  },
  sorry: {
    duration: 400,
    holdTime: 900,
    face: "sad",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Fist on chest
      r_shoulder: { angle: -0.8 }, r_elbow: { angle: -1.8 }, r_wrist: { angle: 0.0 }, r_fingers: HAND.FIST,
    },
    keyframes: [
      { t: 0.0, r_shoulder: { angle: -0.8 }, r_elbow: { angle: -1.8 } },
      { t: 0.5, r_shoulder: { angle: -0.6 }, r_elbow: { angle: -1.6 } },
      { t: 1.0, r_shoulder: { angle: -0.8 }, r_elbow: { angle: -1.8 } },
    ]
  },

  // ── CORE RESPONSES ─────────────────────────────────────────────────────────
  yes: {
    duration: 300,
    holdTime: 900,
    face: "happy",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Fist raised, nodding
      r_shoulder: { angle: -0.8 }, r_elbow: { angle: -1.2 }, r_wrist: { angle: 0.0 }, r_fingers: HAND.FIST,
    },
    keyframes: [
      { t: 0.2, r_wrist: { angle: -0.5 } }, // nod down
      { t: 0.5, r_wrist: { angle: 0.2 } }, // back up
      { t: 0.8, r_wrist: { angle: -0.5 } }, // nod down
    ]
  },
  no: {
    duration: 300,
    holdTime: 900,
    face: "sad", // concerned/stern
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Pointing index, wagging side to side
      r_shoulder: { angle: -1.0 }, r_elbow: { angle: -1.0 }, r_wrist: { angle: 0.0 }, r_fingers: HAND.POINT,
    },
    keyframes: [
      { t: 0.2, r_shoulder: { angle: -1.2 } }, // sweep right
      { t: 0.5, r_shoulder: { angle: -0.8 } }, // sweep left
      { t: 0.8, r_shoulder: { angle: -1.2 } }, // sweep right
    ]
  },
  help: {
    duration: 400,
    holdTime: 800,
    face: "neutral",
    joints: {
      // Left hand flat, right fist resting on it (thumb up)
      l_shoulder: { angle: 0.5 }, l_elbow: { angle: 1.4 }, l_wrist: { angle: -0.5 }, l_fingers: HAND.FLAT,
      r_shoulder: { angle: -0.5 }, r_elbow: { angle: -1.4 }, r_wrist: { angle: 0.5 }, r_fingers: HAND.THUMB,
    },
    keyframes: [
      // Both hands lift up together
      {
        t: 0.5,
        l_shoulder: { angle: 0.8 }, l_elbow: { angle: 1.0 },
        r_shoulder: { angle: -0.8 }, r_elbow: { angle: -1.0 }
      }
    ]
  },
  stop: {
    duration: 300,
    holdTime: 800,
    face: "sad", // severe
    joints: {
      // Hand chops forward
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      r_shoulder: { angle: -1.4 }, r_elbow: { angle: -0.5 }, r_wrist: { angle: -0.5 }, r_fingers: HAND.FLAT,
    },
    keyframes: [
      { t: 0.3, r_shoulder: { angle: -1.0 }, r_elbow: { angle: -1.0 }, r_wrist: { angle: 0.0 } } // chop down
    ]
  },
  more: {
    duration: 400,
    holdTime: 800,
    face: "neutral",
    joints: {
      // Both hands pinched, touching at fingertips
      l_shoulder: { angle: 1.0 }, l_elbow: { angle: 1.5 }, l_wrist: { angle: -0.5 }, l_fingers: HAND.OK,
      r_shoulder: { angle: -1.0 }, r_elbow: { angle: -1.5 }, r_wrist: { angle: 0.5 }, r_fingers: HAND.OK,
    },
    keyframes: [
      // Pull apart then touch twice
      { t: 0.3, l_shoulder: { angle: 0.8 }, r_shoulder: { angle: -0.8 } }, // apart
      { t: 0.6, l_shoulder: { angle: 1.0 }, r_shoulder: { angle: -1.0 } }, // touch
      { t: 0.9, l_shoulder: { angle: 0.8 }, r_shoulder: { angle: -0.8 } }, // apart
    ]
  },

  // ── DESCRIPTORS ────────────────────────────────────────────────────────────
  good: {
    duration: 300,
    holdTime: 700,
    face: "happy",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Flat hand from chin moving outward
      r_shoulder: { angle: -1.2 }, r_elbow: { angle: -1.8 }, r_wrist: { angle: -0.2 }, r_fingers: HAND.FLAT,
    },
    keyframes: [
      { t: 0.5, r_shoulder: { angle: -0.8 }, r_elbow: { angle: -0.8 }, r_wrist: { angle: 0.2 } }, // move outward
    ]
  },
  bad: {
    duration: 300,
    holdTime: 700,
    face: "sad",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Flat hand at chin, moves down and flips
      r_shoulder: { angle: -1.2 }, r_elbow: { angle: -1.8 }, r_wrist: { angle: -0.2 }, r_fingers: HAND.FLAT,
    },
    keyframes: [
      { t: 0.5, r_shoulder: { angle: -0.5 }, r_elbow: { angle: -0.5 }, r_wrist: { angle: 2.0 } }, // flip down
    ]
  },

  // ── ACTIONS / VERBS ────────────────────────────────────────────────────────
  eat: {
    duration: 300,
    holdTime: 800,
    face: "neutral",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Pinch hand to mouth
      r_shoulder: { angle: -1.0 }, r_elbow: { angle: -1.8 }, r_wrist: { angle: 0.0 }, r_fingers: HAND.OK,
    },
    keyframes: [
      { t: 0.3, r_elbow: { angle: -1.5 } }, // away
      { t: 0.6, r_elbow: { angle: -1.8 } }, // to mouth
      { t: 0.9, r_elbow: { angle: -1.5 } }, // away
    ]
  },
  food: {
    duration: 300,
    holdTime: 800,
    face: "neutral",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      r_shoulder: { angle: -1.0 }, r_elbow: { angle: -1.8 }, r_wrist: { angle: 0.0 }, r_fingers: HAND.OK,
    },
    keyframes: [
      { t: 0.3, r_elbow: { angle: -1.5 } },
      { t: 0.6, r_elbow: { angle: -1.8 } },
      { t: 0.9, r_elbow: { angle: -1.5 } },
    ]
  },
  water: {
    duration: 350,
    holdTime: 800,
    face: "neutral",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // W handshape (3 fingers) tapping chin
      r_shoulder: { angle: -1.1 }, r_elbow: { angle: -1.7 }, r_wrist: { angle: -0.2 },
      r_fingers: { spread: 0.4, curl: 0.0, thumbIndexTouch: false, pinkyCurled: true },
    },
    keyframes: [
      { t: 0.3, r_wrist: { angle: 0.2 } }, // tap
      { t: 0.6, r_wrist: { angle: -0.2 } },
      { t: 0.9, r_wrist: { angle: 0.2 } }, // tap
    ]
  },
  learn: {
    duration: 400,
    holdTime: 800,
    face: "neutral",
    joints: {
      // Left palm flat, up. Right hand pulls from left palm to forehead
      l_shoulder: { angle: 0.8 }, l_elbow: { angle: 1.2 }, l_wrist: { angle: -0.4 }, l_fingers: HAND.FLAT,
      r_shoulder: { angle: -0.4 }, r_elbow: { angle: -1.2 }, r_wrist: { angle: 0.4 }, r_fingers: HAND.FLAT,
    },
    keyframes: [
      // Right hand moves to forehead and closes to pinch
      { t: 0.6, r_shoulder: { angle: -1.4 }, r_elbow: { angle: -1.8 }, r_wrist: { angle: 0.0 }, r_fingers: HAND.OK }
    ]
  },
  know: {
    duration: 300,
    holdTime: 700,
    face: "happy",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Flat hand taps side of forehead
      r_shoulder: { angle: -1.4 }, r_elbow: { angle: -1.8 }, r_wrist: { angle: 0.2 }, r_fingers: HAND.FLAT,
    },
    keyframes: [
      { t: 0.3, r_wrist: { angle: -0.2 } }, // tap
      { t: 0.6, r_wrist: { angle: 0.2 } },
    ]
  },

  // ── PRONOUNS ───────────────────────────────────────────────────────────────
  i: {
    duration: 300,
    holdTime: 600,
    face: "neutral",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Point to chest
      r_shoulder: { angle: -0.8 }, r_elbow: { angle: -1.6 }, r_wrist: { angle: 0.8 }, r_fingers: HAND.POINT,
    },
    keyframes: [
      { t: 0.5, r_elbow: { angle: -1.8 } } // tap chest
    ]
  },
  you: {
    duration: 300,
    holdTime: 600,
    face: "neutral",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Point forward
      r_shoulder: { angle: -0.8 }, r_elbow: { angle: -0.5 }, r_wrist: { angle: -0.2 }, r_fingers: HAND.POINT,
    }
  },
  name: {
    duration: 400,
    holdTime: 800,
    face: "neutral",
    joints: {
      // Both H-hands (index+middle), right taps crosswise on left
      l_shoulder: { angle: 0.6 }, l_elbow: { angle: 1.0 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.PEACE,
      r_shoulder: { angle: -0.6 }, r_elbow: { angle: -1.0 }, r_wrist: { angle: 0.0 }, r_fingers: HAND.PEACE,
    },
    keyframes: [
      { t: 0.3, r_elbow: { angle: -1.3 } }, // lift up
      { t: 0.6, r_elbow: { angle: -1.0 } }, // tap down
      { t: 0.9, r_elbow: { angle: -1.3 } }, // lift up
    ]
  },

  // ── QUESTIONS ──────────────────────────────────────────────────────────────
  what: {
    duration: 400,
    holdTime: 900,
    face: "neutral", // furrowed brow conceptually
    joints: {
      // Both hands open, palms up, moving slightly side to side
      l_shoulder: { angle: 0.8 }, l_elbow: { angle: 1.2 }, l_wrist: { angle: 0.4 }, l_fingers: HAND.FIVE,
      r_shoulder: { angle: -0.8 }, r_elbow: { angle: -1.2 }, r_wrist: { angle: -0.4 }, r_fingers: HAND.FIVE,
    },
    keyframes: [
      { t: 0.3, l_shoulder: { angle: 0.6 }, r_shoulder: { angle: -0.6 } }, // sweep inward
      { t: 0.6, l_shoulder: { angle: 1.0 }, r_shoulder: { angle: -1.0 } }, // sweep outward
      { t: 0.9, l_shoulder: { angle: 0.6 }, r_shoulder: { angle: -0.6 } }, // sweep inward
    ]
  },
  where: {
    duration: 300,
    holdTime: 800,
    face: "neutral", // furrowed brow
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Index finger raised, wagging side to side
      r_shoulder: { angle: -1.2 }, r_elbow: { angle: -0.8 }, r_wrist: { angle: 0.0 }, r_fingers: HAND.POINT,
    },
    keyframes: [
      { t: 0.2, r_wrist: { angle: -0.6 } },
      { t: 0.5, r_wrist: { angle: 0.4 } },
      { t: 0.8, r_wrist: { angle: -0.6 } },
    ]
  },
  who: {
    duration: 350,
    holdTime: 800,
    face: "neutral",
    joints: {
      l_shoulder: { angle: 0.2 }, l_elbow: { angle: 0.1 }, l_wrist: { angle: 0.0 }, l_fingers: HAND.FLAT,
      // Thumb on chin, index finger wiggles
      r_shoulder: { angle: -1.1 }, r_elbow: { angle: -1.8 }, r_wrist: { angle: -0.2 }, r_fingers: HAND.POINT,
    },
    keyframes: [
      { t: 0.3, r_fingers: { spread: 0.0, curl: 0.9, indexExtended: false } }, // bend index
      { t: 0.6, r_fingers: HAND.POINT }, // straighten index
      { t: 0.9, r_fingers: { spread: 0.0, curl: 0.9, indexExtended: false } },
    ]
  },
  how: {
    duration: 400,
    holdTime: 800,
    face: "neutral",
    joints: {
      // Both hands curled, backs touching, then roll outward
      l_shoulder: { angle: 0.8 }, l_elbow: { angle: 1.4 }, l_wrist: { angle: 0.5 }, l_fingers: HAND.CUP,
      r_shoulder: { angle: -0.8 }, r_elbow: { angle: -1.4 }, r_wrist: { angle: -0.5 }, r_fingers: HAND.CUP,
    },
    keyframes: [
      {
        t: 0.6,
        l_wrist: { angle: -0.5 }, l_fingers: HAND.FIVE,
        r_wrist: { angle: 0.5 }, r_fingers: HAND.FIVE
      } // roll open
    ]
  },
};

window.SIGN_POSES = POSES;
