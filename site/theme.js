// Colour theme: auto (follows the device), light or dark. The choice is kept in the browser.
(function () {
    var KEY = "openracer-theme", order = ["auto", "light", "dark"];
    function get() { try { return localStorage.getItem(KEY) || "auto"; } catch (e) { return "auto"; } }
    function apply(t) {
        if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
        else document.documentElement.removeAttribute("data-theme");
    }
    apply(get());
    document.addEventListener("DOMContentLoaded", function () {
        var b = document.getElementById("theme");
        if (!b) return;
        function show() {
            var t = get();
            b.textContent = { auto: "◐ Auto", light: "☀ Light", dark: "☾ Dark" }[t];
            b.setAttribute("aria-label", "Colour theme: " + t + ". Click to change.");
        }
        b.addEventListener("click", function () {
            var next = order[(order.indexOf(get()) + 1) % order.length];
            try { if (next === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch (e) {}
            apply(next); show();
        });
        show();
    });
})();
