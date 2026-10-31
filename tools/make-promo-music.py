#!/usr/bin/env python3
"""
Makes an original electronic dance track for the promo video of the site: no samples and no lyrics, everything is calculated here (a kick, a clap, hats, a
bass, a chord pad and an arpeggio, 128 BPM, A minor). Usage: python3 tools/make-promo-music.py out.wav [seconds]   (needs numpy).
"""
import sys
import wave
import numpy as np

SR = 48000
BPM = 128
BEAT = 60.0 / BPM
BAR = 4 * BEAT
SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 93.0
N = int(SR * SECONDS)
rng = np.random.default_rng(7)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12.0)


def add(buf, start, sig, gain=1.0):
    i = int(start * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += gain * sig[:j - i]


def saw(f, n, harmonics=14, detune=0.0):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for h in range(1, harmonics + 1):
        if f * h * (1 + detune) > 9000:
            break
        out += np.sin(2 * np.pi * f * h * (1 + detune) * t + h) / h
    return out * 0.6


def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.minimum(1.0, t / max(attack, 1e-4)) * np.exp(-t / decay)


kick_buf = np.zeros(N)
clap_buf = np.zeros(N)
hat_buf = np.zeros(N)
bass_buf = np.zeros(N)
pad_buf = np.zeros(N)
arp_buf = np.zeros(N)
fx_buf = np.zeros(N)

# the parts of the track in bars: (intro, groove, breakdown, riser, groove, outro)
bars = int(SECONDS / BAR) + 1
INTRO, GROOVE1, BREAK, GROOVE2 = 8, 24, 28, 32
END = int(SECONDS / BAR) - 4

CHORDS = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]     # Am F C G
ROOTS = [33, 29, 36, 31]
ARP = [0, 1, 2, 1, 0, 2, 1, 2]


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t * 28)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.exp(-t * 9) * 1.2 + np.sin(phase * 2) * np.exp(-t * 40) * 0.2


def clap():
    n = int(0.22 * SR)
    noise = rng.standard_normal(n)
    noise = noise - np.convolve(noise, np.ones(8) / 8, mode="same")       # a crude highpass
    e = np.zeros(n)
    t = np.arange(n) / SR
    for d in (0.0, 0.011, 0.023):
        k = int(d * SR)
        e[k:] += np.exp(-(t[:n - k]) * 35)
    return noise * e * 0.35


def hat(open_=False):
    n = int((0.16 if open_ else 0.04) * SR)
    noise = rng.standard_normal(n)
    noise = noise - np.convolve(noise, np.ones(4) / 4, mode="same")
    return noise * np.exp(-np.arange(n) / SR * (22 if open_ else 90)) * 0.16


kick_s, clap_s, hat_c, hat_o = kick(), clap(), hat(False), hat(True)

for bar in range(bars):
    t0 = bar * BAR
    chord = CHORDS[(bar // 2) % 4]
    root = ROOTS[(bar // 2) % 4]
    groove = (INTRO <= bar < BREAK - 4) or (BREAK <= bar < END) or False
    full = (INTRO + 0 <= bar < GROOVE1 + 4) or (GROOVE2 <= bar < END)
    breakdown = GROOVE1 + 4 <= bar < GROOVE2 - 4 + 4 and GROOVE1 + 4 <= bar < GROOVE2
    intro = bar < INTRO
    outro = bar >= END
    # the pad: all through, softer in the groove
    if True:
        n = int(BAR * 2 * SR) if bar % 2 == 0 else 0
        if n:
            sig = np.zeros(n)
            for m in chord:
                sig += saw(hz(m), n, 10) + saw(hz(m), n, 10, 0.004) + saw(hz(m + 12), n, 6, -0.003) * 0.5
            e = np.minimum(1.0, np.arange(n) / SR / 0.8) * np.minimum(1.0, (n - np.arange(n)) / SR / 0.8)
            add(pad_buf, t0, sig * e, 0.05 if not breakdown else 0.075)
    for beat in range(4):
        tb = t0 + beat * BEAT
        if (full or outro and bar < END + 2) and not breakdown:
            add(kick_buf, tb, kick_s, 1.0)
        if (full or outro and bar < END + 2) and beat in (1, 3):
            add(clap_buf, tb, clap_s, 1.0)
        # hats: eighths in the intro, off-beat open hat in the groove
        if intro and bar >= 4:
            add(hat_buf, tb, hat_c, 0.8)
            add(hat_buf, tb + BEAT / 2, hat_c, 0.5)
        if full and not breakdown:
            add(hat_buf, tb + BEAT / 2, hat_o, 1.0)
            add(hat_buf, tb + BEAT / 4, hat_c, 0.4)
            add(hat_buf, tb + 3 * BEAT / 4, hat_c, 0.6)
        # bass on the off-beat eighth, an octave jump now and then
        if full and not breakdown:
            tbass = tb + BEAT / 2
            f = hz(root + (12 if (beat == 3 and bar % 2 == 1) else 0))
            n = int(BEAT * 0.45 * SR)
            add(bass_buf, tbass, saw(f, n, 8) * env(n, 0.004, 0.18), 0.55)
        # the arpeggio: sixteenths
        if (full and bar >= GROOVE2 - 4) or breakdown or (GROOVE1 <= bar < GROOVE1 + 4):
            for s in range(4):
                idx = ARP[(beat * 4 + s) % 8]
                m = chord[idx % 3] + 12 * (1 + (1 if (beat * 4 + s) % 8 > 4 else 0))
                n = int(0.3 * SR)
                ts = tb + s * BEAT / 4
                sig = saw(hz(m), n, 9) * env(n, 0.002, 0.09)
                add(arp_buf, ts, sig, 0.10)
                add(arp_buf, ts + BEAT * 0.75, sig, 0.045)               # an echo, three sixteenths later
    # a riser in the last two bars before the groove comes back
    if GROOVE2 - 2 <= bar < GROOVE2:
        n = int(BAR * SR)
        t = np.arange(n) / SR
        noise = rng.standard_normal(n)
        noise = noise - np.convolve(noise, np.ones(6) / 6, mode="same")
        add(fx_buf, t0, noise * (t / BAR) ** 2 * 0.22, 1.0)
    if bar == GROOVE2 - 1:
        pass

# the kick ducks the pad, the bass and the arpeggio (sidechain)
duck = np.ones(N)
for bar in range(bars):
    for beat in range(4):
        i = int((bar * BAR + beat * BEAT) * SR)
        n = int(0.28 * SR)
        if i < N and kick_buf[i:i + 200].any():
            j = min(N, i + n)
            curve = 1 - 0.75 * np.exp(-np.arange(j - i) / SR / 0.09)
            duck[i:j] = np.minimum(duck[i:j], curve)
mix = kick_buf * 0.95 + clap_buf + hat_buf + (bass_buf + pad_buf + arp_buf) * duck + fx_buf
fade_in = np.minimum(1.0, np.arange(N) / SR / 1.2)
fade_out = np.minimum(1.0, (N - np.arange(N)) / SR / 3.0)
mix = np.tanh(mix * fade_in * fade_out * 1.3) * 0.9
pcm = (mix * 32767).astype("<i2")
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", sys.argv[1], "%.1f s" % SECONDS)
