import React from 'react'
import SPRITES from './sprites.js'

// ---------------------------------------------------------------------------
//  Gothicvania Duel — ported from the standalone-artifact version unchanged
//  in game logic. Sprites: "Legacy Collection" (ansimuz) — Terrible Knight
//  (hero), Ogre (enemy), demon-Files (boss), Dancing Girl (upgrade NPC),
//  Explosions & Magic (VFX), mist-forest background.
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
var DANCER_FW = 39, DANCER_FH = 53, DANCER_FOOT = 4

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

var HERO_SPEED = 96 // px / s, before g.stats.moveSpeedMult
var OGRE_SPEED = 52
var GRAVITY = 900
var JUMP_V = 330 // apex ~= 60px
var MAX_JUMPS = 2 // double jump: one from the ground, one more mid-air
// Shield: an activated buff, not a reflex-timed block — doesn't lock the
// hero out of moving or swinging while it's up. Protects him AND Kira for
// its whole duration, on a cooldown long enough that it's a resource to
// spend deliberately, not a thing to lean on constantly.
var SHIELD_DURATION_MS = 4000
var SHIELD_COOLDOWN_MS = 10000
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

// ---- default character stats -----------------------------------------------
// The one source of truth for a fresh run. Every stat a Dancing-Girl boon can
// touch lives here; freshStats() clones it at game start/restart, and each
// pick permanently mutates the live copy in g.stats for the rest of the run.
var DEFAULT_STATS = { maxHealth: 100, attackDamage: 20, moveSpeedMult: 1 }
function freshStats() {
  return { maxHealth: DEFAULT_STATS.maxHealth, health: DEFAULT_STATS.maxHealth, attackDamage: DEFAULT_STATS.attackDamage, moveSpeedMult: DEFAULT_STATS.moveSpeedMult }
}
var OGRE_HP = 20 // == DEFAULT_STATS.attackDamage, so a base-stat hit still one-shots an ogre
var OGRE_ATK_DAMAGE = 20 // an ogre's club landing
var BOSS_ATK_DAMAGE = 34 // the boss's breath landing — 3 hits kills at 100 max health
var FIREBALL_DAMAGE = 18 // a single phase-3 fireball — lighter since several can be live at once

// ---- dash (double-tap left/right) ------------------------------------------
var DASH_TAP_MS = 280 // max gap between taps to count as a double-tap
var DASH_MS = 160 // dash duration
var DASH_SPEED = 340 // px/s during the dash, independent of moveSpeedMult
var DASH_INVULN_MS = 200 // brief i-frames — the whole point is escaping a homing shot

// ---- homing breath + warning marker -----------------------------------------
// The old fixed-arc breath never visibly reached the hero, so "avoiding" it
// didn't read as avoiding anything. It's now a bolt that launches from the
// mouth and homes in on the hero, capped at a 1s lifetime — quick enough to
// punish standing still, but slow enough (only ~1.5x hero speed) that just
// moving away for that one second is a real answer, and a dash trivially
// beats it. A small red "!" hovers over the hero the whole time it's inbound.
var HOMING_SPEED = 150 // px/s — was 260, which nothing but a dash could outrun
var HOMING_LIFE_MS = 1000
var HOMING_HIT_R = 14

// Phase 1 of the demon boss (full health): 3 fire skulls drift in on the
// hero instead of a single unavoidable breath bolt — a real counterable
// hazard. Slower than the homing bolt they replace, since there are three
// of them and the hero needs the time to actually fight back against at
// least one.
var FIRESKULL_COUNT = 3
var FIRESKULL_SPEED = 70
var FIRESKULL_DAMAGE = 20
var FIRESKULL_LIFE_MS = 6000
var FIRESKULL_HIT_R = 16
var FIRESKULL_SCALE = 0.5

// ---- boss (demon-Files) + wave/upgrade progression -------------------------
// The demon floats rather than walks, so it has no walk cycle — it holds a
// rough distance from the hero (BOSS_ENGAGE) via a slow drift instead of a
// locomotion animation, and cycles telegraph -> attack -> recover on its own
// clock rather than triggering off proximity like the ogre does.
var BOSS_HOVER_Y = GROUND_Y - 46
// After an attack (or the last of a phase-2 chain), the boss drops down to
// BOSS_LOW_Y for the whole recover window — a visible "it's vulnerable now"
// cue, and BOSS_RECOVER_MS gives the hero a real ~3s punish window before it
// climbs back up into the next telegraph.
var BOSS_LOW_Y = GROUND_Y - 14
var BOSS_VERT_SPEED = 70 // px/s, altitude change between hover/low
var BOSS_ENGAGE = 60
var BOSS_HALF = 30 // hero's-attack hit-test half-width (core body, not wings)
// The camera freezes the instant the boss wave starts (g.bossArenaCamX) and
// hero/boss x get clamped to this screen's width for the whole fight — no
// running off down an "infinite" corridor to dodge for free. Margin keeps
// both sprites' own half-width from clipping the frame edge.
var ARENA_MARGIN = 30
var BOSS_RECOVER_MS = 3000
var BOSS_COMBO_RECOVER_MS = 150 // the short beat between chained phase-2 attacks
var BOSS_DRIFT_SPEED = 40 // px/s, position correction only — not a walk anim

// Health is split into thirds: >2/3 is phase 1 (single breath attacks), the
// middle third chains BOSS_COMBO_EXTRA extra attacks back-to-back with only
// the short recover between them, and the bottom third drops the breath
// entirely for 3 volleys of Grotto-FX fireballs, fired one after another
// (reusing the same comboLeft/chaining machinery phase 2 uses).
var BOSS_COMBO_EXTRA = 2
var SPIRAL_VOLLEYS = 3 // fireball volleys per attack, fired one after the other
var SPIRAL_VOLLEY_PAUSE_MS = 400 // beat between volleys — longer than phase 2's, so each is readable
var SPIRAL_COUNT = 3 // fireballs per volley
var SPIRAL_STAGGER_MS = 90 // stagger within one volley
var SPIRAL_SPEED = 130 // px/s
var SPIRAL_SPREAD_DEG = 25 // fireballs fan from -SPREAD..+SPREAD around the aim line to the hero
var SPIRAL_LIFE_MS = 2600

// The breath VFX used to spawn near the ground, nowhere near the demon's
// actual mouth — the bug the boss's fire visibly not coming from its mouth.
// Measured directly off attack frame 7 (312x220, the pose the breath cloud
// first appears in): the mouth sits ~4px left of the frame's own centre and
// ~105px above the sprite's feet anchor. bAtk's contact frame is set to
// match that same pose (index 6, last of the 7-frame clip) so the VFX and
// the pose it's meant to erupt from land on the same tick.
var BOSS_MOUTH_DX = 8 // small forward nudge past the mouth, in facing dir
var BOSS_MOUTH_DY = -105 // relative to the boss's bob-adjusted anchor y

// Two ogre waves per cycle, then the boss; beating the boss starts the next
// (harder) cycle. Kept as plain functions of `cycle` so the curve is easy to
// retune in one place. (Multiple ogres on screen at once per later cycles is
// planned but deliberately deferred — refining cycle 1's boss fight first.)
function ogresPerWave(cycle) { return 2 + cycle } // cycle 1:3, 2:4, 3:5 ...
// Cycle 1 is fixed at 210 (a real fight — ~10-11 hits at base damage); later
// cycles scale up at the same relative rate the old hit-count curve did.
var BOSS_BASE_HP = 210, BOSS_HP_PER_CYCLE = 140
function bossMaxHealthFor(cycle) { return BOSS_BASE_HP + (cycle - 1) * BOSS_HP_PER_CYCLE }

// The three post-boss boons the Dancing Girl (Anya) offers. Each mutates
// g.stats directly and permanently for the rest of the run.
var BOONS = {
  heal: { title: 'Second Wind', desc: 'Fill 5% of your health.', apply: function (s) { s.health = Math.min(s.maxHealth, s.health + s.maxHealth * 0.05) } },
  atk: { title: 'Honed Edge', desc: '+10% attack damage.', icon: 'iconSword', apply: function (s) { s.attackDamage *= 1.10 } },
  spd: { title: 'Fleet Foot', desc: '+10% movement speed.', icon: 'iconScimitar', apply: function (s) { s.moveSpeedMult *= 1.10 } },
}

// The little post-boss scene: hero auto-runs clear across one empty screen,
// then arrives at a second screen where Anya is waiting (POSTBOSS_RUN_DIST,
// covered in a fixed POSTBOSS_RUN_MS regardless of distance — a cinematic
// sprint, not paced by the hero's normal/upgraded speed) -> she dances and
// introduces herself for a full 6s -> the boon choice (pauses for input) ->
// the hero thanks her -> hero auto-runs off for a few seconds -> the next
// cycle's first wave begins. Each beat is plain elapsed time (g.seqT), not
// player input, except the boon pick itself.
var POSTBOSS_RUN_DIST = VW * 2 // a full empty screen, then the one after it
var POSTBOSS_RUN_MS = 4000 // covers POSTBOSS_RUN_DIST in exactly this long
var POSTBOSS_RUN_SPEED = POSTBOSS_RUN_DIST / (POSTBOSS_RUN_MS / 1000)
var ANYA_NAME = 'Anya'
var ANYA_INTRO = 'I am Anya, guardian of these woods. You have earned a boon — choose it well before you continue.'
var HERO_THANKS = 'Thank you, Anya. I will carry this gift with me.'
var DANCER_INTRO_MS = 6000
var DANCER_THANKS_MS = 1800
var DANCER_LEAVE_MS = 3000

// ---- Round 2: the companion (Kira) + multi-enemy waves ---------------------
// Round 1 (ogre waves + the demon boss + Anya) happens exactly once; the
// moment the hero leaves Anya he meets Kira, and from then on the game moves
// into scripted multi-enemy encounters (g.enemies, plural) rather than the
// single-ogre trickle Round 1 used. g.round tracks which era we're in.
var HEROINE_FW = 128, HEROINE_FH = 64, HEROINE_FOOT = 0
var HOUND_FW = 64, HOUND_FH = 48, HOUND_FOOT = 0
var KIRA_NAME = 'Kira'
var KIRA_INTRO = 'I heard the demon fell. I’m with you the rest of the way.'
var HERO_TO_KIRA = 'Glad to have you, ' + KIRA_NAME + '.'
var MEET_KIRA_LINE1_MS = 3600 // was 2600 — felt rushed, given more room to read
var MEET_KIRA_LINE2_MS = 2600 // was 1800

var COMPANION_MAX_HEALTH = 100
var COMPANION_ATK = 25
var COMPANION_SPEED = 90
// Support character, not a second front-liner: she holds a throwing
// distance instead of closing to melee, backing off if anything gets
// inside COMPANION_RANGE_MIN and closing back in past COMPANION_RANGE_MAX.
var COMPANION_RANGE_MIN = 70
var COMPANION_RANGE_MAX = 160
var COMPANION_ATK_COOLDOWN_MS = 550
var COMPANION_FOLLOW_DIST = 34 // where she holds when nothing's alive to fight
// Her evasive dash — a real burst with i-frames, not just walking away at
// normal speed, so she can actually clear a hound's lunge arc or a beast's
// shot instead of eating it while retreating too slowly.
var COMPANION_DASH_SPEED = 260
var COMPANION_DASH_MS = 180
var COMPANION_DASH_INVULN_MS = 260
var COMPANION_DASH_COOLDOWN_MS = 900
// Her dagger throw — the ranged attack replacing her old melee slash.
var COMPANION_DAGGER_SPEED = 260
var COMPANION_DAGGER_LIFE_MS = 1200
// Her support heal — triggers on her own initiative whenever either she or
// the hero drops below the trigger threshold, restoring half of each of
// their max health. Cooldown is a judgment call (not spec'd): long enough
// that it's a real emergency tool, not a constant safety net.
var COMPANION_HEAL_TRIGGER_PCT = 0.4
var COMPANION_HEAL_PCT = 0.5
var COMPANION_HEAL_COOLDOWN_MS = 20000

var HOUND_HP = 50
var HOUND_ATK = 30
var HOUND_SPEED = 62
var HOUND_ENGAGE = 34
// Hell hounds have no attack pose in the source pack — their "telegraph" is
// just holding still for a beat before the lunge, and the lunge itself
// reuses their run cycle sped up, rather than a dedicated swing animation.
var HOUND_TELE_MS = 320
var HOUND_LUNGE_MS = 220
var HOUND_LUNGE_SPEED = 230
var HOUND_RECOVER_MS = 500
var HOUND_ARC_NEAR = 2, HOUND_ARC_FAR = 26
var HOUND_HALF = 14

// Hell Beast: no walk cycle in the source pack either — it's a stationary
// turret. It only wakes up once a target wanders within BEAST_DETECT, then
// winds up (its own Breath pose) and spits a single aimed shot using its
// own tiny fireball sprite (not the Grotto one the demon boss uses).
var BEAST_FW = 80, BEAST_FH = 160, BEAST_FOOT = 0
var BEAST_HP = 30
var BEAST_ATK = 30
var BEAST_DETECT = 220
var BEAST_TELE_MS = 500
var BEAST_RECOVER_MS = 900
var BEAST_PROJ_SPEED = 150
var BEAST_PROJ_LIFE_MS = 2200
var BEAST_HALF = 18
var BEAST_MOUTH_DY = -55

