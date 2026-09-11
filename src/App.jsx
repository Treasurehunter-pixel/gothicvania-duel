import React from 'react'
import SPRITES from './sprites.js'

// ---------------------------------------------------------------------------
//  Gothicvania Duel — ported from the standalone-artifact version unchanged
//  in game logic. Sprites: "Legacy Collection" (ansimuz) — Terrible Knight
//  (hero), Ogre (enemy), Explosions & Magic (VFX), mist-forest background.
//
//  Kept as React.createElement (no JSX) for this component so the port from
//  the artifact was a mechanical extraction — nothing about the simulation
//  or render logic changed on the way in.
// ---------------------------------------------------------------------------
var h = React.createElement
var useRef = React.useRef, useState = React.useState, useEffect = React.useEffect, useCallback = React.useCallback

// ---- world constants (internal canvas resolution) -------------------------
var VW = 480, VH = 270, GROUND_Y = 244
var HERO_FW = 128, HERO_FH = 96, HERO_FOOT = 6
var OGRE_FW = 144, OGRE_FH = 80, OGRE_FOOT = 4

// One split line at the hero's abdomen drives both danger bands: the DUCK band
// fills abdomen -> head-top, the JUMP band fills abdomen -> feet, meeting at
// ABDOMEN_Y with no gap so the two read as one continuous zone. Values are
// measured off the drawn Terrible-Knight sprite: head ~GROUND_Y-36, feet
// ~GROUND_Y, so abdomen sits a touch below the mid-point.
var ABDOMEN_Y = GROUND_Y - 22
var HEAD_TOP_Y = GROUND_Y - 42 // a hair above the standing hero's head

// The hero holds a roughly fixed spot on screen; the WORLD scrolls past.
// hero.x / ogre.x are world coordinates; camX = hero.x - HERO_SCREEN_X.
var HERO_SCREEN_X = 168

var HERO_SPEED = 96 // px / s
var OGRE_SPEED = 52
var GRAVITY = 900
var JUMP_V = 330 // apex ~= 60px
var ENGAGE = 52 // ogre stops & telegraphs at roughly club distance
var TELEGRAPH_MS = 680 // total wind-up window before the swing begins
var TELE_RED_MS = 280 // final slice of the telegraph — band flips to red ("now")
var RECOVER_MS = 430
var PLAYER_REACH = 46 // hero sword hitbox length ahead of centre
var OGRE_HALF = 22, HERO_HALF = 15

// Ogre club hitbox — anchored to the measured swing arc in ogre-attack.png
// frame 5 (arc pixels span raw-x 3..45 in the 144px frame; forward of the
// ogre's centre that is ~27..69px). Active only across the contact frames.
var ATK_ARC_NEAR = 6 // forward dist from ogre centre where the arc starts
var ATK_ARC_FAR = 70 // ... and where it ends (head-to-ground vertical box)

// parallax layers, back (slow) -> front (fast). 1.0 == moves with the world.
// mist-forest-background layers: back, back-trees, rocks, tree, tiles.
var LAYERS = [
  { img: 'bgBack', p: 0.12, top: 0, h: VH },
  { img: 'bgBackTrees', p: 0.30, top: 20, h: 244 },
  { img: 'bgRocks', p: 0.52, top: 52, h: 200 },
  // native art is 336x224 with the canopy touching row 0 (zero margin) — at
  // the old top:28/h:226 (~native scale) that leaves almost no buffer before
  // the canvas edge, so the widest canopy in the scene reads as clipped.
  // Scaled down and shifted down for real headroom; p/alpha untouched.
  // mist paints a thin haze of the ambient sky colour across that same top
  // edge (now more exposed by the extra headroom) so it reads as a misty
  // fade rather than a hard cut — see drawMistSeam.
  { img: 'bgTree', p: 0.72, top: 44, h: 202, alpha: 0.96, mist: { spread: 45, strength: 1.50 } },
  { img: 'bgTiles', p: 1.00, top: GROUND_Y - 8, h: 44, sx: 48, sy: 24, sw: 128, sh: 44 },
]
var HIT_INVULN_MS = 1300
var RESPAWN_MS = 720
var DEATH_VFX_MS = (8 / 14) * 1000
var HIT_VFX_MS = (3 / 16) * 1000

