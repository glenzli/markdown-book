function savedPosition(preference, root, state) {
  const key = [root ?? state.base ?? "/", state.bookId ?? ""].join(":");
  let positions = preference.scrollPositions;
  if (!positions || typeof positions !== "object" || Array.isArray(positions))
    positions = {};
  const previous = positions[key];
  const offset = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);
  return {
    key,
    positions,
    sidebar: offset(previous?.sidebar),
    toc:
      previous?.chapterId === (state.chapterId ?? null)
        ? offset(previous?.toc)
        : 0,
  };
}
function restoreScrollPosition(sidebar, toc, position) {
  if (!sidebar.hidden && sidebar.clientHeight) {
    sidebar.scrollTop = position.sidebar;
    const active = sidebar.querySelector('[aria-current="page"]');
    if (active) {
      const item = active.getBoundingClientRect(),
        box = sidebar.getBoundingClientRect();
      if (item.top < box.top) sidebar.scrollTop += item.top - box.top;
      else if (item.bottom > box.bottom)
        sidebar.scrollTop += item.bottom - box.bottom;
    }
    position.sidebar = sidebar.scrollTop;
  }
  if (toc?.open && toc.clientHeight) toc.scrollTop = position.toc;
}

// The native shell runs this in the body-replacement task. Chapter modules may
// load later, so waiting for startNavigation would expose the directory at zero.
export function prepareNavigation({ preference = {}, root, state = {} }) {
  if (!preference || typeof preference !== "object") preference = {};
  const sidebar = document.getElementById("book-sidebar");
  if (!sidebar) return;
  const open =
    !matchMedia("(max-width: 760px)").matches &&
    preference.sidebarCollapsed !== true;
  sidebar.hidden = !open;
  document
    .querySelector(".reader-layout")
    ?.toggleAttribute("data-sidebar-collapsed", !open);
  document
    .querySelector(".navigation-toggle")
    ?.setAttribute("aria-expanded", String(open));
  const toc = document.querySelector(".on-this-page");
  if (toc) toc.open = preference.tocCollapsed !== true;
  restoreScrollPosition(sidebar, toc, savedPosition(preference, root, state));
}

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
  const position = savedPosition(preference, host?.root, state);
  const positionKey = position.key;
  let positions = position.positions;
  let sidebarScroll = position.sidebar,
    tocScroll = position.toc,
    scrollTimer;
  if (toc) toc.open = preference.tocCollapsed !== true;
  function captureScroll() {
    if (!sidebar.hidden && sidebar.clientHeight)
      sidebarScroll = sidebar.scrollTop;
    if (toc?.open && toc.clientHeight) tocScroll = toc.scrollTop;
  }
  function restoreScroll() {
    if (signal.aborted) return;
    const position = { sidebar: sidebarScroll, toc: tocScroll };
    restoreScrollPosition(sidebar, toc, position);
    sidebarScroll = position.sidebar;
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
