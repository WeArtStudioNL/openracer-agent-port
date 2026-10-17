/*
 * editor-ui.js: what the car editor and the track editor share in their user interface: dialogs that open from buttons
 * (data-open="id of the dialog", data-close on a button inside), cards that remember whether they were folded, and a toast
 * in the 3D view for the messages (window.editorToast(text, kind)).
 */

(function () {
    var page = location.pathname.split("/").pop();

    // dialogs
    document.querySelectorAll("[data-open]").forEach(function (button) {
        button.addEventListener("click", function () {
            var dialog = document.getElementById(button.dataset.open);
            if (dialog && !dialog.open) dialog.showModal();
        });
    });
    document.querySelectorAll("dialog").forEach(function (dialog) {
        dialog.querySelectorAll("[data-close]").forEach(function (button) {
            button.addEventListener("click", function () { dialog.close(); });
        });
        // a click on the dark backdrop closes the dialog
        dialog.addEventListener("click", function (event) {
            if (event.target === dialog) dialog.close();
        });
    });

    // cards: folded or open, as they were last time
    document.querySelectorAll("details.card").forEach(function (card) {
        var summary = card.querySelector("summary");
        var key = "editor-card:" + page + ":" + (summary ? summary.firstChild.textContent.trim() : "");
        try {
            var kept = localStorage.getItem(key);
            if (kept === "open") card.open = true;
            else if (kept === "closed") card.open = false;
        } catch (e) { /* no storage */ }
        card.addEventListener("toggle", function () {
            try { localStorage.setItem(key, card.open ? "open" : "closed"); } catch (e) { /* no storage */ }
        });
    });

    // the toast
    var timer = 0;
    window.editorToast = function (text, kind) {
        var toast = document.getElementById("toast");
        if (!toast) return;
        clearTimeout(timer);
        toast.textContent = text;
        toast.className = kind || "";
        toast.style.display = text ? "block" : "none";
        if (text && kind) timer = setTimeout(function () { toast.style.display = "none"; }, 6000);
    };
})();
