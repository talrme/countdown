(() => {
  const config = window.COUNTDOWN_CONFIG || {};
  const fallback = window.COUNTDOWN_FALLBACK || { boards: [], events: [] };
  const storageKey = "countdown-board-v1";
  const units = ["years", "months", "weeks", "days", "hours", "minutes", "seconds", "mixed"];
  const editableUnits = ["auto"].concat(units);
  const syncWindowMs = 120000;
  const syncIntervalMs = 15000;
  let manifestObjectUrl = "";
  let syncInterval = 0;
  let syncInFlight = false;
  let pendingBoards = {};
  let pendingEvents = {};

  const state = {
    boards: [],
    events: [],
    settings: { board: "", theme: "pop", allowDragOrder: false, animationLevel: 3 },
    openEventIds: [],
    activeUnits: {},
    editingId: "",
    confirmDeleteId: "",
    lastBigText: {},
    celebratedToday: {},
    recentSyncUntil: 0,
    drag: null,
    suppressNextClick: false
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheEls();
    loadState();
    bindEvents();
    applyTheme();
    applyAnimationLevel();
    render();
    requestBackendSnapshot({ reason: "load" });
    startSyncWindow(syncWindowMs);
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
    els.dragToggle = document.querySelector("[data-drag-toggle]");
    els.celebration = document.querySelector("[data-celebration]");
  }

  function loadState() {
    const local = safeJson(localStorage.getItem(storageKey), {});
    const localBoards = Array.isArray(local.boards) && local.boards.length ? local.boards : fallback.boards || [];
    const localEvents = Array.isArray(local.events) && local.events.length ? local.events : fallback.events || [];
    state.boards = normalizeBoards(localBoards);
    state.events = normalizeEvents(localEvents);
    state.settings = Object.assign(state.settings, local.settings || {});
    state.settings.animationLevel = clampAnimationLevel(state.settings.animationLevel);
    state.activeUnits = local.activeUnits || {};
    state.openEventIds = Array.isArray(local.openEventIds) ? local.openEventIds : [];

    const urlBoard = new URL(window.location.href).searchParams.get("board");
    const requestedBoard = urlBoard || state.settings.board || config.defaultBoard || (state.boards[0] && state.boards[0].board_slug) || "bari";
    state.settings.board = boardExists(requestedBoard) ? requestedBoard : (state.boards[0] && state.boards[0].board_slug) || "bari";
    if (!state.settings.cardUiV2) {
      state.settings.cardUiV2 = true;
    }
    if (!state.settings.equalStackV1) {
      state.openEventIds = [];
      state.settings.equalStackV1 = true;
    }
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
      if (state.suppressNextClick) {
        state.suppressNextClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

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

      const animationChoice = target.closest("[data-animation-level]");
      if (animationChoice) setAnimationLevel(animationChoice.getAttribute("data-animation-level"));

      if (target.closest("[data-reset-device]")) resetDevice();
      if (target.closest("[data-copy-link]")) copyLink();
    });

    document.addEventListener("pointerdown", onDragPointerDown);
    document.addEventListener("pointermove", onDragPointerMove);
    document.addEventListener("pointerup", onDragPointerUp);
    document.addEventListener("pointercancel", onDragPointerCancel);
    document.addEventListener("mousedown", onDragPointerDown);
    document.addEventListener("mousemove", onDragPointerMove);
    document.addEventListener("mouseup", onDragPointerUp);

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
    if (els.dragToggle) {
      els.dragToggle.addEventListener("change", () => {
        state.settings.allowDragOrder = Boolean(els.dragToggle.checked);
        saveState();
        renderDragToggle();
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        cancelDrag();
        closeModals();
      }
    });

    window.addEventListener("focus", () => {
      requestBackendSnapshot({ reason: "focus", silent: true });
      startSyncWindow(60000);
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        requestBackendSnapshot({ reason: "visible", silent: true });
        startSyncWindow(60000);
      }
    });
  }

  function render(forceCelebration) {
    const board = currentBoard();
    if (els.boardTitle) els.boardTitle.textContent = board ? board.board_name : "Countdown";
    if (state.settings.board && !boardExists(state.settings.board)) {
      const nextBoard = visibleBoards()[0];
      state.settings.board = nextBoard ? nextBoard.board_slug : "";
      syncUrl();
    }
    renderBoardSelect();
    renderHeroOnly();
    renderList();
    if (forceCelebration) celebrate(8);
    renderThemeButtons();
    renderDragToggle();
    renderAnimationButtons();
    updateInstallManifest();
  }

  function renderHeroOnly(forceCelebration) {
    const events = sortedEvents();
    const main = events[0];
    if (!els.hero) return;
    if (!main) {
      els.hero.innerHTML = '<article class="mini-card add-card"><button type="button" class="mini-summary add-summary" data-open-event="new"><span class="event-icon">+</span><strong>Add a countdown</strong><span>go</span></button></article>';
      return;
    }

    const unit = activeUnitFor(main);
    const display = displayFor(main, unit);
    els.hero.innerHTML = renderEventCard(main, { primary: true, unit, display });

    if (forceCelebration) celebrate(8);
    if (display.kind === "today" && !state.celebratedToday[main.event_id]) {
      state.celebratedToday[main.event_id] = true;
      celebrate(20);
    }
  }

  function renderList() {
    const events = sortedEvents();
    if (!els.list) return;
    const cards = events.map((event) => {
      const unit = activeUnitFor(event);
      const display = displayFor(event, unit);
      if (display.kind === "today" && !state.celebratedToday[event.event_id]) {
        state.celebratedToday[event.event_id] = true;
        celebrate(20);
      }
      return renderEventCard(event, { primary: false, unit, display });
    });
    cards.push('<article class="mini-card add-card"><button type="button" class="mini-summary add-summary" data-open-event="new"><span class="event-icon">+</span><strong>Add another countdown</strong><span>go</span></button></article>');
    els.list.innerHTML = cards.join("");
  }

  function renderEventCard(event, options) {
    const opts = options || {};
    const unit = opts.unit || activeUnitFor(event);
    const display = opts.display || displayFor(event, unit);
    const open = state.openEventIds.includes(event.event_id);
    const id = escapeAttr(event.event_id);
    const classes = "mini-card event-card" + (opts.primary ? " primary-card" : "") + (open ? " is-open" : "");
    return '<article class="' + classes + '" data-event-card="' + id + '">' +
      '<button type="button" class="mini-summary" data-toggle-card="' + id + '" aria-expanded="' + String(open) + '">' +
        '<span class="event-icon">' + escapeHtml(event.icon || "⭐") + '</span>' +
        '<span class="drag-grip" data-drag-grip aria-label="Drag to reorder" role="button">⋮⋮</span>' +
        '<strong>' + escapeHtml(event.title) + '</strong>' +
        '<span class="summary-tail">' + escapeHtml(display.short) + '<i aria-hidden="true">' + (open ? "⌃" : "⌄") + '</i></span>' +
      '</button>' +
      (open ? '<div class="mini-details" id="event-' + id + '">' +
        '<section class="expanded-countdown countdown-card">' +
          countdownCardInner(event, unit, { key: (opts.primary ? "hero:" : "list:") + event.event_id, display, hideIdentity: true }) +
        '</section>' +
        eventToolbar(event) +
      '</div>' : "") +
    '</article>';
  }

  function countdownCardInner(event, unit, options) {
    const display = options && options.display ? options.display : displayFor(event, unit);
    const key = options && options.key ? options.key : event.event_id;
    const displayKey = display.kind === "mixed" ? display.parts.map((part) => part.value).join(":") : display.big;
    const previous = state.lastBigText[key];
    const changed = previous !== undefined && displayKey !== previous;
    state.lastBigText[key] = displayKey;
    const showIdentity = !(options && options.hideIdentity);

    return '<div class="hero-content">' +
        (showIdentity ? '<div class="event-kicker"><span class="event-icon">' + escapeHtml(event.icon || "⭐") + '</span><span>' + escapeHtml(formatTarget(event)) + '</span></div><h1 class="hero-title">' + escapeHtml(event.title) + '</h1>' : '<div class="detail-date">' + escapeHtml(formatTarget(event)) + '</div>') +
        (display.kind === "mixed" ? mixedMarkup(display, changed) : '<div class="number-wrap"><strong class="big-number ' + (changed ? "is-changing" : "") + '" data-fit="' + fitForBigText(display.big) + '">' + escapeHtml(display.big) + '</strong><span class="unit-label" data-fit="' + fitForBigText(display.unit) + '">' + escapeHtml(display.unit) + '</span></div>') +
        (display.note ? '<p class="status-line">' + escapeHtml(display.note) + '</p>' : "") +
      '</div>' +
      '<div class="unit-row" role="group" aria-label="Countdown units">' +
        units.map((candidate) => '<button type="button" data-unit="' + candidate + '" data-unit-event="' + escapeAttr(event.event_id) + '" class="' + (candidate === unit ? "is-active" : "") + '">' + labelForUnit(candidate) + '</button>').join("") +
      '</div>';
  }

  function mixedMarkup(display, changed) {
    return '<div class="mixed-countdown ' + (changed ? "is-changing" : "") + '" aria-label="' + escapeAttr(display.longLabel) + '">' +
      display.parts.map((part, index) => {
        const joiner = index ? '<span class="mixed-plus" aria-hidden="true">+</span>' : "";
        return joiner + '<span class="mixed-part" data-rank="' + index + '"><strong>' + escapeHtml(part.value) + '</strong><em>' + escapeHtml(part.label) + '</em></span>';
      }).join("") +
    '</div>';
  }

  function eventToolbar(event) {
    const id = escapeAttr(event.event_id);
    const title = escapeAttr(event.title);
    const events = sortedEvents();
    const index = events.findIndex((item) => item.event_id === event.event_id);
    const upDisabled = index <= 0 ? " disabled" : "";
    const downDisabled = index < 0 || index >= events.length - 1 ? " disabled" : "";
    return '<div class="mini-actions" aria-label="Countdown actions">' +
      '<button type="button" class="icon-action" data-edit-event="' + id + '" aria-label="Edit ' + title + '"><span aria-hidden="true">✎</span><small>Edit</small></button>' +
      '<button type="button" class="icon-action" data-move-event="' + id + '" data-dir="-1" aria-label="Move up"' + upDisabled + '><span aria-hidden="true">↑</span><small>Up</small></button>' +
      '<button type="button" class="icon-action" data-move-event="' + id + '" data-dir="1" aria-label="Move down"' + downDisabled + '><span aria-hidden="true">↓</span><small>Down</small></button>' +
      '<button type="button" class="icon-action danger-action" data-open-delete="' + id + '" aria-label="Delete ' + title + '"><span aria-hidden="true">×</span><small>Delete</small></button>' +
    '</div>';
  }

  function renderBoardSelect() {
    if (!els.boardSelect) return;
    els.boardSelect.innerHTML = visibleBoards()
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

  function renderDragToggle() {
    if (els.dragToggle) els.dragToggle.checked = Boolean(state.settings.allowDragOrder);
    document.body.classList.toggle("drag-order-enabled", Boolean(state.settings.allowDragOrder));
  }

  function renderAnimationButtons() {
    document.querySelectorAll("[data-animation-level]").forEach((button) => {
      button.classList.toggle("is-active", Number(button.getAttribute("data-animation-level")) === animationLevel());
    });
    applyAnimationLevel();
  }

  function sortedEvents() {
    return state.events
      .filter((event) => event.board_slug === state.settings.board && !event.deleted)
      .sort((a, b) => a.sort_order - b.sort_order || a.target_date.localeCompare(b.target_date));
  }

  function currentBoard() {
    return visibleBoards().find((board) => board.board_slug === state.settings.board) || visibleBoards()[0];
  }

  function boardExists(slugValue) {
    return state.boards.some((board) => board.board_slug === slugValue && !board.deleted);
  }

  function visibleBoards() {
    return state.boards.filter((board) => !board.deleted);
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
      return { kind: "future", big: value, unit: plural(Number(value), "year"), note: "", short: value + "y" };
    }

    if (unit === "months") {
      const value = Math.max(0, months.months);
      return { kind: "future", big: String(value), unit: plural(value, "month"), note: "", short: value + "mo" };
    }

    if (unit === "weeks") {
      const weeks = Math.max(1, Math.ceil(diff / (7 * dayMs)));
      return { kind: "future", big: String(weeks), unit: plural(weeks, "week"), note: "", short: weeks + "w" };
    }

    if (unit === "hours") {
      const hours = Math.max(1, Math.ceil(diff / hourMs));
      return { kind: "future", big: String(hours), unit: plural(hours, "hour"), note: "", short: hours + "h" };
    }

    if (unit === "minutes") {
      const minutes = Math.max(1, Math.ceil(diff / minuteMs));
      return { kind: "future", big: String(minutes), unit: "minutes", note: "", short: minutes + "m" };
    }

    if (unit === "seconds") {
      const seconds = Math.max(1, Math.ceil(diff / secondMs));
      return { kind: "future", big: String(seconds), unit: "seconds", note: "", short: seconds + "s" };
    }

    if (unit === "mixed") {
      const mixed = mixedParts(now, target);
      return { kind: "mixed", big: mixed.big, unit: mixed.unit, note: "", short: mixed.short, parts: mixed.parts, longLabel: mixed.longLabel };
    }

    return { kind: "future", big: String(days), unit: plural(days, "day"), note: "", short: days + "d" };
  }

  function mixedParts(start, end) {
    const pieces = wholeCalendarParts(start, end)
      .map((piece) => ({ value: piece.value, label: plural(piece.value, piece.name), short: piece.short }))
      .filter((piece) => piece.value > 0);
    const parts = pieces.length ? pieces : [{ value: 0, label: "seconds", short: "s" }];
    const primary = parts[0];
    const longLabel = parts.map((piece) => piece.value + " " + piece.label).join(" plus ");
    return {
      big: String(primary.value),
      unit: primary.label,
      parts,
      longLabel,
      short: parts.slice(0, 2).map((piece) => piece.value + piece.short).join("+")
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
    startSyncWindow(syncWindowMs);
    render();
    animateUnitChange(event.event_id);
  }

  function toggleCard(id) {
    if (!id) return;
    const isOpen = state.openEventIds.includes(id);
    state.openEventIds = isOpen ? state.openEventIds.filter((openId) => openId !== id) : state.openEventIds.concat(id);
    saveState();
    renderHeroOnly();
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
    startSyncWindow(syncWindowMs);
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
    startSyncWindow(syncWindowMs);
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
    startSyncWindow(syncWindowMs);
    render();
  }

  function onDragPointerDown(event) {
    if (state.drag) return;
    if (!state.settings.allowDragOrder) return;
    if (event.button !== undefined && event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const summary = target.closest(".mini-summary");
    if (!summary || summary.closest(".add-card")) return;
    const card = summary.closest("[data-event-card]");
    if (!card) return;
    const immediate = Boolean(target.closest("[data-drag-grip]"));
    state.drag = {
      id: card.getAttribute("data-event-card"),
      card,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startTime: Date.now(),
      started: false,
      timer: window.setTimeout(() => startDrag(), 380)
    };
    document.body.classList.add("is-pressing-order");
    if (immediate) {
      event.preventDefault();
      startDrag();
    }
  }

  function onDragPointerMove(event) {
    const drag = state.drag;
    if (!drag) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (!drag.started) {
      const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (Date.now() - drag.startTime > 360) {
        startDrag();
        if (state.drag && state.drag.started) {
          event.preventDefault();
          moveDragGhost(event.clientX, event.clientY);
          positionDragPlaceholder(event.clientY);
        }
        return;
      }
      if (moved > 12) cancelDrag();
      return;
    }
    event.preventDefault();
    moveDragGhost(event.clientX, event.clientY);
    positionDragPlaceholder(event.clientY);
  }

  function onDragPointerUp(event) {
    const drag = state.drag;
    if (!drag) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (!drag.started) {
      cancelDrag();
      return;
    }
    event.preventDefault();
    finishDragOrder();
  }

  function onDragPointerCancel() {
    const drag = state.drag;
    if (drag && drag.started) finishDragOrder();
    else cancelDrag();
  }

  function startDrag() {
    const drag = state.drag;
    if (!drag || drag.started) return;
    const rect = drag.card.getBoundingClientRect();
    const clone = drag.card.cloneNode(true);
    const placeholder = document.createElement("article");
    placeholder.className = "mini-card drag-placeholder";
    placeholder.style.height = rect.height + "px";
    placeholder.setAttribute("data-drag-placeholder", drag.id);

    clone.classList.add("drag-ghost");
    clone.removeAttribute("data-event-card");
    clone.style.width = rect.width + "px";
    clone.style.height = rect.height + "px";
    clone.style.left = rect.left + "px";
    clone.style.top = rect.top + "px";

    drag.offsetX = drag.startX - rect.left;
    drag.offsetY = drag.startY - rect.top;
    drag.clone = clone;
    drag.placeholder = placeholder;
    drag.started = true;
    state.suppressNextClick = true;

    drag.card.parentNode.insertBefore(placeholder, drag.card);
    drag.card.classList.add("drag-source");
    drag.card.style.display = "none";
    document.body.appendChild(clone);
    document.body.classList.remove("is-pressing-order");
    document.body.classList.add("is-dragging-order");
    moveDragGhost(drag.lastX, drag.lastY);
    positionDragPlaceholder(drag.lastY);
  }

  function moveDragGhost(x, y) {
    const drag = state.drag;
    if (!drag || !drag.clone) return;
    drag.clone.style.transform = "translate3d(" + (x - drag.offsetX - drag.clone.offsetLeft) + "px, " + (y - drag.offsetY - drag.clone.offsetTop) + "px, 0) rotate(-1.5deg)";
  }

  function positionDragPlaceholder(y) {
    const drag = state.drag;
    if (!drag || !drag.placeholder) return;
    const cards = Array.from(document.querySelectorAll("[data-event-card]"))
      .filter((card) => card !== drag.card && !card.classList.contains("add-card") && !card.classList.contains("drag-ghost"));
    const before = cards.find((card) => {
      const rect = card.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    if (before && before.parentNode) {
      before.parentNode.insertBefore(drag.placeholder, before);
      drag.previewIds = collectDragOrderIds(drag);
      return;
    }
    const addCard = document.querySelector(".add-card");
    if (addCard && addCard.parentNode) addCard.parentNode.insertBefore(drag.placeholder, addCard);
    else if (els.list) els.list.appendChild(drag.placeholder);
    drag.previewIds = collectDragOrderIds(drag);
  }

  function finishDragOrder() {
    const drag = state.drag;
    if (!drag) return;
    const current = sortedEvents();
    const known = current.map((event) => event.event_id);
    const ids = (drag.previewIds && drag.previewIds.length ? drag.previewIds : collectDragOrderIds(drag))
      .filter((id, index, list) => id && known.includes(id) && list.indexOf(id) === index);
    known.forEach((id) => {
      if (!ids.includes(id)) ids.push(id);
    });
    const byId = Object.fromEntries(current.map((event) => [event.event_id, event]));
    const changed = [];
    ids.forEach((id, index) => {
      const event = byId[id];
      if (event && event.sort_order !== index + 1) {
        event.sort_order = index + 1;
        event.updated_at = new Date().toISOString();
        changed.push(event);
      }
    });
    cleanupDrag();
    if (changed.length) {
      saveState();
      changed.forEach(syncEvent);
      startSyncWindow(syncWindowMs);
    }
    render();
  }

  function collectDragOrderIds(drag) {
    return Array.from(document.querySelectorAll("[data-drag-placeholder], [data-event-card]:not(.drag-source):not(.drag-ghost)"))
      .map((node) => node.getAttribute("data-drag-placeholder") || node.getAttribute("data-event-card") || "")
      .filter(Boolean);
  }

  function cancelDrag() {
    const drag = state.drag;
    if (!drag) return;
    cleanupDrag();
  }

  function cleanupDrag() {
    const drag = state.drag;
    if (!drag) return;
    if (drag.timer) window.clearTimeout(drag.timer);
    if (drag.clone) drag.clone.remove();
    if (drag.placeholder) drag.placeholder.remove();
    if (drag.card) {
      drag.card.classList.remove("drag-source");
      drag.card.style.display = "";
    }
    document.body.classList.remove("is-dragging-order");
    document.body.classList.remove("is-pressing-order");
    state.drag = null;
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
    startSyncWindow(syncWindowMs);
    syncUrl();
    render(true);
  }

  function deleteCurrentBoard() {
    if (visibleBoards().length <= 1) return;
    const current = currentBoard();
    if (!current) return;
    current.deleted = true;
    const deletedEvents = [];
    state.events.forEach((event) => {
      if (event.board_slug === current.board_slug) {
        event.deleted = true;
        event.updated_at = new Date().toISOString();
        deletedEvents.push(event);
      }
    });
    const nextBoard = visibleBoards()[0];
    if (!nextBoard) return;
    state.settings.board = nextBoard.board_slug;
    state.openEventIds = [];
    state.activeUnits = {};
    current.updated_at = new Date().toISOString();
    saveState();
    syncBoard(current);
    deletedEvents.forEach(syncEvent);
    syncUrl();
    render();
    startSyncWindow(syncWindowMs);
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

  function setAnimationLevel(level) {
    state.settings.animationLevel = clampAnimationLevel(level);
    saveState();
    applyAnimationLevel();
    renderAnimationButtons();
  }

  function applyTheme() {
    document.body.dataset.theme = state.settings.theme || "pop";
  }

  function applyAnimationLevel() {
    document.body.dataset.animationLevel = String(animationLevel());
  }

  function animationLevel() {
    return clampAnimationLevel(state.settings.animationLevel);
  }

  function clampAnimationLevel(value) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return 3;
    return Math.max(1, Math.min(5, number));
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

  function startSyncWindow(durationMs) {
    state.recentSyncUntil = Math.max(state.recentSyncUntil || 0, Date.now() + durationMs);
    if (syncInterval) return;
    syncInterval = window.setInterval(() => {
      if (Date.now() > state.recentSyncUntil) {
        window.clearInterval(syncInterval);
        syncInterval = 0;
        return;
      }
      requestBackendSnapshot({ reason: "window", silent: true });
    }, syncIntervalMs);
  }

  function requestBackendSnapshot(options) {
    const opts = options || {};
    if (!config.backendUrl) {
      setSyncStatus("Local only. No Apps Script URL is configured.");
      return Promise.resolve();
    }
    if (syncInFlight) return Promise.resolve();
    syncInFlight = true;

    if (!opts.silent) setSyncStatus("Checking Sheet sync...");
    return backendRequest("snapshot", {}).then((response) => {
      if (!response || !response.ok) {
        setSyncStatus("Sheet sync issue: " + (response && response.error ? response.error : "backend did not return ok."));
        return;
      }
      if (response.boards) state.boards = mergePendingBoards(normalizeBoards(response.boards));
      if (response.events) state.events = mergePendingEvents(normalizeEvents(response.events));
      if (state.settings.board && !boardExists(state.settings.board)) {
        const nextBoard = visibleBoards()[0];
        state.settings.board = nextBoard ? nextBoard.board_slug : "";
        syncUrl();
      }
      state.openEventIds = state.openEventIds.filter((id) => state.events.some((event) => event.event_id === id && !event.deleted));
      saveState();
      render();
      setSyncStatus("Sheet sync connected.");
    }).catch(() => {
      setSyncStatus("Sheet sync issue: Apps Script is not reachable. Check Web App access.");
    }).finally(() => {
      syncInFlight = false;
    });
  }

  function syncEvent(event) {
    if (!config.backendUrl || !event) return;
    rememberPendingEvent(event);
    backendRequest("upsertEvent", { event }).then((response) => {
      if (response && response.ok) {
        setSyncStatus("Sheet sync connected.");
        requestBackendSnapshot({ reason: "event-save", silent: true });
      }
      else setSyncStatus("Sheet sync issue: " + (response && response.error ? response.error : "event did not save to Sheet."));
    }).catch(() => {
      setSyncStatus("Sheet sync issue: event saved only on this device.");
    });
  }

  function syncBoard(board) {
    if (!config.backendUrl || !board) return;
    rememberPendingBoard(board);
    backendRequest("upsertBoard", { board }).then((response) => {
      if (response && response.ok) {
        setSyncStatus("Sheet sync connected.");
        requestBackendSnapshot({ reason: "board-save", silent: true });
      }
      else setSyncStatus("Sheet sync issue: " + (response && response.error ? response.error : "board did not save to Sheet."));
    }).catch(() => {
      setSyncStatus("Sheet sync issue: board saved only on this device.");
    });
  }

  function setSyncStatus(message) {
    if (els.syncStatus) els.syncStatus.textContent = message;
  }

  function rememberPendingEvent(event) {
    pendingEvents[event.event_id] = {
      record: Object.assign({}, event),
      until: Date.now() + 30000
    };
  }

  function rememberPendingBoard(board) {
    pendingBoards[board.board_slug] = {
      record: Object.assign({}, board),
      until: Date.now() + 30000
    };
  }

  function mergePendingEvents(events) {
    prunePending();
    let merged = events.slice();
    Object.keys(pendingEvents).forEach((id) => {
      const pending = pendingEvents[id].record;
      merged = merged.filter((event) => event.event_id !== id);
      if (!pending.deleted) merged.push(pending);
    });
    return merged;
  }

  function mergePendingBoards(boards) {
    prunePending();
    let merged = boards.slice();
    Object.keys(pendingBoards).forEach((slugValue) => {
      const pending = pendingBoards[slugValue].record;
      merged = merged.filter((board) => board.board_slug !== slugValue);
      if (!pending.deleted) merged.push(pending);
    });
    return merged;
  }

  function prunePending() {
    const now = Date.now();
    Object.keys(pendingEvents).forEach((id) => {
      if (pendingEvents[id].until < now) delete pendingEvents[id];
    });
    Object.keys(pendingBoards).forEach((slugValue) => {
      if (pendingBoards[slugValue].until < now) delete pendingBoards[slugValue];
    });
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
    const level = animationLevel();
    if (level <= 1) return;
    const adjustedCount = level >= 5 ? Math.ceil(count * 1.6) : level === 2 ? Math.ceil(count * 0.55) : count;
    for (let i = 0; i < adjustedCount; i++) {
      const dot = document.createElement("span");
      dot.className = "confetti";
      dot.style.left = Math.random() * 100 + "vw";
      dot.style.background = ["var(--accent)", "var(--accent-2)", "var(--accent-3)"][i % 3];
      dot.style.animationDelay = Math.random() * 220 + "ms";
      els.celebration.appendChild(dot);
      window.setTimeout(() => dot.remove(), 1200);
    }
  }

  function animateUnitChange(eventId) {
    const level = animationLevel();
    if (level <= 1) return;
    const card = document.querySelector('[data-event-card="' + cssEscape(eventId) + '"] .expanded-countdown');
    if (!card) return;
    card.classList.remove("unit-pop");
    void card.offsetWidth;
    card.classList.add("unit-pop");
    window.setTimeout(() => card.classList.remove("unit-pop"), 760);

    const sparkCounts = { 2: 5, 3: 9, 4: 14, 5: 22 };
    const count = sparkCounts[level] || 8;
    for (let i = 0; i < count; i++) {
      const spark = document.createElement("span");
      const angle = Math.random() * Math.PI * 2;
      const distance = 26 + Math.random() * (level >= 5 ? 96 : 58);
      spark.className = "unit-spark";
      spark.style.setProperty("--dx", Math.cos(angle) * distance + "px");
      spark.style.setProperty("--dy", Math.sin(angle) * distance + "px");
      spark.style.background = ["var(--accent)", "var(--accent-2)", "var(--accent-3)"][i % 3];
      spark.style.animationDelay = Math.random() * 90 + "ms";
      card.appendChild(spark);
      window.setTimeout(() => spark.remove(), 1000);
    }
    if (level >= 5) celebrate(8);
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
