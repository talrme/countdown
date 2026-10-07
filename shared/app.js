(() => {
  const config = window.COUNTDOWN_CONFIG || {};
  const fallback = window.COUNTDOWN_FALLBACK || { boards: [], events: [] };
  const storageKey = "countdown-board-v1";
  const units = ["years", "months", "weeks", "days", "hours", "minutes", "seconds", "mixed"];
  const editableUnits = ["auto"].concat(units);
  let manifestObjectUrl = "";

  const state = {
    boards: [],
    events: [],
    settings: { board: "", theme: "pop" },
    openEventIds: [],
    activeUnits: {},
    editingId: "",
    confirmDeleteId: "",
    lastBigText: {},
    celebratedToday: {}
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
      renderHeroOnly();
      renderList();
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
    els.confirmModal = document.querySelector("[data-confirm-modal]");
    els.confirmTitle = document.querySelector("[data-confirm-title]");
    els.settingsModal = document.querySelector("[data-settings-modal]");
    els.shareModal = document.querySelector("[data-share-modal]");
    els.boardSelect = document.querySelector("[data-board-select]");
    els.newBoardName = document.querySelector("[data-new-board-name]");
    els.shareUrl = document.querySelector("[data-share-url]");
    els.copyStatus = document.querySelector("[data-copy-status]");
    els.syncStatus = document.querySelector("[data-sync-status]");
    els.celebration = document.querySelector("[data-celebration]");
  }

  function loadState() {
    const local = safeJson(localStorage.getItem(storageKey), {});
    const localBoards = Array.isArray(local.boards) && local.boards.length ? local.boards : fallback.boards || [];
    const localEvents = Array.isArray(local.events) && local.events.length ? local.events : fallback.events || [];
    state.boards = normalizeBoards(localBoards);
    state.events = normalizeEvents(localEvents);
    state.settings = Object.assign(state.settings, local.settings || {});
    state.activeUnits = local.activeUnits || {};
    state.openEventIds = Array.isArray(local.openEventIds) ? local.openEventIds : [];

    const urlBoard = new URL(window.location.href).searchParams.get("board");
    const requestedBoard = urlBoard || state.settings.board || config.defaultBoard || (state.boards[0] && state.boards[0].board_slug) || "bari";
    state.settings.board = boardExists(requestedBoard) ? requestedBoard : (state.boards[0] && state.boards[0].board_slug) || "bari";
    saveState();
    syncUrl();
    updateInstallManifest();
  }

  function saveState() {
    localStorage.setItem(storageKey, JSON.stringify({
      boards: state.boards,
      events: state.events,
      settings: state.settings,
      activeUnits: state.activeUnits,
      openEventIds: state.openEventIds
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
    return events.map((event, index) => {
      const unit = String(event.default_unit || "").toLowerCase();
      return {
        event_id: String(event.event_id || event.id || "evt_" + Date.now() + "_" + index),
        board_slug: slug(event.board_slug || state.settings.board || config.defaultBoard || "bari"),
        title: String(event.title || "Big day"),
        target_date: String(event.target_date || event.date || todayIso()),
        target_time: String(event.target_time || event.time || ""),
        timezone: String(event.timezone || config.defaultTimezone || "America/Los_Angeles"),
        default_unit: editableUnits.includes(unit) ? unit : "auto",
        icon: String(event.icon || "⭐"),
        theme: String(event.theme || ""),
        sort_order: Number(event.sort_order || index + 1),
        created_at: String(event.created_at || new Date().toISOString()),
        updated_at: String(event.updated_at || new Date().toISOString()),
        deleted: truthy(event.deleted)
      };
    }).filter((event) => event.event_id && !event.deleted);
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
      if (target.closest("[data-close-modal]") || target.closest("[data-cancel-delete]") || target === els.backdrop) closeModals();

      const unit = target.closest("[data-unit]");
      if (unit) setUnit(unit.getAttribute("data-unit"), unit.getAttribute("data-unit-event"));

      const summary = target.closest("[data-toggle-card]");
      if (summary) toggleCard(summary.getAttribute("data-toggle-card"));

      const edit = target.closest("[data-edit-event]");
      if (edit) openEventModal(edit.getAttribute("data-edit-event"));

      const move = target.closest("[data-move-event]");
      if (move) moveEvent(move.getAttribute("data-move-event"), Number(move.getAttribute("data-dir")));

      const deleteButton = target.closest("[data-open-delete]");
      if (deleteButton) openDeleteConfirm(deleteButton.getAttribute("data-open-delete"));

      if (target.closest("[data-confirm-delete]")) confirmDeleteEvent();
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
        if (state.editingId) openDeleteConfirm(state.editingId);
      });
    }

    if (els.boardSelect) {
      els.boardSelect.addEventListener("change", () => {
        state.settings.board = els.boardSelect.value;
        state.openEventIds = [];
        state.activeUnits = {};
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
    updateInstallManifest();
  }

  function renderHeroOnly(forceCelebration) {
    const events = sortedEvents();
    const main = events[0];
    if (!els.hero) return;
    if (!main) {
      els.hero.innerHTML = '<div class="hero-content"><h1 class="hero-title">No countdowns yet</h1><p class="status-line">Tap + to add one.</p></div>';
      return;
    }

    const unit = activeUnitFor(main);
    const display = displayFor(main, unit);
    els.hero.innerHTML = countdownCardInner(main, unit, { key: "hero:" + main.event_id, display });

    if (forceCelebration) celebrate(8);
    if (display.kind === "today" && !state.celebratedToday[main.event_id]) {
      state.celebratedToday[main.event_id] = true;
      celebrate(20);
    }
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
      const unit = activeUnitFor(event);
      const display = displayFor(event, unit);
      const open = state.openEventIds.includes(event.event_id);
      return '<article class="mini-card ' + (open ? "is-open" : "") + '">' +
        '<button type="button" class="mini-summary" data-toggle-card="' + escapeAttr(event.event_id) + '">' +
          '<span class="event-icon">' + escapeHtml(event.icon || "⭐") + '</span>' +
          '<strong>' + escapeHtml(event.title) + '</strong>' +
          '<span>' + escapeHtml(display.short) + '</span>' +
        '</button>' +
        (open ? '<div class="mini-details" id="event-' + escapeAttr(event.event_id) + '">' +
          '<section class="expanded-countdown countdown-card">' +
            countdownCardInner(event, unit, { key: "list:" + event.event_id, display }) +
          '</section>' +
          eventToolbar(event) +
        '</div>' : "") +
      '</article>';
    }).join("");
  }

  function countdownCardInner(event, unit, options) {
    const display = options && options.display ? options.display : displayFor(event, unit);
    const key = options && options.key ? options.key : event.event_id;
    const previous = state.lastBigText[key];
    const changed = previous !== undefined && display.big !== previous;
    state.lastBigText[key] = display.big;

    return '<div class="hero-content">' +
        '<div class="event-kicker"><span class="event-icon">' + escapeHtml(event.icon || "⭐") + '</span><span>' + escapeHtml(formatTarget(event)) + '</span></div>' +
        '<h1 class="hero-title">' + escapeHtml(event.title) + '</h1>' +
        '<div class="number-wrap">' +
          '<strong class="big-number ' + (changed ? "is-changing" : "") + '" data-fit="' + fitForBigText(display.big) + '">' + escapeHtml(display.big) + '</strong>' +
          '<span class="unit-label" data-fit="' + fitForBigText(display.unit) + '">' + escapeHtml(display.unit) + '</span>' +
        '</div>' +
        '<p class="status-line">' + escapeHtml(display.note) + '</p>' +
      '</div>' +
      '<div class="unit-row" role="group" aria-label="Countdown units">' +
        units.map((candidate) => '<button type="button" data-unit="' + candidate + '" data-unit-event="' + escapeAttr(event.event_id) + '" class="' + (candidate === unit ? "is-active" : "") + '">' + labelForUnit(candidate) + '</button>').join("") +
      '</div>';
  }

  function eventToolbar(event) {
    const id = escapeAttr(event.event_id);
    const title = escapeAttr(event.title);
    return '<div class="mini-actions" aria-label="Countdown actions">' +
      '<button type="button" class="icon-action" data-edit-event="' + id + '" aria-label="Edit ' + title + '"><span aria-hidden="true">✎</span><small>Edit</small></button>' +
      '<button type="button" class="icon-action" data-move-event="' + id + '" data-dir="-1" aria-label="Move up"><span aria-hidden="true">↑</span><small>Up</small></button>' +
      '<button type="button" class="icon-action" data-move-event="' + id + '" data-dir="1" aria-label="Move down"><span aria-hidden="true">↓</span><small>Down</small></button>' +
      '<button type="button" class="icon-action danger-action" data-open-delete="' + id + '" aria-label="Delete ' + title + '"><span aria-hidden="true">×</span><small>Delete</small></button>' +
    '</div>';
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

  function activeUnitFor(event) {
    const chosen = state.activeUnits[event.event_id] || event.default_unit || "auto";
    return units.includes(chosen) ? chosen : autoUnitForEvent(event);
  }

  function autoUnitForEvent(event) {
    const display = displayFor(event, "days");
    if (display.kind !== "future") return "days";
    const diff = targetDate(event).getTime() - Date.now();
    const days = diff / 86400000;
    const hours = diff / 3600000;
    const minutes = diff / 60000;
    if (days >= 730) return "years";
    if (days >= 75) return "months";
    if (days >= 21) return "weeks";
    if (days >= 2) return "days";
    if (hours >= 2) return "hours";
    if (minutes >= 2) return "minutes";
    return "seconds";
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
      const value = years >= 10 ? String(Math.round(years)) : years.toFixed(1);
      return { kind: "future", big: value, unit: plural(Number(value), "year"), note: "Counting in years.", short: value + "y" };
    }

    if (unit === "months") {
      const value = Math.max(0, months.months);
      return { kind: "future", big: String(value), unit: plural(value, "month"), note: "Counting in months.", short: value + "mo" };
    }

    if (unit === "weeks") {
      const weeks = Math.max(1, Math.ceil(diff / (7 * dayMs)));
      return { kind: "future", big: String(weeks), unit: plural(weeks, "week"), note: "Counting in weeks.", short: weeks + "w" };
    }

    if (unit === "hours") {
      const hours = Math.max(1, Math.ceil(diff / hourMs));
      return { kind: "future", big: String(hours), unit: plural(hours, "hour"), note: "Counting in hours.", short: hours + "h" };
    }

    if (unit === "minutes") {
      const minutes = Math.max(1, Math.ceil(diff / minuteMs));
      return { kind: "future", big: String(minutes), unit: "minutes", note: "Counting in minutes.", short: minutes + "m" };
    }

    if (unit === "seconds") {
      const seconds = Math.max(1, Math.ceil(diff / secondMs));
      return { kind: "future", big: String(seconds), unit: "seconds", note: "Counting every second.", short: seconds + "s" };
    }

    if (unit === "mixed") {
      const mixed = mixedParts(now, target);
      return { kind: "future", big: mixed.big, unit: mixed.unit, note: mixed.note, short: mixed.short };
    }

    return { kind: "future", big: String(days), unit: plural(days, "day"), note: friendlyNote(days), short: days + "d" };
  }

  function friendlyNote(days) {
    if (days <= 3) return "Very soon.";
    if (days <= 14) return "Soon-ish.";
    if (days <= 60) return "Close enough to start asking every day.";
    return "Still a bit of waiting.";
  }

  function mixedParts(start, end) {
    const pieces = wholeCalendarParts(start, end)
      .map((piece) => ({ value: piece.value, label: plural(piece.value, piece.name), short: piece.short }))
      .filter((piece) => piece.value > 0);
    const parts = pieces.length ? pieces : [{ value: 0, label: "seconds", short: "s" }];
    const primary = parts[0];
    const rest = parts.slice(1).map((piece) => piece.value + " " + piece.label);
    const tail = rest.length ? " · " + rest.join(" · ") : "";
    return {
      big: String(primary.value),
      unit: primary.label + tail,
      note: "Mixed countdown.",
      short: primary.value + primary.short
    };
  }

  function wholeCalendarParts(start, end) {
    let years = end.getFullYear() - start.getFullYear();
    while (years > 0 && addYears(start, years) > end) years--;
    let cursor = addYears(start, Math.max(0, years));

    let months = (end.getFullYear() - cursor.getFullYear()) * 12 + (end.getMonth() - cursor.getMonth());
    while (months > 0 && addMonths(cursor, months) > end) months--;
    cursor = addMonths(cursor, Math.max(0, months));

    let remainder = Math.max(0, end.getTime() - cursor.getTime());
    const days = Math.floor(remainder / 86400000);
    remainder -= days * 86400000;
    const hours = Math.floor(remainder / 3600000);
    remainder -= hours * 3600000;
    const minutes = Math.floor(remainder / 60000);
    remainder -= minutes * 60000;
    const seconds = Math.max(0, Math.floor(remainder / 1000));

    return [
      { name: "year", value: Math.max(0, years), short: "y" },
      { name: "month", value: Math.max(0, months), short: "mo" },
      { name: "day", value: days, short: "d" },
      { name: "hour", value: hours, short: "h" },
      { name: "minute", value: minutes, short: "m" },
      { name: "second", value: seconds, short: "s" }
    ];
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

  function addYears(date, years) {
    const result = new Date(date);
    result.setFullYear(result.getFullYear() + years);
    return result;
  }

  function addMonths(date, months) {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
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

  function plural(value, singular) {
    return Number(value) === 1 ? singular : singular + "s";
  }

  function fitForBigText(text) {
    const length = String(text || "").replace(/\s/g, "").length;
    if (length >= 13) return "mega";
    if (length >= 8) return "ultra";
    if (length >= 6) return "dense";
    if (length >= 4) return "compact";
    return "normal";
  }

  function setUnit(unit, eventId) {
    if (!units.includes(unit)) return;
    const event = state.events.find((item) => item.event_id === eventId) || sortedEvents()[0];
    if (!event) return;
    state.activeUnits[event.event_id] = unit;
    event.default_unit = unit;
    event.updated_at = new Date().toISOString();
    saveState();
    syncEvent(event);
    render();
  }

  function toggleCard(id) {
    if (!id) return;
    const isOpen = state.openEventIds.includes(id);
    state.openEventIds = isOpen ? state.openEventIds.filter((openId) => openId !== id) : state.openEventIds.concat(id);
    saveState();
    renderList();
    if (!isOpen) {
      window.setTimeout(() => {
        const panel = document.getElementById("event-" + cssEscape(id));
        if (panel) panel.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }
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
      els.eventForm.default_unit.value = event ? event.default_unit || "auto" : "auto";
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
    event.default_unit = editableUnits.includes(form.default_unit.value) ? form.default_unit.value : "auto";
    event.deleted = false;
    event.updated_at = new Date().toISOString();
    if (event.default_unit === "auto") delete state.activeUnits[event.event_id];
    else state.activeUnits[event.event_id] = event.default_unit;

    saveState();
    syncEvent(event);
    closeModals();
    render(true);
  }

  function openDeleteConfirm(id) {
    const event = state.events.find((item) => item.event_id === id);
    if (!event) return;
    state.confirmDeleteId = id;
    if (els.confirmTitle) els.confirmTitle.textContent = "Delete " + event.title + "?";
    openModal("confirm");
  }

  function confirmDeleteEvent() {
    if (!state.confirmDeleteId) return;
    deleteEvent(state.confirmDeleteId);
  }

  function deleteEvent(id) {
    const event = state.events.find((item) => item.event_id === id);
    if (!event) return;
    event.deleted = true;
    event.updated_at = new Date().toISOString();
    state.openEventIds = state.openEventIds.filter((openId) => openId !== id);
    delete state.activeUnits[id];
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
    state.openEventIds = [];
    state.activeUnits = {};
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
    const nextBoard = state.boards.find((board) => !board.deleted);
    if (!nextBoard) return;
    state.settings.board = nextBoard.board_slug;
    state.openEventIds = [];
    state.activeUnits = {};
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
    hidePanels();
    if (els.backdrop) els.backdrop.hidden = false;
    if (which === "event" && els.eventModal) els.eventModal.hidden = false;
    if (which === "settings" && els.settingsModal) els.settingsModal.hidden = false;
    if (which === "share" && els.shareModal) els.shareModal.hidden = false;
    if (which === "confirm" && els.confirmModal) els.confirmModal.hidden = false;
  }

  function closeModals() {
    if (els.backdrop) els.backdrop.hidden = true;
    hidePanels();
    state.confirmDeleteId = "";
  }

  function hidePanels() {
    [els.eventModal, els.settingsModal, els.shareModal, els.confirmModal].forEach((modal) => {
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
    updateInstallManifest();
  }

  function updateInstallManifest() {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    const start = new URL(boardUrl(), window.location.href);
    const manifest = {
      name: "Countdown",
      short_name: "Countdown",
      description: "Playful countdowns for birthdays, trips, camp, and big days.",
      start_url: start.toString(),
      scope: new URL(".", start).toString(),
      display: "standalone",
      background_color: "#eaf8ff",
      theme_color: "#177ddc",
      icons: [
        {
          src: new URL("countdown-icon.png", start).toString(),
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable"
        }
      ]
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
    if (manifestObjectUrl) URL.revokeObjectURL(manifestObjectUrl);
    manifestObjectUrl = URL.createObjectURL(blob);
    link.href = manifestObjectUrl;
  }

  function requestBackendSnapshot() {
    if (!config.backendUrl) {
      setSyncStatus("Local only. No Apps Script URL is configured.");
      return;
    }

    setSyncStatus("Checking Sheet sync...");
    backendRequest("snapshot", {}).then((response) => {
      if (!response || !response.ok) {
        setSyncStatus("Sheet sync issue: " + (response && response.error ? response.error : "backend did not return ok."));
        return;
      }
      if (response.boards) state.boards = normalizeBoards(response.boards);
      if (response.events) state.events = normalizeEvents(response.events);
      state.openEventIds = state.openEventIds.filter((id) => state.events.some((event) => event.event_id === id && !event.deleted));
      saveState();
      render();
      setSyncStatus("Sheet sync connected.");
    }).catch(() => {
      setSyncStatus("Sheet sync issue: Apps Script is not reachable. Check Web App access.");
    });
  }

  function syncEvent(event) {
    if (!config.backendUrl || !event) return;
    backendRequest("upsertEvent", { event }).then((response) => {
      if (response && response.ok) setSyncStatus("Sheet sync connected.");
      else setSyncStatus("Sheet sync issue: " + (response && response.error ? response.error : "event did not save to Sheet."));
    }).catch(() => {
      setSyncStatus("Sheet sync issue: event saved only on this device.");
    });
  }

  function syncBoard(board) {
    if (!config.backendUrl || !board) return;
    backendRequest("upsertBoard", { board }).then((response) => {
      if (response && response.ok) setSyncStatus("Sheet sync connected.");
      else setSyncStatus("Sheet sync issue: " + (response && response.error ? response.error : "board did not save to Sheet."));
    }).catch(() => {
      setSyncStatus("Sheet sync issue: board saved only on this device.");
    });
  }

  function setSyncStatus(message) {
    if (els.syncStatus) els.syncStatus.textContent = message;
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

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function safeJson(value, fallbackValue) {
    try {
      return JSON.parse(value || "");
    } catch {
      return fallbackValue;
    }
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
