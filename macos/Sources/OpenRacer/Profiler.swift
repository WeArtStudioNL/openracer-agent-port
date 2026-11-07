// A measurement of where the time of a frame goes, for debug builds only (MACOS-METAL.md). Started with the environment of the app:
//
//   OPENRACER_PROFILE=<seconds>          measure that long once the race runs, then print the result and quit
//   OPENRACER_QUERY=car=..&track=..&ai=3 the address of the game (it starts the race straight away), default: the Muscle on the Desert with 3 AI cars
//
//   OPENRACER_PROFILE=30 macos/build/dd/Build/Products/Debug/OpenRacer.app/Contents/MacOS/OpenRacer
//
// The player's car is driven by the AI (the autopilot of main.js after a finish), so the physics works as in a race. The result is one line of
// JSON on stdout: per part of a frame the mean, the 95th percentile and the maximum in ms.
#if DEBUG
import Foundation
import WebKit

final class Profiler: NSObject, WKScriptMessageHandler {
    let seconds: Double
    let query: String
    let extra: String

    init?(environment: [String: String]) {
        guard let text = environment["OPENRACER_PROFILE"], let seconds = Double(text), seconds > 0 else { return nil }
        self.seconds = seconds
        query = environment["OPENRACER_QUERY"] ?? "car=openracer-muscle&track=desert&ai=3&laps=0"
        extra = environment["OPENRACER_PROFILE_JS"] ?? ""      // run once the race runs, e.g. renderer.setPixelRatio(1)
    }

    func install(in config: WKWebViewConfiguration) {
        config.userContentController.add(self, name: "openracerProfile")
        let source = Self.script.replacingOccurrences(of: "__SECONDS__", with: String(seconds))
            .replacingOccurrences(of: "__EXTRA__", with: extra)
        config.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        var text = (message.body as? String) ?? "\(message.body)"
        if text.hasPrefix("{\"done\""), let window = NSApp.windows.first {
            // a window that is covered or on another Space may get fewer frames from WebKit: say so with the result
            text = "{\"window_visible\":\(window.occlusionState.contains(.visible)),\"window_key\":\(window.isKeyWindow)," + text.dropFirst()
        }
        FileHandle.standardOutput.write(Data(("OPENRACER_PROFILE " + text + "\n").utf8))
        if text.contains("\"done\":true") { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { NSApp.terminate(nil) } }
    }

    private static let script = #"""
    (function () {
        var post = function (o) { window.webkit.messageHandlers.openracerProfile.postMessage(JSON.stringify(o)); };
        var seconds = __SECONDS__, warmup = 5, samples = {}, measuring = false, started = 0, last = 0;
        function add(name, ms) { if (measuring) (samples[name] = samples[name] || []).push(ms); }
        function wrap(name, label) {
            var f = window[name];
            if (typeof f !== "function") { post({ note: "no function " + name }); return; }
            window[name] = function () { var t = performance.now(); try { return f.apply(this, arguments); } finally { add(label, performance.now() - t); } };
        }
        var carWrapped = false, hiddenFrames = 0;
        function tick(now) {
            if (last) add("interval", now - last);
            if (measuring && document.hidden) hiddenFrames++;
            last = now;
            if (!carWrapped && typeof car !== "undefined" && car && car.isReady && car.isReady() && typeof race !== "undefined") {
                carWrapped = true;
                // (the scripts of the game are loaded after the page, so their functions are wrapped once the car is there)
                wrap("render", "frame_cpu");            // everything of a frame on the main thread: the game, the reflections, the drawing
                wrap("onEnterFrame", "game");           // the physics of the player, the AI, the race, the sound
                wrap("updateRace", "ai_and_opponents"); // the AI cars: their drivers and their physics
                var u = car.update;
                car.update = function () { var t = performance.now(); try { return u.apply(this, arguments); } finally { add("player_physics", performance.now() - t); } };
                try { startAutopilot(); car.autopilot.paceFactor = 1; car.autopilot.paceCap = 1e9; car.cameraOverride = null; } catch (e) { post({ note: "no autopilot: " + e.message }); }
                try { (function () { __EXTRA__ })(); } catch (e) { post({ note: "extra failed: " + e.message }); }
                post({ note: "race running, warming up " + warmup + " s" });
                setTimeout(function () { measuring = true; started = performance.now(); }, warmup * 1000);
            }
            if (measuring && now - started > seconds * 1000) {
                measuring = false;
                var out = { done: true, seconds: seconds, frames: (samples.interval || []).length, ua: navigator.userAgent,
                            canvas: (typeof renderer !== "undefined" && renderer) ? renderer.domElement.width + "x" + renderer.domElement.height + " @" + window.devicePixelRatio : "?",
                            simCost_ms_per_game_s: typeof simCost === "number" ? +simCost.toFixed(1) : null, simLimit: typeof simLimit === "number" ? simLimit : null,
                            speed_kmh: car && car.vehicle ? Math.round(Math.hypot(car.vehicle.u || 0, car.vehicle.v || 0) * 3.6) : null, hidden_frames: hiddenFrames, ai: typeof race !== "undefined" && race.opponents ? race.opponents.length : 0, parts: {} };
                Object.keys(samples).forEach(function (k) {
                    var s = samples[k].slice().sort(function (a, b) { return a - b; }), n = s.length;
                    out.parts[k] = { mean: +(s.reduce(function (a, b) { return a + b; }, 0) / n).toFixed(2), p95: +s[Math.floor(n * 0.95)].toFixed(2), max: +s[n - 1].toFixed(2), n: n };
                });
                post(out);
                return;
            }
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    })();
    """#
}
#endif
