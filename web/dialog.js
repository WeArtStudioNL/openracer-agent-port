/*
 * dialog.js
 *
 * Description: Questions and messages as a window of the page, in the look of the game (theme.css), in place of the alerts and confirms of the browser, which
 *              are never used. A plain script, for the game and for the editors.
 *
 *   OpenRacerDialog.ask({ title, text, details, ok, cancel, danger })  Promise of true (ok) or false (cancel, Esc, a click beside the window)
 *   OpenRacerDialog.tell({ title, text, details, ok })                 Promise, when it is closed
 *   OpenRacerDialog.prompt({ title, text, input, ok })                 Promise of the text that was typed, or null
 *
 *   details: a list of lines of text, or of [name, before, after] for a list of changes, or a DOM node; it scrolls when it is long.
 */
var OpenRacerDialog = (function () {
    var styled = false;
    function addStyle() {
        if (styled) return;
        styled = true;
        var style = document.createElement("style");
        style.textContent =
            "#orDialog { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 9000; background: rgba(0, 0, 0, 0.7); display: flex; align-items: center; justify-content: center; " +
            "font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }" +
            "#orDialog .box { width: 560px; max-width: calc(100% - 32px); max-height: calc(100% - 32px); display: flex; flex-direction: column; background: var(--panel, #181d23); color: var(--text, #d9dee5); " +
            "border: 1px solid var(--line, #272e37); border-radius: 12px; padding: 22px 26px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6); }" +
            "#orDialog h2 { margin: 0 0 6px; font-size: 20px; color: var(--head, #f4f6f8); }" +
            "#orDialog .text { color: var(--muted, #8d97a3); font-size: 14px; line-height: 1.5; margin: 0 0 12px; }" +
            "#orDialog .details { overflow-y: auto; min-height: 0; margin: 0 0 14px; border: 1px solid var(--line, #272e37); border-radius: 8px; background: var(--bg2, #14181d); }" +
            "#orDialog .details .line { padding: 7px 12px; font-size: 13px; border-bottom: 1px solid var(--line, #272e37); word-break: break-word; }" +
            "#orDialog .details .line:last-child { border-bottom: 0; }" +
            "#orDialog .details .name { color: var(--head, #f4f6f8); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }" +
            "#orDialog .details .was { color: var(--bad, #ff6b62); text-decoration: line-through; opacity: .85; }" +
            "#orDialog .details .now { color: var(--ok, #3ddc84); }" +
            "#orDialog .actions { display: flex; justify-content: flex-end; gap: 10px; }" +
            "#orDialog input.field { font: 15px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: var(--head, #f4f6f8); background: var(--bg2, #14181d); border: 1px solid var(--line, #272e37); border-radius: 8px; padding: 9px 12px; margin: 0 0 14px; }" +
            "#orDialog button { font: 600 15px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: var(--text, #d9dee5); background: var(--bg2, #14181d); border: 1px solid var(--line, #272e37); border-radius: 8px; padding: 9px 18px; cursor: pointer; }" +
            "#orDialog button:hover { border-color: var(--muted, #8d97a3); color: var(--head, #f4f6f8); }" +
            "#orDialog button.primary { background: var(--accent, #ff5a1f); border-color: var(--accent, #ff5a1f); color: #fff; }" +
            "#orDialog button.danger { background: #c0443b; border-color: #c0443b; color: #fff; }";
        document.head.appendChild(style);
    }

    function short(v) {
        var s = typeof v === "string" ? v : JSON.stringify(v);
        if (s === undefined) s = "(none)";
        return s.length > 70 ? s.slice(0, 67) + "…" : s;
    }

    function detailsNode(details) {
        if (!details) return null;
        if (details.nodeType) return details;
        var box = document.createElement("div");
        box.className = "details";
        details.forEach(function (d) {
            var line = document.createElement("div");
            line.className = "line";
            if (Array.isArray(d)) {
                var name = document.createElement("div");
                name.className = "name";
                name.textContent = d[0];
                line.appendChild(name);
                var change = document.createElement("div");
                var was = document.createElement("span"), now = document.createElement("span");
                was.className = "was"; now.className = "now";
                was.textContent = short(d[1]); now.textContent = short(d[2]);
                if (d[1] === undefined) { change.appendChild(document.createTextNode("added: ")); change.appendChild(now); }
                else if (d[2] === undefined) { change.appendChild(document.createTextNode("removed: ")); change.appendChild(was); }
                else { change.appendChild(was); change.appendChild(document.createTextNode("  →  ")); change.appendChild(now); }
                line.appendChild(change);
            } else line.textContent = d;
            box.appendChild(line);
        });
        return box;
    }

    function show(options, withCancel) {
        addStyle();
        return new Promise(function (resolve) {
            var old = document.getElementById("orDialog");
            if (old) old.remove();
            var shade = document.createElement("div");
            shade.id = "orDialog";
            var box = document.createElement("div");
            box.className = "box";
            shade.appendChild(box);
            var h = document.createElement("h2");
            h.textContent = options.title || "";
            box.appendChild(h);
            if (options.text) { var t = document.createElement("div"); t.className = "text"; t.textContent = options.text; box.appendChild(t); }
            var d = detailsNode(options.details);
            if (d) box.appendChild(d);
            var field = null;
            if (options.input !== undefined) {
                field = document.createElement("input");
                field.className = "field"; field.type = "text"; field.value = options.input || ""; field.maxLength = options.maxLength || 60;
                field.setAttribute("aria-label", options.title || "Name");
                box.appendChild(field);
            }
            var actions = document.createElement("div");
            actions.className = "actions";
            var before = document.activeElement;
            function finish(answer) {
                document.removeEventListener("keydown", onKey, true); shade.remove();
                if (before && before.focus && document.contains(before)) before.focus();          // (the focus goes back where it was)
                resolve(field ? (answer ? field.value : null) : answer);
            }
            function onKey(e) {
                if (e.code === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
                else if (e.code === "Enter") {
                    // Enter is the button that has the focus (Tab to Cancel, then Enter, deleted the car all the same); OK when none has it
                    e.preventDefault(); e.stopPropagation();
                    var focused = document.activeElement;
                    if (focused && focused.tagName === "BUTTON" && box.contains(focused)) focused.click(); else ok.click();
                }
                else if (e.code === "Tab") {
                    // the focus stays in the window
                    var buttons = Array.prototype.slice.call(box.querySelectorAll("button, input"));
                    if (!buttons.length) return;
                    var at = buttons.indexOf(document.activeElement);
                    e.preventDefault();
                    buttons[(at + (e.shiftKey ? buttons.length - 1 : 1) + buttons.length) % buttons.length].focus();
                }
            }
            if (withCancel) {
                var cancel = document.createElement("button");
                cancel.textContent = options.cancel || "Cancel";
                cancel.onclick = function () { finish(false); };
                actions.appendChild(cancel);
            }
            var ok = document.createElement("button");
            ok.className = options.danger ? "danger" : "primary";
            ok.textContent = options.ok || "OK";
            ok.onclick = function () {
                if (field && !field.value.trim()) { field.focus(); return; }           // (a name is needed)
                finish(true);
            };
            actions.appendChild(ok);
            box.appendChild(actions);
            shade.onclick = function (e) { if (e.target === shade) finish(false); };
            document.addEventListener("keydown", onKey, true);
            shade.setAttribute("role", "dialog"); shade.setAttribute("aria-modal", "true"); shade.setAttribute("aria-label", options.title || "");
            document.body.appendChild(shade);
            // (a question that deletes something starts on Cancel: a stray Enter or Space does not delete)
            if (field) { field.focus(); field.select(); } else if (options.danger && cancel) cancel.focus(); else ok.focus();
        });
    }

    // The differences between two configurations, as [path, before, after] (undefined: not there). Objects are walked; a list is one value.
    function differences(before, after, prefix, out) {
        out = out || [];
        prefix = prefix || "";
        var isObject = function (v) { return v && typeof v === "object" && !Array.isArray(v); };
        var keys = {};
        Object.keys(before || {}).forEach(function (k) { keys[k] = 1; });
        Object.keys(after || {}).forEach(function (k) { keys[k] = 1; });
        Object.keys(keys).sort().forEach(function (k) {
            if (k.charAt(0) === "_" || (!prefix && k === "id")) return;
            var a = before ? before[k] : undefined, b = after ? after[k] : undefined, path = prefix ? prefix + "." + k : k;
            if (isObject(a) && isObject(b)) differences(a, b, path, out);
            else if (JSON.stringify(a) !== JSON.stringify(b)) out.push([path, a, b]);
        });
        return out;
    }

    return {
        ask: function (options) { return show(options || {}, true); },
        tell: function (options) { return show(options || {}, false); },
        // a name: Promise of the text, or null (cancel, Esc). options.input is the text it starts with
        prompt: function (options) { options = Object.assign({}, options || {}); if (options.input === undefined) options.input = ""; return show(options, true); },
        differences: differences
    };
})();
