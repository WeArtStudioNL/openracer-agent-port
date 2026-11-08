class_name AtmosphereShaders
extends RefCounted
## The shaders of the atmosphere (web/js/Atmosphere.js): the sky, the rain and the snow that fall past the camera, and
## the ground (the material of the surfaces of a track with the wet, the puddles and the snow on it).

## The sky: the colours overhead and at the horizon, the glow round the sun and the sun, the stars, the moon with its
## phase and its seas, and the clouds (noise over a plane far above, thinner at the horizon).
const SKY := """
shader_type sky;
render_mode use_debanding;

uniform vec3 top = vec3(0.07, 0.2, 0.55);
uniform vec3 horizon = vec3(0.65, 0.78, 0.9);
uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);
uniform vec3 sun_color = vec3(1.0);
uniform vec3 moon_dir = vec3(0.0, -1.0, 0.0);
uniform vec3 cloud_color = vec3(1.0);
uniform vec3 cloud_shade = vec3(0.5);
uniform float cover = 0.4;
uniform float stars = 0.0;
uniform float moon_phase = 1.0;
uniform float sun_vis = 1.0;
uniform float moon_vis = 0.0;
uniform float haze = 0.35;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
	float v = 0.0, a = 0.5;
	for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
	return v;
}

void sky() {
	vec3 d = normalize(EYEDIR);
	float h = d.y;
	vec3 col = mix(horizon, top, pow(smoothstep(0.0, 0.7, max(h, 0.0)), 0.8));
	float sd = max(dot(d, sun_dir), 0.0);
	col += sun_color * (pow(sd, 6.0) * 0.16 + pow(sd, 80.0) * 0.4) * sun_vis;
	if (!AT_CUBEMAP_PASS && stars > 0.01 && h > 0.0) {
		vec3 q = d * 150.0;
		vec3 c = floor(q);
		float r = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
		vec3 f = fract(q) - 0.5;
		float tw = 0.65 + 0.35 * sin(TIME * 2.0 + r * 60.0);
		col += vec3(1.0, 0.97, 0.9) * step(0.9965, r) * smoothstep(0.35, 0.0, length(f)) * stars * tw * smoothstep(0.0, 0.2, h);
	}
	float disc = smoothstep(cos(0.0125), cos(0.0095), dot(d, sun_dir));
	col = mix(col, sun_color * 10.0, disc * sun_vis);
	float md = dot(d, moon_dir);
	if (md > 0.9985 && moon_vis > 0.01) {
		vec3 up = abs(moon_dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
		vec3 tx = normalize(cross(up, moon_dir));
		vec3 ty = cross(moon_dir, tx);
		vec2 p = vec2(dot(d, tx), dot(d, ty)) / 0.016;
		float r2 = dot(p, p);
		if (r2 < 1.0) {
			vec3 n = vec3(p, sqrt(1.0 - r2));
			float th = (1.0 - moon_phase) * 3.14159265;
			vec3 l = vec3(sin(th), 0.0, cos(th));
			float lit = smoothstep(-0.03, 0.05, dot(n, l));
			float seas = fbm(p * 2.6 + 3.0);
			vec3 moon = vec3(0.95, 0.94, 0.88) * (0.82 - 0.34 * smoothstep(0.45, 0.65, seas));
			col = mix(col, moon * (0.03 + 1.7 * lit), smoothstep(1.0, 0.92, r2) * moon_vis);
		}
	}
	if (h > -0.02) {
		vec2 uv = d.xz / (max(h, 0.0) + 0.22) * 0.75 + vec2(TIME * 0.006, TIME * 0.0025);
		float n = fbm(uv * 2.3);
		float dens = smoothstep(1.0 - cover, 1.0 - cover + 0.3, n) * smoothstep(0.0, 0.1, h);
		vec3 cc = mix(cloud_color, cloud_shade, smoothstep(0.42, 0.85, n) * 0.65);
		cc += sun_color * pow(sd, 10.0) * 0.3 * sun_vis;
		col = mix(col, cc, dens * 0.94);
	}
	col = mix(col, horizon, haze * smoothstep(0.3, 0.0, h));
	COLOR = col;
}
"""

## Streaks of rain (lines: a top and a bottom vertex) in a box of 40 by 28 by 40 m round the camera, moved in the
## shader. UV.x is the end of the streak (0 top, 1 bottom), UV.y the speed.
const RAIN := """
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;

uniform vec3 colour = vec3(0.58, 0.65, 0.73);
varying float v_fade;

void vertex() {
	vec3 cam = CAMERA_POSITION_WORLD;
	vec3 p = VERTEX;
	float tail = UV.x;
	float fall = TIME * 16.0 * UV.y;
	p.y = cam.y - 8.0 + mod(p.y - fall, 28.0);
	p.x = cam.x + mod(p.x - cam.x + 20.0, 40.0) - 20.0;
	p.z = cam.z + mod(p.z - cam.z + 20.0, 40.0) - 20.0;
	p.y += tail * 0.9;
	p.x += tail * 0.08;
	v_fade = 1.0 - tail * 0.7;
	POSITION = PROJECTION_MATRIX * VIEW_MATRIX * vec4(p, 1.0);
}

void fragment() {
	ALBEDO = colour;
	ALPHA = 0.5 * v_fade;
}
"""

