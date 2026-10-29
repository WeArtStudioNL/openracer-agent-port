# synthesises the impulse responses of the exhausts of the Engine card (our own, no recordings): a pipe is a delay line with a reflection at the
# open end (negative: a pulse comes back as a rarefaction), a muffler is chambers that smear and dull the pulse
import numpy as np, wave, sys, os
SR=44100; C=343.0
rng=np.random.default_rng(7)
def lowpass(x,fc):
    # one-pole x2
    a=np.exp(-2*np.pi*fc/SR); y=np.zeros_like(x); s1=s2=0.0
    for i,v in enumerate(x):
        s1=(1-a)*v+a*s1; s2=(1-a)*s1+a*s2; y[i]=s2
    return y
def highpass(x,fc): return x-lowpass(x,fc)
def burst(n,decay,fc_lo=None,fc_hi=None):
    t=np.arange(n)/SR; x=rng.standard_normal(n)*np.exp(-t/decay)
    if fc_lo: x=lowpass(x,fc_lo)
    if fc_hi: x=highpass(x,fc_hi)
    return x
def pipe(n,length,refl,fc=None):
    # the pulse and its echoes through a pipe of this length, open at the end
    ir=np.zeros(n); d=int(2*length/C*SR); k=0; g=1.0
    while k*d<n and abs(g)>1e-3:
        ir[k*d]+=g; g*=-refl; k+=1
    if fc: ir=lowpass(ir,fc)
    return ir
def norm(x): x=x/np.abs(x).max(); return x
def save(name,x):
    x=norm(x); w=wave.open(os.path.join(os.path.dirname(os.path.abspath(__file__)),name),"wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((x*30000).astype("<i2").tobytes()); w.close()
n=int(0.45*SR)
# Standard: a stock muffler: chambers that smear the pulse into a dull, boomy tail
x=np.zeros(n); x[0]=0.25
x+=burst(n,0.09,fc_lo=700)*1.0 + pipe(n,0.9,0.5,fc=900)*0.6
save("exhaust_standard.wav",x)
# Sport: a resonator and a free-flowing muffler: the low pipe tones stay, the tail is shorter
x=np.zeros(n); x[0]=0.5
x+=burst(n,0.05,fc_lo=1600)*0.8 + pipe(n,1.4,0.6,fc=2200)*1.0
save("exhaust_sport.wav",x)
# Performance: a cat-back with a straight-through muffler: all the pipe, a little of the muffler
x=np.zeros(n); x[0]=0.8
x+=burst(n,0.035,fc_lo=4500)*0.5 + pipe(n,1.6,0.7,fc=5500)*1.1
save("exhaust_performance.wav",x)
# Straight cut: an open pipe without muffler: a bright ring of the pipe length
x=np.zeros(n); x[0]=1.0
x+=pipe(n,1.7,0.82)*1.2 + highpass(burst(n,0.03),900)*0.35
save("exhaust_straight.wav",x)
# Open headers: only the primary pipes, the pulse is cracked out of the engine
x=np.zeros(n); x[0]=1.0
x+=pipe(n,0.55,0.8)*1.0 + highpass(burst(n,0.015),1800)*0.8
save("exhaust_open.wav",x)
