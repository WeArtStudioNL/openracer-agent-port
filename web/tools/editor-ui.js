/*
 * editor-ui.js: what the car editor and the track editor share in their user interface: dialogs that open from buttons
 * (data-open="id of the dialog", data-close on a button inside), cards that start folded, and a toast
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
        // a click on the dark backdrop closes the dialog (pressed and let go there: selecting the text of a field and letting go beside the window closed it)
        // (beside the window, by the place: the edges of the window are the dialog too, and they scale it now)
        var outside = function (event) { var r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; };
        var downOnBackdrop = false;
        dialog.addEventListener("pointerdown", function (event) { downOnBackdrop = event.target === dialog && outside(event); });
        dialog.addEventListener("click", function (event) {
            if (event.target === dialog && downOnBackdrop && outside(event)) dialog.close();
            downOnBackdrop = false;
        });
        // every window of the editor is moved by its head and scaled at its edges and corners (Movable.js); what it holds scrolls inside it, away from the edge
        var head = dialog.querySelector(".head");
        if (head && window.OpenRacer && OpenRacer.Movable) {
            dialog.classList.add("mvDialog");
            head.style.cursor = "move";
            OpenRacer.Movable.make(dialog, { key: "dialog-" + (dialog.id || "x"), handle: head, edges: true });
        }
    });

    // cards: all folded when the editor opens (the ones the page marks open too)
    document.querySelectorAll("details.card").forEach(function (card) { card.open = false; });

    // (i) buttons: the longer explanation of a short line, in a small popover (a click or the keyboard; it goes away with a click elsewhere or Escape)
    var pop = null, popFor = null;
    function hideTip() { if(pop) pop.style.display = "none"; popFor = null; }
    document.addEventListener("click", function (event) {
        var button = event.target.closest && event.target.closest("button.info");
        if(!button) { hideTip(); return; }
        if(!pop) { pop = document.createElement("div"); pop.id = "tipPop"; pop.setAttribute("role", "tooltip"); document.body.appendChild(pop); }
        if(popFor === button) { hideTip(); return; }
        popFor = button;
        pop.textContent = button.dataset.tip || "";
        pop.style.display = "block";
        var r = button.getBoundingClientRect();
        pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left - 8)) + "px";
        pop.style.top = (r.bottom + 6 + pop.offsetHeight > window.innerHeight ? Math.max(8, r.top - pop.offsetHeight - 6) : r.bottom + 6) + "px";
    });
    document.addEventListener("keydown", function (event) { if(event.key === "Escape") hideTip(); });

    // the toast
    var timer = 0;
    window.editorToast = function (text, kind) {
        var toast = document.getElementById("toast");
        if (!toast) return;
        clearTimeout(timer);
        toast.textContent = text;
        toast.className = kind || "";
        toast.style.display = text ? "block" : "none";
        // (an error stays until it is clicked away: a long one was gone before it was read; the others go after 6 s)
        toast.title = kind === "error" || kind === "warn" ? "Click to close" : "";
        toast.onclick = function () { toast.style.display = "none"; };
        if (text && kind && kind !== "error" && kind !== "warn") timer = setTimeout(function () { toast.style.display = "none"; }, 6000);
    };
})();