## Flakes of snow that drift as they fall: a small quad that faces the camera for each (UV.x the size, UV.y the speed,
## UV2 the corner), as wide on the screen as the points of the browser (1.4 to 9 pixels at 1080 lines).
const SNOW := """
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;

uniform vec3 colour = vec3(1.0);
varying float v_fade;
varying vec2 v_corner;

void vertex() {
	vec3 cam = CAMERA_POSITION_WORLD;
	vec3 p = VERTEX;
	float tail = UV.x;
	float speed = UV.y;
	float fall = TIME * 1.6 * speed;
	p.y = cam.y - 8.0 + mod(p.y - fall, 28.0);
	p.x = cam.x + mod(p.x - cam.x + 20.0, 40.0) - 20.0;
	p.z = cam.z + mod(p.z - cam.z + 20.0, 40.0) - 20.0;
	p.x += sin(TIME * 0.7 + VERTEX.z) * 0.6 * speed;
	p.z += cos(TIME * 0.6 + VERTEX.x) * 0.5 * speed;
	v_fade = 0.6 + 0.4 * tail;
	v_corner = UV2;
	vec4 mv = VIEW_MATRIX * vec4(p, 1.0);
	float d = max(0.6, -mv.z);
	float pixels = clamp((0.012 + 0.016 * tail) * 600.0 / d, 1.4, 9.0);
	float metres = pixels * d / 600.0;
	mv.xy += UV2 * metres * 0.5;
	POSITION = PROJECTION_MATRIX * mv;
}

void fragment() {
	float a = smoothstep(1.0, 0.3, length(v_corner));
	ALBEDO = colour * 1.6;
	ALPHA = 0.95 * a * v_fade;
}
"""