var ANIM = {
  idle: { img: 'heroIdle', n: 4, fps: 6, loop: true },
  run: { img: 'heroRun', n: 12, fps: 15, loop: true },
  jump: { img: 'heroJump', n: 4, fps: 9, loop: false },
  crouch: { img: 'heroCrouch', n: 2, fps: 5, loop: true },
  attack: { img: 'heroSlash', n: 6, fps: 15, loop: false, active: [2, 3] },
  crouchAtk: { img: 'heroCrouchSlash', n: 4, fps: 14, loop: false, active: [1, 2] },
  hurt: { img: 'heroHurt', n: 3, fps: 10, loop: false },
  oIdle: { img: 'ogreIdle', n: 4, fps: 5, loop: true },
  oWalk: { img: 'ogreWalk', n: 6, fps: 8, loop: true },
  // ogre-attack.png is authored facing the OPPOSITE way to walk/idle and its
  // body drifts within the frame (coils back on the wind-up, lunges on the
  // swing). nf:-1 inverts the flip so the chop agrees with o.facing; offX is
  // a per-frame anchor nudge (px, +ve = toward o.facing) that cancels the
  // drift so the ogre doesn't lurch at the walk -> attack hand-off.
  oAtk: {
    img: 'ogreAttack', n: 7, fps: 9, loop: false, nf: -1,
    offX: [0, -5, -11, -12, 4, 6, 6], contactHigh: 3, contactLow: 4,
  },
}

// Grotto-escape-2-FX slash overlays, played once on the ogre's contact frame.
var FX = {
  slashUp: { img: 'slashUp', n: 5, fps: 22, fw: 52, fh: 56, sc: 1.7 }, // 260x56 — HIGH
  slashHoriz: { img: 'slashHoriz', n: 5, fps: 24, fw: 65, fh: 40, sc: 1.4 }, // 325x40 — LOW
}

var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v }
var sign = function (v) { return v < 0 ? -1 : v > 0 ? 1 : 0 }

function newHero() {
  return {
    x: 0, feetY: GROUND_Y, vy: 0, facing: 1, onGround: true,
    state: 'idle', anim: 'idle', animT: 0, frame: 0, done: false,
    lockT: 0, invuln: 0, swung: false, hitShake: 0,
  }
}
// Ogres ALWAYS enter from the right, just past the right screen edge, in
// world space — so they scroll in with the parallax world.
function newOgre(heroX) {
  return {
    x: heroX + (VW - HERO_SCREEN_X) + 28, feetY: GROUND_Y, facing: -1,
    state: 'walk', anim: 'oWalk', animT: 0, frame: 0, done: false,
    t: 0, atk: 'high', struck: false, deadT: 0,
  }
}

function setAnim(o, name) {
  if (o.anim !== name) { o.anim = name; o.animT = 0; o.frame = 0; o.done = false }
}
function stepAnim(o, dt) {
  var a = ANIM[o.anim]
  if (!a) return
  o.animT += dt
  var f = Math.floor(o.animT * a.fps)
  if (a.loop) { o.frame = f % a.n; o.done = false }
  else if (f >= a.n) { o.frame = a.n - 1; o.done = true }
  else { o.frame = f; o.done = false }
}

