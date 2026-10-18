export function startNavigation({
  signal,
  storage,
  host,
  preferences,
  state = {},
}) {
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
  const positionKey = [
    host?.root ?? state.base ?? "/",
    state.bookId ?? "",
  ].join(":");
  let positions = preference.scrollPositions;
  if (!positions || typeof positions !== "object" || Array.isArray(positions))
    positions = {};
  const previous = positions[positionKey];
  const offset = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);
  let sidebarScroll = offset(previous?.sidebar),
    tocScroll =
      previous?.chapterId === (state.chapterId ?? null)
        ? offset(previous?.toc)
        : 0,
    scrollTimer;
  if (toc) toc.open = preference.tocCollapsed !== true;
  function captureScroll() {
    if (!sidebar.hidden && sidebar.clientHeight)
      sidebarScroll = sidebar.scrollTop;
    if (toc?.open && toc.clientHeight) tocScroll = toc.scrollTop;
  }
  function restoreScroll() {
    if (signal.aborted) return;
    if (!sidebar.hidden && sidebar.clientHeight) {
      sidebar.scrollTop = sidebarScroll;
      const active = sidebar.querySelector('[aria-current="page"]');
      if (active) {
        const item = active.getBoundingClientRect(),
          box = sidebar.getBoundingClientRect();
        if (item.top < box.top) sidebar.scrollTop += item.top - box.top;
        else if (item.bottom > box.bottom)
          sidebar.scrollTop += item.bottom - box.bottom;
      }
      sidebarScroll = sidebar.scrollTop;
    }
    if (toc?.open && toc.clientHeight) toc.scrollTop = tocScroll;
  }
  function remember() {
    clearTimeout(scrollTimer);
    const entries = Object.entries(positions).filter(
      ([key]) => key !== positionKey,
    );
    entries.push([
      positionKey,
      {
        sidebar: sidebarScroll,
        toc: tocScroll,
        chapterId: state.chapterId ?? null,
      },
    ]);
    positions = Object.fromEntries(entries.slice(-8));
    const value = {
      sidebarCollapsed: collapsed,
      tocCollapsed: toc ? !toc.open : false,
      scrollPositions: positions,
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
    restoreScroll();
  }
  function saveScroll() {
    captureScroll();
    remember();
  }
  function onScroll() {
    captureScroll();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(remember, 150);
  }
  sidebar.addEventListener("scroll", onScroll, { signal, passive: true });
  toc?.addEventListener("scroll", onScroll, { signal, passive: true });
  document.addEventListener("mb:save-navigation", saveScroll, { signal });
  signal.addEventListener(
    "abort",
    () => {
      captureScroll();
      remember();
    },
    { once: true },
  );
  toggle.addEventListener(
    "click",
    () => {
      captureScroll();
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
  toc?.addEventListener("toggle", saveScroll, { signal });
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
  const frame = requestAnimationFrame(restoreScroll);
  signal.addEventListener("abort", () => cancelAnimationFrame(frame), {
    once: true,
  });
}