// Round 2's boss wave: the Dragon Boss. Ranged only — it holds its distance
// (like the Hell Beast, but airborne and mobile) and reads its attack
// pattern straight off remaining health, same idea as the demon boss's
// bossPhase, but landing on breath-count/cadence instead of a melee combo.
// Full health: 1 bolt at a time. Middle third: a 3-bolt fan. Bottom third:
// a genuine barrage (DRAGON_BARRAGE_MS) with a DRAGON_BREAK_MS opening after
// each one for the hero and Kira to actually punish it.
var DRAGON_FW = 144, DRAGON_FH = 64, DRAGON_FOOT = 0
var DRAGON_HOVER_Y = GROUND_Y - 46
var DRAGON_HP = 500
var DRAGON_ATK = 60
var DRAGON_ENGAGE = 95 // the distance it tries to hold — well outside melee
var DRAGON_MOUTH_DX = 12
var DRAGON_MOUTH_DY = -34
var DRAGON_TELE_MS = 500
var DRAGON_RECOVER_MS = 1100
var DRAGON_PROJ_SPEED = 160
var DRAGON_PROJ_LIFE_MS = 2400
var DRAGON_TRIPLE_SPREAD_DEG = 18 // half-angle of the 3-bolt fan
var DRAGON_BARRAGE_MS = 2500
var DRAGON_BREAK_MS = 3000
var DRAGON_BARRAGE_SHOT_MS = 380 // cadence between bolts during the barrage
var DRAGON_HALF = 40 // hero's/Kira's attack hit-test half-width

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
  // demon-Files: idle (256x176) and attack (312x220) are different crop
  // boxes, so each anim carries its own fw/fh rather than the single shared
  // constant hero/ogre frames use. The attack sheet is trimmed to the first
  // 7 of the source's 18 frames — the wind-up into the pose the breath first
  // appears in (contact = index 6, the last frame of the clip); frames 7-18
  // of the source are that same held pose repeated, so nothing is lost.
  bIdle: { img: 'bossIdle', n: 6, fps: 6, loop: true, fw: 256, fh: 176 },
  bAtk: { img: 'bossAttack', n: 7, fps: 8, loop: false, fw: 312, fh: 220, contact: 6 },
  // Dancing Girl: a calm hip-sway loop used as her "offering boons" idle.
  dIdle: { img: 'dancerIdle', n: 8, fps: 8, loop: true, fw: DANCER_FW, fh: DANCER_FH },
  // A livelier finger-snap step, played while she's introducing herself —
  // she settles into the calmer hip-sway (dIdle) once she gets to business.
  dDance: { img: 'dancerDance', n: 8, fps: 10, loop: true, fw: DANCER_FW, fh: DANCER_FH },
  // Kira, the companion — her attack already bakes in a glowing energy-arc
  // swing in the source frames, so no extra "magic" overlay is needed there.
  cIdle: { img: 'heroineIdle', n: 4, fps: 6, loop: true, fw: HEROINE_FW, fh: HEROINE_FH },
  cRun: { img: 'heroineRun', n: 7, fps: 14, loop: true, fw: HEROINE_FW, fh: HEROINE_FH },
  cAtk: { img: 'heroineAttack', n: 5, fps: 14, loop: false, fw: HEROINE_FW, fh: HEROINE_FH, active: [1, 2] },
  cJump: { img: 'heroineJump', n: 4, fps: 10, loop: true, fw: HEROINE_FW, fh: HEROINE_FH },
  // Hell hound: no attack pose exists, so the lunge reuses the run cycle
  // (hRun) sped up rather than a dedicated swing.
  hIdle: { img: 'houndIdle', n: 11, fps: 8, loop: true, fw: HOUND_FW, fh: HOUND_FH },
  hWalk: { img: 'houndWalk', n: 12, fps: 10, loop: true, fw: HOUND_FW, fh: HOUND_FH },
  hRun: { img: 'houndRun', n: 5, fps: 18, loop: true, fw: HOUND_FW, fh: HOUND_FH },
  // Hell Beast reuses its "Breath" pose as the wind-up/attack animation —
  // the actual shot is a separate projectile (see FX.beastFireball).
  beastIdle: { img: 'beastIdle', n: 6, fps: 6, loop: true, fw: BEAST_FW, fh: BEAST_FH },
  beastAttack: { img: 'beastAttack', n: 4, fps: 9, loop: false, fw: BEAST_FW, fh: BEAST_FH, contact: 2 },
  // Dragon Boss: idle hover + its one "Breath" pose, reused both for a
  // single telegraphed shot (phases 1-2) and, replayed on a loop by
  // updateDragon itself, for the sustained phase-3 barrage.
  dragonIdle: { img: 'dragonIdle', n: 6, fps: 8, loop: true, fw: DRAGON_FW, fh: DRAGON_FH },
  dragonBreath: { img: 'dragonBreath', n: 7, fps: 11, loop: false, fw: DRAGON_FW, fh: DRAGON_FH, contact: 3 },
  fireSkull: { img: 'fireSkull', n: 8, fps: 12, loop: true, fw: 96, fh: 112 },
}

// Grotto-escape-2-FX overlays, played once on the attacker's contact frame.
var FX = {
  slashUp: { img: 'slashUp', n: 5, fps: 22, fw: 52, fh: 56, sc: 1.7 }, // 260x56 — HIGH
  slashHoriz: { img: 'slashHoriz', n: 5, fps: 24, fw: 65, fh: 40, sc: 1.4 }, // 325x40 — LOW
  bossBreath: { img: 'bossBreath', n: 5, fps: 18, fw: 160, fh: 96, sc: 1.6 }, // demon breath cloud
  fireball: { img: 'fireballProj', n: 3, fps: 14, fw: 52, fh: 29, sc: 1.3 }, // phase-3 spiral shot
  beastFireball: { img: 'beastFireball', n: 3, fps: 12, fw: 19, fh: 16, sc: 2.4 }, // Hell Beast's own shot
  dagger: { img: 'dagger', n: 1, fps: 1, fw: 32, fh: 32, sc: 1.1, spin: true }, // Kira's thrown dagger
}

var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v }
var sign = function (v) { return v < 0 ? -1 : v > 0 ? 1 : 0 }
var DEG = Math.PI / 180

function newHero() {
  return {
    x: 0, feetY: GROUND_Y, vy: 0, facing: 1, onGround: true,
    state: 'idle', anim: 'idle', animT: 0, frame: 0, done: false,
    lockT: 0, invuln: 0, swung: false, hitShake: 0,
    dashT: 0, dashDir: 0, lastTapLeft: -9999, lastTapRight: -9999, trail: [],
    jumpsUsed: 0, shieldT: 0, shieldCooldown: 0,
  }
}
// Ogres ALWAYS enter from the right, just past the right screen edge, in
// world space — so they scroll in with the parallax world.
function newOgre(heroX) {
  return {
    x: heroX + (VW - HERO_SCREEN_X) + 28, feetY: GROUND_Y, facing: -1,
    state: 'walk', anim: 'oWalk', animT: 0, frame: 0, done: false,
    t: 0, atk: 'high', struck: false, deadT: 0, hp: OGRE_HP,
  }
}
// The boss enters from offscreen right, same as an ogre, then holds a rough
// distance from the hero (BOSS_ENGAGE) via drift rather than a walk cycle.
function newBoss(heroX, hp) {
  return {
    x: heroX + (VW - HERO_SCREEN_X) + 28, feetY: BOSS_HOVER_Y, facing: -1,
    state: 'telegraph', anim: 'bIdle', animT: 0, frame: 0, done: false,
    t: 0, struck: false, deadT: 0,
    hp: hp, maxHp: hp, hitFlash: 0, bob: Math.random() * 10,
    phase: 1, comboLeft: 0, chaining: false,
  }
}
function newDancer(heroX) {
  return { x: heroX + 70, feetY: GROUND_Y, facing: -1, anim: 'dIdle', animT: 0, frame: 0 }
}
// Kira starts inactive (just standing in for the meet-and-greet beat);
// active=true once the dialogue finishes and she actually starts fighting.
function newCompanion(x) {
  return {
    x: x, feetY: GROUND_Y, facing: 1, active: false,
    state: 'idle', anim: 'cIdle', animT: 0, frame: 0, done: false,
    hp: COMPANION_MAX_HEALTH, maxHp: COMPANION_MAX_HEALTH,
    targetId: -1, swung: false, atkCooldown: 0, hitFlash: 0, invuln: 0,
    dashCooldown: 0, dashT: 0,
    vy: 0, onGround: true, jumpsUsed: 0, jumpCooldown: 0,
    healCooldown: 0,
  }
}
// Hell hounds spawn already engaged, spread out a little so a pair doesn't
// perfectly overlap; `id` lets attacks/targeting refer to one unambiguously.
function newHound(x, id) {
  return {
    id: id, type: 'hound', x: x, feetY: GROUND_Y, facing: -1,
    state: 'approach', anim: 'hWalk', animT: 0, frame: 0, done: false,
    t: 0, struck: false, deadT: 0, hp: HOUND_HP, maxHp: HOUND_HP, hitFlash: 0,
    lungeDir: 0,
  }
}
// Hell Beasts hold their ground — no approach/lunge states, just
// idle -> telegraph -> attack -> recover in place.
function newBeast(x, id) {
  return {
    id: id, type: 'beast', x: x, feetY: GROUND_Y, facing: -1,
    state: 'idle', anim: 'beastIdle', animT: 0, frame: 0, done: false,
    t: 0, struck: false, deadT: 0, hp: BEAST_HP, maxHp: BEAST_HP, hitFlash: 0,
  }
}
// Round 2's boss — enters the same way the demon boss does (offscreen
// right, arena camera frozen behind it in advanceAfterOgreDeath's
// equivalent for wave2's clear), but airborne and holding its distance.
function newDragon(heroX, hp) {
  return {
    kind: 'dragon', x: heroX + (VW - HERO_SCREEN_X) + 28, feetY: GROUND_Y, facing: -1,
    state: 'telegraph', anim: 'dragonIdle', animT: 0, frame: 0, done: false,
    t: 0, struck: false, deadT: 0, hp: hp, maxHp: hp, hitFlash: 0, bob: Math.random() * 10,
    shotsLeft: 0, shotTimer: 0, barrageT: 0, grounded: true,
  }
}
// A fire skull drifting toward the hero — free-flying (x/y, not a
// feetY-anchored ground entity like everything else), hittable, and
// destroyed either by a swing or by actually landing its hit.
function newFireSkull(x, y) {
  return { x: x, y: y, anim: 'fireSkull', animT: Math.random() * 2, frame: 0, done: false, dead: false, deadT: 0, t: 0 }
}

function setAnim(o, name) {
  if (o.anim !== name) { o.anim = name; o.animT = 0; o.frame = 0; o.done = false }
}
// fpsMult speeds the whole clip (not just a truncated lockT), so a stacked
// speed-up plays the swing faster start-to-finish rather than cutting it off
// mid-frame — the caller keeps hero.lockT in sync with the same factor.
function stepAnim(o, dt, fpsMult) {
  var a = ANIM[o.anim]
  if (!a) return
  var fps = a.fps * (fpsMult || 1)
  o.animT += dt
  var f = Math.floor(o.animT * fps)
  if (a.loop) { o.frame = f % a.n; o.done = false }
  else if (f >= a.n) { o.frame = a.n - 1; o.done = true }
  else { o.frame = f; o.done = false }
}
function bossPhase(b) {
  if (b.hp <= b.maxHp / 3) return 3
  if (b.hp <= (b.maxHp * 2) / 3) return 2
  return 1
}
function dragonPhase(b) {
  if (b.hp <= b.maxHp / 3) return 3
  if (b.hp <= (b.maxHp * 2) / 3) return 2
  return 1
}

