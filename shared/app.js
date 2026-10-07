(() => {
  const config = window.COUNTDOWN_CONFIG || {};
  const fallback = window.COUNTDOWN_FALLBACK || { boards: [], events: [] };
  const storageKey = "countdown-board-v1";
  const units = ["years", "months", "weeks", "days", "hours", "minutes", "seconds", "mixed"];
  const state = {
    boards: [],
    events: [],
    settings: { board: "", theme: "pop" },
    openEventId: "",
    activeUnit: "",
    editingId: "",
    lastBigText: "",
    tick: 0
  };
  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheEls();
    loadState();
    bindEvents();
    applyTheme();
    render();
    requestBackendSnapshot();
    window.setInterval(() => {
      state.tick++;
      renderHeroOnly();
    }, 1000);
  }

  function cacheEls() {
    els.boardTitle = document.querySelector("[data-board-title]");
    els.hero = document.querySelector("[data-hero-card]");
    els.list = document.querySelector("[data-event-list]");
    els.backdrop = document.querySelector("[data-modal-backdrop]");
    els.eventModal = document.querySelector("[data-event-modal]");
    els.eventForm = document.querySelector("[data-event-form]");
    els.eventTitle = document.querySelector("[data-event-modal-title]");
    els.deleteEvent = document.querySelector("[data-delete-event]");
    els.settingsModal = document.querySelector("[data-settings-modal]");
    els.shareModal = document.querySelector("[data-share-modal]");
    els.boardSelect = document.querySelector("[data-board-select]");
    els.newBoardName = document.querySelector("[data-new-board-name]");
    els.shareUrl = document.querySelector("[data-share-url]");
    els.copyStatus = document.querySelector("[data-copy-status]");
    els.celebration = document.querySelector("[data-celebration]");
  }

  function loadState() {
    const local = safeJson(localStorage.getItem(storageKey), {});
    state.boards = normalizeBoards(local.boards || fallback.boards || []);
    state.events = normalizeEvents(local.events || fallback.events || []);
    state.settings = Object.assign(state.settings, local.settings || {});
    const urlBoard = new URL(window.location.href).searchParams.get("board");
    const defaultBoard = urlBoard || state.settings.board || config.defaultBoard || (state.boards[0] && state.boards[0].board_slug) || "bari";
    state.settings.board = boardExists(defaultBoard) ? defaultBoard : (state.boards[0] && state.boards[0].board_slug) || "bari";
    if (!state.activeUnit) {
      const first = sortedEvents()[0];
      state.activeUnit = first ? (first.default_unit || "days") : "days";
    }
    saveState();
    syncUrl();
  }

  function saveState() {
    localStorage.setItem(storageKey, JSON.stringify({
      boards: state.boards,
      events: state.events,
      settings: state.settings
    }));
  }

  function normalizeBoards(boards) {
    return boards.map((board, index) => ({
      board_slug: slug(board.board_slug || board.slug || board.board_name || "board-" + (index + 1)),
      board_name: String(board.board_name || board.name || "Countdowns"),
      sort_order: Number(board.sort_order || index + 1),
      deleted: truthy(board.deleted)
    })).filter((board) => board.board_slug && !board.deleted);
  }

  function normalizeEvents(events) {
    return events.map((event, index) => ({
      event_id: String(event.event_id || event.id || "evt_" + Date.now() + "_" + index),
      board_slug: slug(event.board_slug || state.settings.board || config.defaultBoard || "bari"),
      title: String(event.title || "Big day"),
      target_date: String(event.target_date || event.date || todayIso()),
      target_time: String(event.target_time || event.time || ""),
      timezone: String(event.timezone || config.defaultTimezone || "America/Los_Angeles"),
      default_unit: units.includes(String(event.default_unit)) ? String(event.default_unit) : "days",
      icon: String(event.icon || "⭐"),
      theme: String(event.theme || ""),
      sort_order: Number(event.sort_order || index + 1),
      created_at: String(event.created_at || new Date().toISOString()),
      updated_at: String(event.updated_at || new Date().toISOString()),
      deleted: truthy(event.deleted)
    })).filter((event) => event.event_id && !event.deleted);
  }

  function truthy(value) {
    return value === true || String(value).toLowerCase() === "true" || String(value) === "1";
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-go-today]")) render(true);
      const openEvent = target.closest("[data-open-event]");
      if (openEvent) openEventModal(openEvent.getAttribute("data-open-event"));
      if (target.closest("[data-open-settings]")) openModal("settings");
      if (target.closest("[data-open-share]")) openShare();
      if (target.closest("[data-close-modal]") || target === els.backdrop) closeModals();
      const unit = target.closest("[data-unit]");
      if (unit) setUnit(unit.getAttribute("data-unit"));
      const summary = target.closest("[data-toggle-card]");
      if (summary) toggleCard(summary.getAttribute("data-toggle-card"));
      const edit = target.closest("[data-edit-event]");
      if (edit) openEventModal(edit.getAttribute("data-edit-event"));
      const move = target.closest("[data-move-event]");
      if (move) moveEvent(move.getAttribute("data-move-event"), Number(move.getAttribute("data-dir")));
      if (target.closest("[data-add-board]")) addBoard();
      if (target.closest("[data-delete-board]")) deleteCurrentBoard();
      const themeChoice = target.closest("[data-theme-choice]");
      if (themeChoice) setTheme(themeChoice.getAttribute("data-theme-choice"));
      if (target.closest("[data-reset-device]")) resetDevice();
      if (target.closest("[data-copy-link]")) copyLink();
    });

    if (els.eventForm) {
      els.eventForm.addEventListener("submit", (event) => {
        event.preventDefault();
        saveEventFromForm();
      });
    }
    if (els.deleteEvent) {
      els.deleteEvent.addEventListener("click", () => {
        if (state.editingId) deleteEvent(state.editingId);
      });
    }
    if (els.boardSelect) {
      els.boardSelect.addEventListener("change", () => {
        state.settings.board = els.boardSelect.value;
        state.activeUnit = "";
        saveState();
        syncUrl();
        render();
      });
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeModals();
    });
  }

  function render(forceCelebration) {
    const board = currentBoard();
    if (els.boardTitle) els.boardTitle.textContent = board ? board.board_name : "Countdown";
    renderBoardSelect();
    renderHeroOnly(forceCelebration);
    renderList();
    renderThemeButtons();
  }

  function renderHeroOnly(forceCelebration) {
    const events = sortedEvents();
    const main = events[0];
    if (!els.hero) return;
    if (!main) {
      els.hero.innerHTML = '<div class="hero-content"><h1 class="hero-title">No countdowns yet</h1><p class="status-line">Tap + to add one.</p></div>';
      return;
    }
    if (!state.activeUnit || !units.includes(state.activeUnit)) state.activeUnit = main.default_unit || "days";
    const display = displayFor(main, state.activeUnit);
    const changed = display.big !== state.lastBigText;
    state.lastBigText = display.big;
    els.hero.innerHTML =
      '<div class="hero-content">' +
        '<div class="event-kicker"><span class="event-icon">' + escapeHtml(main.icon || "⭐") + '</span><span>' + escapeHtml(formatTarget(main)) + '</span></div>' +
        '<h1 class="hero-title">' + escapeHtml(main.title) + '</h1>' +
        '<div class="number-wrap">' +
          '<strong class="big-number ' + (changed ? "is-changing" : "") + '" data-fit="' + fitForBigText(display.big) + '">' + escapeHtml(display.big) + '</strong>' +
          '<span class="unit-label">' + escapeHtml(display.unit) + '</span>' +
        '</div>' +
        '<p class="status-line">' + escapeHtml(display.note) + '</p>' +
      '</div>' +
      '<div class="unit-row" role="group" aria-label="Countdown units">' +
        units.map((unit) => '<button type="button" data-unit="' + unit + '" class="' + (unit === state.activeUnit ? "is-active" : "") + '">' + labelForUnit(unit) + '</button>').join("") +
      '</div>';
    if (forceCelebration || display.kind === "today") celebrate(display.kind === "today" ? 20 : 8);
  }

  function renderList() {
    const events = sortedEvents();
    const rest = events.slice(1);
    if (!els.list) return;
    if (!rest.length) {
      els.list.innerHTML = '<article class="mini-card"><button type="button" class="mini-summary" data-open-event="new"><span class="event-icon">+</span><strong>Add another countdown</strong><span>go</span></button></article>';
      return;
    }
    els.list.innerHTML = rest.map((event) => {
      const display = displayFor(event, event.default_unit || "days");
      const open = state.openEventId === event.event_id;
      return '<article class="mini-card ' + (open ? "is-open" : "") + '">' +
        '<button type="button" class="mini-summary" data-toggle-card="' + escapeAttr(event.event_id) + '">' +
          '<span class="event-icon">' + escapeHtml(event.icon || "⭐") + '</span>' +
          '<strong>' + escapeHtml(event.title) + '</strong>' +
          '<span>' + escapeHtml(display.short) + '</span>' +
        '</button>' +
        '<div class="mini-details">' +
          '<p>' + escapeHtml(formatTarget(event)) + ' · ' + escapeHtml(display.note || display.unit) + '</p>' +
          '<div class="mini-actions">' +
            '<button type="button" data-edit-event="' + escapeAttr(event.event_id) + '">Edit</button>' +
            '<button type="button" data-move-event="' + escapeAttr(event.event_id) + '" data-dir="-1">Move up</button>' +
            '<button type="button" data-move-event="' + escapeAttr(event.event_id) + '" data-dir="1">Move down</button>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join("");
  }

  function renderBoardSelect() {
    if (!els.boardSelect) return;
    els.boardSelect.innerHTML = state.boards
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((board) => '<option value="' + escapeAttr(board.board_slug) + '">' + escapeHtml(board.board_name) + '</option>')
      .join("");
    els.boardSelect.value = state.settings.board;
  }

  function renderThemeButtons() {
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.classList.toggle("is-active", button.getAttribute("data-theme-choice") === state.settings.theme);
    });
  }

  function sortedEvents() {
    return state.events
      .filter((event) => event.board_slug === state.settings.board && !event.deleted)
      .sort((a, b) => a.sort_order - b.sort_order || a.target_date.localeCompare(b.target_date));
  }

  function currentBoard() {
    return state.boards.find((board) => board.board_slug === state.settings.board) || state.boards[0];
  }

  function boardExists(slugValue) {
    return state.boards.some((board) => board.board_slug === slugValue && !board.deleted);
  }

  function displayFor(event, unit) {
    const allDay = !event.target_time;
    const today = todayIso();
    if (allDay && event.target_date === today) {
      return { kind: "today", big: "It's", unit: "today!", note: "The wait is over.", short: "today" };
    }
    if (allDay && event.target_date < today) {
      return { kind: "past", big: "Already", unit: "happened", note: "This one already happened.", short: "done" };
    }
    const target = targetDate(event);
    const now = new Date();
    const diff = target.getTime() - now.getTime();
    if (diff <= 0) {
      return { kind: "past", big: "Already", unit: "happened", note: "This one already happened.", short: "done" };
    }
    const dayMs = 86400000;
    const hourMs = 3600000;
    const minuteMs = 60000;
    const secondMs = 1000;
    const days = Math.max(1, Math.ceil(diff / dayMs));
    const months = calendarParts(now, target);
    if (unit === "years") {
      const years = Math.max(0.1, diff / (365.2425 * dayMs));
      return { kind: "future", big: years >= 10 ? String(Math.round(years)) : years.toFixed(1), unit: "years", note: days + " days away", short: Math.round(years * 10) / 10 + "y" };
    }
    if (unit === "months") {
      return { kind: "future", big: String(Math.max(0, months.months)), unit: months.months === 1 ? "month" : "months", note: months.days ? "and " + months.days + " days" : "right around then", short: months.months + "mo" };
    }
    if (unit === "weeks") {
      const weeks = Math.max(1, Math.ceil(diff / (7 * dayMs)));
      return { kind: "future", big: String(weeks), unit: weeks === 1 ? "week" : "weeks", note: days + " days away", short: weeks + "w" };
    }
    if (unit === "hours") {
      const hours = Math.max(1, Math.ceil(diff / hourMs));
      return { kind: "future", big: String(hours), unit: hours === 1 ? "hour" : "hours", note: days + " days away", short: hours + "h" };
    }
    if (unit === "minutes") {
      const minutes = Math.max(1, Math.ceil(diff / minuteMs));
      return { kind: "future", big: String(minutes), unit: "minutes", note: "That is a lot of minutes.", short: minutes + "m" };
    }
    if (unit === "seconds") {
      const seconds = Math.max(1, Math.ceil(diff / secondMs));
      return { kind: "future", big: String(seconds), unit: "seconds", note: "Whoa. So many seconds.", short: seconds + "s" };
    }
    if (unit === "mixed") {
      const mixed = mixedParts(diff);
      return { kind: "future", big: mixed.big, unit: mixed.unit, note: mixed.note, short: days + "d" };
    }
    return { kind: "future", big: String(days), unit: days === 1 ? "day" : "days", note: friendlyNote(days), short: days + "d" };
  }

  function friendlyNote(days) {
    if (days <= 3) return "Very soon.";
    if (days <= 14) return "Soon-ish.";
    if (days <= 60) return "Close enough to start asking every day.";
    return "Still a bit of waiting.";
  }

  function mixedParts(diff) {
    const dayMs = 86400000;
    const hourMs = 3600000;
    const days = Math.floor(diff / dayMs);
    const hours = Math.floor((diff % dayMs) / hourMs);
    if (days >= 1) return { big: String(days), unit: days === 1 ? "day" : "days", note: hours ? "and " + hours + " hours" : "almost exactly" };
    const minutes = Math.max(1, Math.ceil(diff / 60000));
    return { big: String(minutes), unit: "minutes", note: "Today is the day." };
  }

  function calendarParts(start, end) {
    let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    let anchor = new Date(start);
    anchor.setMonth(anchor.getMonth() + months);
    if (anchor > end) {
      months -= 1;
      anchor = new Date(start);
      anchor.setMonth(anchor.getMonth() + months);
    }
    const days = Math.max(0, Math.ceil((startOfDay(end) - startOfDay(anchor)) / 86400000));
    return { months, days };
  }

  function targetDate(event) {
    const time = event.target_time || "00:00";
    return new Date(event.target_date + "T" + time + ":00");
  }

  function formatTarget(event) {
    const date = new Date(event.target_date + "T00:00:00");
    const formatted = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    return event.target_time ? formatted + " at " + event.target_time : formatted;
  }

  function labelForUnit(unit) {
    return unit.charAt(0).toUpperCase() + unit.slice(1);
  }

  function fitForBigText(text) {
    const length = String(text || "").replace(/\s/g, "").length;
    if (length >= 8) return "ultra";
    if (length >= 6) return "dense";
    if (length >= 4) return "compact";
    return "normal";
  }

  function setUnit(unit) {
    if (!units.includes(unit)) return;
    state.activeUnit = unit;
    const main = sortedEvents()[0];
    if (main) {
      main.default_unit = unit;
      main.updated_at = new Date().toISOString();
    }
    saveState();
    syncEvent(main);
    renderHeroOnly();
  }

  function toggleCard(id) {
    state.openEventId = state.openEventId === id ? "" : id;
    renderList();
  }

  function openEventModal(id) {
    const isNew = id === "new" || !id;
    const event = isNew ? null : state.events.find((item) => item.event_id === id);
    state.editingId = event ? event.event_id : "";
    if (els.eventTitle) els.eventTitle.textContent = event ? "Edit countdown" : "Add countdown";
    if (els.deleteEvent) els.deleteEvent.hidden = !event;
    if (els.eventForm) {
      els.eventForm.event_id.value = event ? event.event_id : "";
      els.eventForm.title.value = event ? event.title : "";
      els.eventForm.target_date.value = event ? event.target_date : todayIso();
      els.eventForm.target_time.value = event ? event.target_time : "";
      els.eventForm.icon.value = event ? event.icon : "⭐";
      els.eventForm.default_unit.value = event ? event.default_unit : "days";
    }
    openModal("event");
  }

  function saveEventFromForm() {
    const form = els.eventForm;
    const id = form.event_id.value || "evt_" + Date.now().toString(36);
    let event = state.events.find((item) => item.event_id === id);
    if (!event) {
      event = {
        event_id: id,
        board_slug: state.settings.board,
        sort_order: sortedEvents().length + 1,
        created_at: new Date().toISOString()
      };
      state.events.push(event);
    }
    event.title = form.title.value.trim() || "Big day";
    event.target_date = form.target_date.value || todayIso();
    event.target_time = form.target_time.value || "";
    event.timezone = config.defaultTimezone || "America/Los_Angeles";
    event.icon = form.icon.value.trim() || "⭐";
    event.default_unit = form.default_unit.value || "days";
    event.deleted = false;
    event.updated_at = new Date().toISOString();
    saveState();
    syncEvent(event);
    closeModals();
    state.activeUnit = event.default_unit;
    render(true);
  }

  function deleteEvent(id) {
    const event = state.events.find((item) => item.event_id === id);
    if (!event) return;
    event.deleted = true;
    event.updated_at = new Date().toISOString();
    saveState();
    syncEvent(event);
    closeModals();
    render();
  }

  function moveEvent(id, dir) {
    const events = sortedEvents();
    const index = events.findIndex((event) => event.event_id === id);
    const next = index + dir;
    if (index < 0 || next < 0 || next >= events.length) return;
    const a = events[index];
    const b = events[next];
    const aOrder = a.sort_order;
    a.sort_order = b.sort_order;
    b.sort_order = aOrder;
    a.updated_at = b.updated_at = new Date().toISOString();
    saveState();
    syncEvent(a);
    syncEvent(b);
    render();
  }

  function addBoard() {
    const name = (els.newBoardName && els.newBoardName.value.trim()) || "";
    if (!name) return;
    const board = {
      board_slug: uniqueBoardSlug(slug(name)),
      board_name: name,
      sort_order: state.boards.length + 1,
      deleted: false
    };
    state.boards.push(board);
    state.settings.board = board.board_slug;
    if (els.newBoardName) els.newBoardName.value = "";
    saveState();
    syncBoard(board);
    syncUrl();
    render(true);
  }

  function deleteCurrentBoard() {
    if (state.boards.length <= 1) return;
    const current = currentBoard();
    if (!current) return;
    current.deleted = true;
    state.events.forEach((event) => {
      if (event.board_slug === current.board_slug) event.deleted = true;
    });
    state.settings.board = state.boards.find((board) => !board.deleted).board_slug;
    saveState();
    syncBoard(current);
    syncUrl();
    render();
  }

  function uniqueBoardSlug(base) {
    let candidate = base || "board";
    let n = 2;
    while (boardExists(candidate)) {
      candidate = base + "-" + n;
      n++;
    }
    return candidate;
  }

  function setTheme(theme) {
    state.settings.theme = theme || "pop";
    saveState();
    applyTheme();
    renderThemeButtons();
  }

  function applyTheme() {
    document.body.dataset.theme = state.settings.theme || "pop";
  }

  function resetDevice() {
    localStorage.removeItem(storageKey);
    window.location.reload();
  }

  function openShare() {
    const url = boardUrl();
    if (els.shareUrl) els.shareUrl.value = url;
    if (els.copyStatus) els.copyStatus.textContent = "";
    openModal("share");
  }

  function copyLink() {
    const url = boardUrl();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        if (els.copyStatus) els.copyStatus.textContent = "Copied.";
      }).catch(() => fallbackCopy(url));
    } else {
      fallbackCopy(url);
    }
  }

  function fallbackCopy(url) {
    if (els.shareUrl) {
      els.shareUrl.select();
      document.execCommand("copy");
      if (els.copyStatus) els.copyStatus.textContent = "Copied.";
    }
  }

  function openModal(which) {
    if (els.backdrop) els.backdrop.hidden = false;
    if (which === "event" && els.eventModal) els.eventModal.hidden = false;
    if (which === "settings" && els.settingsModal) els.settingsModal.hidden = false;
    if (which === "share" && els.shareModal) els.shareModal.hidden = false;
  }

  function closeModals() {
    if (els.backdrop) els.backdrop.hidden = true;
    [els.eventModal, els.settingsModal, els.shareModal].forEach((modal) => {
      if (modal) modal.hidden = true;
    });
  }

  function boardUrl() {
    const base = config.liveSiteUrl || window.location.href.split("?")[0];
    const url = new URL(base, window.location.href);
    url.searchParams.set("board", state.settings.board);
    return url.toString();
  }

  function syncUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set("board", state.settings.board);
    window.history.replaceState({}, "", url.toString());
  }

  function requestBackendSnapshot() {
    if (!config.backendUrl) return;
    backendRequest("snapshot", {}).then((response) => {
      if (!response || !response.ok) return;
      if (response.boards) state.boards = normalizeBoards(response.boards);
      if (response.events) state.events = normalizeEvents(response.events);
      saveState();
      render();
    }).catch(() => {});
  }

  function syncEvent(event) {
    if (!config.backendUrl || !event) return;
    backendRequest("upsertEvent", { event }).catch(() => {});
  }

  function syncBoard(board) {
    if (!config.backendUrl || !board) return;
    backendRequest("upsertBoard", { board }).catch(() => {});
  }

  function backendRequest(action, payload) {
    return new Promise((resolve, reject) => {
      const callback = "countdownCallback_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      const url = new URL(config.backendUrl);
      url.searchParams.set("action", action);
      url.searchParams.set("callback", callback);
      if (payload && Object.keys(payload).length) url.searchParams.set("payload", JSON.stringify(payload));
      const script = document.createElement("script");
      const timer = window.setTimeout(() => cleanup(reject, new Error("Backend timed out")), 12000);
      window[callback] = (data) => cleanup(resolve, data);
      script.onerror = () => cleanup(reject, new Error("Backend failed"));
      function cleanup(fn, value) {
        window.clearTimeout(timer);
        delete window[callback];
        script.remove();
        fn(value);
      }
      script.src = url.toString();
      document.body.appendChild(script);
    });
  }

  function celebrate(count) {
    if (!els.celebration) return;
    for (let i = 0; i < count; i++) {
      const dot = document.createElement("span");
      dot.className = "confetti";
      dot.style.left = Math.random() * 100 + "vw";
      dot.style.background = ["var(--accent)", "var(--accent-2)", "var(--accent-3)"][i % 3];
      dot.style.animationDelay = Math.random() * 220 + "ms";
      els.celebration.appendChild(dot);
      window.setTimeout(() => dot.remove(), 1200);
    }
  }

  function slug(text) {
    return String(text || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "board";
  }

  function todayIso() {
    const now = new Date();
    return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function safeJson(value, fallbackValue) {
    try { return JSON.parse(value || ""); } catch { return fallbackValue; }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }
})();
