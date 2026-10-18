// Docs page: the sidebar toggle on a phone, the link of the section in view highlighted, and # links on the headings.
(function () {
    var side = document.getElementById("side");
    var toggle = document.getElementById("tocToggle");
    var links = Array.prototype.slice.call(side.querySelectorAll("a[href^='#']"));

    toggle.addEventListener("click", function () {
        var open = side.classList.toggle("open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.forEach(function (a) {
        a.addEventListener("click", function () { side.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); });
    });

    document.querySelectorAll(".doc h2[id], .doc h3[id]").forEach(function (h) {
        var a = document.createElement("a");
        a.className = "hash"; a.href = "#" + h.id; a.textContent = "#"; a.setAttribute("aria-label", "Link to this section");
        h.appendChild(a);
    });

    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var sections = Object.keys(byId).map(function (id) { return document.getElementById(id); }).filter(Boolean);

    function mark(id) {
        links.forEach(function (a) { a.classList.toggle("active", a === byId[id]); });
        var a = byId[id];
        if (a && side.scrollHeight > side.clientHeight) {
            var top = a.offsetTop, bottom = top + a.offsetHeight;
            if (top < side.scrollTop + 40) side.scrollTop = Math.max(0, top - 40);
            else if (bottom > side.scrollTop + side.clientHeight - 40) side.scrollTop = bottom - side.clientHeight + 40;
        }
    }

    function update() {
        var current = sections[0] && sections[0].id;
        var line = 100;
        for (var i = 0; i < sections.length; i++) {
            if (sections[i].getBoundingClientRect().top <= line) current = sections[i].id; else break;
        }
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && sections.length) current = sections[sections.length - 1].id;
        if (current) mark(current);
    }
    var ticking = false;
    window.addEventListener("scroll", function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () { ticking = false; update(); });
    }, { passive: true });
    window.addEventListener("resize", update);
    update();
})();
