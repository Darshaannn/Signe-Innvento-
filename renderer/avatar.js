/**
 * SignBridge — renderer/avatar.js (Full Avatar Version)
 * Canvas 2D engine for a cartoon sign language interpreter using Forward Kinematics.
 */
"use strict";

const PALETTE = {
  skin: "#E8C49A",
  shadow: "#C49A6C",
  shirt: "#0D2B2B",
  outline: "#1A1A2E",
  hair: "#2E1A1A",
  glow: "rgba(0,229,176,0.2)",
};

class AvatarRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.W = canvas.width;
    this.H = canvas.height;

    // State
    this.time = 0;
    this.speed = 1.0;
    this.currentSign = null;
    this.signProgress = 0;      // 0 to 1 for the transition
    this.signHoldTime = 0;      // ms remaining in peak hold
    this.label = "";
    this.isTransitioning = false;

    // Blink state
    this.lastBlink = 0;
    this.blinkStart = 0;
    this.blinkInterval = 3000;

    // Body metrics (scaled for a 300x280 canvas, will be auto-centered)
    this.cx = this.W / 2;
    this.cy = 80;               // Base Y for the neck center

    // Initialize skeleton
    this.basePose = window.SIGN_POSES?.idle || { duration: 0, joints: {} };
    this.currentJoints = JSON.parse(JSON.stringify(this.basePose.joints));
    this.targetJoints = null;
    this.startJoints = null;

    // Bone lengths
    this.bones = {
      shoulderW: 90,  // Total shoulder width
      armUpper: 50,
      armLower: 45,
      palm: 30,
    };
  }

  start() {
    this.lastFrameTime = performance.now();
    const loop = (now) => {
      const dt = now - this.lastFrameTime;
      this.lastFrameTime = now;
      this.update(dt * this.speed);
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  setSpeed(s) { this.speed = s || 1.0; }

  // ─── Animation Logic ───────────────────────────────────────────────────────

  transitionTo(signName, transitionDuration = 400) {
    let key = signName.toLowerCase().replace(/\s+/g, "_");
    if (key === "thank" || key === "thanks") key = "thank_you";

    // Fallback to spelling or generic if not found (for now just idle)
    const signData = window.SIGN_POSES[key] || window.SIGN_POSES.idle;

    this.currentSign = signData;
    this.label = signName;
    this.startJoints = JSON.parse(JSON.stringify(this.currentJoints));
    this.targetJoints = signData.joints;

    this.transitionDuration = signData.duration || transitionDuration;
    this.signProgress = 0;
    this.signHoldTime = signData.holdTime || 1000;
    this.isTransitioning = true;
  }

  update(dt) {
    this.time += dt;

    // Update transition
    if (this.isTransitioning && this.targetJoints) {
      this.signProgress += dt / this.transitionDuration;

      if (this.signProgress >= 1.0) {
        this.signProgress = 1.0;
        this.isTransitioning = false;
      }

      const easeT = this.easeInOut(this.signProgress);

      // Interpolate joints
      for (const j in this.targetJoints) {
        if (!this.startJoints[j]) continue;

        // Fingers are objects (spread, curl), arms are {angle}
        if (j.endsWith('fingers')) {
          this.currentJoints[j].spread = this.lerp(this.startJoints[j].spread, this.targetJoints[j].spread, easeT);
          this.currentJoints[j].curl = this.lerp(this.startJoints[j].curl, this.targetJoints[j].curl, easeT);
          this.currentJoints[j].indexExtended = this.targetJoints[j].indexExtended;
          this.currentJoints[j].thumbExtended = this.targetJoints[j].thumbExtended;
          this.currentJoints[j].thumbIndexTouch = this.targetJoints[j].thumbIndexTouch;
          this.currentJoints[j].middleExtended = this.targetJoints[j].middleExtended;
        } else {
          this.currentJoints[j].angle = this.lerp(this.startJoints[j].angle, this.targetJoints[j].angle, easeT);
        }
      }
    }
    // Hold peak, then play keyframes or return idle
    else if (this.currentSign && this.currentSign !== window.SIGN_POSES.idle) {
      this.signHoldTime -= dt;

      // Play sub-keyframes if holding
      if (this.currentSign.keyframes) {
        const holdProgress = 1.0 - (this.signHoldTime / (this.currentSign.holdTime || 1000));
        let kfs = this.currentSign.keyframes;

        for (let i = 0; i < kfs.length - 1; i++) {
          if (holdProgress >= kfs[i].t && holdProgress <= kfs[i + 1].t) {
            const localT = (holdProgress - kfs[i].t) / (kfs[i + 1].t - kfs[i].t);
            const easeT = this.easeInOut(localT);

            for (const j in kfs[i + 1]) {
              if (j === 't') continue;
              if (j.endsWith('fingers')) {
                // Not doing finger lerp in keyframes yet for simplicity, just snap
                this.currentJoints[j] = kfs[i + 1][j];
              } else {
                const startA = kfs[i][j] ? kfs[i][j].angle : this.targetJoints[j].angle;
                const endA = kfs[i + 1][j].angle;
                this.currentJoints[j].angle = this.lerp(startA, endA, easeT);
              }
            }
          }
        }
      }

      if (this.signHoldTime <= 0) {
        this.transitionTo('idle', 500);
        this.label = "";
      }
    }

    // Idle breathing & blinking
    this.breatheY = Math.sin(this.time * 0.003) * 3;
    this.swayX = Math.sin(this.time * 0.0015) * 1.5;

    if (this.time - this.lastBlink > this.blinkInterval) {
      this.blinkStart = this.time;
      this.lastBlink = this.time;
      this.blinkInterval = 2000 + Math.random() * 3000;
    }
  }

  // ─── Drawing ───────────────────────────────────────────────────────────────

  draw() {
    this.ctx.clearRect(0, 0, this.W, this.H);
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    // Dynamic center base
    const bx = this.cx + this.swayX;
    const by = this.cy + this.breatheY;

    // Draw back arm (right arm, index=-1)
    this.drawArm(bx, by, -1);

    // Draw torso & head
    this.drawTorso(bx, by);
    this.drawHead(bx, by - 35);

    // Draw front arm (left arm, index=1)
    this.drawArm(bx, by, 1);

    // Subtitle label
    if (this.label && this.label !== "idle") {
      this.ctx.save();
      this.ctx.textAlign = "center";
      this.ctx.font = "bold 16px 'Segoe UI', sans-serif";
      this.ctx.fillStyle = PALETTE.glow;
      this.ctx.fillText(this.label.toUpperCase(), this.W / 2, this.H - 20);
      this.ctx.fillStyle = "#fff";
      this.ctx.fillText(this.label.toUpperCase(), this.W / 2, this.H - 21);
      this.ctx.restore();
    }
  }

  drawTorso(bx, by) {
    const { ctx } = this;

    // Neck
    ctx.fillStyle = PALETTE.skin;
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx - 12, by - 30, 24, 25, 4);
    ctx.fill(); ctx.stroke();

    // Neck shadow
    ctx.fillStyle = PALETTE.shadow;
    ctx.beginPath();
    ctx.roundRect(bx - 12, by - 12, 24, 8, 4);
    ctx.fill();

    // Chest/Shirt
    ctx.fillStyle = PALETTE.shirt;
    ctx.beginPath();
    // Shoulders
    ctx.moveTo(bx - 55, by);
    ctx.quadraticCurveTo(bx, by - 15, bx + 55, by);
    // Sides
    ctx.lineTo(bx + 45, by + 120);
    ctx.lineTo(bx - 45, by + 120);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Collar detail
    ctx.strokeStyle = PALETTE.outline;
    ctx.beginPath();
    ctx.moveTo(bx - 18, by - 5);
    ctx.quadraticCurveTo(bx, by + 10, bx + 18, by - 5);
    ctx.stroke();
  }

  drawHead(hx, hy) {
    const { ctx } = this;
    const r = 36;

    // Face base
    ctx.fillStyle = PALETTE.skin;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // Shadow side
    ctx.fillStyle = "rgba(196, 154, 108, 0.4)";
    ctx.beginPath();
    ctx.arc(hx, hy, r, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = PALETTE.hair;
    ctx.beginPath();
    ctx.arc(hx, hy, r, Math.PI, Math.PI * 2);
    ctx.quadraticCurveTo(hx + r + 5, hy + 10, hx, hy - 15);
    ctx.quadraticCurveTo(hx - r - 5, hy + 10, hx - r, hy);
    ctx.fill(); ctx.stroke();

    // Eyes
    const eyeOpen = this.time - this.blinkStart < 150 ? 0 : 1;
    ctx.fillStyle = PALETTE.outline;

    // Left eye
    ctx.beginPath();
    if (eyeOpen) ctx.arc(hx - 12, hy - 2, 3, 0, Math.PI * 2);
    else { ctx.moveTo(hx - 15, hy - 2); ctx.lineTo(hx - 9, hy - 2); }
    ctx.fill(); ctx.stroke();

    // Right eye
    ctx.beginPath();
    if (eyeOpen) ctx.arc(hx + 12, hy - 2, 3, 0, Math.PI * 2);
    else { ctx.moveTo(hx + 9, hy - 2); ctx.lineTo(hx + 15, hy - 2); }
    ctx.fill(); ctx.stroke();

    // Mouth
    ctx.beginPath();
    const face = this.currentSign?.face || "neutral";
    if (face === "happy") {
      ctx.arc(hx, hy + 10, 8, 0, Math.PI);
    } else if (face === "sad") {
      ctx.arc(hx, hy + 18, 6, Math.PI, 0);
    } else {
      ctx.moveTo(hx - 5, hy + 12);
      ctx.lineTo(hx + 5, hy + 12);
    }
    ctx.stroke();

    // Cheeks
    ctx.fillStyle = "rgba(255, 100, 100, 0.2)";
    ctx.beginPath(); ctx.arc(hx - 18, hy + 6, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(hx + 18, hy + 6, 6, 0, Math.PI * 2); ctx.fill();
  }

  drawArm(bx, by, sideMod) {
    const { ctx } = this;
    const prefix = sideMod === 1 ? 'l_' : 'r_';

    // Forward Kinematics calculation
    const shA = this.currentJoints[prefix + 'shoulder'].angle;
    const elA = this.currentJoints[prefix + 'elbow'].angle;
    const wrA = this.currentJoints[prefix + 'wrist'].angle;
    const fingers = this.currentJoints[prefix + 'fingers'];

    // Joints coords
    const sx = bx + (this.bones.shoulderW / 2 * sideMod);
    const sy = by;

    // Upper arm
    const ex = sx + Math.sin(shA) * this.bones.armUpper;
    const ey = sy + Math.cos(shA) * this.bones.armUpper;

    // Forearm
    const globalElA = shA + elA;
    const wx = ex + Math.sin(globalElA) * this.bones.armLower;
    const wy = ey + Math.cos(globalElA) * this.bones.armLower;

    // Wrist / Palm base
    const globalWrA = globalElA + wrA;
    const px = wx + Math.sin(globalWrA) * this.bones.palm;
    const py = wy + Math.cos(globalWrA) * this.bones.palm;

    ctx.lineWidth = 2;

    // Upper arm segment (Shirt sleeve)
    ctx.strokeStyle = PALETTE.outline;
    ctx.fillStyle = PALETTE.shirt;
    ctx.beginPath();
    ctx.arc(sx, sy, 14, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.lineWidth = 26;
    ctx.stroke();
    // inner fill
    ctx.strokeStyle = PALETTE.shirt;
    ctx.lineWidth = 24;
    ctx.stroke();

    // Forearm segment (Skin)
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(wx, wy);
    ctx.lineCap = "round";
    ctx.stroke();

    // Inner skin pass
    ctx.strokeStyle = PALETTE.skin;
    ctx.lineWidth = 18;
    ctx.stroke();

    // Shadow down forearm edge
    ctx.strokeStyle = PALETTE.shadow;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ex - Math.cos(globalElA) * 8, ey + Math.sin(globalElA) * 8);
    ctx.lineTo(wx - Math.cos(globalElA) * 8, wy + Math.sin(globalElA) * 8);
    ctx.stroke();

    // Hand (Palm + Fingers)
    this.drawHand(wx, wy, globalWrA, fingers, sideMod);
  }

  drawHand(wx, wy, angle, state, sideMod) {
    const { ctx } = this;

    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(angle * sideMod); // Mirror rotation for left side if needed
    // The angle points strictly DOWN down the arm in screen space. Let's flip it so 0 points UP like a standard hand
    ctx.rotate(Math.PI);

    // Palm box
    ctx.fillStyle = PALETTE.skin;
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-12, 0, 24, 25, 6);
    ctx.fill(); ctx.stroke();

    // Shadow pass
    ctx.fillStyle = PALETTE.shadow;
    ctx.beginPath();
    ctx.fillRect(-12, 18, 24, 7);

    // Fingers
    // spread: 0 (tight) to 1 (splayed)
    // curl: 0 (straight) to 1 (fist)
    let spreadAngles = [-0.1, 0.0, 0.1, 0.2];
    if (state.spread > 0.5) spreadAngles = [-0.4, -0.15, 0.15, 0.4];

    // index, middle, ring, pinky
    const fingerMetrics = [
      { x: -9, l: 22, curl: state.indexExtended ? 0 : state.curl, ext: state.indexExtended },
      { x: -3, l: 24, curl: state.middleExtended ? 0 : state.curl, ext: state.middleExtended },
      { x: 3, l: 21, curl: state.curl, ext: false },
      { x: 9, l: 16, curl: state.curl, ext: false },
    ];

    for (let i = 0; i < 4; i++) {
      const fm = fingerMetrics[i];
      this.drawFinger(fm.x, 25, spreadAngles[i], fm.l, fm.curl);
    }

    // Thumb
    const thumbX = sideMod === 1 ? -12 : 12; // Outboard side
    let thumbA = sideMod === 1 ? -0.8 : 0.8;
    if (state.thumbExtended) thumbA = sideMod === 1 ? -1.5 : 1.5;
    if (state.thumbIndexTouch) {
      thumbA = sideMod === 1 ? -0.2 : 0.2; // pull in
    }

    ctx.beginPath();
    ctx.lineWidth = 7;
    ctx.strokeStyle = PALETTE.skin;
    ctx.moveTo(thumbX, 10);
    ctx.lineTo(thumbX + Math.sin(thumbA) * 18, 10 + Math.cos(thumbA) * 18);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PALETTE.outline;
    ctx.strokeRect(thumbX - 3.5, 10, 7, 2); // joint line

    ctx.restore();
  }

  drawFinger(fx, fy, angle, length, curl) {
    const { ctx } = this;

    // Curling reduces the apparent length and arcs it
    const visualLen = length * (1.0 - (curl * 0.7));
    const curvedAngle = angle + (curl * 2.0); // curve inward

    const tipX = fx + Math.sin(curvedAngle) * visualLen;
    const tipY = fy + Math.cos(curvedAngle) * visualLen;

    ctx.lineWidth = 6;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tipX, tipY);

    // Skin
    ctx.strokeStyle = PALETTE.skin;
    ctx.stroke();

    // Outline
    ctx.lineWidth = 8;
    ctx.strokeStyle = PALETTE.outline;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    // Joint crease if curled
    if (curl > 0.4) {
      ctx.beginPath();
      ctx.strokeStyle = PALETTE.shadow;
      ctx.lineWidth = 1;
      ctx.moveTo(fx - 2, fy + visualLen * 0.5);
      ctx.lineTo(fx + 2, fy + visualLen * 0.5);
      ctx.stroke();
    }
  }

  // ─── Math Utils ────────────────────────────────────────────────────────────
  lerp(a, b, t) { return a + (b - a) * t; }
  easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
}

window.AvatarRenderer = AvatarRenderer;
