/* A picture of the site opens in a full-screen window instead of as a file: it fits the width and the height of the screen, and closes with the cross, a click outside it or Esc. */
(function () {
    var box = null, img = null, caption = null, closer = null, opener = null;
    function build() {
        box = document.createElement("div");
        box.className = "lightbox";
        box.setAttribute("role", "dialog");
        box.setAttribute("aria-modal", "true");
        box.setAttribute("aria-label", "Picture");
        box.hidden = true;
        img = document.createElement("img");
        caption = document.createElement("div");
        caption.className = "lightbox-caption";
        closer = document.createElement("button");
        closer.type = "button";
        closer.className = "lightbox-close";
        closer.setAttribute("aria-label", "Close");
        closer.textContent = "×";
        box.appendChild(img);
        box.appendChild(caption);
        box.appendChild(closer);
        box.addEventListener("click", function (e) { if (e.target !== img) close(); });
        document.body.appendChild(box);
    }
    function open(link) {
        var thumb = link.querySelector("img");
        if (!thumb) return;
        if (!box) build();
        opener = link;
        img.src = link.getAttribute("href");
        img.alt = thumb.alt;
        var figure = link.closest("figure"), text = figure && figure.querySelector("figcaption");
        caption.textContent = text ? text.textContent : thumb.alt;
        box.hidden = false;
        document.documentElement.classList.add("lightbox-open");
        closer.focus();
    }
    function close() {
        if (!box || box.hidden) return;
        box.hidden = true;
        img.removeAttribute("src");
        document.documentElement.classList.remove("lightbox-open");
        if (opener) opener.focus();
    }
    document.addEventListener("click", function (e) {
        if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;      // (a new tab on a modified click still works)
        var link = e.target.closest && e.target.closest("figure.shot a");
        if (!link || !/\.(webp|png|jpe?g)$/i.test(link.getAttribute("href") || "")) return;
        e.preventDefault();
        open(link);
    });
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") close();
        else if (e.key === "Tab" && box && !box.hidden) { e.preventDefault(); closer.focus(); }      // (the cross is the only thing to reach)
    });
})();