export default function GothicvaniaDuel() {
  var canvasRef = useRef(null)
  var G = useRef(null)
  if (!G.current) {
    var h0 = newHero()
    G.current = {
      hero: h0, ogre: newOgre(h0.x), boss: null, dancer: null, companion: null, enemies: [],
      vfx: [], projectiles: [], allyProjectiles: [], homing: [], fireSkulls: [], fog: [],
      keys: new Set(), pendJump: false, pendAtk: false, pendDash: 0, pendShield: false,
      phase: 'loading', running: false, last: 0, acc: 0,
      stats: freshStats(), score: 0, reduced: false, round: 1,
      cycle: 1, wave: 'wave1', waveKills: 0, waveTarget: ogresPerWave(1),
      announce: null, postbossTargetX: 0, bossArenaCamX: 0, seqT: 0,
    }
  }
  var g = G.current

  var hp = useState(100), health = hp[0], setHealth = hp[1]
  var sc = useState(0), score = sc[0], setScore = sc[1]
  var ph = useState('loading'), phase = ph[0], setPhase = ph[1]
  var cy = useState(1), cycle = cy[0], setCycle = cy[1]
  var ks = useState(true), kiraSurvived = ks[0], setKiraSurvived = ks[1]

  var reset = useCallback(function () {
    g.hero = newHero()
    g.ogre = newOgre(g.hero.x)
    g.boss = null; g.dancer = null; g.companion = null; g.enemies = []
    g.vfx = []; g.projectiles = []; g.allyProjectiles = []; g.homing = []; g.fireSkulls = []
    g.stats = freshStats(); g.score = 0; g.round = 1
    g.cycle = 1; g.wave = 'wave1'; g.waveKills = 0; g.waveTarget = ogresPerWave(1)
    g.announce = null
    setHealth(100); setScore(0); setCycle(1); setKiraSurvived(true)
    g.phase = 'playing'; setPhase('playing')
    g.running = true; g.last = performance.now(); g.acc = 0
  }, [])

  var begin = useCallback(function () {
    g.phase = 'playing'; setPhase('playing')
    g.running = true; g.last = performance.now(); g.acc = 0
  }, [])

  // Called from the Dancing Girl's boon-choice overlay — outside the
  // sprite/loop effect below, so it only touches the ref + module-level
  // helpers, never canvas/IMG state that effect owns.
  var pickBoon = useCallback(function (id) {
    BOONS[id].apply(g.stats)
    setHealth(Math.round((g.stats.health / g.stats.maxHealth) * 100))
    g.cycle++; setCycle(g.cycle)
    // Dancer stays on screen for the Thanks/Leave beats — cleared at the end
    // of dancerLeave (see updateHero), not here.
    g.wave = 'dancerThanks'; g.seqT = 0
    g.announce = { text: HERO_THANKS, speaker: 'You', t: 0, dur: DANCER_THANKS_MS, kind: 'dialogue' }
    g.phase = 'playing'; setPhase('playing')
    g.running = true; g.last = performance.now(); g.acc = 0
  }, [])

  // ---- input ---------------------------------------------------------------
  useEffect(function () {
    var press = function (code) {
      if (code === 'jump') g.pendJump = true
      if (code === 'atk') g.pendAtk = true
      if (code === 'shield') g.pendShield = true
    }
    var kd = function (e) {
      var k = e.key
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown' || k === ' ') e.preventDefault()
      var had = g.keys.has(k); g.keys.add(k)
      if (had) return
      if (k === 'ArrowUp' || k === ' ') press('jump')
      if (k === 'x' || k === 'X') press('atk')
      if (k === 'q' || k === 'Q') press('shield')
      // double-tap left/right -> dash. Each side tracks its own last-tap
      // time on the hero so the two directions can't cross-trigger each other.
      var now = performance.now(), hero = g.hero
      if (k === 'ArrowLeft') {
        if (now - hero.lastTapLeft < DASH_TAP_MS) g.pendDash = -1
        hero.lastTapLeft = now
      } else if (k === 'ArrowRight') {
        if (now - hero.lastTapRight < DASH_TAP_MS) g.pendDash = 1
        hero.lastTapRight = now
      }
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
    // The shield's bubble — a soft glassy fill plus a brighter rim, with a
    // slow pulse so a held-still shield doesn't read as a static sticker.
    function drawShieldBubble(cx, feetY, halfH) {
      var pulse = 0.75 + 0.2 * Math.sin(performance.now() / 220)
      var cy = feetY - halfH
      ctx.save()
      ctx.globalAlpha = 0.85
      ctx.fillStyle = 'rgba(90,170,240,0.16)'
      ctx.beginPath(); ctx.ellipse(cx, cy, halfH * 0.95, halfH + 6, 0, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = pulse
      ctx.strokeStyle = '#7ec6ff'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.ellipse(cx, cy, halfH * 0.95, halfH + 6, 0, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    }
    function label(txt, cx, y, col) {
      ctx.save()
      ctx.font = '700 11px Oswald, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)'
      ctx.strokeText(txt, cx, y); ctx.fillStyle = col; ctx.fillText(txt, cx, y)
      ctx.restore()
    }
    // Where the boss's mouth actually is on screen this frame — shared by
    // the breath VFX and the phase-3 fireball spawn point so neither one can
    // drift away from the sprite's own pose again.
    function bossMouth(b, bobY) {
      return { x: b.x - camXRef.v + BOSS_MOUTH_DX * b.facing, y: bobY + BOSS_MOUTH_DY }
    }
    function dragonMouth(b, bobY) {
      return { x: b.x - camXRef.v + DRAGON_MOUTH_DX * b.facing, y: bobY + DRAGON_MOUTH_DY }
    }
    var camXRef = { v: 0 } // updated once per render(), read by bossMouth

    // ---- in-canvas HUD -------------------------------------------------
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
    function drawHealthBar() {
      var bw = 84, bh = 9, bx = 8, by = 5
      var pct = clamp(g.stats.health / g.stats.maxHealth, 0, 1)
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 2
      ctx.fillStyle = 'rgba(10,9,8,0.75)'; ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4)
      ctx.fillStyle = 'rgba(70,16,16,0.9)'; ctx.fillRect(bx, by, bw, bh)
      ctx.fillStyle = pct > 0.5 ? '#c0362c' : pct > 0.22 ? '#d3552f' : '#e0503d'
      ctx.fillRect(bx, by, bw * pct, bh)
      ctx.strokeStyle = 'rgba(233,223,201,0.5)'; ctx.lineWidth = 1
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1)
      ctx.restore()
      ctx.save()
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      drawHudText(Math.max(0, Math.round(g.stats.health)) + '/' + g.stats.maxHealth, bx + bw + 6, by + bh, '600 9px Oswald, system-ui, sans-serif', 'rgba(224,215,198,0.85)')
      ctx.restore()
    }
    // Shield readiness icon — a small radial-wipe pie under the health bar:
    // empty and dim the instant it's used, filling clockwise as the 10s
    // cooldown elapses, solid blue (brighter still while actually active)
    // once it's ready again. Q to use.
    function drawShieldIcon() {
      var hero = g.hero
      var cx = 16, cy = 30, r = 8
      var ready = hero.shieldCooldown <= 0
      var pct = ready ? 1 : 1 - clamp(hero.shieldCooldown / SHIELD_COOLDOWN_MS, 0, 1)
      ctx.save()
      ctx.beginPath(); ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(10,9,8,0.75)'; ctx.fill()
      ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(120,120,120,0.35)'; ctx.fill()
      if (pct > 0) {
        ctx.beginPath(); ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, r - 1, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2)
        ctx.closePath()
        ctx.fillStyle = ready ? '#bfe4ff' : '#4a90c4'
        ctx.fill()
      }
      ctx.strokeStyle = ready ? '#7ec6ff' : 'rgba(233,223,201,0.4)'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
      ctx.save()
      ctx.textAlign = 'left'
      drawHudText('Q', cx + r + 4, cy + 3, '700 9px Oswald, system-ui, sans-serif', 'rgba(224,215,198,0.7)')
      ctx.restore()
    }
    function drawHUD() {
      drawHealthBar()
      drawShieldIcon()
      ctx.save()
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'right'
      drawHudText('SCORE', VW - 34, 17, '600 10px Oswald, system-ui, sans-serif', 'rgba(224,215,198,0.92)')
      drawHudText(String(g.score), VW - 9, 18, '600 16px Oswald, system-ui, sans-serif', '#f4ecd6')
      ctx.restore()
      drawWaveHUD()
    }
    // Top-center: which ogre wave we're on, or the boss's health bar once
    // the fight starts. textAlign is set once here (not inside drawHudText,
    // which only touches font/stroke/fill) the same way drawHUD does above.
    function drawWaveHUD() {
      ctx.save()
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
      if ((g.wave === 'boss' || g.wave === 'r2boss') && g.boss) {
        var b = g.boss, bw = 180, bh = 7, bx = VW / 2 - bw / 2, by = 7
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4)
        ctx.fillStyle = 'rgba(70,16,16,0.9)'; ctx.fillRect(bx, by, bw, bh)
        var pct = clamp(b.hp / b.maxHp, 0, 1)
        ctx.fillStyle = '#c0362c'; ctx.fillRect(bx, by, bw * pct, bh)
        // third-marks so the phase breakpoints are visible on the bar itself
        ctx.fillStyle = 'rgba(0,0,0,0.4)'
        ctx.fillRect(bx + bw / 3, by, 1, bh)
        ctx.fillRect(bx + (bw * 2) / 3, by, 1, bh)
        drawHudText(b.kind === 'dragon' ? 'DRAGON BOSS' : 'BOSS WAVE', VW / 2, by + bh + 12, '700 10px Oswald, system-ui, sans-serif', 'rgba(224,215,198,0.92)')
      } else if (g.wave === 'wave1' || g.wave === 'wave2') {
        drawHudText(g.wave === 'wave1' ? 'WAVE 1' : 'WAVE 2', VW / 2, 17, '700 9px Oswald, system-ui, sans-serif', 'rgba(224,215,198,0.75)')
      } else if (g.wave === 'r2wave1' || g.wave === 'r2wave2') {
        drawHudText(g.wave === 'r2wave1' ? 'WAVE 1' : 'WAVE 2', VW / 2, 17, '700 9px Oswald, system-ui, sans-serif', 'rgba(224,215,198,0.75)')
      }
      ctx.restore()
      if (g.announce && g.announce.t < g.announce.dur) {
        ctx.save()
        var fadeStart = g.announce.dur - 300
        ctx.globalAlpha = g.announce.t < fadeStart ? 1 : 1 - (g.announce.t - fadeStart) / 300
        if (g.announce.kind === 'dialogue') {
          drawDialogue(g.announce.speaker, g.announce.text)
        } else {
          ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
          drawHudText(g.announce.text, VW / 2, VH * 0.34, '700 13px Pirata One, serif', g.announce.col || '#e0503d')
        }
        ctx.restore()
      }
    }
    // Breaks `text` into lines no wider than maxW at the given font — used
    // so a full dialogue sentence never silently overflows its box.
    function wrapText(text, font, maxW) {
      ctx.font = font
      var words = text.split(' '), lines = [], cur = ''
      for (var i = 0; i < words.length; i++) {
        var test = cur ? cur + ' ' + words[i] : words[i]
        if (cur && ctx.measureText(test).width > maxW) { lines.push(cur); cur = words[i] }
        else cur = test
      }
      if (cur) lines.push(cur)
      return lines
    }
    // A proper speech box for Anya/the hero's lines — a real name label plus
    // a clear sans-serif body font on a backing panel, instead of the boss's
    // one-line Pirata One combat banner (too decorative to read as dialogue,
    // and too easily lost against the busy background without a backing).
    function drawDialogue(speaker, text) {
      var font = '600 10px Oswald, system-ui, sans-serif'
      var boxW = VW - 56
      var lines = wrapText(text, font, boxW - 20)
      var lineH = 13
      var boxH = 16 + lines.length * lineH
      var bx = VW / 2 - boxW / 2, by = VH * 0.16
      ctx.save()
      ctx.fillStyle = 'rgba(10,9,8,0.78)'
      ctx.fillRect(bx, by, boxW, boxH)
      ctx.strokeStyle = 'rgba(224,153,58,0.55)'; ctx.lineWidth = 1
      ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1)
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
      drawHudText(speaker.toUpperCase(), VW / 2, by + 11, '700 8px Oswald, system-ui, sans-serif', '#e0993a')
      for (var i = 0; i < lines.length; i++) {
        drawHudText(lines[i], VW / 2, by + 24 + i * lineH, font, '#f4ecd6')
      }
      ctx.restore()
    }

    // ---- simulation ---------------------------------------------------
    function damageHero(from, dmg) {
      var hero = g.hero
      if (hero.shieldT > 0) { onShieldBlock(hero.x, from); return }
      hero.state = 'hurt'; setAnim(hero, 'hurt')
      hero.lockT = 0.32; hero.invuln = HIT_INVULN_MS
      hero.hitShake = g.reduced ? 0 : 160
      var away = sign(hero.x - from) || 1
      hero.x += away * 9
      g.vfx.push({ kind: 'hit', x: hero.x, y: GROUND_Y - 42, t: 0 })
      g.stats.health = Math.max(0, g.stats.health - dmg)
      setHealth(Math.round((g.stats.health / g.stats.maxHealth) * 100))
      if (g.stats.health <= 0) {
        g.phase = 'over'; setPhase('over'); g.running = false; g.announce = null
        setScore(g.score)
      }
    }
    // The shield blocks the hit outright — a spark at whoever it protected
    // rather than a banner, since it's meant to read as routine while it's
    // up, not a one-off trick like the parry it replaced.
    function onShieldBlock(atX, fromX) {
      g.vfx.push({ kind: 'hit', x: atX, y: GROUND_Y - 42, t: 0 })
    }
    function hitOgre(o) {
      o.hp -= g.stats.attackDamage
      g.hero.swung = true
      if (o.hp > 0) {
        g.vfx.push({ kind: 'hit', x: o.x, y: GROUND_Y - 40, t: 0 })
        return
      }
      o.state = 'dead'; o.deadT = 0; o.anim = null
      g.vfx.push({ kind: 'death', x: o.x, y: GROUND_Y - 34, t: 0 })
      g.score += 20; setScore(g.score)
    }
    // Called once the dead ogre's respawn delay elapses (see updateOgre).
    // Counts it against the current wave's quota and either spawns the next
    // ogre, or — once the quota's met — moves straight on (wave1 -> wave2,
    // wave2 -> boss). Upgrades no longer interrupt the waves; the Dancing
    // Girl only shows up after the boss falls.
    function advanceAfterOgreDeath() {
      g.waveKills++
      if (g.waveKills >= g.waveTarget) {
        if (g.wave === 'wave1') {
          g.wave = 'wave2'; g.waveKills = 0; g.waveTarget = ogresPerWave(g.cycle)
          g.ogre = newOgre(g.hero.x)
        } else {
          g.wave = 'boss'
          // Freeze the camera right here — the boss arena is exactly this
          // one screen's width, not an infinite corridor the hero can flee
          // down. updateHero clamps hero.x (and the boss) to it below.
          g.bossArenaCamX = g.hero.x - HERO_SCREEN_X
          g.boss = newBoss(g.hero.x, bossMaxHealthFor(g.cycle))
        }
      } else {
        g.ogre = newOgre(g.hero.x)
      }
    }
    function hitBoss() {
      var boss = g.boss
      boss.hp -= g.stats.attackDamage; boss.hitFlash = 160
      g.vfx.push({ kind: 'hit', x: boss.x, y: BOSS_HOVER_Y - 10, t: 0 })
      g.hero.swung = true
      var wasPhase = boss.phase, nowPhase = bossPhase(boss)
      if (nowPhase > wasPhase) {
        boss.phase = nowPhase
        g.announce = { text: nowPhase === 2 ? 'THE DEMON’S FURY GROWS' : 'THE DEMON UNLEASHES FIRE', t: 0, dur: 1600, kind: 'banner' }
      }
      if (boss.hp <= 0) killBoss()
    }
    function killBoss() {
      var boss = g.boss
      boss.state = 'dead'; boss.deadT = 0; boss.anim = null
      g.vfx.push({ kind: 'death', x: boss.x, y: BOSS_HOVER_Y - 10, t: 0 })
      g.projectiles = []; g.homing = []
      g.score += 100; setScore(g.score)
      applyBossVictoryBoost()
    }
    // Every boss kill (the demon boss now, the Dragon Boss later) permanently
    // grows the hero — +200% health (both the cap and his current fill, so
    // the reward actually reads on the bar right away) and +15 attack damage.
    // Kira shares the health boost too, but only once she's actually in the
    // party — she isn't recruited yet when the demon boss falls.
    function applyBossVictoryBoost() {
      g.stats.maxHealth *= 3
      g.stats.health *= 3
      g.stats.attackDamage += 15
      setHealth(Math.round((g.stats.health / g.stats.maxHealth) * 100))
      if (g.companion) {
        g.companion.maxHp *= 3
        g.companion.hp *= 3
      }
      g.announce = { text: 'YOUR STRENGTH SURGES', t: 0, dur: 1800, kind: 'banner', col: '#e0993a' }
    }

    // ---- Round 2: Kira + hell hounds ----------------------------------
    function damageCompanion(from, dmg) {
      var c = g.companion
      if (!c || !c.active || c.invuln > 0 || c.hp <= 0) return
      if (g.hero.shieldT > 0) { onShieldBlock(c.x, from); return }
      c.hitFlash = 300; c.invuln = 700
      var away = sign(c.x - from) || 1
      c.x += away * 6
      g.vfx.push({ kind: 'hit', x: c.x, y: GROUND_Y - 40, t: 0 })
      c.hp = Math.max(0, c.hp - dmg)
    }
    // Shared by both the hero's and Kira's attacks, and by every Round 2
    // enemy type (hound or beast) — dmg is whichever of theirs landed.
    function hitEnemy(e, dmg) {
      if (e.state === 'dead') return
      e.hp -= dmg
      if (e.hp > 0) { e.hitFlash = 150; g.vfx.push({ kind: 'hit', x: e.x, y: GROUND_Y - 30, t: 0 }); return }
      e.state = 'dead'; e.deadT = 0
      g.vfx.push({ kind: 'death', x: e.x, y: GROUND_Y - 26, t: 0 })
      g.score += 15; setScore(g.score)
    }
    function hitDragon(dmg) {
      var b = g.boss
      if (!b || b.state === 'dead') return
      b.hp -= dmg; b.hitFlash = 160
      g.vfx.push({ kind: 'hit', x: b.x, y: DRAGON_HOVER_Y - 10, t: 0 })
      var wasPhase = dragonPhase({ hp: b.hp + dmg, maxHp: b.maxHp }), nowPhase = dragonPhase(b)
      if (nowPhase > wasPhase) {
        g.announce = {
          text: nowPhase === 2 ? 'THE DRAGON GROWS DESPERATE' : 'THE DRAGON UNLEASHES ITS FURY',
          t: 0, dur: 1600, kind: 'banner',
        }
      }
      if (b.hp <= 0) killDragon()
    }
    function killDragon() {
      var b = g.boss
      b.state = 'dead'; b.deadT = 0; b.anim = null
      g.vfx.push({ kind: 'death', x: b.x, y: DRAGON_HOVER_Y - 10, t: 0 })
      g.projectiles = []; g.allyProjectiles = []
      g.score += 250; setScore(g.score)
      applyBossVictoryBoost()
      // Which ending line plays depends on whether Kira made it this far —
      // captured now, right as the fight ends, rather than re-derived later
      // from state that keeps changing after this.
      setKiraSurvived(!!(g.companion && g.companion.hp > 0))
    }
    function livingTargets() {
      var hero = g.hero, list = [hero]
      if (g.companion && g.companion.active && g.companion.hp > 0) list.push(g.companion)
      return list
    }
    function nearestTarget(x, targets) {
      var best = targets[0], bestD = Math.abs(targets[0].x - x)
      for (var i = 1; i < targets.length; i++) {
        var d = Math.abs(targets[i].x - x)
        if (d < bestD) { bestD = d; best = targets[i] }
      }
      return best
    }
    // No dedicated attack pose exists for the hound, so its "telegraph" is
    // just holding still for a beat, then a fast lunge (run cycle sped up)
    // that can land on either the hero or Kira, whichever it's aimed at.
    function updateHound(e, dt) {
      var dtms = dt * 1000
      if (e.hitFlash > 0) e.hitFlash -= dtms
      if (e.state === 'dead') { e.deadT += dtms; return }

      var targets = livingTargets()
      var target = nearestTarget(e.x, targets)

      if (e.state === 'approach') {
        var dir = sign(target.x - e.x) || e.facing
        e.facing = dir
        e.x += dir * HOUND_SPEED * dt
        setAnim(e, 'hWalk')
        if (Math.abs(target.x - e.x) <= HOUND_ENGAGE) { e.state = 'telegraph'; e.t = 0; setAnim(e, 'hIdle') }
      } else if (e.state === 'telegraph') {
        e.t += dtms
        e.facing = sign(target.x - e.x) || e.facing
        if (e.t >= HOUND_TELE_MS) {
          e.state = 'lunge'; e.t = 0; e.struck = false; e.lungeDir = e.facing
          setAnim(e, 'hRun')
        }
      } else if (e.state === 'lunge') {
        e.t += dtms
        e.x += e.lungeDir * HOUND_LUNGE_SPEED * dt
        if (!e.struck) {
          for (var i = 0; i < targets.length; i++) {
            var tg = targets[i]
            var dxf = (tg.x - e.x) * e.lungeDir
            var facingIt = sign(tg.x - e.x) === e.lungeDir || tg.x === e.x
            var inArc = dxf > HOUND_ARC_NEAR - HOUND_HALF && dxf < HOUND_ARC_FAR + HOUND_HALF
            if (inArc && facingIt) {
              if (tg === g.hero) { if (tg.invuln <= 0 && tg.state !== 'hurt') { damageHero(e.x, HOUND_ATK); e.struck = true } }
              else { damageCompanion(e.x, HOUND_ATK); e.struck = true }
            }
          }
        }
        if (e.t >= HOUND_LUNGE_MS) { e.state = 'recover'; e.t = 0; setAnim(e, 'hIdle') }
      } else if (e.state === 'recover') {
        e.t += dtms
        if (e.t >= HOUND_RECOVER_MS) { e.state = 'approach'; setAnim(e, 'hWalk') }
      }
      stepAnim(e, dt)
    }
    // Hell Beast: never moves. Wakes up once something wanders within
    // BEAST_DETECT, winds up, and spits one aimed shot (not a volley) —
    // simple and readable since it can't chase or reposition at all.
    function updateBeast(e, dt) {
      var dtms = dt * 1000
      if (e.hitFlash > 0) e.hitFlash -= dtms
      if (e.state === 'dead') { e.deadT += dtms; return }

      var targets = livingTargets()
      var target = nearestTarget(e.x, targets)
      var dist = Math.abs(target.x - e.x)
      e.facing = sign(target.x - e.x) || e.facing

      if (e.state === 'idle') {
        setAnim(e, 'beastIdle')
        if (dist <= BEAST_DETECT) { e.state = 'telegraph'; e.t = 0 }
      } else if (e.state === 'telegraph') {
        e.t += dtms
        e.facing = sign(target.x - e.x) || e.facing
        if (e.t >= BEAST_TELE_MS) { e.state = 'attack'; e.t = 0; e.struck = false; setAnim(e, 'beastAttack') }
      } else if (e.state === 'attack') {
        stepAnim(e, dt)
        if (!e.struck && e.frame >= ANIM.beastAttack.contact) {
          e.struck = true
          var mx = e.x, my = e.feetY + BEAST_MOUTH_DY
          var tgY = target === g.hero ? target.feetY - 26 : target.feetY - HEROINE_FH * 0.5
          var aim = Math.atan2(tgY - my, target.x - mx)
          g.projectiles.push({
            x: mx, y: my, vx: Math.cos(aim) * BEAST_PROJ_SPEED, vy: Math.sin(aim) * BEAST_PROJ_SPEED,
            launchIn: 0, t: 0, dead: false, dmg: BEAST_ATK, life: BEAST_PROJ_LIFE_MS, fxKey: 'beastFireball',
          })
        }
        if (e.done) { e.state = 'recover'; e.t = 0; setAnim(e, 'beastIdle') }
      } else if (e.state === 'recover') {
        e.t += dtms
        if (e.t >= BEAST_RECOVER_MS) { e.state = 'idle'; setAnim(e, 'beastIdle') }
      }
      if (e.state !== 'attack') stepAnim(e, dt)
    }
    // Kira: picks the nearest living enemy, closes to melee, swings on a
    // cooldown, and backs off instead of trading blows if a hound is mid-
    // lunge close by. Falls back to just keeping pace with the hero when
    // nothing's alive to fight.
    function updateCompanion(dt) {
      var c = g.companion, hero = g.hero, dtms = dt * 1000
      if (!c || !c.active) return
      if (c.hitFlash > 0) c.hitFlash -= dtms
      if (c.invuln > 0) c.invuln -= dtms
      if (c.atkCooldown > 0) c.atkCooldown -= dtms
      if (c.dashCooldown > 0) c.dashCooldown -= dtms
      if (c.healCooldown > 0) c.healCooldown -= dtms
      if (c.hp <= 0) {
        if (c.state !== 'down') {
          c.state = 'down'; setAnim(c, 'cIdle')
          // She can die mid-jump — drop her to the ground first so the
          // "lying flat" render doesn't leave her floating mid-air.
          c.feetY = GROUND_Y; c.vy = 0; c.onGround = true
        }
        return
      }

      // An in-progress dash runs to completion before anything else (target
      // picking, attacking) gets a say — same priority the hero's own dash
      // gets in updateHero.
      if (c.state === 'dash') {
        c.dashT -= dtms
        c.x += c.dashDir * COMPANION_DASH_SPEED * dt
        if (c.dashT <= 0) c.state = 'idle'
        stepAnim(c, dt); return
      }
      if (c.jumpCooldown > 0) c.jumpCooldown -= dtms
      // Same for an in-progress hop — she just rides the arc out, same as
      // the hero's own jump needs no air control to matter. Because feetY
      // actually moves now, this is a real dodge against a beast's shot
      // (see the projectile hit-test, which reads live feetY), not cosmetic.
      if (!c.onGround) {
        c.vy += GRAVITY * dt
        c.feetY += c.vy * dt
        if (c.feetY >= GROUND_Y) {
          c.feetY = GROUND_Y; c.vy = 0; c.onGround = true; c.jumpsUsed = 0
          c.state = 'idle'; setAnim(c, 'cIdle')
        }
        stepAnim(c, dt); return
      }

      // Her support act, on her own initiative — no player input drives
      // this. Fires the moment either of them is hurting and it's off
      // cooldown, ahead of any combat decision.
      if (c.healCooldown <= 0) {
        var heroPct = g.stats.health / g.stats.maxHealth
        var selfPct = c.hp / c.maxHp
        if (heroPct < COMPANION_HEAL_TRIGGER_PCT || selfPct < COMPANION_HEAL_TRIGGER_PCT) {
          g.stats.health = Math.min(g.stats.maxHealth, g.stats.health + g.stats.maxHealth * COMPANION_HEAL_PCT)
          setHealth(Math.round((g.stats.health / g.stats.maxHealth) * 100))
          c.hp = Math.min(c.maxHp, c.hp + c.maxHp * COMPANION_HEAL_PCT)
          c.healCooldown = COMPANION_HEAL_COOLDOWN_MS
          g.vfx.push({ kind: 'hit', x: hero.x, y: GROUND_Y - 42, t: 0 })
          g.vfx.push({ kind: 'hit', x: c.x, y: GROUND_Y - 40, t: 0 })
          g.announce = { text: 'KIRA MENDS THE WOUNDED', t: 0, dur: 1200, kind: 'banner', col: '#7ec6ff' }
          c.state = 'idle'; setAnim(c, 'cIdle'); stepAnim(c, dt); return
        }
      }

      var target = null, bestD = Infinity
      for (var i = 0; i < g.enemies.length; i++) {
        var e = g.enemies[i]
        if (e.state === 'dead') continue
        var d = Math.abs(e.x - c.x)
        if (d < bestD) { bestD = d; target = e }
      }
      if (!target && g.wave === 'r2boss' && g.boss && g.boss.state !== 'dead') target = g.boss

      if (!target) {
        var followX = hero.x - hero.facing * COMPANION_FOLLOW_DIST
        var toFollow = followX - c.x
        if (Math.abs(toFollow) > 4) {
          c.x += sign(toFollow) * COMPANION_SPEED * dt; c.facing = sign(toFollow)
          c.state = 'run'; setAnim(c, 'cRun')
        } else { c.state = 'idle'; setAnim(c, 'cIdle') }
        stepAnim(c, dt); return
      }

      var houndDanger = false, beastDanger = false
      for (var j = 0; j < g.enemies.length; j++) {
        var eh = g.enemies[j]
        if (eh.state === 'lunge' && Math.abs(eh.x - c.x) < 50) houndDanger = true
        // A beast winding up or firing at her specifically is the "magical
        // attack" she's meant to know to dodge.
        if (eh.type === 'beast' && (eh.state === 'telegraph' || eh.state === 'attack') && nearestTarget(eh.x, livingTargets()) === c) beastDanger = true
      }
      // Same idea against the Dragon Boss's bolts, single or barrage alike.
      if (g.boss && g.boss.kind === 'dragon' && (g.boss.state === 'telegraph' || g.boss.state === 'attack' || g.boss.state === 'barrage') && nearestTarget(g.boss.x, livingTargets()) === c) beastDanger = true
      var danger = houndDanger || beastDanger
      // A beast's shot is a straight aimed line — hopping clear of it (the
      // same double jump the hero gets) beats running, since running just
      // keeps her at the same height the shot is aimed at.
      if (beastDanger && c.state !== 'attack' && c.jumpCooldown <= 0 && c.jumpsUsed < MAX_JUMPS) {
        c.vy = -JUMP_V; c.onGround = false; c.jumpsUsed += 1; c.jumpCooldown = 300
        c.state = 'jump'; setAnim(c, 'cJump'); stepAnim(c, dt); return
      }
      if (danger && c.state !== 'attack' && c.dashCooldown <= 0) {
        var awayD = -(sign(target.x - c.x) || 1)
        c.state = 'dash'; c.dashDir = awayD; c.dashT = COMPANION_DASH_MS
        c.invuln = Math.max(c.invuln, COMPANION_DASH_INVULN_MS)
        c.dashCooldown = COMPANION_DASH_COOLDOWN_MS
        c.facing = -awayD; setAnim(c, 'cRun'); stepAnim(c, dt); return
      }
      if (danger && c.state !== 'attack') {
        // Dash still on cooldown — fall back to a plain retreat rather than
        // standing there and trading the hit.
        var away = -(sign(target.x - c.x) || 1)
        c.x += away * COMPANION_SPEED * dt; c.facing = -away
        c.state = 'run'; setAnim(c, 'cRun'); stepAnim(c, dt); return
      }

      // Support positioning: hold a throwing distance rather than closing
      // to melee — back off if something's crowded her, close back in if
      // she's drifted out of effective range, otherwise plant and throw.
      var dx = target.x - c.x
      c.facing = sign(dx) || c.facing
      if (c.state !== 'attack' && Math.abs(dx) < COMPANION_RANGE_MIN) {
        c.x -= sign(dx) * COMPANION_SPEED * dt; c.facing = sign(dx)
        c.state = 'run'; setAnim(c, 'cRun'); stepAnim(c, dt)
      } else if (c.state !== 'attack' && Math.abs(dx) > COMPANION_RANGE_MAX) {
        c.x += sign(dx) * COMPANION_SPEED * dt
        c.state = 'run'; setAnim(c, 'cRun'); stepAnim(c, dt)
      } else if (c.state === 'attack' || c.atkCooldown <= 0) {
        if (c.state !== 'attack') { c.state = 'attack'; setAnim(c, 'cAtk'); c.swung = false }
        stepAnim(c, dt)
        var a = ANIM.cAtk
        if (!c.swung && a.active.indexOf(c.frame) >= 0) {
          fireDagger(c, target)
          c.swung = true
        }
        if (c.done) { c.state = 'idle'; setAnim(c, 'cIdle'); c.atkCooldown = COMPANION_ATK_COOLDOWN_MS }
      } else {
        c.state = 'idle'; setAnim(c, 'cIdle'); stepAnim(c, dt)
      }
    }
    function updateEnemies(dt) {
      for (var i = 0; i < g.enemies.length; i++) {
        var en = g.enemies[i]
        if (en.type === 'hound') updateHound(en, dt)
        else if (en.type === 'beast') updateBeast(en, dt)
      }
      if ((g.wave === 'r2wave1' || g.wave === 'r2wave2') && g.enemies.length) {
        var cleared = true
        for (var j = 0; j < g.enemies.length; j++) {
          var e = g.enemies[j]
          if (e.state !== 'dead' || e.deadT < DEATH_VFX_MS + 400) { cleared = false; break }
        }
        if (cleared) {
          if (g.wave === 'r2wave1') {
            // Round 2's second wave: 1 hound (mobile) + 2 stationary beasts.
            g.wave = 'r2wave2'
            g.enemies = [newHound(g.hero.x + 220, 1), newBeast(g.hero.x + 320, 2), newBeast(g.hero.x + 420, 3)]
          } else {
            g.enemies = []
            g.wave = 'r2boss'
            // Same arena-freeze trick as Round 1's boss transition — this is
            // the last fight, not another corridor to run down.
            g.bossArenaCamX = g.hero.x - HERO_SCREEN_X
            g.boss = newDragon(g.hero.x, DRAGON_HP)
            g.announce = { text: 'THE DRAGON DESCENDS', t: 0, dur: 1800, kind: 'banner' }
          }
        }
      }
    }

    function updateHero(dt) {
      var hero = g.hero, k = g.keys
      var dtms = dt * 1000
      if (hero.invuln > 0) hero.invuln -= dtms
      if (hero.hitShake > 0) hero.hitShake -= dtms
      if (hero.shieldCooldown > 0) hero.shieldCooldown -= dtms
      if (hero.shieldT > 0) hero.shieldT -= dtms

      // Post-boss: the hero auto-runs to a safe distance and stops, ignoring
      // input entirely, so the Dancing Girl can step into a calm scene.
      if (g.wave === 'postboss') {
        var toTarget = g.postbossTargetX - hero.x
        if (Math.abs(toTarget) > 2) {
          // Fixed cinematic sprint speed, not the hero's normal/upgraded
          // pace — this run always takes POSTBOSS_RUN_MS regardless of how
          // fast Fleet Foot has made the hero.
          hero.x += Math.sign(toTarget) * Math.min(POSTBOSS_RUN_SPEED * dt, Math.abs(toTarget))
          hero.facing = 1; hero.state = 'run'; setAnim(hero, 'run')
        } else {
          hero.state = 'idle'; setAnim(hero, 'idle')
          setAnim(g.dancer, 'dDance') // she was already standing there waiting — now she greets him
          g.wave = 'dancerIntro'; g.seqT = 0
          g.announce = { text: ANYA_INTRO, speaker: ANYA_NAME, t: 0, dur: DANCER_INTRO_MS, kind: 'dialogue' }
        }
        stepAnim(hero, dt)
        return
      }
      // Anya dances and introduces herself — a held beat, not a pause; the
      // sim (and this timer) keep running so the dialogue box can animate.
      if (g.wave === 'dancerIntro') {
        hero.state = 'idle'; setAnim(hero, 'idle'); stepAnim(hero, dt)
        g.seqT += dtms
        if (g.seqT >= DANCER_INTRO_MS) {
          g.seqT = 0
          setAnim(g.dancer, 'dIdle') // she settles down once it's time to choose
          g.wave = 'dancerChoice'
          g.phase = 'upgrade'; setPhase('upgrade'); g.running = false
        }
        return
      }
      // The hero's thanks — same held-beat pattern, after the boon pick.
      if (g.wave === 'dancerThanks') {
        hero.state = 'idle'; setAnim(hero, 'idle'); stepAnim(hero, dt)
        g.seqT += dtms
        if (g.seqT >= DANCER_THANKS_MS) {
          g.seqT = 0; g.wave = 'dancerLeave'
          if (g.round === 1) {
            // Same idea as Anya — Kira is already standing at exactly where
            // this jog is going to end, waiting, instead of appearing out of
            // nowhere the instant he arrives.
            var leaveDist = HERO_SPEED * g.stats.moveSpeedMult * (DANCER_LEAVE_MS / 1000)
            g.companion = newCompanion(hero.x + leaveDist + 70)
            g.companion.facing = -1
          }
        }
        return
      }
      // Hero jogs off for a few seconds, leaving Anya behind. Round 1 (ogre
      // waves + the demon boss + Anya) only ever happens once — from here
      // the hero walks straight into meeting Kira and Round 2 begins.
      if (g.wave === 'dancerLeave') {
        hero.x += HERO_SPEED * g.stats.moveSpeedMult * dt
        hero.facing = 1; hero.state = 'run'; setAnim(hero, 'run'); stepAnim(hero, dt)
        g.seqT += dtms
        if (g.seqT >= DANCER_LEAVE_MS) {
          g.seqT = 0; g.dancer = null
          if (g.round === 1) {
            g.round = 2
            hero.state = 'idle'; setAnim(hero, 'idle')
            g.companion.facing = 1 // she was facing back to watch him arrive — now she turns to walk alongside him
            g.wave = 'meetKira1'
            g.announce = { text: KIRA_INTRO, speaker: KIRA_NAME, t: 0, dur: MEET_KIRA_LINE1_MS, kind: 'dialogue' }
          } else {
            g.wave = 'wave1'; g.waveKills = 0; g.waveTarget = ogresPerWave(g.cycle)
            g.ogre = newOgre(hero.x)
          }
        }
        return
      }
      // Kira's greeting, then the hero's reply — both held beats, same
      // pattern as the Anya sequence.
      if (g.wave === 'meetKira1') {
        hero.state = 'idle'; setAnim(hero, 'idle'); stepAnim(hero, dt)
        g.seqT += dtms
        if (g.seqT >= MEET_KIRA_LINE1_MS) {
          g.seqT = 0
          g.wave = 'meetKira2'
          g.announce = { text: HERO_TO_KIRA, speaker: 'You', t: 0, dur: MEET_KIRA_LINE2_MS, kind: 'dialogue' }
        }
        return
      }
      if (g.wave === 'meetKira2') {
        hero.state = 'idle'; setAnim(hero, 'idle'); stepAnim(hero, dt)
        g.seqT += dtms
        if (g.seqT >= MEET_KIRA_LINE2_MS) {
          g.seqT = 0
          g.companion.active = true
          g.wave = 'r2wave1'
          g.enemies = [newHound(hero.x + 220, 1), newHound(hero.x + 280, 2)]
        }
        return
      }

      var left = k.has('ArrowLeft'), right = k.has('ArrowRight'), down = k.has('ArrowDown')
      var locked = hero.state === 'attack' || hero.state === 'crouchAtk' || hero.state === 'hurt' || hero.state === 'dash'

      // resolve attack / hurt / dash lock
      if (locked) {
        hero.lockT -= dt
        if (hero.state === 'hurt') {
          if (hero.done || hero.lockT <= 0) { hero.state = hero.onGround ? 'idle' : 'jump' }
        } else if (hero.state === 'dash') {
          hero.dashT -= dtms
          hero.x += hero.dashDir * DASH_SPEED * dt
          hero.trail.push({ x: hero.x, facing: hero.facing })
          if (hero.trail.length > 5) hero.trail.shift()
          if (hero.dashT <= 0) { hero.state = hero.onGround ? 'idle' : 'jump'; hero.trail = [] }
        } else {
          if (hero.done || hero.lockT <= 0) {
            hero.state = hero.onGround ? 'idle' : 'jump'
            hero.swung = false
          }
        }
      }
      locked = hero.state === 'attack' || hero.state === 'crouchAtk' || hero.state === 'hurt' || hero.state === 'dash'

      // edge actions. A second jump is allowed once, mid-air, as long as the
      // first hasn't already spent it — jumpsUsed resets on landing below.
      if (g.pendJump && !locked && (hero.onGround || hero.jumpsUsed < MAX_JUMPS)) {
        hero.vy = -JUMP_V; hero.onGround = false; hero.state = 'jump'; setAnim(hero, 'jump')
        hero.jumpsUsed += 1
      }
      if (g.pendAtk && !locked) {
        if (hero.onGround && down) { hero.state = 'crouchAtk'; setAnim(hero, 'crouchAtk'); hero.lockT = ANIM.crouchAtk.n / ANIM.crouchAtk.fps }
        else { hero.state = 'attack'; setAnim(hero, 'attack'); hero.lockT = ANIM.attack.n / ANIM.attack.fps }
        hero.swung = false
      }
      // Shield — an activated buff, not a stance, so it doesn't touch
      // `locked` at all; he keeps moving and swinging while it's up.
      if (g.pendShield && hero.shieldCooldown <= 0) {
        hero.shieldT = SHIELD_DURATION_MS
        hero.shieldCooldown = SHIELD_COOLDOWN_MS
      }
      // Double-tap dash — a short burst of speed with brief i-frames, mainly
      // meant to outrun the boss's homing breath. Checked against the state
      // fresh (not the stale `locked`) so a same-frame attack always wins.
      if (g.pendDash !== 0 && hero.state !== 'attack' && hero.state !== 'crouchAtk' && hero.state !== 'hurt' && hero.state !== 'dash') {
        hero.state = 'dash'; hero.dashDir = g.pendDash; hero.dashT = DASH_MS; hero.lockT = DASH_MS / 1000
        hero.invuln = Math.max(hero.invuln, DASH_INVULN_MS)
        hero.facing = g.pendDash; hero.trail = []
        setAnim(hero, hero.onGround ? 'run' : 'jump')
      }
      g.pendJump = false; g.pendAtk = false; g.pendDash = 0; g.pendShield = false
      locked = hero.state === 'attack' || hero.state === 'crouchAtk' || hero.state === 'hurt' || hero.state === 'dash'

      // vertical
      if (!hero.onGround) {
        hero.vy += GRAVITY * dt
        hero.feetY += hero.vy * dt
        if (hero.feetY >= GROUND_Y) {
          hero.feetY = GROUND_Y; hero.vy = 0; hero.onGround = true; hero.jumpsUsed = 0
          if (hero.state === 'jump') hero.state = 'idle'
        }
      }

      // horizontal + grounded pose
      if (!locked) {
        if (!hero.onGround) {
          if (left && !right) { hero.x -= HERO_SPEED * 0.82 * g.stats.moveSpeedMult * dt; hero.facing = -1 }
          if (right && !left) { hero.x += HERO_SPEED * 0.82 * g.stats.moveSpeedMult * dt; hero.facing = 1 }
          setAnim(hero, 'jump')
        } else if (down) {
          hero.state = 'crouch'; setAnim(hero, 'crouch')
        } else if (left !== right) {
          hero.x += (right ? 1 : -1) * HERO_SPEED * g.stats.moveSpeedMult * dt
          hero.facing = right ? 1 : -1
          hero.state = 'run'; setAnim(hero, 'run')
        } else {
          hero.state = 'idle'; setAnim(hero, 'idle')
        }
      } else if (hero.state === 'dash') {
        setAnim(hero, hero.onGround ? 'run' : 'jump')
      }
      stepAnim(hero, dt)

      // Boss arena: the camera is frozen (see advanceAfterOgreDeath), so
      // clamp to that same frozen screen — no fleeing the fight by just
      // running in one direction. Applied last so it overrides every kind
      // of movement above (walk, air-strafe, dash) uniformly.
      if (g.wave === 'boss' || g.wave === 'r2boss') {
        hero.x = clamp(hero.x, g.bossArenaCamX + ARENA_MARGIN, g.bossArenaCamX + VW - ARENA_MARGIN)
      }

      // player blow connects? — against the boss during the boss wave, a
      // hound during Round 2's multi-enemy waves, otherwise the current ogre.
      if ((hero.state === 'attack' || hero.state === 'crouchAtk') && !hero.swung) {
        var a = ANIM[hero.anim]
        if (a.active && a.active.indexOf(hero.frame) >= 0) {
          // Fire skulls (phase 1 of the demon boss) are a counterable hazard,
          // not just a dodge-or-eat-it bolt — any swing that's close enough
          // pops one, from any angle, since they can be closing in from
          // above or the side.
          for (var fsi = 0; fsi < g.fireSkulls.length; fsi++) {
            var fs = g.fireSkulls[fsi]
            if (fs.dead) continue
            if (Math.hypot(fs.x - hero.x, fs.y - (hero.feetY - 26)) < PLAYER_REACH + 18) {
              fs.dead = true; fs.deadT = 0
              g.vfx.push({ kind: 'death', x: fs.x, y: fs.y, t: 0 })
              hero.swung = true
              break
            }
          }
          if (g.wave === 'boss') {
            var b = g.boss
            if (b && b.state !== 'dead') {
              var dxb = (b.x - hero.x) * hero.facing
              if (dxb > -8 && dxb < PLAYER_REACH + BOSS_HALF) hitBoss()
            }
          } else if (g.wave === 'r2wave1' || g.wave === 'r2wave2') {
            for (var ei = 0; ei < g.enemies.length; ei++) {
              var en = g.enemies[ei]
              if (en.state === 'dead') continue
              var half = en.type === 'beast' ? BEAST_HALF : HOUND_HALF
              var dxe = (en.x - hero.x) * hero.facing
              if (dxe > -8 && dxe < PLAYER_REACH + half) { hitEnemy(en, g.stats.attackDamage); hero.swung = true; break }
            }
          } else if (g.wave === 'r2boss') {
            var dragon = g.boss
            if (dragon && dragon.state !== 'dead') {
              var dxd = (dragon.x - hero.x) * hero.facing
              if (dxd > -8 && dxd < PLAYER_REACH + DRAGON_HALF) { hitDragon(g.stats.attackDamage); hero.swung = true }
            }
          } else {
            var o = g.ogre
            if (o.state !== 'dead') {
              var dx = (o.x - hero.x) * hero.facing
              if (dx > -8 && dx < PLAYER_REACH + OGRE_HALF) hitOgre(o)
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
          advanceAfterOgreDeath()
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
              damageHero(o.x, OGRE_ATK_DAMAGE)
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

    // The boss has no walk state — it enters already engaged (newBoss) and
    // just cycles telegraph -> attack -> recover on its own clock, drifting
    // (not walking) to stay roughly BOSS_ENGAGE from the hero the rest of
    // the time so it can't be trivially outrun. Its attack pattern reads
    // straight off its remaining health: see bossPhase.
    function updateBoss(dt) {
      var b = g.boss, hero = g.hero, dtms = dt * 1000
      if (!b) return
      if (b.hitFlash > 0) b.hitFlash -= dtms
      b.bob += dt

      if (b.state === 'dead') {
        b.deadT += dtms
        if (b.deadT >= DEATH_VFX_MS + 600 && g.phase === 'playing') {
          g.wave = 'postboss'
          g.postbossTargetX = hero.x + POSTBOSS_RUN_DIST
          g.boss = null
          // The hero might be mid-jump right as the boss dies — force him
          // back to solid ground before the cinematic run takes over, since
          // that whole sequence (through Anya and into Kira) never runs
          // gravity and would otherwise leave him frozen floating in mid-air
          // the entire time.
          hero.feetY = GROUND_Y; hero.vy = 0; hero.onGround = true; hero.jumpsUsed = 0
          // Anya's already there waiting at his destination, not conjured
          // out of thin air the instant he arrives — spawned now, holding a
          // plain idle pose; she only starts dancing once he actually shows up.
          g.dancer = newDancer(g.postbossTargetX)
          setAnim(g.dancer, 'dIdle')
        }
        return
      }

      b.facing = sign(hero.x - b.x) || b.facing
      // Only drifts horizontally during recover — holding dead still through
      // the telegraph and the attack itself keeps the fight readable instead
      // of chasing a moving target.
      if (b.state === 'recover') {
        var target = hero.x - b.facing * BOSS_ENGAGE
        var maxStep = BOSS_DRIFT_SPEED * dt
        b.x += clamp(target - b.x, -maxStep, maxStep)
      }
      // Same frozen-screen arena the hero is held to — belt-and-braces so
      // the boss can't drift out past a hero already pinned at an edge.
      b.x = clamp(b.x, g.bossArenaCamX + ARENA_MARGIN, g.bossArenaCamX + VW - ARENA_MARGIN)
      // Altitude: low and reachable through the real recover window (the
      // hero's punish opportunity) — not the brief beat between chained
      // phase-2 hits, which is over too fast for that to mean anything.
      var targetY = (b.state === 'recover' && !b.chaining) ? BOSS_LOW_Y : BOSS_HOVER_Y
      var maxVStep = BOSS_VERT_SPEED * dt
      b.feetY += clamp(targetY - b.feetY, -maxVStep, maxVStep)

      if (b.state === 'telegraph') {
        b.t += dtms
        setAnim(b, 'bIdle')
        if (b.t >= TELEGRAPH_MS) {
          b.phase = bossPhase(b)
          b.state = 'attack'; b.t = 0; b.struck = false; setAnim(b, 'bAtk')
          if (b.phase === 2) b.comboLeft = BOSS_COMBO_EXTRA
          else if (b.phase === 3) b.comboLeft = SPIRAL_VOLLEYS - 1
        }
      } else if (b.state === 'attack') {
        stepAnim(b, dt)
        if (!b.struck && b.frame >= ANIM.bAtk.contact) {
          b.struck = true
          if (b.phase === 3) {
            spawnSpiral(b)
          } else if (b.phase === 1) {
            // Full health: 3 fire skulls instead of the old single breath
            // bolt — see spawnFireSkulls/updateFireSkulls.
            spawnFireSkulls(b)
          } else {
            // Phase 2: a homing bolt launched from the mouth — see
            // updateHoming. Fast enough to catch ordinary walking, but a
            // dash's burst of speed can put enough distance between hero
            // and bolt that its fixed lifetime runs out before it connects.
            var m = bossMouth(b, b.feetY + Math.sin(b.bob * 2) * 4)
            g.homing.push({ x: m.x + camXRef.v, y: m.y, face: b.facing, t: 0 })
          }
        }
        if (b.done) {
          b.chaining = (b.phase === 2 || b.phase === 3) && b.comboLeft > 0
          if (b.chaining) b.comboLeft--
          b.state = 'recover'; b.t = 0; setAnim(b, 'bIdle')
        }
      } else if (b.state === 'recover') {
        b.t += dtms
        stepAnim(b, dt)
        var recoverLen = !b.chaining ? BOSS_RECOVER_MS : b.phase === 3 ? SPIRAL_VOLLEY_PAUSE_MS : BOSS_COMBO_RECOVER_MS
        if (b.t >= recoverLen) {
          if (b.chaining) { b.state = 'attack'; b.t = 0; b.struck = false; setAnim(b, 'bAtk') }
          else { b.state = 'telegraph'; b.t = 0; setAnim(b, 'bIdle') }
        }
      }

      if (b.state !== 'attack' && b.state !== 'recover') stepAnim(b, dt)
    }

    // Dragon Boss: airborne, ranged-only, holds DRAGON_ENGAGE rather than
    // closing in. Phases 1-2 are a plain telegraph -> attack -> recover
    // cycle (1 bolt, then a 3-bolt fan); phase 3 drops that cycle for a
    // sustained barrage/break loop instead — see the constants above.
    function updateDragon(dt) {
      var b = g.boss, hero = g.hero, dtms = dt * 1000
      if (!b) return
      if (b.hitFlash > 0) b.hitFlash -= dtms
      b.bob += dt

      if (b.state === 'dead') {
        b.deadT += dtms
        if (b.deadT >= DEATH_VFX_MS + 600 && g.phase === 'playing') {
          g.wave = 'round2clear'; g.phase = 'victory'; setPhase('victory'); g.running = false
          g.announce = null // the "STRENGTH SURGES" banner would otherwise still be fading when this overlay appears, overlapping its title
          g.boss = null
        }
        return
      }

      var nearestX = nearestTarget(b.x, livingTargets()).x
      b.facing = sign(nearestX - b.x) || b.facing
      // Only holds its distance while actually attacking or winding up to —
      // during recover/break it stands still, because DRAGON_ENGAGE puts it
      // just past the hero's (and Kira's) melee reach on purpose: otherwise
      // it would keep kiting straight through its own punish window and
      // never be hittable at all.
      if (b.state !== 'recover' && b.state !== 'break') {
        var dxh = nearestX - b.x
        if (Math.abs(Math.abs(dxh) - DRAGON_ENGAGE) > 4) {
          b.x += (Math.abs(dxh) > DRAGON_ENGAGE ? sign(dxh) : -sign(dxh)) * BOSS_DRIFT_SPEED * dt
        }
      }
      // The arena is frozen at exactly one screen's width (see the wave2
      // transition) — nothing enforced that on the dragon itself before,
      // so it could drift straight past the right edge and off-screen.
      b.x = clamp(b.x, g.bossArenaCamX + ARENA_MARGIN, g.bossArenaCamX + VW - ARENA_MARGIN)

      var phase = dragonPhase(b)
      // Grounded at full health; takes flight the moment it drops into
      // phase 2 (and stays airborne through phase 3). b.grounded also
      // tells the renderer to drop the idle hover-bob while it's down here.
      b.grounded = phase === 1
      b.feetY = b.grounded ? GROUND_Y : DRAGON_HOVER_Y
      var stepped = false

      if (phase < 3) {
        // Just dropped out of phase 3 into... itself never happens (hp only
        // falls), but guard it anyway so a phase re-entry can't get stuck
        // mid-barrage.
        if (b.state === 'barrage' || b.state === 'break') { b.state = 'telegraph'; b.t = 0 }
        if (b.state === 'telegraph') {
          b.t += dtms
          if (b.t >= DRAGON_TELE_MS) {
            b.state = 'attack'; b.t = 0; b.struck = false
            b.shotsLeft = phase === 1 ? 1 : 3
            setAnim(b, 'dragonBreath')
          }
        } else if (b.state === 'attack') {
          stepAnim(b, dt); stepped = true
          if (!b.struck && b.frame >= ANIM.dragonBreath.contact) {
            b.struck = true
            fireDragonShots(b, b.shotsLeft)
          }
          if (b.done) { b.state = 'recover'; b.t = 0; setAnim(b, 'dragonIdle') }
        } else if (b.state === 'recover') {
          b.t += dtms
          if (b.t >= DRAGON_RECOVER_MS) { b.state = 'telegraph'; b.t = 0; setAnim(b, 'dragonIdle') }
        }
      } else {
        if (b.state !== 'barrage' && b.state !== 'break') {
          b.state = 'barrage'; b.barrageT = 0; b.shotTimer = 0; setAnim(b, 'dragonBreath')
        }
        if (b.state === 'barrage') {
          b.barrageT += dtms; b.shotTimer -= dtms
          stepAnim(b, dt); stepped = true
          if (b.shotTimer <= 0) { fireDragonShots(b, 1); b.shotTimer = DRAGON_BARRAGE_SHOT_MS }
          if (b.done) setAnim(b, 'dragonBreath') // keep replaying the breath pose through the whole barrage
          if (b.barrageT >= DRAGON_BARRAGE_MS) { b.state = 'break'; b.t = 0; setAnim(b, 'dragonIdle') }
        } else {
          // break — deliberately does nothing threatening; this is the
          // punish window the spec calls for.
          b.t += dtms
          if (b.t >= DRAGON_BREAK_MS) { b.state = 'barrage'; b.barrageT = 0; b.shotTimer = 0; setAnim(b, 'dragonBreath') }
        }
      }
      if (!stepped) stepAnim(b, dt)
    }

    // Phase 3: a fan of fireballs, launched a few ms apart so the rotating
    // angle across the sequence reads as a spiral even though each shot
    // itself just flies straight — simpler and far more predictable than a
    // true curved path, and still forces the hero to find/hold a gap. Each
    // volley re-aims at the hero's position right as it fires, so the fan
    // visibly reads as shooting AT the hero, not off at some fixed angle
    // that happens to miss wherever they actually are.
    function spawnSpiral(b) {
      var hero = g.hero
      var bobY = b.feetY + Math.sin(b.bob * 2) * 4
      var m = bossMouth(b, bobY)
      var mWorldX = m.x + camXRef.v
      var aim = Math.atan2((hero.feetY - 26) - m.y, hero.x - mWorldX)
      for (var i = 0; i < SPIRAL_COUNT; i++) {
        var t = SPIRAL_COUNT <= 1 ? 0 : i / (SPIRAL_COUNT - 1)
        var ang = aim + (-SPIRAL_SPREAD_DEG + t * (SPIRAL_SPREAD_DEG * 2)) * DEG
        g.projectiles.push({
          x: mWorldX, y: m.y, face: b.facing,
          vx: Math.cos(ang) * SPIRAL_SPEED,
          vy: Math.sin(ang) * SPIRAL_SPEED,
          launchIn: i * SPIRAL_STAGGER_MS, t: 0, dead: false,
        })
      }
    }
    // Phase 1's attack: 3 fire skulls out of the boss's mouth, fanned
    // vertically so they don't all overlap on the same line, then each
    // drifts toward the hero on its own under updateFireSkulls.
    function spawnFireSkulls(b) {
      var bobY = b.feetY + Math.sin(b.bob * 2) * 4
      var m = bossMouth(b, bobY)
      var mWorldX = m.x + camXRef.v
      for (var i = 0; i < FIRESKULL_COUNT; i++) {
        g.fireSkulls.push(newFireSkull(mWorldX, m.y + (i - (FIRESKULL_COUNT - 1) / 2) * 24))
      }
    }
    // The Dragon Boss's bolt(s) — count is 1, 3 (fanned), or the barrage's
    // repeated single shots, per dragonPhase. Aims at whichever of hero/Kira
    // is currently nearest it, same as the Hell Beast, since both of them
    // are live targets during this fight — reuses FX.fireball (the same
    // sprite the demon boss's spiral already uses) rather than a new asset.
    function fireDragonShots(b, count) {
      var bobY = b.feetY + Math.sin(b.bob * 2) * 4
      var m = dragonMouth(b, bobY)
      var mWorldX = m.x + camXRef.v
      var target = nearestTarget(mWorldX, livingTargets())
      var tgY = target === g.hero ? target.feetY - 26 : target.feetY - HEROINE_FH * 0.5
      var baseAim = Math.atan2(tgY - m.y, target.x - mWorldX)
      for (var i = 0; i < count; i++) {
        var t = count <= 1 ? 0.5 : i / (count - 1)
        var ang = count <= 1 ? baseAim : baseAim + (-DRAGON_TRIPLE_SPREAD_DEG + t * (DRAGON_TRIPLE_SPREAD_DEG * 2)) * DEG
        g.projectiles.push({
          x: mWorldX, y: m.y, face: b.facing,
          vx: Math.cos(ang) * DRAGON_PROJ_SPEED, vy: Math.sin(ang) * DRAGON_PROJ_SPEED,
          launchIn: 0, t: 0, dead: false, dmg: DRAGON_ATK, life: DRAGON_PROJ_LIFE_MS, fxKey: 'fireball',
        })
      }
    }
    // Where a thrown/aimed shot should actually aim on a given enemy —
    // shared by Kira's daggers going out and (already, elsewhere) the
    // beast/dragon's own shots coming in.
    function enemyHurtY(e) {
      if (e === g.boss) return e.feetY - 34
      if (e.type === 'beast') return e.feetY - 30
      return e.feetY - 20
    }
    // Kira's ranged attack — a thrown dagger, replacing her old melee
    // swing now that she's support rather than front-line. Lands in
    // g.allyProjectiles (a separate list from enemy shots) so it can damage
    // enemies instead of the hero/companion.
    function fireDagger(c, target) {
      var mx = c.x + c.facing * 14, my = c.feetY - 34
      var tgY = enemyHurtY(target)
      var aim = Math.atan2(tgY - my, target.x - mx)
      g.allyProjectiles.push({
        x: mx, y: my, t: 0, dead: false,
        vx: Math.cos(aim) * COMPANION_DAGGER_SPEED, vy: Math.sin(aim) * COMPANION_DAGGER_SPEED,
        dmg: COMPANION_ATK, life: COMPANION_DAGGER_LIFE_MS, fxKey: 'dagger', target: target,
      })
    }
    // Mirrors updateProjectiles below, but for daggers going the other way
    // — each one remembers exactly which enemy it was thrown at, so it
    // doesn't need a generic target search, just to check whether that one
    // is still alive and now in front of it.
    function updateAllyProjectiles(dt) {
      var dtms = dt * 1000
      for (var i = g.allyProjectiles.length - 1; i >= 0; i--) {
        var p = g.allyProjectiles[i]
        p.t += dtms
        p.x += p.vx * dt; p.y += p.vy * dt
        var target = p.target
        if (!p.dead) {
          if (!target || target.state === 'dead' || target.hp <= 0) {
            p.dead = true
          } else {
            var tgY = enemyHurtY(target)
            var dx = p.x - target.x, dy = p.y - tgY
            if (Math.abs(dx) < 16 && Math.abs(dy) < 24) {
              if (target === g.boss) hitDragon(p.dmg)
              else hitEnemy(target, p.dmg)
              p.dead = true
            }
          }
        }
        if (p.dead || p.t >= p.life || p.y > GROUND_Y + 40) {
          g.allyProjectiles.splice(i, 1)
        }
      }
    }
    // Generic projectile mover/resolver — used by the demon boss's phase-3
    // spiral (fxKey 'fireball', dmg FIREBALL_DAMAGE, hero-only) and Hell
    // Beast's shots (fxKey 'beastFireball', dmg BEAST_ATK, can hit Kira too).
    // Each projectile carries its own dmg/fxKey/life so the two can coexist.
    function updateProjectiles(dt) {
      var dtms = dt * 1000
      var targets = livingTargets()
      for (var i = g.projectiles.length - 1; i >= 0; i--) {
        var p = g.projectiles[i]
        if (p.launchIn > 0) { p.launchIn -= dtms; continue }
        p.t += dtms
        p.x += p.vx * dt; p.y += p.vy * dt
        if (!p.dead) {
          for (var ti = 0; ti < targets.length; ti++) {
            var tg = targets[ti]
            var tgY = tg === g.hero ? tg.feetY - 30 : tg.feetY - HEROINE_FH * 0.5
            var dx = p.x - tg.x, dy = p.y - tgY
            if (Math.abs(dx) < 13 && Math.abs(dy) < 18) {
              if (tg === g.hero) { if (tg.invuln <= 0 && tg.state !== 'hurt') { damageHero(p.x, p.dmg || FIREBALL_DAMAGE); p.dead = true } }
              else { damageCompanion(p.x, p.dmg || FIREBALL_DAMAGE); p.dead = true }
              if (p.dead) break
            }
          }
        }
        // Bug fixed here: this used to despawn anything above HEAD_TOP_Y-60,
        // but fireballs LAUNCH from the boss's mouth (already far above that
        // line — see BOSS_MOUTH_DY) — so every shot was deleted on its very
        // first active frame, before it was ever visibly drawn. Lifetime and
        // the ground floor are the only bounds that matter now.
        if (p.dead || p.t >= (p.life || SPIRAL_LIFE_MS) || p.y > GROUND_Y + 20) {
          g.projectiles.splice(i, 1)
        }
      }
    }

    // Pure pursuit at a fixed speed: it always steers at the hero's current
    // spot, so it reliably catches ordinary walking, but its lifetime is
    // tight enough that a dash's sudden burst of distance can make it run out
    // of time before it closes the gap. Ends by scorching the ground where it
    // lands whether or not it actually connects — the fire always reaches the
    // ground now, which is the whole point.
    function updateHoming(dt) {
      var hero = g.hero, dtms = dt * 1000
      for (var i = g.homing.length - 1; i >= 0; i--) {
        var m = g.homing[i]
        m.t += dtms
        var tx = hero.x, ty = hero.feetY - 26
        var dx = tx - m.x, dy = ty - m.y, dist = Math.hypot(dx, dy) || 1
        var step = Math.min(dist, HOMING_SPEED * dt)
        m.x += (dx / dist) * step; m.y += (dy / dist) * step
        var hit = dist < HOMING_HIT_R
        if (hit && hero.invuln <= 0 && hero.state !== 'hurt') {
          damageHero(m.x, BOSS_ATK_DAMAGE)
        }
        if (hit || m.t >= HOMING_LIFE_MS) {
          g.vfx.push({ kind: 'bossBreath', x: m.x, y: GROUND_Y - 20, face: m.face, t: 0 })
          g.homing.splice(i, 1)
        }
      }
    }
    // Fire skulls: slow homing hazards that, unlike the bolt above, can be
    // popped by the hero's own swing (see the attack-connect check in
    // updateHero) — dodge, shield, or fight back, all three are valid.
    function updateFireSkulls(dt) {
      var hero = g.hero, dtms = dt * 1000
      for (var i = g.fireSkulls.length - 1; i >= 0; i--) {
        var s = g.fireSkulls[i]
        if (s.dead) {
          s.deadT += dtms
          if (s.deadT >= DEATH_VFX_MS) g.fireSkulls.splice(i, 1)
          continue
        }
        s.t += dtms
        stepAnim(s, dt)
        var tx = hero.x, ty = hero.feetY - 26
        var dx = tx - s.x, dy = ty - s.y, dist = Math.hypot(dx, dy) || 1
        var step = Math.min(dist, FIRESKULL_SPEED * dt)
        s.x += (dx / dist) * step; s.y += (dy / dist) * step
        if (dist < FIRESKULL_HIT_R && hero.invuln <= 0 && hero.state !== 'hurt') {
          damageHero(s.x, FIRESKULL_DAMAGE)
          s.dead = true; s.deadT = 0
        } else if (s.t >= FIRESKULL_LIFE_MS) {
          g.fireSkulls.splice(i, 1)
        }
      }
    }

    function update(dt) {
      updateHero(dt)
      if (g.wave === 'boss') updateBoss(dt)
      else if (g.wave === 'wave1' || g.wave === 'wave2') updateOgre(dt)
      else if (g.wave === 'r2wave1' || g.wave === 'r2wave2') updateEnemies(dt)
      else if (g.wave === 'r2boss') updateDragon(dt)
      updateCompanion(dt)
      // Same frozen-arena bound as the hero and the dragon — she has no
      // clamp of her own inside updateCompanion (too many early-returns in
      // there to cover cleanly), so it's simplest to enforce it once here.
      if (g.wave === 'r2boss' && g.companion) {
        g.companion.x = clamp(g.companion.x, g.bossArenaCamX + ARENA_MARGIN, g.bossArenaCamX + VW - ARENA_MARGIN)
      }
      updateProjectiles(dt)
      updateAllyProjectiles(dt)
      updateHoming(dt)
      updateFireSkulls(dt)
      if (g.dancer) stepAnim(g.dancer, dt)
      if (g.companion && !g.companion.active) stepAnim(g.companion, dt)
      if (g.announce) { g.announce.t += dt * 1000; if (g.announce.t > g.announce.dur) g.announce = null }
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
      var grad = ctx.createLinearGradient(0, y - spread, 0, y + spread)
      grad.addColorStop(0, 'rgba(' + col + ',0)')
      grad.addColorStop(0.5, 'rgba(' + col + ',' + strength + ')')
      grad.addColorStop(1, 'rgba(' + col + ',0)')
      ctx.save(); ctx.fillStyle = grad; ctx.fillRect(0, y - spread, VW, spread * 2); ctx.restore()

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
      var hero = g.hero, o = g.ogre, b = g.boss, dancer = g.dancer, companion = g.companion
      // Frozen during the boss wave (see advanceAfterOgreDeath) — the arena
      // is exactly this one screen, so the hero roams within it rather than
      // staying pinned at HERO_SCREEN_X with the world scrolling underneath.
      var camX = (g.wave === 'boss' || g.wave === 'r2boss') ? g.bossArenaCamX : hero.x - HERO_SCREEN_X
      camXRef.v = camX
      // Equals HERO_SCREEN_X exactly whenever the camera is doing its normal
      // job of tracking the hero — but during the boss's frozen camera, the
      // hero actually moves across the screen, so every render-time use of
      // "where the hero is drawn" has to go through this, not the constant.
      var heroSX = hero.x - camX
      var oSX = o.x - camX // ogre screen x
      var bSX = b ? b.x - camX : 0 // boss screen x (during the boss wave)
      var dSX = dancer ? dancer.x - camX : 0
      var cpSX = companion ? companion.x - camX : 0
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
      shadow(heroSX, hero.onGround ? 1 : 0.7)
      if (g.wave === 'boss' || g.wave === 'r2boss') { if (b && b.state !== 'dead') shadow(bSX, 1.3) }
      else if (g.wave === 'wave1' || g.wave === 'wave2') { if (o.state !== 'dead') shadow(oSX, 1.15) }
      if (dancer) shadow(dSX, 0.85)

      // ---- danger telegraph: ogre (duck/jump band — the only warning UI
      // left in the game; the boss has none at all, by design) ----
      if ((g.wave === 'wave1' || g.wave === 'wave2') && o && (o.state === 'telegraph' || (o.state === 'attack' && !o.struck))) {
        var fdir = o.facing
        var near = oSX + 2 * fdir, far = oSX + 84 * fdir
        var tbx = Math.min(near, far), tbw = Math.abs(far - near)
        var isRed = o.state === 'attack' || o.t >= TELEGRAPH_MS - TELE_RED_MS
        var pulse = isRed
          ? 0.40 + 0.22 * Math.abs(Math.sin(o.t / 55))
          : 0.16 + 0.18 * Math.abs(Math.sin(o.t / 120))
        ctx.fillStyle = isRed ? 'rgba(206,52,38,' + pulse + ')' : 'rgba(232,196,64,' + pulse + ')'
        if (o.atk === 'high') {
          ctx.fillRect(tbx, HEAD_TOP_Y, tbw, ABDOMEN_Y - HEAD_TOP_Y) // head -> abdomen
          label('DUCK', tbx + tbw / 2, HEAD_TOP_Y - 3, '#f2ead4')
        } else {
          ctx.fillRect(tbx, ABDOMEN_Y, tbw, GROUND_Y - ABDOMEN_Y) // abdomen -> feet
          label('JUMP', tbx + tbw / 2, GROUND_Y + 14, '#f2ead4')
        }
      }

      // ---- ogre ----
      if (g.wave === 'wave1' || g.wave === 'wave2') {
        if (o.state === 'dead') {
          var dfade = 1 - clamp(o.deadT / 220, 0, 1)
          if (dfade > 0) drawSheet('ogreIdle', OGRE_FW, OGRE_FH, 0, oSX, o.feetY, OGRE_FOOT, o.facing, dfade)
        } else {
          var oa = ANIM[o.anim] || ANIM.oWalk
          var nf = oa.nf || 1 // per-anim flip
          var ox = oa.offX ? (oa.offX[Math.min(o.frame, oa.offX.length - 1)] || 0) * (o.facing * nf) : 0
          drawSheet(oa.img, OGRE_FW, OGRE_FH, o.frame, oSX + ox, o.feetY, OGRE_FOOT, o.facing * nf, 1)
        }
      }

      // ---- boss (demon-Files; floats, so a gentle bob is added at render
      // time only — it never affects hit-test geometry) ----
      if (b) {
        // Grounded dragon (full health) skips the hover bob entirely — it's
        // standing on the ground, not floating an inch above it.
        var bobY = (b.kind === 'dragon' && b.grounded) ? b.feetY : b.feetY + Math.sin(b.bob * 2) * 4
        var bIdleAnim = b.kind === 'dragon' ? ANIM.dragonIdle : ANIM.bIdle
        if (b.state === 'dead') {
          var bdfade = 1 - clamp(b.deadT / 260, 0, 1)
          if (bdfade > 0) drawSheet(bIdleAnim.img, bIdleAnim.fw, bIdleAnim.fh, 0, bSX, bobY, 0, b.facing, bdfade)
        } else {
          var ba = ANIM[b.anim] || bIdleAnim
          var bAlpha = b.hitFlash > 0 && Math.floor(b.hitFlash / 40) % 2 === 0 ? 0.45 : 1
          drawSheet(ba.img, ba.fw, ba.fh, b.frame, bSX, bobY, 0, b.facing, bAlpha)
        }
      }

      // ---- Dancing Girl (post-boss boon offer) ----
      if (dancer) {
        var da = ANIM[dancer.anim] || ANIM.dIdle
        drawSheet(da.img, DANCER_FW, DANCER_FH, dancer.frame, dSX, dancer.feetY, DANCER_FOOT, dancer.facing, 1)
      }

      // ---- hell hounds & hell beasts (Round 2 ground enemies) ----
      for (var hi = 0; hi < g.enemies.length; hi++) {
        var hd = g.enemies[hi], hSX = hd.x - camX
        var isBeast = hd.type === 'beast'
        var hFW = isBeast ? BEAST_FW : HOUND_FW, hFH = isBeast ? BEAST_FH : HOUND_FH, hFOOT = isBeast ? BEAST_FOOT : HOUND_FOOT
        if (hd.state === 'dead') {
          var hfade = 1 - clamp(hd.deadT / 260, 0, 1)
          if (hfade > 0) drawSheet(isBeast ? 'beastIdle' : 'houndIdle', hFW, hFH, 0, hSX, hd.feetY, hFOOT, hd.facing, hfade)
          continue
        }
        shadow(hSX, isBeast ? 0.9 : 0.85)
        var hha = ANIM[hd.anim] || (isBeast ? ANIM.beastIdle : ANIM.hWalk)
        // A brief quiver during the wind-up beat — its only tell, since
        // there's no dedicated attack pose to telegraph with (hounds); the
        // beast gets the same cue while it winds up its shot.
        var hAlpha = hd.state === 'telegraph' && Math.floor(hd.t / 60) % 2 === 0 ? 0.55
          : hd.hitFlash > 0 && Math.floor(hd.hitFlash / 40) % 2 === 0 ? 0.45 : 1
        drawSheet(hha.img, hFW, hFH, hd.frame, hSX, hd.feetY, hFOOT, hd.facing, hAlpha)

        // tiny floating health bar above the head. hFH is the frame's full
        // padded height (extra headroom baked into the sheet for wind-up
        // poses), not the resting silhouette — measured each type's real
        // head height straight from the sprite's alpha channel (hound 24px,
        // beast 60px above their feet) so the bar sits close to the head
        // instead of floating high over a mostly-empty part of the frame.
        var hHeadH = isBeast ? 60 : 24
        var hbw = 20, hbh = 2.5, hbx = hSX - hbw / 2, hby = hd.feetY - hHeadH - 6
        var hpct = clamp(hd.hp / hd.maxHp, 0, 1)
        ctx.save()
        ctx.fillStyle = 'rgba(10,9,8,0.7)'; ctx.fillRect(hbx - 1, hby - 1, hbw + 2, hbh + 2)
        ctx.fillStyle = 'rgba(60,16,14,0.9)'; ctx.fillRect(hbx, hby, hbw, hbh)
        ctx.fillStyle = hpct > 0.3 ? '#c0392b' : '#e74c3c'; ctx.fillRect(hbx, hby, hbw * hpct, hbh)
        ctx.restore()
      }

      // ---- Kira, the companion (drawn from the moment she appears in the
      // meet-and-greet beat — only her AI/combat logic waits for active) ----
      if (companion && companion.state === 'down') {
        // The source pack has no knockdown/death pose for her at all (idle,
        // run, attack, jump — that's the whole set), so there's no sprite to
        // reach for here. Fake it the classic pixel-art way instead: rotate
        // her standing idle frame 90° flat around her own feet, so what was
        // her upright body now lies along the ground pointing the way she
        // fell — reads as "downed," not "still standing," at a glance.
        var dimg = IMG[ANIM.cIdle.img]
        if (dimg) {
          ctx.save()
          ctx.globalAlpha = 0.85
          ctx.translate(cpSX, companion.feetY)
          ctx.rotate(companion.facing >= 0 ? Math.PI / 2 : -Math.PI / 2)
          ctx.drawImage(dimg, 0, 0, HEROINE_FW, HEROINE_FH, -HEROINE_FW / 2, -HEROINE_FH, HEROINE_FW, HEROINE_FH)
          ctx.restore()
        }
      } else if (companion) {
        shadow(cpSX, 0.95)
        var ca = ANIM[companion.anim] || ANIM.cIdle
        var cAlpha = companion.hitFlash > 0 && Math.floor(companion.hitFlash / 40) % 2 === 0 ? 0.45 : 1
        drawSheet(ca.img, HEROINE_FW, HEROINE_FH, companion.frame, cpSX, companion.feetY, HEROINE_FOOT, companion.facing, cAlpha)
        // her own health bar, floating just above her head, green to read
        // apart from the hero's red bar at a glance. HEROINE_FH is the frame's
        // full padded height, not her actual silhouette — measured her real
        // head height (41px above her feet) straight from the sprite's alpha
        // channel so the bar sits close to her instead of floating over it.
        var cbw = 26, cbh = 3, cbx = cpSX - cbw / 2, cby = companion.feetY - 41 - 6
        var cpct = clamp(companion.hp / companion.maxHp, 0, 1)
        ctx.save()
        ctx.fillStyle = 'rgba(10,9,8,0.7)'; ctx.fillRect(cbx - 1, cby - 1, cbw + 2, cbh + 2)
        ctx.fillStyle = 'rgba(20,60,20,0.9)'; ctx.fillRect(cbx, cby, cbw, cbh)
        ctx.fillStyle = '#4caf50'; ctx.fillRect(cbx, cby, cbw * cpct, cbh)
        ctx.restore()
      }

      // ---- dash afterimages (behind the hero, faint, oldest -> newest) ----
      if (hero.state === 'dash' && hero.trail.length) {
        var haT = ANIM[hero.anim] || ANIM.run
        for (var ti = 0; ti < hero.trail.length; ti++) {
          var tr = hero.trail[ti]
          var trailSX = heroSX - (hero.x - tr.x)
          drawSheet(haT.img, HERO_FW, HERO_FH, hero.frame, trailSX, hero.feetY, HERO_FOOT, tr.facing, 0.10 + 0.10 * (ti / hero.trail.length))
        }
      }

      // ---- hero (pinned at HERO_SCREEN_X normally; roams within the frozen
      // arena's bounds during the boss wave — see heroSX above) ----
      var ha = ANIM[hero.anim] || ANIM.idle
      var blink = hero.invuln > 0 && Math.floor(hero.invuln / 70) % 2 === 0 ? 0.35 : 1
      drawSheet(ha.img, HERO_FW, HERO_FH, hero.frame, heroSX, hero.feetY, HERO_FOOT, hero.facing, blink)

      // Shield bubble — persistent for its whole duration (not a brief
      // flash like the parry it replaced), on both the hero and Kira since
      // it protects them together.
      if (hero.shieldT > 0) {
        drawShieldBubble(heroSX, hero.feetY, 30)
        if (companion && companion.active && companion.state !== 'down') {
          drawShieldBubble(cpSX, companion.feetY, 26)
        }
      }

      // ---- homing warning: a small bouncing "!" over the hero's head for
      // as long as any bolt is inbound — the only tell this attack gets ----
      if (g.homing.length) {
        var warnBounce = Math.abs(Math.sin(performance.now() / 90)) * 3
        var warnY = HEAD_TOP_Y - 12 - warnBounce
        ctx.save()
        ctx.fillStyle = '#c0362c'
        ctx.beginPath(); ctx.arc(heroSX, warnY, 7, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.5; ctx.stroke()
        ctx.font = '900 12px Oswald, sans-serif'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillStyle = '#f2ead4'
        ctx.fillText('!', heroSX, warnY + 1)
        ctx.restore()
      }

      // sword arc flourish on the active frames
      if (hero.state === 'attack' && ha.active.indexOf(hero.frame) >= 0) {
        ctx.save()
        ctx.strokeStyle = 'rgba(245,238,214,0.8)'; ctx.lineWidth = 2
        ctx.beginPath()
        var ax = heroSX + hero.facing * 14, ay = GROUND_Y - 46
        ctx.arc(ax, ay, 30, hero.facing > 0 ? -1.1 : 2.0, hero.facing > 0 ? 1.1 : 4.3)
        ctx.stroke(); ctx.restore()
      }

      // ---- fireballs (world space) — phase-3 spiral shots and Hell Beast's
      // own shots share this loop, each keyed by its own fxKey/sprite ----
      for (var pi = 0; pi < g.projectiles.length; pi++) {
        var pr = g.projectiles[pi]
        if (pr.launchIn > 0) continue
        var psx = pr.x - camX
        var pS = FX[pr.fxKey || 'fireball'], pim = IMG[pS.img]
        if (!pim) continue
        var pf = Math.min(pS.n - 1, Math.floor(pr.t / (1000 / pS.fps)))
        var pdw = pS.fw * pS.sc, pdh = pS.fh * pS.sc
        ctx.save()
        ctx.translate(Math.round(psx), Math.round(pr.y))
        // the sprite's own head sits toward its +x side (measured off the
        // source frame), so aligning local +x with the velocity vector is
        // the whole trick — no separate mirror needed.
        ctx.rotate(Math.atan2(pr.vy, pr.vx))
        ctx.drawImage(pim, pf * pS.fw, 0, pS.fw, pS.fh, -pdw / 2, -pdh / 2, pdw, pdh)
        ctx.restore()
      }

      // ---- Kira's thrown daggers (world space) ----
      for (var ai = 0; ai < g.allyProjectiles.length; ai++) {
        var ap = g.allyProjectiles[ai]
        var asx = ap.x - camX
        var aS = FX[ap.fxKey || 'dagger'], aim = IMG[aS.img]
        if (!aim) continue
        var adw = aS.fw * aS.sc, adh = aS.fh * aS.sc
        ctx.save()
        ctx.translate(Math.round(asx), Math.round(ap.y))
        // Thrown end over end — the spin is purely cosmetic (added on top
        // of the travel-direction rotation), since the source art is one
        // static frame.
        ctx.rotate(Math.atan2(ap.vy, ap.vx) + (aS.spin ? ap.t / 60 : 0))
        ctx.drawImage(aim, 0, 0, aS.fw, aS.fh, -adw / 2, -adh / 2, adw, adh)
        ctx.restore()
      }

      // ---- homing bolt(s) in flight (world space) — the breath cloud,
      // travelling, so it visibly closes the distance to the hero instead of
      // bursting once at the mouth and going nowhere ----
      for (var mi = 0; mi < g.homing.length; mi++) {
        var mb = g.homing[mi]
        var mS = FX.bossBreath, mim = IMG[mS.img]
        if (!mim) continue
        var mf = Math.floor(mb.t / (1000 / mS.fps)) % mS.n
        var mdw = mS.fw * 0.85, mdh = mS.fh * 0.85
        var mvsx = mb.x - camX
        ctx.save()
        if (mb.face < 0) {
          ctx.translate(Math.round(mvsx), 0); ctx.scale(-1, 1)
          ctx.drawImage(mim, mf * mS.fw, 0, mS.fw, mS.fh, -mdw / 2, Math.round(mb.y - mdh / 2), mdw, mdh)
        } else ctx.drawImage(mim, mf * mS.fw, 0, mS.fw, mS.fh, Math.round(mvsx - mdw / 2), Math.round(mb.y - mdh / 2), mdw, mdh)
        ctx.restore()
      }

      // ---- fire skulls (world space) — free-flying, so drawn centered on
      // (x,y) rather than through drawSheet's feetY anchor ----
      for (var fki = 0; fki < g.fireSkulls.length; fki++) {
        var fk = g.fireSkulls[fki]
        var fkA = ANIM.fireSkull, fkImg = IMG[fkA.img]
        if (!fkImg) continue
        var fkw = fkA.fw * FIRESKULL_SCALE, fkh = fkA.fh * FIRESKULL_SCALE
        var fkAlpha = fk.dead ? 1 - clamp(fk.deadT / DEATH_VFX_MS, 0, 1) : 1
        if (fkAlpha <= 0) continue
        ctx.save()
        ctx.globalAlpha = fkAlpha
        ctx.drawImage(fkImg, fk.frame * fkA.fw, 0, fkA.fw, fkA.fh, Math.round(fk.x - camX - fkw / 2), Math.round(fk.y - fkh / 2), fkw, fkh)
        ctx.restore()
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
          // Grotto slash/breath overlay, anchored at the attacker's own contact point
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
  // Health + score are drawn INSIDE the canvas (see drawHUD) — the .frame
  // div below is the entire game viewport; nothing else renders on the page.
  var overlay = null
  if (phase === 'loading') {
    overlay = h('div', { className: 'overlay' }, h('p', { className: 'final' }, 'Summoning the wood…'))
  } else if (phase === 'ready') {
    overlay = h(
      'div', { className: 'overlay' },
      h('h2', null, 'The Haunted Wood'),
      h('p', null, 'An ogre stalks the treeline. Read its wind-up, dodge the blow, answer with steel.'),
      h('div', { className: 'controls' },
        h('span', null, h('b', null, '←→'), ' Move'),
        h('span', null, h('b', null, '↑'), ' Jump (x2)'),
        h('span', null, h('b', null, 'X'), ' Attack'),
        h('span', null, h('b', null, 'Q'), ' Shield'),
        h('span', null, h('b', null, '←←/→→'), ' Dash')
      ),
      h('button', { className: 'action', onClick: begin, autoFocus: true }, 'Enter the wood')
    )
  } else if (phase === 'upgrade') {
    overlay = h(
      'div', { className: 'overlay' },
      h('h2', null, 'A Boon, Traveler'),
      h('p', null, ANYA_NAME + ' offers you one gift before the road continues.'),
      h(
        'div', { className: 'upgradeGrid' },
        Object.keys(BOONS).map(function (id) {
          var u = BOONS[id]
          return h(
            'button', { key: id, className: 'upgradeCard', onClick: function () { pickBoon(id) } },
            u.icon
              ? h('img', { className: 'upgradeIcon', src: SPRITES[u.icon], alt: '' })
              : h('svg', { className: 'upgradeIcon', viewBox: '0 0 24 24' },
                h('path', { d: 'M12 21s-7.5-4.7-10-9.4C.3 8.2 2 4.5 5.5 4.5c2 0 3.6 1.2 4.5 2.8 1-1.6 2.5-2.8 4.5-2.8C22 4.5 23.7 8.2 22 11.6 19.5 16.3 12 21 12 21z', fill: '#c0362c' })),
            h('div', { className: 'upgradeTitle' }, u.title),
            h('div', { className: 'upgradeDesc' }, u.desc)
          )
        })
      )
    )
  } else if (phase === 'over') {
    overlay = h(
      'div', { className: 'overlay' },
      h('h2', null, 'You Died'),
      h('div', { className: 'final' }, 'Final score', h('b', null, score)),
      h('div', { className: 'final' }, 'Reached', h('b', null, 'Cycle ' + cycle)),
      h('button', { className: 'action', onClick: reset, autoFocus: true }, 'Rise again')
    )
  } else if (phase === 'victory') {
    overlay = kiraSurvived ? h(
      'div', { className: 'overlay' },
      h('h2', { className: 'victoryTitle' }, 'The Dragon Falls'),
      h('p', null, KIRA_NAME + ' catches you staring at the wreckage a beat too long and elbows you. "We won," she says, "you can stare at me instead." You decide the wood can wait a little longer before you head home.'),
      h('div', { className: 'final' }, 'Final score', h('b', null, score)),
      h('button', { className: 'action', onClick: reset, autoFocus: true }, 'Rise again')
    ) : h(
      'div', { className: 'overlay' },
      h('h2', { className: 'victoryTitle' }, 'The Dragon Falls'),
      h('p', null, 'The dragon is dead. So is ' + KIRA_NAME + '. You sit down right there in the ash, sword across your knees, and decide the whole hero business was never really you. A quiet farm sounds good. Turnips don’t breathe fire.'),
      h('div', { className: 'final' }, 'Final score', h('b', null, score)),
      h('button', { className: 'action', onClick: reset, autoFocus: true }, 'Hang up the sword')
    )
  }

  return h(
    'div', { className: 'gameRoot' },
    h(
      'div', { className: 'frame' },
      h('canvas', {
        ref: canvasRef, width: VW, height: VH, role: 'img',
        'aria-label': 'Gothicvania duel — ' + health + '% health, ' + score + ' points',
      }),
      overlay
    )
  )
}
