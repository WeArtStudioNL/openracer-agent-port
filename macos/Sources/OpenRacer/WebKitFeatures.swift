// Features of WebKit that are not in its public API, set by name (the app is sold as a DMG, not in the App Store, where this is not allowed).
//
// PreferPageRenderingUpdatesNear60FPSEnabled: WebKit gives a page at most 60 frames a second (requestAnimationFrame), also on a screen of
// 120 Hz (ProMotion). Off, the game gets the refresh rate of the screen. Measured on an M5: the low preset went from 60 to 120 fps.
//
// If a version of macOS renames or drops a feature, nothing happens: the game then runs as before.
import WebKit

enum WebKitFeatures {
    static func set(_ key: String, _ enabled: Bool, in preferences: WKPreferences) {
        let cls: AnyClass = WKPreferences.self
        let listSelector = NSSelectorFromString("_features")
        let setSelector = NSSelectorFromString("_setEnabled:forFeature:")
        guard let list = class_getClassMethod(cls, listSelector), let setter = class_getInstanceMethod(cls, setSelector) else {
            NSLog("OpenRacer: WebKit has no list of features; \(key) stays as it is")
            return
        }
        typealias ListFn = @convention(c) (AnyClass, Selector) -> NSArray
        typealias SetFn = @convention(c) (WKPreferences, Selector, Bool, AnyObject) -> Void
        let features = unsafeBitCast(method_getImplementation(list), to: ListFn.self)(cls, listSelector)
        for case let feature as NSObject in features where (feature.value(forKey: "key") as? String) == key {
            unsafeBitCast(method_getImplementation(setter), to: SetFn.self)(preferences, setSelector, enabled, feature)
            return
        }
        NSLog("OpenRacer: WebKit has no feature \(key); it stays as it is")
    }
}
