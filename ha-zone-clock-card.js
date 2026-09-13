/*
 * Zone Clock Card for Home Assistant
 * "Weasley Clock" style card: person avatars move under the CATEGORY column
 * matching their current zone. Multiple real HA zones can be grouped into
 * one category (e.g. "Work" = zone.nisqually_administration + zone.watec).
 * A category left with no zones assigned automatically becomes the
 * catch-all / fallback column (e.g. "Away", "Traveling", "Lost").
 *
 * Comes with a full visual editor - no YAML required.
 *
 * INSTALL:
 * 1. Copy this file to <config>/www/ha-zone-clock-card/ha-zone-clock-card.js
 * 2. Settings > Dashboards > (three dots) > Resources > Add Resource
 *      URL: /local/ha-zone-clock-card/ha-zone-clock-card.js
 *      Type: JavaScript Module
 * 3. Hard-refresh the browser (Ctrl/Cmd+Shift+R) after updating the file.
 * 4. Add the card from the card picker ("Zone Clock Card").
 */

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key) || !deepEqual(a[key], b[key])) {
        return false;
      }
    }
    return true;
  }
  return a === b;
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function normalize(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function migrateConfig(config) {
  const cfg = cloneConfig(config || {});
  if (!cfg.categories) {
    // Migrate from the old flat "zones" list format
    const zones = cfg.zones || [];
    cfg.categories = zones.map((z) => ({
      label: z.split('.')[1] || z,
      icon: '',
      zones: [z],
    }));
    cfg.categories.push({
      label: cfg.default_label || 'Away',
      icon: 'mdi:help-circle',
      zones: [],
    });
    delete cfg.zones;
    delete cfg.default_label;
  }
  if (!cfg.persons) cfg.persons = [];
  if (cfg.show_names === undefined) cfg.show_names = true;
  if (cfg.show_category_icons === undefined) cfg.show_category_icons = true;
  if (cfg.header_position !== 'top' && cfg.header_position !== 'bottom') cfg.header_position = 'top';
  if (cfg.layout !== 'columns' && cfg.layout !== 'clock') cfg.layout = 'clock';
  return cfg;
}

class HaZoneClockCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  static getConfigElement() {
    return document.createElement('ha-zone-clock-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'Family Locations',
      persons: [],
      show_names: true,
      layout: 'clock',
      categories: [
        { label: 'Home', icon: 'mdi:home', zones: ['zone.home'] },
        { label: 'Away', icon: 'mdi:help-circle', zones: [] },
      ],
    };
  }

  setConfig(config) {
    if (!config) throw new Error('ha-zone-clock-card: invalid configuration');
    this._config = migrateConfig(config);
    this._built = false;
    this._avatarEls = {};
  }

  connectedCallback() {
    if (!this._resizeObserver) {
      this._resizeObserver = new ResizeObserver(() => {
        this._applyResponsiveSizing();
        this._update();
      });
      this._resizeObserver.observe(this);
    }
  }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._avatarRaf) {
      Object.values(this._avatarRaf).forEach((id) => cancelAnimationFrame(id));
      this._avatarRaf = {};
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._build();
      this._built = true;
      this._applyResponsiveSizing();
    }
    this._update();
  }

  getCardSize() {
    if (this._config && this._config.layout === 'clock') return 6;
    const rowHeight = this._config && this._config.show_names ? 68 : 54;
    const stack = this._maxStack || 1;
    return Math.max(3, Math.ceil((stack * rowHeight + 90) / 50));
  }

  getLayoutOptions() {
    // Hint at a reasonable starting size; grid_min_rows: 1 so the user can
    // freely shrink the card in Sections view without it snapping back.
    if (this._config && this._config.layout === 'clock') {
      return { grid_columns: 4, grid_rows: 6, grid_min_rows: 2 };
    }
    return { grid_columns: 4, grid_rows: this.getCardSize(), grid_min_rows: 1 };
  }

  // Returns candidate normalized match strings for a zone entity: its
  // entity_id slug AND its friendly name, since different HA versions /
  // setups can report either as the person's zone state.
  _zoneMatchCandidates(zoneEntityId) {
    const slug = normalize(zoneEntityId.split('.')[1]);
    const state = this._hass && this._hass.states[zoneEntityId];
    const friendly = state && state.attributes && state.attributes.friendly_name;
    const candidates = [slug];
    if (friendly) candidates.push(normalize(friendly));
    return candidates;
  }

  _computeColumns() {
    const categories = this._config.categories || [];
    const hasFallback = categories.some((c) => !c.zones || c.zones.length === 0);
    const columns = categories.map((c) => ({
      label: c.label || '(unnamed)',
      icon: c.icon || '',
      zones: c.zones || [],
    }));
    if (!hasFallback) {
      columns.push({ label: 'Away', icon: 'mdi:help-circle', zones: [], implicit: true });
    }
    return columns;
  }

  _makeAvatarSlot(slotClassName) {
    const slot = document.createElement('div');
    slot.className = slotClassName;

    const circle = document.createElement('div');
    circle.className = 'avatar-circle';

    const img = document.createElement('img');
    img.style.display = 'none';

    const initials = document.createElement('div');
    initials.className = 'avatar-initials';

    circle.appendChild(img);
    circle.appendChild(initials);
    slot.appendChild(circle);

    let name = null;
    if (this._config.show_names) {
      name = document.createElement('div');
      name.className = 'avatar-name';
      slot.appendChild(name);
    }

    return { slot, circle, img, initials, name };
  }

  // Refreshes photo/initials/name text for one person's avatar element set.
  _refreshAvatarContent(personEntity, els) {
    const personState = this._hass.states[personEntity];
    const pic = personState && personState.attributes.entity_picture;
    const displayName = (personState && personState.attributes.friendly_name) || personEntity;
    if (els.name) els.name.textContent = displayName;
    els.initials.textContent = displayName.charAt(0).toUpperCase();

    if (pic) {
      if (els.img.getAttribute('data-src') !== pic) {
        els.img.setAttribute('data-src', pic);
        els.img.onerror = () => {
          els.img.style.display = 'none';
          els.img.removeAttribute('data-src');
          els.initials.style.display = 'flex';
        };
        els.img.onload = () => {
          els.img.style.display = 'block';
          els.initials.style.display = 'none';
        };
        els.img.src = pic;
      } else if (els.img.style.display === 'block') {
        els.initials.style.display = 'none';
      }
    } else {
      els.img.style.display = 'none';
      els.img.removeAttribute('src');
      els.img.removeAttribute('data-src');
      els.initials.style.display = 'flex';
    }
  }

  // Triggers the brief glow/scale pulse when a person's category changes.
  // Returns true if this update represents a genuine change (not first load).
  _maybePulse(personEntity, els, colIndex) {
    this._prevColIndex = this._prevColIndex || {};
    const prevIndex = this._prevColIndex[personEntity];
    const changed = prevIndex !== undefined && prevIndex !== colIndex;
    if (changed) {
      els.circle.classList.remove('zcc-arrived');
      void els.circle.offsetWidth;
      els.circle.classList.add('zcc-arrived');
      clearTimeout(els._arriveTimeout);
      els._arriveTimeout = setTimeout(() => {
        els.circle.classList.remove('zcc-arrived');
      }, 700);
    }
    this._prevColIndex[personEntity] = colIndex;
    return changed;
  }

  // Determines which category (column/clock-position) index a person
  // currently belongs to, based on their zone state.
  _resolveColIndex(personEntity) {
    const personState = this._hass.states[personEntity];
    const stateValue = normalize(personState ? personState.state : 'not_home');
    const fallbackIndex = this._columns.findIndex((c) => !c.zones || c.zones.length === 0);
    let colIndex = fallbackIndex >= 0 ? fallbackIndex : this._columns.length - 1;
    for (let i = 0; i < this._columns.length; i++) {
      const zones = this._columns[i].zones || [];
      if (zones.some((z) => this._zoneMatchCandidates(z).includes(stateValue))) {
        colIndex = i;
        break;
      }
    }
    return colIndex;
  }

  _applyResponsiveSizing() {
    if (this._config && this._config.layout === 'clock') return;
    if (!this._columns || !this._columns.length) return;
    const width = this.clientWidth || this.getBoundingClientRect().width;
    if (!width) return;
    const perCol = width / this._columns.length;
    // Leave room for gaps/padding between avatars; clamp to a sane range.
    const size = Math.max(22, Math.min(42, Math.floor(perCol - 16)));
    this._colAvatarSize = size;
    this.style.setProperty('--zcc-avatar-size', `${size}px`);
    this.style.setProperty('--zcc-name-max-width', `${Math.max(size + 20, 40)}px`);
  }

  _build() {
    this._columns = this._computeColumns();
    const colCount = this._columns.length;
    const colWidthPct = (100 / colCount).toFixed(4);
    const rowHeight = this._config.show_names ? 68 : 54;

    this._board = null;
    this._headerRow = null;
    this._clockFace = null;
    this._clockWrapper = null;
    this._clockTicks = null;

    const card = document.createElement('ha-card');
    if (this._config.title) card.header = this._config.title;

    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        height: 100%;
        box-sizing: border-box;
      }
      ha-card {
        display: flex;
        flex-direction: column;
        height: 100%;
        box-sizing: border-box;
        overflow: hidden;
      }
      .wrapper {
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
        padding: 8px 12px 16px;
        box-sizing: border-box;
        width: 100%;
      }
      .header-row {
        display: flex;
        width: 100%;
        border-bottom: 2px solid var(--divider-color);
        padding-bottom: 8px;
        margin-bottom: 4px;
      }
      .header-row.zcc-header-bottom {
        border-bottom: none;
        border-top: 2px solid var(--divider-color);
        padding-bottom: 0;
        padding-top: 8px;
        margin-bottom: 0;
        margin-top: 4px;
      }
      .header-cell {
        flex: 1 1 ${colWidthPct}%;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        font-weight: 600;
        font-size: 0.8em;
        color: var(--primary-text-color);
        text-transform: uppercase;
        letter-spacing: .02em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding: 0 2px;
      }
      .header-cell ha-icon {
        --mdc-icon-size: 18px;
        color: var(--primary-color);
        order: -1;
        margin-bottom: 2px;
      }
      .clock-wrapper {
        position: relative;
        width: 100%;
        height: 100%;
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      .clock-face {
        position: relative;
        border-radius: 50%;
        border: 2px solid var(--divider-color);
        background: var(--card-background-color);
        box-sizing: border-box;
        flex-shrink: 0;
      }
      .clock-tick {
        position: absolute;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        font-weight: 600;
        font-size: var(--zcc-tick-font-size, 0.72em);
        color: var(--primary-text-color);
        text-transform: uppercase;
        letter-spacing: .02em;
        white-space: nowrap;
        line-height: 1.15;
        pointer-events: none;
      }
      .clock-tick ha-icon {
        --mdc-icon-size: var(--zcc-tick-icon-size, 18px);
        color: var(--primary-color);
        margin-bottom: 2px;
      }
      .clock-slot {
        position: absolute;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        transition: left 1.4s cubic-bezier(.3,0,.2,1), top 1.4s cubic-bezier(.3,0,.2,1);
      }
      .board {
        position: relative;
        width: 100%;
        min-height: ${rowHeight + 8}px;
      }
      .avatar-slot {
        position: absolute;
        width: ${colWidthPct}%;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        box-sizing: border-box;
        transition: left 0.6s cubic-bezier(.4,0,.2,1), top 0.6s cubic-bezier(.4,0,.2,1);
      }
      .avatar-circle {
        position: relative;
        width: var(--zcc-avatar-size, 42px);
        height: var(--zcc-avatar-size, 42px);
        border-radius: 50%;
        border: 2px solid var(--primary-color);
        box-shadow: 0 1px 3px rgba(0,0,0,.3);
        overflow: hidden;
        background: var(--primary-color);
        flex-shrink: 0;
      }
      .avatar-circle img {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        object-fit: cover;
      }
      .avatar-circle .avatar-initials {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        color: var(--text-primary-color, #fff);
      }
      .avatar-circle.zcc-arrived {
        animation: zcc-arrive 0.7s ease;
      }
      @keyframes zcc-arrive {
        0% {
          transform: scale(1);
          box-shadow: 0 1px 3px rgba(0,0,0,.3), 0 0 0 0 var(--primary-color);
        }
        35% {
          transform: scale(1.2);
          box-shadow: 0 1px 3px rgba(0,0,0,.3), 0 0 10px 2px var(--primary-color);
        }
        100% {
          transform: scale(1);
          box-shadow: 0 1px 3px rgba(0,0,0,.3), 0 0 0 0 var(--primary-color);
        }
      }
      .avatar-name {
        margin-top: 4px;
        font-size: 0.7em;
        color: var(--secondary-text-color);
        text-align: center;
        max-width: var(--zcc-name-max-width, 68px);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `;
    this.shadowRoot.innerHTML = '';
    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(card);

    const wrapper = document.createElement('div');
    wrapper.className = 'wrapper';

    if (this._config.layout === 'clock') {
      const clockWrapper = document.createElement('div');
      clockWrapper.className = 'clock-wrapper';

      const face = document.createElement('div');
      face.className = 'clock-face';
      this._clockFace = face;

      this._clockTicks = this._columns.map((col) => {
        const tick = document.createElement('div');
        tick.className = 'clock-tick';
        if (col.icon && this._config.show_category_icons) {
          const icon = document.createElement('ha-icon');
          icon.icon = col.icon;
          tick.appendChild(icon);
        }
        const label = document.createElement('div');
        label.textContent = col.label;
        tick.appendChild(label);
        face.appendChild(tick);
        return tick;
      });

      (this._config.persons || []).forEach((personEntity) => {
        const els = this._makeAvatarSlot('clock-slot');
        face.appendChild(els.slot);
        this._avatarEls[personEntity] = els;
      });

      clockWrapper.appendChild(face);
      wrapper.appendChild(clockWrapper);
      this._clockWrapper = clockWrapper;
      card.appendChild(wrapper);
      return;
    }

    const headerRow = document.createElement('div');
    headerRow.className = 'header-row';
    if (this._config.header_position === 'bottom') {
      headerRow.classList.add('zcc-header-bottom');
    }
    this._columns.forEach((col) => {
      const cell = document.createElement('div');
      cell.className = 'header-cell';
      if (col.icon && this._config.show_category_icons) {
        const icon = document.createElement('ha-icon');
        icon.icon = col.icon;
        cell.appendChild(icon);
      }
      const label = document.createElement('div');
      label.textContent = col.label;
      cell.appendChild(label);
      headerRow.appendChild(cell);
    });
    this._headerRow = headerRow;

    const board = document.createElement('div');
    board.className = 'board';
    this._board = board;

    (this._config.persons || []).forEach((personEntity) => {
      const els = this._makeAvatarSlot('avatar-slot');
      board.appendChild(els.slot);
      this._avatarEls[personEntity] = els;
    });

    if (this._config.header_position === 'bottom') {
      wrapper.appendChild(board);
      wrapper.appendChild(headerRow);
    } else {
      wrapper.appendChild(headerRow);
      wrapper.appendChild(board);
    }
    card.appendChild(wrapper);
  }

  _update() {
    if (!this._hass || !this._columns) return;
    if (this._config.layout === 'clock') {
      this._updateClock();
    } else {
      this._updateColumns();
    }
  }

  _updateColumns() {
    const stackCounts = {};
    const colWidthPct = 100 / this._columns.length;
    const rowHeight = this._config.show_names ? 68 : 54;
    const placements = [];

    (this._config.persons || []).forEach((personEntity) => {
      const els = this._avatarEls[personEntity];
      if (!els) return;

      const colIndex = this._resolveColIndex(personEntity);
      this._maybePulse(personEntity, els, colIndex);

      const stackIndex = stackCounts[colIndex] || 0;
      stackCounts[colIndex] = stackIndex + 1;

      this._refreshAvatarContent(personEntity, els);

      placements.push({ els, colIndex, stackIndex });
    });

    // Track the tallest column so getCardSize() stays proportional to
    // actual content instead of a fixed worst case.
    const maxStack = Object.keys(stackCounts).length
      ? Math.max(...Object.values(stackCounts))
      : 1;
    this._maxStack = maxStack;

    // Normally each stacked avatar gets its own full row. If there isn't
    // enough vertical room for that (e.g. a fixed-height Sections card),
    // compress the stacking step so avatars overlap more and more until
    // the whole stack exactly fits the available height - no scrollbar,
    // no clipping, just tighter overlap the more crowded a column gets.
    let step = rowHeight;
    const wrapperEl = this.shadowRoot.querySelector('.wrapper');
    if (wrapperEl && maxStack > 1) {
      const headerH = this._headerRow ? this._headerRow.getBoundingClientRect().height + 12 : 0;
      const available = wrapperEl.clientHeight - headerH;
      if (available > 0) {
        const maxAllowedStep = (available - rowHeight) / (maxStack - 1);
        step = Math.max(0, Math.min(rowHeight, maxAllowedStep));
      }
    }

    placements.forEach(({ els, colIndex, stackIndex }) => {
      els.slot.style.left = `${colIndex * colWidthPct}%`;
      els.slot.style.top = `${stackIndex * step}px`;
      // Earlier people in a zone sit visually on top of later arrivals.
      els.slot.style.zIndex = String(maxStack - stackIndex);
    });

    if (this._board) {
      this._board.style.minHeight = `${(maxStack - 1) * step + rowHeight}px`;
      this._board.style.maxHeight = `${(maxStack - 1) * step + rowHeight}px`;
    }
  }

  // Animates one avatar from (fromTheta, fromRadius) to (toTheta, toRadius)
  // in polar coordinates around `center`, sweeping around the shorter way
  // (clockwise or counter-clockwise) instead of cutting straight across
  // the face. Runs on requestAnimationFrame since CSS transitions can only
  // interpolate left/top in a straight line, not an arc.
  _animateAvatarArc(personEntity, els, fromTheta, toTheta, fromRadius, toRadius, center) {
    if (this._avatarRaf[personEntity]) {
      cancelAnimationFrame(this._avatarRaf[personEntity]);
    }
    let delta = ((toTheta - fromTheta + 540) % 360) - 180;
    const duration = 1200;
    const start = performance.now();
    els.slot.style.transition = 'none';

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const theta = fromTheta + delta * eased;
      const radius = fromRadius + (toRadius - fromRadius) * eased;
      const rad = (theta * Math.PI) / 180;
      const x = center + radius * Math.sin(rad);
      const y = center - radius * Math.cos(rad);
      els.slot.style.left = `${x}px`;
      els.slot.style.top = `${y}px`;
      this._avatarState[personEntity] = { theta: ((theta % 360) + 360) % 360, radius };

      if (t < 1) {
        this._avatarRaf[personEntity] = requestAnimationFrame(step);
      } else {
        delete this._avatarRaf[personEntity];
        els.slot.style.transition = '';
        els.circle.classList.remove('zcc-arrived');
        void els.circle.offsetWidth;
        els.circle.classList.add('zcc-arrived');
        clearTimeout(els._arriveTimeout);
        els._arriveTimeout = setTimeout(() => {
          els.circle.classList.remove('zcc-arrived');
        }, 700);
      }
    };
    this._avatarRaf[personEntity] = requestAnimationFrame(step);
  }

  _updateClock() {
    const N = this._columns.length;
    if (!this._clockWrapper || !N) return;

    const rect = this._clockWrapper.getBoundingClientRect();
    // In Sections view the wrapper has a real fixed height, so fit the
    // circle to whichever dimension is smaller. In Masonry view the card
    // has no fixed height yet on first measurement, so size from width -
    // the resulting square height then becomes the card's real height on
    // the next layout pass (and the next ResizeObserver tick confirms it).
    const usableHeight = rect.height > 40 ? rect.height : rect.width;
    const diameter = Math.max(60, Math.floor(Math.min(rect.width, usableHeight)) - 4);
    if (this._clockFace) {
      this._clockFace.style.width = `${diameter}px`;
      this._clockFace.style.height = `${diameter}px`;
    }

    const center = diameter / 2;
    const labelRadius = center * 0.91;
    const avatarRadius = center * 0.7;
    // Scale with the actual clock size instead of capping small - on a
    // big clock the avatars and zone labels should grow too, or they end
    // up looking lost with oddly large empty space around them.
    const avatarSize = Math.max(20, Math.min(90, Math.floor(diameter * 0.1)));
    this.style.setProperty('--zcc-avatar-size', `${avatarSize}px`);
    this.style.setProperty('--zcc-name-max-width', `${Math.max(avatarSize + 16, 40)}px`);

    const tickFontSize = Math.max(10, Math.min(26, Math.floor(diameter * 0.032)));
    const tickIconSize = Math.max(14, Math.min(34, Math.floor(diameter * 0.045)));
    this.style.setProperty('--zcc-tick-font-size', `${tickFontSize}px`);
    this.style.setProperty('--zcc-tick-icon-size', `${tickIconSize}px`);

    // Position each category label just inside the rim, evenly spaced
    // around the circle starting at 12 o'clock, going clockwise. Rotate
    // each label so it reads outward along its spoke, flipping the
    // bottom half 180deg so the text isn't upside down.
    this._columns.forEach((col, i) => {
      const thetaDeg = (360 / N) * i;
      const theta = (thetaDeg * Math.PI) / 180;
      const x = center + labelRadius * Math.sin(theta);
      const y = center - labelRadius * Math.cos(theta);
      const tick = this._clockTicks[i];
      if (tick) {
        tick.style.left = `${x}px`;
        tick.style.top = `${y}px`;
        let faceDeg = thetaDeg;
        if (faceDeg > 90 && faceDeg < 270) faceDeg += 180;
        tick.style.transform = `translate(-50%, -50%) rotate(${faceDeg}deg)`;
      }
    });

    // Group people by their current category so ones sharing a zone can
    // stack along that spoke - like a little chain running from the
    // rim toward the center - instead of piling on one spot. Grouping
    // only ever includes people currently in that zone, so the stack is
    // always contiguous - nobody's absence leaves a gap in the chain.
    const groups = {};
    (this._config.persons || []).forEach((personEntity) => {
      const colIndex = this._resolveColIndex(personEntity);
      groups[colIndex] = groups[colIndex] || [];
      groups[colIndex].push(personEntity);
    });

    // Exactly half of each avatar peeks out from behind its neighbor -
    // never fully hidden, never gapped.
    const overlapStep = avatarSize * 0.5;

    this._avatarState = this._avatarState || {};
    this._avatarRaf = this._avatarRaf || {};
    this._prevColIndex = this._prevColIndex || {};

    Object.keys(groups).forEach((colIndexStr) => {
      const colIndex = Number(colIndexStr);
      const members = groups[colIndex];
      const k = members.length;
      const thetaBaseDeg = (360 / N) * colIndex;
      const maxRadius = labelRadius * 0.8;
      const minRadius = avatarSize * 0.5;

      // Keep spacing between stacked avatars perfectly equal: instead of
      // clamping each member's radius separately (which compresses the
      // gap for whichever one hits the ceiling), shift the whole stack's
      // center radius inward just enough that every member fits within
      // [minRadius, maxRadius] while the step between them stays fixed.
      const halfSpan = ((k - 1) / 2) * overlapStep;
      let stackCenterRadius = avatarRadius;
      if (stackCenterRadius + halfSpan > maxRadius) stackCenterRadius = maxRadius - halfSpan;
      if (stackCenterRadius - halfSpan < minRadius) stackCenterRadius = minRadius + halfSpan;

      members.forEach((personEntity, idx) => {
        const els = this._avatarEls[personEntity];
        if (!els) return;

        // First member sits nearest the rim; each following member
        // steps further in toward the center, overlapping by half.
        const targetRadius = stackCenterRadius + ((k - 1) / 2 - idx) * overlapStep;
        const targetTheta = thetaBaseDeg;

        const prevIndex = this._prevColIndex[personEntity];
        const categoryChanged = prevIndex !== undefined && prevIndex !== colIndex;
        this._prevColIndex[personEntity] = colIndex;

        const prevState = this._avatarState[personEntity];

        if (categoryChanged && prevState) {
          // Sweep clockwise or counter-clockwise (whichever is shorter)
          // around to the new zone instead of sliding radially.
          this._animateAvatarArc(personEntity, els, prevState.theta, targetTheta, prevState.radius, targetRadius, center);
        } else if (!prevState) {
          // First render - place directly with no animation.
          const rad = (targetTheta * Math.PI) / 180;
          const x = center + targetRadius * Math.sin(rad);
          const y = center - targetRadius * Math.cos(rad);
          els.slot.style.transition = 'none';
          els.slot.style.left = `${x}px`;
          els.slot.style.top = `${y}px`;
          void els.slot.offsetWidth;
          els.slot.style.transition = '';
          this._avatarState[personEntity] = { theta: targetTheta, radius: targetRadius };
        } else if (!this._avatarRaf[personEntity]) {
          // Same zone as last time - just a minor stacking adjustment
          // (someone else joined/left this zone). Let the normal CSS
          // transition ease it into place.
          const rad = (targetTheta * Math.PI) / 180;
          const x = center + targetRadius * Math.sin(rad);
          const y = center - targetRadius * Math.cos(rad);
          els.slot.style.left = `${x}px`;
          els.slot.style.top = `${y}px`;
          this._avatarState[personEntity] = { theta: targetTheta, radius: targetRadius };
        }

        els.slot.style.zIndex = String(k - idx);
        this._refreshAvatarContent(personEntity, els);
      });
    });

    this._maxStack = Math.max(1, ...Object.values(groups).map((m) => m.length));
  }
}

customElements.define('ha-zone-clock-card', HaZoneClockCard);

/* ---------------------------------------------------------------------- */
/* Visual editor                                                          */
/* ---------------------------------------------------------------------- */

class HaZoneClockCardEditor extends HTMLElement {
  setConfig(config) {
    const migrated = migrateConfig(config);
    // If this is just Home Assistant echoing back the config we ourselves
    // just fired (e.g. after each keystroke), don't rebuild the DOM -
    // doing so would blow away focus mid-edit. Only rebuild on a genuine
    // external change (first load, YAML edit, undo, etc).
    if (this._config && deepEqual(migrated, this._config)) {
      this._config = migrated;
      return;
    }
    this._config = migrated;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this.querySelectorAll('ha-entity-picker').forEach((el) => {
      el.hass = hass;
    });
  }

  _fireChanged() {
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config: cloneConfig(this._config) },
        bubbles: true,
        composed: true,
      })
    );
  }

  _selectBox(labelText, options, value, onChange) {
    this._textBoxId = (this._textBoxId || 0) + 1;
    const selectId = `zcc-select-${this._textBoxId}`;

    const wrap = document.createElement('div');
    wrap.className = 'zcc-textbox';

    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    lbl.htmlFor = selectId;

    const select = document.createElement('select');
    select.id = selectId;
    options.forEach((opt) => {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      if (opt.value === value) optionEl.selected = true;
      select.appendChild(optionEl);
    });
    select.addEventListener('change', (e) => onChange(e.target.value));

    wrap.appendChild(lbl);
    wrap.appendChild(select);
    return wrap;
  }

  _textBox(labelText, value, onInput) {
    this._textBoxId = (this._textBoxId || 0) + 1;
    const inputId = `zcc-textbox-${this._textBoxId}`;

    const wrap = document.createElement('div');
    wrap.className = 'zcc-textbox';

    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    lbl.htmlFor = inputId;

    const input = document.createElement('input');
    input.type = 'text';
    input.id = inputId;
    input.value = value || '';
    input.addEventListener('input', (e) => onInput(e.target.value));

    wrap.appendChild(lbl);
    wrap.appendChild(input);
    return wrap;
  }

  _removeBtn(onClick, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '\u00D7';
    btn.title = label || 'Remove';
    btn.className = 'zcc-remove-btn';
    btn.addEventListener('click', onClick);
    return btn;
  }

  _entityPickerRow(value, domain, onChange, onRemove) {
    const row = document.createElement('div');
    row.className = 'zcc-row';

    const picker = document.createElement('ha-entity-picker');
    picker.setAttribute('outlined', '');
    picker.hass = this._hass;
    picker.includeDomains = [domain];
    picker.value = value || '';
    picker.style.flex = '1';
    picker.addEventListener('value-changed', (e) => {
      e.stopPropagation();
      onChange(e.detail.value);
    });
    row.appendChild(picker);
    row.appendChild(this._removeBtn(onRemove, 'Remove'));
    return row;
  }

  _moveItem(array, index, delta) {
    const newIndex = index + delta;
    if (newIndex < 0 || newIndex >= array.length) return;
    const [item] = array.splice(index, 1);
    array.splice(newIndex, 0, item);
  }

  // Builds a drag handle + up/down arrow cluster and wires up native
  // HTML5 drag-and-drop on `container` (drop target), scoped to `array`
  // so items only reorder within their own list.
  _addReorderUI(array, index, onReorder) {
    const wrap = document.createElement('div');
    wrap.className = 'zcc-reorder-wrap';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'zcc-reorder-btn';
    upBtn.textContent = '\u25B2';
    upBtn.title = 'Move up';
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', () => {
      this._moveItem(array, index, -1);
      onReorder();
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'zcc-reorder-btn';
    downBtn.textContent = '\u25BC';
    downBtn.title = 'Move down';
    downBtn.disabled = index === array.length - 1;
    downBtn.addEventListener('click', () => {
      this._moveItem(array, index, 1);
      onReorder();
    });

    wrap.appendChild(upBtn);
    wrap.appendChild(downBtn);
    return wrap;
  }

  _categoryBox(category, index) {
    const box = document.createElement('div');
    box.className = 'zcc-category-box';

    this._expandedCategories = this._expandedCategories || new WeakSet();
    const isCollapsed = !this._expandedCategories.has(category);

    const header = document.createElement('div');
    header.className = 'zcc-category-header';

    header.appendChild(
      this._addReorderUI(this._config.categories, index, () => {
        this._fireChanged();
        this._render();
      })
    );

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'zcc-collapse-btn';
    toggleBtn.textContent = isCollapsed ? '\u25B8' : '\u25BE';
    toggleBtn.title = isCollapsed ? 'Expand' : 'Collapse';
    toggleBtn.addEventListener('click', () => {
      if (isCollapsed) this._expandedCategories.add(category);
      else this._expandedCategories.delete(category);
      this._render();
    });
    header.appendChild(toggleBtn);

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'zcc-inline-input';
    labelInput.placeholder = 'Category label';
    labelInput.value = category.label || '';
    labelInput.addEventListener('input', (e) => {
      category.label = e.target.value;
      this._fireChanged();
    });
    header.appendChild(labelInput);

    header.appendChild(
      this._removeBtn(() => {
        this._config.categories.splice(index, 1);
        this._fireChanged();
        this._render();
      }, 'Remove category')
    );

    box.appendChild(header);

    if (isCollapsed) return box;

    const body = document.createElement('div');
    body.className = 'zcc-category-body';

    // Icon field
    const iconField = document.createElement('ha-icon-picker');
    iconField.setAttribute('outlined', '');
    iconField.label = 'Icon (optional, mdi:...)';
    iconField.value = category.icon || '';
    iconField.style.width = '100%';
    iconField.style.marginBottom = '4px';
    iconField.addEventListener('value-changed', (e) => {
      e.stopPropagation();
      category.icon = e.detail.value;
      this._fireChanged();
    });
    body.appendChild(iconField);

    // Zones list
    const zonesLabel = document.createElement('div');
    zonesLabel.className = 'zcc-subheading';
    zonesLabel.textContent = 'Zones in this category';
    body.appendChild(zonesLabel);

    const zonesList = document.createElement('div');
    category.zones = category.zones || [];
    category.zones.forEach((zoneId, zIndex) => {
      const row = this._entityPickerRow(
        zoneId,
        'zone',
        (newVal) => {
          if (!newVal) {
            category.zones.splice(zIndex, 1);
            this._fireChanged();
            this._render();
          } else {
            category.zones[zIndex] = newVal;
            this._fireChanged();
          }
        },
        () => {
          category.zones.splice(zIndex, 1);
          this._fireChanged();
          this._render();
        }
      );
      zonesList.appendChild(row);
    });
    body.appendChild(zonesList);

    const addZoneBtn = document.createElement('button');
    addZoneBtn.type = 'button';
    addZoneBtn.className = 'zcc-outline-btn';
    addZoneBtn.textContent = '+ Add zone';
    addZoneBtn.addEventListener('click', () => {
      category.zones.push('');
      this._fireChanged();
      this._render();
    });
    body.appendChild(addZoneBtn);

    const footer = document.createElement('div');
    footer.className = 'zcc-category-footer';

    const hint = document.createElement('div');
    hint.className = 'zcc-hint';
    hint.textContent = 'Leave zones empty to use this category as a fallback (e.g. "Traveling"/"Lost")';
    footer.appendChild(hint);

    body.appendChild(footer);
    box.appendChild(body);

    return box;
  }

  _render() {
    this.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = `
      .zcc-editor { padding: 8px 0; }
      .zcc-editor ha-textfield,
      .zcc-editor ha-icon-picker,
      .zcc-editor ha-entity-picker {
        margin-bottom: 2px;
      }
      .zcc-textbox { margin-bottom: 14px; }
      .zcc-textbox label {
        display: block;
        font-size: 0.75em;
        color: var(--secondary-text-color);
        margin-bottom: 4px;
      }
      .zcc-textbox input[type="text"] {
        display: block;
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border: 1px solid var(--divider-color);
        border-radius: 6px;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color);
        font-size: 0.95em;
        font-family: inherit;
      }
      .zcc-textbox input[type="text"]:focus {
        outline: none;
        border-color: var(--primary-color);
        border-width: 2px;
        padding: 9px 11px;
      }
      .zcc-textbox select {
        display: block;
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border: 1px solid var(--divider-color);
        border-radius: 6px;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color);
        font-size: 0.95em;
        font-family: inherit;
        cursor: pointer;
      }
      .zcc-textbox select:focus {
        outline: none;
        border-color: var(--primary-color);
        border-width: 2px;
        padding: 9px 11px;
      }
      .zcc-subheading { margin-top: 16px; margin-bottom: 6px; font-size: 0.85em; color: var(--secondary-text-color); }
      .zcc-category-box {
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        padding: 12px 16px;
        margin-bottom: 16px;
        background: var(--card-background-color);
      }
      .zcc-category-header {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .zcc-category-body { margin-top: 14px; }
      .zcc-inline-input {
        flex: 1 1 auto;
        min-width: 0;
        padding: 8px 10px;
        border: 1px solid var(--divider-color);
        border-radius: 6px;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color);
        font-size: 0.95em;
        font-family: inherit;
      }
      .zcc-inline-input:focus {
        outline: none;
        border-color: var(--primary-color);
        border-width: 2px;
        padding: 7px 9px;
      }
      .zcc-collapse-btn {
        flex: 0 0 auto;
        width: 28px; height: 28px;
        border-radius: 6px;
        border: 1px solid var(--divider-color);
        background: transparent;
        color: var(--secondary-text-color);
        font-size: 13px;
        cursor: pointer;
      }
      .zcc-collapse-btn:hover { background: var(--secondary-background-color); }
      .zcc-reorder-wrap {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 0 0 auto;
      }
      .zcc-reorder-btn {
        flex: 0 0 auto;
        width: 26px; height: 20px;
        border-radius: 4px;
        border: 1px solid var(--divider-color);
        background: transparent;
        color: var(--secondary-text-color);
        font-size: 10px;
        line-height: 1;
        padding: 0;
        cursor: pointer;
      }
      .zcc-reorder-btn:hover:not(:disabled) { background: var(--secondary-background-color); }
      .zcc-reorder-btn:disabled { opacity: 0.3; cursor: default; }
      .zcc-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        border-radius: 6px;
      }
      .zcc-remove-btn {
        flex: 0 0 auto;
        width: 36px; height: 36px;
        border-radius: 50%;
        border: 1px solid var(--divider-color);
        background: transparent;
        color: var(--secondary-text-color);
        font-size: 18px;
        cursor: pointer;
      }
      .zcc-remove-btn:hover { background: var(--secondary-background-color); }
      .zcc-outline-btn {
        display: inline-block;
        margin-top: 4px;
        padding: 8px 14px;
        border-radius: 6px;
        border: 1px solid var(--primary-color);
        background: transparent;
        color: var(--primary-color);
        font-size: 0.9em;
        cursor: pointer;
      }
      .zcc-outline-btn:hover { background: rgba(var(--rgb-primary-color), 0.08); }
      .zcc-hint { font-size: 0.75em; color: var(--secondary-text-color); flex: 1 1 auto; min-width: 0; }
      .zcc-category-footer {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
        margin-top: 12px;
      }
      .zcc-section-title { font-size: 1em; font-weight: 600; margin: 20px 0 8px; color: var(--primary-text-color); }
      .zcc-add-category-btn {
        display: block;
        width: 100%;
        padding: 12px;
        border-radius: 8px;
        border: 1px dashed var(--divider-color);
        background: transparent;
        color: var(--primary-color);
        font-size: 0.95em;
        cursor: pointer;
        margin-bottom: 24px;
      }
      .zcc-add-category-btn:hover { background: var(--secondary-background-color); }
      .zcc-checkbox-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 16px 0;
        font-size: 0.95em;
        color: var(--primary-text-color);
      }
      .zcc-checkbox-row input { width: 18px; height: 18px; cursor: pointer; }
      .zcc-checkbox-row label { cursor: pointer; }
    `;
    this.appendChild(style);

    const root = document.createElement('div');
    root.className = 'zcc-editor';

    // Title
    const titleBox = this._textBox('Title', this._config.title, (val) => {
      this._config.title = val;
      this._fireChanged();
    });
    root.appendChild(titleBox);

    // Show names toggle
    const checkboxRow = document.createElement('div');
    checkboxRow.className = 'zcc-checkbox-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'zcc-show-names';
    checkbox.checked = this._config.show_names !== false;
    checkbox.addEventListener('change', (e) => {
      this._config.show_names = e.target.checked;
      this._fireChanged();
    });
    const checkboxLabel = document.createElement('label');
    checkboxLabel.htmlFor = 'zcc-show-names';
    checkboxLabel.textContent = 'Show names under avatars';
    checkboxRow.appendChild(checkbox);
    checkboxRow.appendChild(checkboxLabel);
    root.appendChild(checkboxRow);

    // Show category icons toggle
    const iconCheckboxRow = document.createElement('div');
    iconCheckboxRow.className = 'zcc-checkbox-row';
    const iconCheckbox = document.createElement('input');
    iconCheckbox.type = 'checkbox';
    iconCheckbox.id = 'zcc-show-category-icons';
    iconCheckbox.checked = this._config.show_category_icons !== false;
    iconCheckbox.addEventListener('change', (e) => {
      this._config.show_category_icons = e.target.checked;
      this._fireChanged();
    });
    const iconCheckboxLabel = document.createElement('label');
    iconCheckboxLabel.htmlFor = 'zcc-show-category-icons';
    iconCheckboxLabel.textContent = 'Show category icons';
    iconCheckboxRow.appendChild(iconCheckbox);
    iconCheckboxRow.appendChild(iconCheckboxLabel);
    root.appendChild(iconCheckboxRow);

    // Layout style dropdown
    const layoutBox = this._selectBox(
      'Layout style',
      [
        { value: 'clock', label: 'Clock face (circular)' },
        { value: 'columns', label: 'Columns (classic)' },
      ],
      this._config.layout || 'clock',
      (val) => {
        this._config.layout = val;
        this._fireChanged();
        this._render();
      }
    );
    root.appendChild(layoutBox);

    // Header position dropdown - only meaningful for the columns layout
    if (this._config.layout !== 'clock') {
      const positionBox = this._selectBox(
        'Header position',
        [
          { value: 'top', label: 'Top of card' },
          { value: 'bottom', label: 'Bottom of card' },
        ],
        this._config.header_position || 'top',
        (val) => {
          this._config.header_position = val;
          this._fireChanged();
        }
      );
      root.appendChild(positionBox);
    }

    // People section
    const peopleTitle = document.createElement('div');
    peopleTitle.className = 'zcc-section-title';
    peopleTitle.textContent = 'People to track';
    root.appendChild(peopleTitle);

    const peopleBox = document.createElement('div');
    this._config.persons = this._config.persons || [];
    this._config.persons.forEach((personId, pIndex) => {
      const row = this._entityPickerRow(
        personId,
        'person',
        (newVal) => {
          if (!newVal) {
            this._config.persons.splice(pIndex, 1);
            this._fireChanged();
            this._render();
          } else {
            this._config.persons[pIndex] = newVal;
            this._fireChanged();
          }
        },
        () => {
          this._config.persons.splice(pIndex, 1);
          this._fireChanged();
          this._render();
        }
      );
      row.insertBefore(
        this._addReorderUI(this._config.persons, pIndex, () => {
          this._fireChanged();
          this._render();
        }),
        row.firstChild
      );
      peopleBox.appendChild(row);
    });
    root.appendChild(peopleBox);

    const addPersonBtn = document.createElement('button');
    addPersonBtn.type = 'button';
    addPersonBtn.className = 'zcc-outline-btn';
    addPersonBtn.textContent = '+ Add person';
    addPersonBtn.addEventListener('click', () => {
      this._config.persons.push('');
      this._fireChanged();
      this._render();
    });
    root.appendChild(addPersonBtn);

    // Categories section
    const catTitle = document.createElement('div');
    catTitle.className = 'zcc-section-title';
    catTitle.textContent = 'Zone categories';
    root.appendChild(catTitle);

    this._config.categories = this._config.categories || [];
    this._config.categories.forEach((category, index) => {
      root.appendChild(this._categoryBox(category, index));
    });

    const addCategoryBtn = document.createElement('button');
    addCategoryBtn.type = 'button';
    addCategoryBtn.className = 'zcc-add-category-btn';
    addCategoryBtn.textContent = '+ Add category';
    addCategoryBtn.addEventListener('click', () => {
      const newCategory = { label: '', icon: '', zones: [] };
      this._config.categories.push(newCategory);
      this._expandedCategories = this._expandedCategories || new WeakSet();
      this._expandedCategories.add(newCategory);
      this._fireChanged();
      this._render();
    });
    root.appendChild(addCategoryBtn);

    this.appendChild(root);

    if (this._hass) {
      this.querySelectorAll('ha-entity-picker').forEach((el) => {
        el.hass = this._hass;
      });
    }
  }
}

customElements.define('ha-zone-clock-card-editor', HaZoneClockCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'ha-zone-clock-card',
  name: 'Zone Clock Card',
  description: 'Weasley-clock style card: group zones into categories and watch people move between columns.',
});