## The ground: the material of a surface of a track (what a StandardMaterial3D of a glb has: a colour, a texture, the
## vertex colours, a normal map, roughness and metallic, alpha scissor) with the wet, the puddles with the rings of the
## wheels and of the rain, and the snow, from the shared numbers of Ground (global uniforms). @CULL@ and @ALPHA@ are
## filled in per material.
const GROUND := """
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, @CULL@, diffuse_burley, specular_schlick_ggx;

global uniform float ground_wet;
global uniform float ground_snow;
global uniform float ground_puddle;
global uniform float ground_road_melt;
global uniform float ground_rain;
global uniform float ground_regrow;
global uniform vec2 ground_clear_centre;
global uniform float ground_clear_size;
global uniform sampler2D ground_clear : filter_linear, repeat_enable;
global uniform sampler2D ground_rings : filter_nearest;

uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D albedo_texture : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool use_texture = false;
uniform bool use_vertex_color = false;
uniform float roughness = 1.0;
uniform float metallic = 0.0;
uniform float specular = 0.5;
uniform sampler2D normal_texture : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool use_normal = false;
uniform float normal_scale = 1.0;
uniform vec3 uv1_scale = vec3(1.0);
uniform vec3 uv1_offset = vec3(0.0);
uniform vec3 emission : source_color = vec3(0.0);
uniform float emission_energy = 0.0;
uniform float alpha_scissor = 0.5;

varying vec3 v_pos;
varying vec3 v_normal;

float g_ihash(ivec2 c) {
	uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u;
	h = (h ^ (h >> 13u)) * 1274126177u;
	h = h ^ (h >> 16u);
	return float(h & 0xFFFFFFu) / 16777216.0;
}
float g_vn(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	ivec2 c = ivec2(i);
	return mix(mix(g_ihash(c), g_ihash(c + ivec2(1, 0)), f.x), mix(g_ihash(c + ivec2(0, 1)), g_ihash(c + ivec2(1, 1)), f.x), f.y);
}
float g_puddle_mask(vec2 p) {
	float n = 0.6 * g_vn(p / 5.0) + 0.4 * g_vn(p / 1.9 + vec2(31.7, 11.3));
	float t = 0.8 - 0.22 * ground_puddle;
	return smoothstep(t, t + 0.04, n) * smoothstep(0.0, 0.2, ground_puddle);
}
vec2 g_ring(vec2 p, vec2 c, float r, float width, float strength) {
	vec2 d = p - c;
	float len = max(length(d), 0.001);
	float w = exp(-pow((len - r) / width, 2.0));
	return d / len * ((len - r) / width) * w * strength;
}
float g_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float g_noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(g_hash(i), g_hash(i + vec2(1.0, 0.0)), f.x), mix(g_hash(i + vec2(0.0, 1.0)), g_hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void vertex() {
	UV = UV * uv1_scale.xy + uv1_offset.xy;
	v_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_normal = normalize(mat3(MODEL_MATRIX) * NORMAL);
}

void fragment() {
	vec4 base = albedo;
	if (use_texture) base *= texture(albedo_texture, UV);
	if (use_vertex_color) base *= COLOR;
	@ALPHA@
	vec3 dc = base.rgb;
	float rough = roughness;
	vec2 xz = v_pos.xz;
	// (the side that is seen: a surface drawn on both sides with its normals down is a floor from above)
	float g_up = clamp(normalize(v_normal).y * (FRONT_FACING ? 1.0 : -1.0), 0.0, 1.0);
	float g_flat = smoothstep(0.45, 0.85, g_up);
	float lum = dot(dc, vec3(0.2126, 0.7152, 0.0722));
	float mx = max(dc.r, max(dc.g, dc.b)), mn = min(dc.r, min(dc.g, dc.b));
	float asphalt = (1.0 - smoothstep(0.3, 0.5, lum)) * (1.0 - smoothstep(0.25, 0.45, (mx - mn) / max(mx, 0.001)));
	float g_snow = 0.0;
	float g_clear = 0.0;
	if (ground_snow > 0.003) {
		vec2 gd = abs(xz - ground_clear_centre);
		float g_in = 1.0 - smoothstep(0.36 * ground_clear_size, 0.46 * ground_clear_size, max(gd.x, gd.y));
		g_clear = clamp(texture(ground_clear, xz / ground_clear_size).r - ground_regrow, 0.0, 1.0) * g_in;
		float gn = 0.55 * g_noise(xz * 0.6) + 0.3 * g_noise(xz * 2.7) + 0.15 * g_noise(xz * 11.0);
		float melt = ground_road_melt * asphalt * (1.2 + 2.2 * g_noise(xz * 0.15));
		g_snow = smoothstep(0.0, 0.35, ground_snow * (1.0 - g_clear) * 1.25 - gn * 0.55 - melt) * g_flat;
	}
	float wet_in = ground_wet + ground_snow * g_clear * 0.8 + ground_snow * ground_road_melt * asphalt * 0.4;
	float g_wet = clamp(wet_in, 0.0, 1.0) * smoothstep(0.35, 0.8, g_up) * (1.0 - g_snow);
	float g_pud = 0.0;
	vec2 ripple = vec2(0.0);
	if (ground_puddle > 0.01) {
		g_pud = g_puddle_mask(xz) * smoothstep(0.93, 0.985, g_up) * asphalt * (1.0 - g_snow);
		if (g_pud > 0.02) {
			for (int k = 0; k < 12; k++) {
				vec4 rp = texelFetch(ground_rings, ivec2(k, 0), 0);
				if (rp.z < 1.6) ripple += g_ring(xz, rp.xy, rp.z * (1.4 + 3.0 * rp.w), 0.09 + 0.12 * rp.w, rp.w * (1.0 - rp.z / 1.6));
			}
			if (ground_rain > 0.01) {
				vec2 gc = floor(xz / 0.9);
				float gr = g_ihash(ivec2(gc));
				float ph = fract(TIME * 0.8 + gr * 7.0);
				vec2 ctr = (gc + 0.5 + (vec2(gr, fract(gr * 13.7)) - 0.5) * 0.3) * 0.9;
				ripple += g_ring(xz, ctr, ph * 0.4, 0.05, (1.0 - ph) * ground_rain * 0.6);
			}
		}
		g_wet = max(g_wet, g_pud);
		dc *= mix(1.0, 0.7, g_pud);
	}
	dc *= mix(1.0, 0.58, g_wet);
	dc = mix(dc, vec3(0.8, 0.84, 0.9) * (0.9 + 0.2 * g_noise(xz * 30.0)), g_snow * 0.93);
	rough = mix(rough, 0.16, g_wet);
	rough = mix(rough, 0.88, g_snow);
	rough = mix(rough, 0.02, g_pud);
	ALBEDO = dc;
	ROUGHNESS = rough;
	METALLIC = metallic;
	SPECULAR = specular;
	EMISSION = emission * emission_energy;
	if (use_normal) {
		NORMAL_MAP = texture(normal_texture, UV).rgb;
		NORMAL_MAP_DEPTH = normal_scale;
	}
	if (g_pud > 0.02) NORMAL = normalize(NORMAL + (VIEW_MATRIX * vec4(ripple.x, 0.0, ripple.y, 0.0)).xyz * 0.45 * g_pud);
}
"""