export default function GothicvaniaDuel() {
  var canvasRef = useRef(null)
  var G = useRef(null)
  if (!G.current) {
    var h0 = newHero()
    G.current = {
      hero: h0, ogre: newOgre(h0.x), vfx: [], fog: [],
      keys: new Set(), pendJump: false, pendAtk: false,
      phase: 'loading', running: false, last: 0, acc: 0,
      lives: 3, score: 0, reduced: false,
    }
  }
  var g = G.current

  var live = useState(3), lives = live[0], setLives = live[1]
  var sc = useState(0), score = sc[0], setScore = sc[1]
  var ph = useState('loading'), phase = ph[0], setPhase = ph[1]

  var reset = useCallback(function () {
    g.hero = newHero()
    g.ogre = newOgre(g.hero.x)
    g.vfx = []
    g.lives = 3; g.score = 0
    setLives(3); setScore(0)
    g.phase = 'playing'; setPhase('playing')
    g.running = true; g.last = performance.now(); g.acc = 0
  }, [])

  var begin = useCallback(function () {
    g.phase = 'playing'; setPhase('playing')
    g.running = true; g.last = performance.now(); g.acc = 0
  }, [])

  // ---- input ---------------------------------------------------------------
  useEffect(function () {
    var press = function (code) {
      if (code === 'jump') g.pendJump = true
      if (code === 'atk') g.pendAtk = true
    }
    var kd = function (e) {
      var k = e.key
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown' || k === ' ') e.preventDefault()
      var had = g.keys.has(k); g.keys.add(k)
      if (had) return
      if (k === 'ArrowUp' || k === ' ') press('jump')
      if (k === 'x' || k === 'X') press('atk')
      if (g.phase === 'ready' && (k === ' ' || k === 'Enter')) begin()
      if (g.phase === 'over' && (k === ' ' || k === 'Enter')) reset()
    }
    var ku = function (e) { g.keys.delete(e.key) }
    var blur = function () { g.keys.clear() }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    window.addEventListener('blur', blur)
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    g.reduced = mq.matches
    var mql = function () { g.reduced = mq.matches }
    mq.addEventListener && mq.addEventListener('change', mql)
    return function () {
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      window.removeEventListener('blur', blur)
      mq.removeEventListener && mq.removeEventListener('change', mql)
    }
  }, [begin, reset])

  // ---- load sprites + main loop -------------------------------------------
  useEffect(function () {
    var canvas = canvasRef.current
    var ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false

    var IMG = {}, keys = Object.keys(SPRITES), loaded = 0, dead = false
    keys.forEach(function (k) {
      var im = new Image()
      im.onload = function () {
        loaded++
        if (loaded === keys.length && !dead) {
          // seed fog
          for (var i = 0; i < 7; i++) {
            g.fog.push({
              x: Math.random() * VW, y: 60 + Math.random() * 150,
              r: 40 + Math.random() * 70, s: 3 + Math.random() * 7,
              a: 0.03 + Math.random() * 0.05,
            })
          }
          g.phase = 'ready'; setPhase('ready')
        }
      }
      im.src = SPRITES[k]
      IMG[k] = im
    })

    var hashInt = function (n) {
      n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4)
      n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return n >>> 0
    }

    // ---- helpers --------------------------------------------------------
    function drawSheet(key, fw, fh, frame, cx, feetY, foot, facing, alpha) {
      var img = IMG[key]; if (!img) return
      var dx = Math.round(cx - fw / 2), dy = Math.round(feetY + foot - fh)
      ctx.save()
      if (alpha != null) ctx.globalAlpha = alpha
      if (facing < 0) {
        ctx.translate(dx + fw, 0); ctx.scale(-1, 1)
        ctx.drawImage(img, frame * fw, 0, fw, fh, 0, dy, fw, fh)
      } else ctx.drawImage(img, frame * fw, 0, fw, fh, dx, dy, fw, fh)
      ctx.restore()
    }
    function shadow(cx, scale) {
      ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.30)'
      ctx.beginPath(); ctx.ellipse(cx, GROUND_Y + 3, 17 * scale, 4.2, 0, 0, Math.PI * 2)
      ctx.fill(); ctx.restore()
    }
    function label(txt, cx, y, col) {
      ctx.save()
      ctx.font = '700 11px Oswald, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)'
      ctx.strokeText(txt, cx, y); ctx.fillStyle = col; ctx.fillText(txt, cx, y)
      ctx.restore()
    }

    // ---- in-canvas HUD -------------------------------------------------
    var heartPath = typeof Path2D !== 'undefined'
      ? new Path2D('M12 21s-7.5-4.7-10-9.4C.3 8.2 2 4.5 5.5 4.5c2 0 3.6 1.2 4.5 2.8 1-1.6 2.5-2.8 4.5-2.8C22 4.5 23.7 8.2 22 11.6 19.5 16.3 12 21 12 21z')
      : null
    // No background scrim behind the HUD — the scene stays edge-to-edge and
    // every glyph carries its own drop-shadow / stroke for contrast instead,
    // the same technique the DUCK/JUMP labels already use.
    function drawHeart(x, y, px, filled) {
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 0.5
      ctx.translate(x, y); ctx.scale(px / 24, px / 24)
      if (heartPath) {
        if (filled) { ctx.fillStyle = '#c0362c'; ctx.fill(heartPath) }
        else { ctx.strokeStyle = 'rgba(230,222,205,0.65)'; ctx.lineWidth = 2; ctx.stroke(heartPath) }
      } else {
        ctx.fillStyle = filled ? '#c0362c' : 'rgba(214,198,168,0.35)'
        ctx.fillRect(3, 3, 18, 18)
      }
      ctx.restore()
    }
    function drawHudText(txt, x, y, font, fillCol) {
      ctx.save()
      ctx.font = font
      ctx.lineJoin = 'round'; ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'
      ctx.strokeText(txt, x, y)
      ctx.fillStyle = fillCol
      ctx.fillText(txt, x, y)
      ctx.restore()
    }
    function drawHUD() {
      ctx.save()
      for (var i = 0; i < 3; i++) drawHeart(8 + i * 15, 9, 12, g.lives > i)
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'right'
      drawHudText('SLAIN', VW - 34, 17, '600 10px Oswald, system-ui, sans-serif', 'rgba(224,215,198,0.92)')
      drawHudText(String(g.score), VW - 9, 18, '600 16px Oswald, system-ui, sans-serif', '#f4ecd6')
      ctx.restore()
    }

    // ---- simulation ---------------------------------------------------
    function damageHero(from) {
      var hero = g.hero
      hero.state = 'hurt'; setAnim(hero, 'hurt')
      hero.lockT = 0.32; hero.invuln = HIT_INVULN_MS
      hero.hitShake = g.reduced ? 0 : 160
      var away = sign(hero.x - from) || 1
      hero.x += away * 9
      g.vfx.push({ kind: 'hit', x: hero.x, y: GROUND_Y - 42, t: 0 })
      g.lives -= 1; setLives(g.lives)
      if (g.lives <= 0) {
        g.phase = 'over'; setPhase('over'); g.running = false
        setScore(g.score)
      }
    }
    function killOgre() {
      var o = g.ogre, hero = g.hero
      o.state = 'dead'; o.deadT = 0; o.anim = null
      g.vfx.push({ kind: 'death', x: o.x, y: GROUND_Y - 34, t: 0 })
      g.vfx.push({ kind: 'hit', x: hero.x + hero.facing * PLAYER_REACH * 0.65, y: GROUND_Y - 40, t: 0 })
      g.score += 1; setScore(g.score)
      g.hero.swung = true
    }

    function updateHero(dt) {
      var hero = g.hero, k = g.keys
      var dtms = dt * 1000
      if (hero.invuln > 0) hero.invuln -= dtms
      if (hero.hitShake > 0) hero.hitShake -= dtms

      var left = k.has('ArrowLeft'), right = k.has('ArrowRight'), down = k.has('ArrowDown')
      var locked = hero.state === 'attack' || hero.state === 'crouchAtk' || hero.state === 'hurt'

      // resolve attack / hurt lock
      if (locked) {
        hero.lockT -= dt
        if (hero.state === 'hurt') {
          if (hero.done || hero.lockT <= 0) { hero.state = hero.onGround ? 'idle' : 'jump' }
        } else {
          if (hero.done || hero.lockT <= 0) {
            hero.state = hero.onGround ? 'idle' : 'jump'
            hero.swung = false
          }
        }
      }
      locked = hero.state === 'attack' || hero.state === 'crouchAtk' || hero.state === 'hurt'

      // edge actions
      if (g.pendJump && hero.onGround && !locked) {
        hero.vy = -JUMP_V; hero.onGround = false; hero.state = 'jump'; setAnim(hero, 'jump')
      }
      if (g.pendAtk && !locked) {
        if (hero.onGround && down) { hero.state = 'crouchAtk'; setAnim(hero, 'crouchAtk'); hero.lockT = ANIM.crouchAtk.n / ANIM.crouchAtk.fps }
        else { hero.state = 'attack'; setAnim(hero, 'attack'); hero.lockT = ANIM.attack.n / ANIM.attack.fps }
        hero.swung = false
      }
      g.pendJump = false; g.pendAtk = false
      locked = hero.state === 'attack' || hero.state === 'crouchAtk' || hero.state === 'hurt'

      // vertical
      if (!hero.onGround) {
        hero.vy += GRAVITY * dt
        hero.feetY += hero.vy * dt
        if (hero.feetY >= GROUND_Y) {
          hero.feetY = GROUND_Y; hero.vy = 0; hero.onGround = true
          if (hero.state === 'jump') hero.state = 'idle'
        }
      }

      // horizontal + grounded pose
      if (!locked) {
        if (!hero.onGround) {
          if (left && !right) { hero.x -= HERO_SPEED * 0.82 * dt; hero.facing = -1 }
          if (right && !left) { hero.x += HERO_SPEED * 0.82 * dt; hero.facing = 1 }
          setAnim(hero, 'jump')
        } else if (down) {
          hero.state = 'crouch'; setAnim(hero, 'crouch')
        } else if (left !== right) {
          hero.x += (right ? 1 : -1) * HERO_SPEED * dt
          hero.facing = right ? 1 : -1
          hero.state = 'run'; setAnim(hero, 'run')
        } else {
          hero.state = 'idle'; setAnim(hero, 'idle')
        }
      }
      stepAnim(hero, dt)

      // player blow connects?
      if ((hero.state === 'attack' || hero.state === 'crouchAtk') && !hero.swung) {
        var a = ANIM[hero.anim]
        if (a.active && a.active.indexOf(hero.frame) >= 0) {
          var o = g.ogre
          if (o.state !== 'dead') {
            var dx = (o.x - hero.x) * hero.facing
            if (dx > -8 && dx < PLAYER_REACH + OGRE_HALF) {
              killOgre()
            }
          }
        }
      }
    }

    function updateOgre(dt) {
      var o = g.ogre, hero = g.hero, dtms = dt * 1000

      if (o.state === 'dead') {
        o.deadT += dtms
        if (o.deadT >= DEATH_VFX_MS + RESPAWN_MS && g.phase === 'playing') {
          g.ogre = newOgre(hero.x) // always re-enters from the right
        }
        return
      }

      if (o.state === 'walk') {
        var dir = sign(hero.x - o.x) || o.facing
        o.facing = dir
        o.x += dir * OGRE_SPEED * dt
        setAnim(o, 'oWalk')
        if (Math.abs(hero.x - o.x) <= ENGAGE) {
          o.state = 'telegraph'; o.t = 0
          o.atk = Math.random() < 0.5 ? 'high' : 'low'
          setAnim(o, 'oIdle')
        }
      } else if (o.state === 'telegraph') {
        o.t += dtms
        o.facing = sign(hero.x - o.x) || o.facing
        setAnim(o, 'oIdle')
        if (o.t >= TELEGRAPH_MS) {
          o.state = 'attack'; o.t = 0; o.struck = false; setAnim(o, 'oAtk')
        }
      } else if (o.state === 'attack') {
        stepAnim(o, dt)
        // contact resolves once, on the swing frame — later for a low sweep
        // (frame 5->6) than for an overhead (frame 4->5). No hitbox on the
        // wind-up (frames 1-4) or the recovery (frames 6-7).
        var contactF = o.atk === 'low' ? ANIM.oAtk.contactLow : ANIM.oAtk.contactHigh
        if (!o.struck && o.frame >= contactF) {
          o.struck = true
          var dxf = (hero.x - o.x) * o.facing // hero's distance IN FRONT of the ogre
          var facingPlayer = sign(hero.x - o.x) === o.facing || hero.x === o.x
          var inArc = dxf > ATK_ARC_NEAR - HERO_HALF && dxf < ATK_ARC_FAR + HERO_HALF
          if (inArc && facingPlayer) {
            var ducking = hero.state === 'crouch' || hero.state === 'crouchAtk'
            var airborne = hero.feetY <= GROUND_Y - 24
            var dodged = (o.atk === 'high' && ducking) || (o.atk === 'low' && airborne)
            if (!dodged && hero.invuln <= 0 && hero.state !== 'hurt') {
              damageHero(o.x)
            }
          }
          // slash overlay at the height that matches the warning band
          var ax = o.x + 34 * o.facing
          if (o.atk === 'high') g.vfx.push({ kind: 'slashUp', x: ax, y: GROUND_Y - 32, face: o.facing, t: 0 })
          else g.vfx.push({ kind: 'slashHoriz', x: ax, y: GROUND_Y - 10, face: o.facing, t: 0 })
        }
        if (o.done) { o.state = 'recover'; o.t = 0; setAnim(o, 'oIdle') }
      } else if (o.state === 'recover') {
        o.t += dtms
        stepAnim(o, dt)
        if (o.t >= RECOVER_MS) { o.state = 'walk'; setAnim(o, 'oWalk') }
      }

      if (o.state !== 'attack' && o.state !== 'recover') stepAnim(o, dt)
    }

    function update(dt) {
      updateHero(dt)
      updateOgre(dt)
      // fog drift
      for (var i = 0; i < g.fog.length; i++) {
        var f = g.fog[i]
        if (!g.reduced) f.x += f.s * dt
        if (f.x - f.r > VW) f.x = -f.r
      }
      // vfx
      for (var j = g.vfx.length - 1; j >= 0; j--) {
        var v = g.vfx[j]; v.t += dt * 1000
        var life = v.kind === 'death' ? DEATH_VFX_MS
          : v.kind === 'hit' ? HIT_VFX_MS
          : (FX[v.kind].n / FX[v.kind].fps) * 1000
        if (v.t >= life) g.vfx.splice(j, 1)
      }
    }

    // ---- render -----------------------------------------------------
    function drawLayer(L, camX) {
      var img = IMG[L.img]; if (!img || !img.width) return
      var sx = L.sx || 0, sy = L.sy || 0, sw = L.sw || img.width, sh = L.sh || img.height
      var w = sw * (L.h / sh)
      var off = -(camX * L.p) % w; if (off > 0) off -= w
      ctx.save()
      if (L.alpha != null) ctx.globalAlpha = L.alpha
      for (var x = off; x < VW; x += w) {
        ctx.drawImage(img, sx, sy, sw, sh, Math.round(x), L.top, Math.ceil(w) + 1, L.h)
      }
      ctx.restore()
    }

    // Some layer art (bgTree) has a flat, undifferentiated fill right at the
    // top of its own canopy silhouette — no leaf detail, no alpha taper, just
    // a solid mass that stops dead. Fading the layer's own alpha there only
    // reveals a softened copy of that same flat blob (tried it — looks like a
    // grey pill floating in the sky). Painting a thin haze of the ambient sky
    // colour across the seam instead hides the hard line under something that
    // reads as mist, without touching the layer's own pixels, position, scale
    // or parallax factor.
    var SKY_STOPS = [[0, 0x9f, 0xb7, 0xb1], [0.55, 0x7f, 0x9a, 0x95], [1, 0x4e, 0x65, 0x60]]
    function skyColorAt(y) {
      var t = Math.max(0, Math.min(1, y / VH))
      for (var i = 0; i < SKY_STOPS.length - 1; i++) {
        var a = SKY_STOPS[i], b = SKY_STOPS[i + 1]
        if (t <= b[0] || i === SKY_STOPS.length - 2) {
          var f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0])
          f = Math.max(0, Math.min(1, f))
          return Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ',' + Math.round(a[3] + (b[3] - a[3]) * f)
        }
      }
    }
    function drawMistSeam(y, spread, strength) {
      var col = skyColorAt(y)
      // base haze: a dense, even wash so there's no gap for the seam to show through
      var g = ctx.createLinearGradient(0, y - spread, 0, y + spread)
      g.addColorStop(0, 'rgba(' + col + ',0)')
      g.addColorStop(0.5, 'rgba(' + col + ',' + strength + ')')
      g.addColorStop(1, 'rgba(' + col + ',0)')
      ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, y - spread, VW, spread * 2); ctx.restore()

      // cloudy texture: overlapping soft puffs (same technique/tint as the
      // ambient fog puffs elsewhere) layered on top, much denser than those,
      // so the band reads as an uneven mist bank instead of a flat gradient
      // painted across the trees. Positions are deterministic (hashInt) so
      // the texture doesn't crawl/flicker frame to frame.
      var FOG_COL = '210,222,217'
      ctx.save()
      for (var i = 0; i < 12; i++) {
        var n = hashInt(i * 97 + 13)
        var px = ((n % 1000) / 1000) * (VW + 140) - 70
        var py = y + (((n >>> 8) % 100) / 100 - 0.5) * spread * 1.2
        var pr = spread * (1.2 + ((n >>> 16) % 100) / 150)
        var pa = 0.30 + (((n >>> 20) % 100) / 100) * 0.25
        var grd = ctx.createRadialGradient(px, py, 0, px, py, pr)
        grd.addColorStop(0, 'rgba(' + FOG_COL + ',' + pa + ')')
        grd.addColorStop(1, 'rgba(' + FOG_COL + ',0)')
        ctx.fillStyle = grd
        ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()
    }

    function render() {
      var hero = g.hero, o = g.ogre
      var camX = hero.x - HERO_SCREEN_X // world -> screen: screenX = worldX - camX
      var oSX = o.x - camX // ogre screen x
      ctx.save()

      var sh = hero.hitShake > 0 ? (g.reduced ? 0 : hero.hitShake / 160) : 0
      if (sh > 0) ctx.translate((Math.random() - 0.5) * 6 * sh, (Math.random() - 0.5) * 5 * sh)

      // sky wash behind everything
      var sky = ctx.createLinearGradient(0, 0, 0, VH)
      sky.addColorStop(0, '#9fb7b1'); sky.addColorStop(0.55, '#7f9a95'); sky.addColorStop(1, '#4e6560')
      ctx.fillStyle = sky; ctx.fillRect(0, 0, VW, VH)

      // ---- parallax layers (far -> near); the ground strip is drawn later ----
      for (var li = 0; li < LAYERS.length - 1; li++) {
        var L = LAYERS[li]
        drawLayer(L, camX)
        if (L.mist) drawMistSeam(L.top, L.mist.spread, L.mist.strength)
      }

      // fog puffs (mist has no fixed anchor — gentle screen drift + faint depth)
      for (var i = 0; i < g.fog.length; i++) {
        var f = g.fog[i]
        var fx0 = f.x - ((camX * 0.08) % (VW + 2 * f.r))
        var grd = ctx.createRadialGradient(fx0, f.y, 0, fx0, f.y, f.r)
        grd.addColorStop(0, 'rgba(210,222,217,' + f.a + ')')
        grd.addColorStop(1, 'rgba(210,222,217,0)')
        ctx.fillStyle = grd
        ctx.beginPath(); ctx.arc(fx0, f.y, f.r, 0, Math.PI * 2); ctx.fill()
      }

      // ---- ground (scrolls with the world, p = 1) ----
      ctx.fillStyle = '#12100c'; ctx.fillRect(0, GROUND_Y, VW, VH - GROUND_Y)
      // procedural grass fallback, keyed to world position so it travels past
      var spacing = 10, w0 = Math.floor(camX / spacing)
      ctx.fillStyle = '#0e2c18'
      for (var gi = -1; gi <= Math.ceil(VW / spacing) + 1; gi++) {
        var wi = w0 + gi, gsx = wi * spacing - camX, hgt = 2 + (hashInt(wi) % 4)
        ctx.fillRect(Math.round(gsx), GROUND_Y - 2 - hgt, 2, hgt)
      }
      // the real tileset ground strip, p = 1
      drawLayer(LAYERS[LAYERS.length - 1], camX)
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, GROUND_Y - 1, VW, 1)
      // scattered dark stones
      ctx.fillStyle = '#171712'
      for (var si = w0 - 2; si < w0 + Math.ceil(VW / spacing) + 2; si++) {
        if (hashInt(si * 131) % 17 === 0) {
          var stx = si * spacing - camX
          ctx.fillRect(Math.round(stx), GROUND_Y + 3, 4 + (hashInt(si) % 4), 3)
        }
      }

      // shadows
      shadow(HERO_SCREEN_X, hero.onGround ? 1 : 0.7)
      if (o.state !== 'dead') shadow(oSX, 1.15)

      // ---- danger telegraph ----
      // Colour = timing only (yellow "ready" -> red "now"), identical for both
      // attack types. Position = type: a shoulder/head band for an overhead
      // (duck), a torso-and-below band for a low sweep (jump), placed over the
      // club's arc in front of the ogre so it overlaps the hero's body.
      if (o.state === 'telegraph' || (o.state === 'attack' && !o.struck)) {
        var fdir = o.facing
        var near = oSX + 2 * fdir, far = oSX + 84 * fdir
        var bx = Math.min(near, far), bw = Math.abs(far - near)
        var isRed = o.state === 'attack' || o.t >= TELEGRAPH_MS - TELE_RED_MS
        var pulse = isRed
          ? 0.40 + 0.22 * Math.abs(Math.sin(o.t / 55))
          : 0.16 + 0.18 * Math.abs(Math.sin(o.t / 120))
        ctx.fillStyle = isRed ? 'rgba(206,52,38,' + pulse + ')' : 'rgba(232,196,64,' + pulse + ')'
        if (o.atk === 'high') {
          ctx.fillRect(bx, HEAD_TOP_Y, bw, ABDOMEN_Y - HEAD_TOP_Y) // head -> abdomen
          label('DUCK', bx + bw / 2, HEAD_TOP_Y - 3, '#f2ead4')
        } else {
          ctx.fillRect(bx, ABDOMEN_Y, bw, GROUND_Y - ABDOMEN_Y) // abdomen -> feet
          label('JUMP', bx + bw / 2, GROUND_Y + 14, '#f2ead4')
        }
      }

      // ---- ogre ----
      if (o.state === 'dead') {
        var dfade = 1 - clamp(o.deadT / 220, 0, 1)
        if (dfade > 0) drawSheet('ogreIdle', OGRE_FW, OGRE_FH, 0, oSX, o.feetY, OGRE_FOOT, o.facing, dfade)
      } else {
        var oa = ANIM[o.anim] || ANIM.oWalk
        var nf = oa.nf || 1 // per-anim flip
        var ox = oa.offX ? (oa.offX[Math.min(o.frame, oa.offX.length - 1)] || 0) * (o.facing * nf) : 0
        drawSheet(oa.img, OGRE_FW, OGRE_FH, o.frame, oSX + ox, o.feetY, OGRE_FOOT, o.facing * nf, 1)
      }

      // ---- hero (always at HERO_SCREEN_X) ----
      var ha = ANIM[hero.anim] || ANIM.idle
      var blink = hero.invuln > 0 && Math.floor(hero.invuln / 70) % 2 === 0 ? 0.35 : 1
      drawSheet(ha.img, HERO_FW, HERO_FH, hero.frame, HERO_SCREEN_X, hero.feetY, HERO_FOOT, hero.facing, blink)

      // sword arc flourish on the active frames
      if (hero.state === 'attack' && ha.active.indexOf(hero.frame) >= 0) {
        ctx.save()
        ctx.strokeStyle = 'rgba(245,238,214,0.8)'; ctx.lineWidth = 2
        ctx.beginPath()
        var ax = HERO_SCREEN_X + hero.facing * 14, ay = GROUND_Y - 46
        ctx.arc(ax, ay, 30, hero.facing > 0 ? -1.1 : 2.0, hero.facing > 0 ? 1.1 : 4.3)
        ctx.stroke(); ctx.restore()
      }

      // ---- vfx (stored in world space) ----
      for (var v = 0; v < g.vfx.length; v++) {
        var fx = g.vfx[v]
        var vsx = fx.x - camX
        if (fx.kind === 'death') {
          var df = Math.min(7, Math.floor(fx.t / (DEATH_VFX_MS / 8)))
          var di = IMG.vfxDeath
          if (di) ctx.drawImage(di, df * 48, 0, 48, 48, Math.round(vsx - 48), Math.round(fx.y - 48), 96, 96)
        } else if (fx.kind === 'hit') {
          var hf = Math.min(2, Math.floor(fx.t / (HIT_VFX_MS / 3)))
          var img = IMG.vfxHit
          if (img) ctx.drawImage(img, hf * 31, 0, 31, 32, Math.round(vsx - 31), Math.round(fx.y - 32), 62, 64)
        } else {
          // Grotto slash overlay (slashUp for overhead, slashHoriz for sweep)
          var S = FX[fx.kind], im = IMG[S.img]
          if (im) {
            var sf = Math.min(S.n - 1, Math.floor(fx.t / (1000 / S.fps)))
            var dw = S.fw * S.sc, dh = S.fh * S.sc
            ctx.save()
            ctx.globalAlpha = 0.92 * (1 - (fx.t / ((S.n / S.fps) * 1000)) * 0.5)
            if (fx.face < 0) {
              ctx.translate(Math.round(vsx), 0); ctx.scale(-1, 1)
              ctx.drawImage(im, sf * S.fw, 0, S.fw, S.fh, -dw / 2, Math.round(fx.y - dh / 2), dw, dh)
            } else ctx.drawImage(im, sf * S.fw, 0, S.fw, S.fh, Math.round(vsx - dw / 2), Math.round(fx.y - dh / 2), dw, dh)
            ctx.restore()
          }
        }
      }

      // (Removed: a corner vignette used to sit here. Its radial gradient was
      // centred at (VW/2, VH*0.42) with an outer radius of VH*0.9 — on this
      // 480x270, 16:9 canvas that outer radius is shorter than the distance
      // from centre to the top corners, so canvas clamps those corners to the
      // gradient's *last* stop: a flat 0.55-alpha black square sitting right
      // behind the hearts/score and reading as a dark band over the treeline.
      // HUD legibility no longer depends on it — drawHeart/drawHudText carry
      // their own shadow/stroke — so it's dropped rather than reshaped.)

      ctx.restore()

      // HUD last, outside the shake transform so it stays pinned to the corners
      drawHUD()
    }

    function loop(now) {
      raf = requestAnimationFrame(loop)
      var dt = (now - g.last) / 1000; g.last = now
      if (dt > 0.25) dt = 0.25
      if (g.running && g.phase === 'playing') {
        g.acc += dt
        var steps = 0
        while (g.acc >= 1 / 120 && steps < 8) { update(1 / 120); g.acc -= 1 / 120; steps++ }
      }
      if (g.phase !== 'loading') render()
    }
    var raf = requestAnimationFrame(loop)

    return function () { dead = true; cancelAnimationFrame(raf) }
  }, [])

  // ---- chrome ----------------------------------------------------------
  // Lives + score are drawn INSIDE the canvas (see drawHUD) — the .frame div
  // below is the entire game viewport; nothing else renders on the page.
  var overlay = null
  if (phase === 'loading') {
    overlay = h('div', { className: 'overlay' }, h('p', { className: 'final' }, 'Summoning the wood…'))
  } else if (phase === 'ready') {
    overlay = h(
      'div', { className: 'overlay' },
      h('h2', null, 'The Haunted Wood'),
      h('p', null, 'An ogre stalks the treeline. Read its wind-up, dodge the blow, answer with steel.'),
      h('button', { className: 'action', onClick: begin, autoFocus: true }, 'Enter the wood')
    )
  } else if (phase === 'over') {
    overlay = h(
      'div', { className: 'overlay' },
      h('h2', null, 'You Died'),
      h('div', { className: 'final' }, 'Foes slain', h('b', null, score)),
      h('button', { className: 'action', onClick: reset, autoFocus: true }, 'Rise again')
    )
  }

  return h(
    'div', { className: 'gameRoot' },
    h(
      'div', { className: 'frame' },
      h('canvas', {
        ref: canvasRef, width: VW, height: VH, role: 'img',
        'aria-label': 'Gothicvania duel — ' + lives + ' lives, ' + score + ' foes slain',
      }),
      overlay
    )
  )
}
