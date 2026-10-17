export function startNavigation({ signal, storage, host, preferences }) {
  const toggle = document.querySelector(".navigation-toggle");
  const sidebar = document.getElementById("book-sidebar");
  const layout = document.querySelector(".reader-layout");
  const toc = document.querySelector(".on-this-page");
  const narrow = matchMedia("(max-width: 760px)");
  let preference;
  try {
    preference =
      host?.getLayout?.() ??
      JSON.parse(storage.get("localStorage", "markdown-book:layout") ?? "{}");
  } catch {
    preference = {};
  }
  if (!preference || typeof preference !== "object") preference = {};
  let collapsed = preference.sidebarCollapsed === true,
    mobileOpen = false;
  if (toc) toc.open = preference.tocCollapsed !== true;
  function remember() {
    const value = {
      sidebarCollapsed: collapsed,
      tocCollapsed: toc ? !toc.open : false,
    };
    storage.set("localStorage", "markdown-book:layout", JSON.stringify(value));
    host?.setLayout?.(value);
  }
  function render() {
    const open = narrow.matches ? mobileOpen : !collapsed;
    sidebar.hidden = !open;
    layout.toggleAttribute("data-sidebar-collapsed", !open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute(
      "data-mb-label-aria-label",
      open ? "collapseChapters" : "expandChapters",
    );
    toggle.setAttribute(
      "data-mb-label-title",
      open ? "collapseChapters" : "expandChapters",
    );
    toggle.setAttribute(
      "aria-label",
      preferences.t(open ? "collapseChapters" : "expandChapters"),
    );
    toggle.title = preferences.t(open ? "collapseChapters" : "expandChapters");
  }
  toggle.addEventListener(
    "click",
    () => {
      if (narrow.matches) mobileOpen = !mobileOpen;
      else collapsed = !collapsed;
      remember();
      render();
    },
    { signal },
  );
  sidebar.addEventListener(
    "click",
    (event) => {
      if (!narrow.matches || !event.target.closest("a")) return;
      mobileOpen = false;
      render();
    },
    { signal },
  );
  toc?.addEventListener("toggle", remember, { signal });
  narrow.addEventListener("change", render, { signal });
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key !== "Escape" ||
        !narrow.matches ||
        !mobileOpen ||
        document.querySelector("dialog[open]")
      )
        return;
      mobileOpen = false;
      render();
      toggle.focus();
    },
    { signal },
  );
  preferences.subscribe(render, { signal });
}
