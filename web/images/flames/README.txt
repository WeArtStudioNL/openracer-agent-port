Your own pictures for the flames at the exhaust (pops, bangs, anti-lag; web/js/Flames.js).

Put flat PNGs with transparency here and list their names in index.json (at most 16), for example ["flame1.png", "flame2.png"]. Without
index.json the game looks for flame1.png, flame2.png, ... up to the first missing number. Every flame takes one of them at random. Without a picture here the game makes a gradient flame.

A picture points to the right: the nozzle is the middle of the left edge, the tip is the right edge. The game turns it to the way the flame flies
(as seen from the camera) and draws it additive, so black counts as nothing. A wide picture, about 2:1, works well; 128 x 64 pixels is enough.
