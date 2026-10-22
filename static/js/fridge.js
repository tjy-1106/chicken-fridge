// My Fridge: the cartoon fridge, the bin chicken, the Add Item panel, item details
// and the expired item check.

import { api } from './api.js';
import { icon, catIcon } from './icons.js';
import {
  h, setChildren, state, toast, openSheet, closeSheet, sheetIsOpen, nameInput, stepper, setNavBadge,
  ZONES, ZONE_LABEL, addDays, fmtDate, daysLabel, daysLong, statusTag, qtyText,
} from './ui.js';

const ROWS = { pantry: 2, chilled: 3, frozen: 2 }; // shelves per compartment
const CHIP_MIN = 84;
const CHIP_GAP = 8;
const QUICK = [[3, '3 days'], [7, '1 week'], [14, '2 weeks'], [30, '1 month']];

const MOOD_RANK = { angry: 0, sulky: 1, content: 2, happy: 3, superhappy: 4 };
const MOOD_LABEL = { angry: 'very angry', sulky: 'a bit cross', content: 'content', happy: 'happy', superhappy: 'super happy' };
// Which picture each mood uses: the heart one is "happy", the dancing one is "super happy".
const MOOD_IMAGE = { angry: 'angry', sulky: 'sulky', content: 'content', happy: 'content', superhappy: 'happy' };
const REACTION_MS = 2200;      // how long a reaction card stays up
const MOOD_CHANGE_MS = 1300;   // hop / shake when the standing mood changes
const DEMO = new URLSearchParams(location.search).get('demo') === '1';

const root = document.getElementById('view-fridge');
const isWide = () => window.matchMedia('(min-width: 900px)').matches;

// What the side panel (desktop) or sheet (mobile) is showing:
// { kind: 'zone', zone } | { kind: 'item', id, from } | null
let panel = null;

const closestQuick = (days) =>
  QUICK.reduce((best, [n]) => (Math.abs(n - days) < Math.abs(best - days) ? n : best), QUICK[0][0]);

async function load() {
  [state.fridge, state.pending, state.mascot] =
    await Promise.all([api.get('/fridge'), api.get('/list/pending'), api.get('/mascot')]);
  setNavBadge(state.pending.length);
}

// Called when the page is opened: draw it, then ask about anything past its date.
export async function renderFridge() {
  await load();
  drawFridge();
  openExpiredCheck();
}

// ---------------------------------------------------------------- the fridge

export function drawFridge() {
  const soon = state.fridge.filter((i) => i.status === 'soon').length;
  const expired = state.fridge.filter((i) => i.days_left < 0).length;
  const summary = [
    `${state.fridge.length} ${state.fridge.length === 1 ? 'item' : 'items'}`,
    `${soon} to eat soon`,
    expired ? `${expired} past date` : null,
  ].filter(Boolean).join(' · ');

  setChildren(root,
    h('header', { class: 'page-head with-action fridge-head' },
      h('div', null, h('h1', null, 'My Fridge'), h('p', { class: 'sub' }, summary)),
      // Top right on desktop; floats bottom right on phones (see .fab in the CSS).
      fabEl()),
    h('div', { class: 'fridge-layout' },
      h('div', { class: 'fridge-stage' },
        mascotEl(),
        h('div', { class: 'fridge' },
          h('div', { class: 'fridge-body' },
            h('div', { class: 'fridge-brow' }, h('span', { class: 'fridge-light' }), h('span', { class: 'fridge-vent' })),
            ZONES.map(zoneEl)),
          doorEl()),
        h('div', { class: 'fridge-feet' }, h('i'), h('i'))),
      h('aside', { class: 'side-panel', id: 'fridge-panel', 'aria-label': 'Details' })),
    demoPanel(),
  );
  fillShelves();

  if (isWide()) {
    panel ??= { kind: 'zone', zone: 'chilled' };
    drawPanel();
  }
}

// ---------------------------------------------------------------- bin chicken

let shownMood = null;   // mood last drawn, to spot changes
let moodAnim = null;    // { cls, until }: survives the redraws that follow a change
let bubbleTimer;

// What the bird on the fridge shows: always its standing mood, which comes from the
// server. It hops or shakes only at the moment that standing mood changes.
// Reactions to a single item are shown separately (see showReaction).
function mascotPose() {
  const mood = state.mascot.mood;
  if (shownMood && shownMood !== mood) {
    moodAnim = { cls: MOOD_RANK[mood] > MOOD_RANK[shownMood] ? 'hop' : 'shake', until: Date.now() + MOOD_CHANGE_MS };
  }
  shownMood = mood;
  const idle = mood === 'superhappy' ? 'dance' : '';
  if (moodAnim && Date.now() < moodAnim.until) {
    const anim = moodAnim;
    setTimeout(() => {
      if (moodAnim !== anim) return; // a newer change has taken over
      moodAnim = null;
      root.querySelector('.mascot .mascot-img, .mascot .mascot-missing')?.classList.replace(anim.cls, idle || 'still');
    }, anim.until - Date.now());
    return { mood, cls: anim.cls };
  }
  return { mood, cls: idle };
}

// One-off reaction to a single item being eaten or thrown away: its own little card with
// the happy or angry bird and one line. It goes away by itself; a tap closes it sooner.
let reactionTimer;
function showReaction(reaction) {
  document.querySelector('.reaction-card')?.remove();
  clearTimeout(reactionTimer);
  const card = h('div', { class: 'reaction-card', role: 'status', onclick: () => card.remove() },
    mascotImg(reaction.mood, reaction.mood === 'happy' ? 'hop' : 'shake'),
    h('p', null, reaction.message));
  document.body.append(card);
  reactionTimer = setTimeout(() => {
    card.classList.add('leaving');
    setTimeout(() => card.remove(), 200);
  }, REACTION_MS);
}

function mascotImg(mood, className = '') {
  const img = h('img', {
    class: `mascot-img ${className}`.trim(), alt: `Bin chicken, ${MOOD_LABEL[mood]}`, draggable: 'false',
    src: `/static/img/bin-chicken/bin-chicken-${MOOD_IMAGE[mood]}.png`,
    // Until the artwork is added, show a labelled stand-in rather than a broken image.
    onerror: () => img.replaceWith(h('span', { class: `mascot-missing ${className}`.trim() }, 'bin chicken', h('strong', null, mood))),
  });
  return img;
}

function mascotEl() {
  const pose = mascotPose();
  const bubble = h('p', { class: 'bubble', role: 'status', hidden: true });
  return h('div', { class: 'perch' },
    bubble,
    h('button', {
      class: 'mascot', type: 'button', 'aria-label': `Bin chicken is ${MOOD_LABEL[state.mascot.mood]}. Tap to hear why`,
      onclick: () => {
        clearTimeout(bubbleTimer);
        bubble.hidden = !bubble.hidden;
        bubble.textContent = state.mascot.message;
        if (!bubble.hidden) bubbleTimer = setTimeout(() => { bubble.hidden = true; }, 7000);
      },
    }, mascotImg(pose.mood, pose.cls)));
}

// Presentation helper, only with ?demo=1 in the address.
function demoPanel() {
  if (!DEMO) return null;
  return h('div', { class: 'demo-panel' },
    h('strong', null, 'Demo'),
    Object.keys(MOOD_RANK).reverse().map((mood) =>
      h('button', { type: 'button', class: state.mascot.mood === mood ? 'on' : '',
        onclick: async () => { await api.post('/demo/mood', { mood }); await load(); drawFridge(); } }, MOOD_LABEL[mood])),
    h('button', { type: 'button', class: 'reset',
      onclick: async () => { await api.post('/demo/reset'); toast('Seed data reloaded'); await renderFridge(); } }, 'Reset data'));
}

function zoneEl(zone) {
  const count = state.fridge.filter((i) => i.zone === zone).length;
  return h('section', {
    class: `zone zone-${zone}` + (isWide() && panel?.kind === 'zone' && panel.zone === zone ? ' selected' : ''),
    'data-zone': zone,
    onclick: (e) => { if (!e.target.closest('button')) show({ kind: 'zone', zone }); },
  },
    h('button', { class: 'zone-tab', type: 'button', onclick: () => show({ kind: 'zone', zone }) },
      ZONE_LABEL[zone], h('span', { class: 'zone-count' }, count), icon('chevron')),
    h('div', { class: 'shelves' }));
}

// The open door, seen edge-on at the fridge's right side.
function doorEl() {
  const el = h('div', { class: 'fridge-door', 'aria-hidden': 'true' });
  el.innerHTML =
    '<svg viewBox="0 0 30 100" preserveAspectRatio="none">' +
    '<polygon points="1,2.500 29,0.400 29,99.600 1,97.500" fill="var(--cream)"/>' +
    '<polygon points="1,36 29,35 29,41 1,41.500" fill="var(--wheat)"/>' +
    '<polygon points="1,66 29,66 29,72.500 1,72" fill="var(--mint)"/>' +
    '<rect x="19" y="46" width="5" height="14" rx="2.500" fill="var(--ink)" stroke="none"/>' +
    '<polygon points="1,2.500 29,0.400 29,99.600 1,97.500" fill="none"/>' +
    '</svg>';
  return el;
}

function fabEl() {
  const n = state.pending.length;
  return h('button', {
    class: 'fab', type: 'button', onclick: () => openAdd(),
    'aria-label': n ? `Add item. ${n} bought ${n === 1 ? 'item' : 'items'} waiting to be stored` : 'Add item',
  }, icon('plus'), h('span', { class: 'fab-label' }, 'Add food'), n ? h('span', { class: 'badge' }, n) : null);
}

// Lay food chips out on shelves; whatever doesn't fit collapses into a "+N" chip.
function fillShelves() {
  for (const zoneNode of root.querySelectorAll('.zone')) {
    const zone = zoneNode.dataset.zone;
    const shelves = zoneNode.querySelector('.shelves');
    const items = state.fridge.filter((i) => i.zone === zone); // already sorted soonest-first
    const cols = Math.max(2, Math.floor((shelves.clientWidth - 8 + CHIP_GAP) / (CHIP_MIN + CHIP_GAP)));
    const capacity = cols * ROWS[zone];

    const chips = items.slice(0, items.length > capacity ? capacity - 1 : capacity).map(chipEl);
    if (items.length > capacity) {
      const more = items.length - chips.length;
      chips.push(h('button', {
        class: 'food more', type: 'button', 'aria-label': `${more} more in ${ZONE_LABEL[zone]}`,
        onclick: () => show({ kind: 'zone', zone }),
      }, h('strong', null, `+${more}`), h('span', { class: 'food-name' }, 'more')));
    }

    shelves.style.setProperty('--cols', cols);
    shelves.replaceChildren();
    for (let r = 0; r < ROWS[zone]; r++) {
      const row = chips.slice(r * cols, (r + 1) * cols);
      shelves.append(h('div', { class: 'shelf' },
        row.length || r > 0 || items.length ? row : h('p', { class: 'shelf-empty' }, 'Nothing here yet')));
    }
  }
}

function chipEl(item) {
  return h('button', {
    class: `food ${item.status}`, type: 'button',
    'aria-label': `${item.name}${qtyText(item)}, ${daysLong(item)}`,
    onclick: () => show({ kind: 'item', id: item.id }),
  },
    statusTag(item),
    catIcon(item.category),
    h('span', { class: 'food-days' }, daysLabel(item)),
    h('span', { class: 'food-name' }, item.name, item.quantity > 1 ? h('small', null, qtyText(item)) : null));
}

// ---------------------------------------------------------------- panel / sheet

const findItem = (id) => state.fridge.find((i) => i.id === id);

function panelTitle(p) {
  return p.kind === 'zone' ? ZONE_LABEL[p.zone] : findItem(p.id)?.name || 'Item';
}

function panelContent(p) {
  return p.kind === 'zone' ? zoneList(p.zone) : itemDetail(findItem(p.id));
}

function show(p) {
  panel = p;
  if (isWide()) {
    root.querySelectorAll('.zone').forEach((z) =>
      z.classList.toggle('selected', p.kind === 'zone' && z.dataset.zone === p.zone));
    drawPanel();
  } else {
    openSheet(panelContent(p), { title: panelTitle(p), onClose: () => { panel = null; } });
  }
}

function drawPanel() {
  const el = document.getElementById('fridge-panel');
  if (panel.kind === 'item' && !findItem(panel.id)) panel = { kind: 'zone', zone: panel.from || 'chilled' };
  const backTo = panel.kind === 'item' ? panel.from || findItem(panel.id).zone : null;
  setChildren(el,
    h('header', { class: 'panel-head' },
      backTo && h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Back to ${ZONE_LABEL[backTo]}`,
        onclick: () => show({ kind: 'zone', zone: backTo }) }, icon('back')),
      h('h2', null, panelTitle(panel))),
    panelContent(panel));
}

// Reload after a change and keep the panel or sheet in step with the data.
async function refresh() {
  await load();
  drawFridge();
  if (isWide() || !sheetIsOpen() || !panel) return;
  if (panel.kind === 'zone') show(panel);
  else if (panel.from) show({ kind: 'zone', zone: panel.from });
  else closeSheet();
}

// Eaten / thrown away: recorded in the history log, which drives the bin chicken's mood.
async function removeItem(item, action) {
  const { reaction } = await api.post(`/fridge/${item.id}/resolve`, { action });
  showReaction(reaction);
  await refresh();
}

// Plain delete (added by mistake): not recorded, so it never counts as waste.
async function deleteItem(item) {
  await api.del(`/fridge/${item.id}`);
  toast(`${item.name} deleted`);
  await refresh();
}

function zoneList(zone) {
  const items = state.fridge.filter((i) => i.zone === zone);
  if (!items.length) return h('p', { class: 'empty' }, `Nothing in ${ZONE_LABEL[zone]} yet. Use the + button to add food.`);
  return h('ul', { class: 'rows' }, items.map((i) =>
    h('li', { class: `row ${i.status}` },
      h('button', { class: 'row-main', type: 'button', onclick: () => show({ kind: 'item', id: i.id, from: zone }) },
        catIcon(i.category),
        h('span', { class: 'row-text' }, h('strong', null, i.name, qtyText(i)), h('small', null, daysLong(i))),
        statusTag(i)),
      h('button', { class: 'icon-btn', type: 'button', title: 'Eaten', 'aria-label': `Mark ${i.name} as eaten`,
        onclick: () => removeItem(i, 'eaten') }, icon('check')),
      h('button', { class: 'icon-btn', type: 'button', title: 'Thrown away', 'aria-label': `Throw away ${i.name}`,
        onclick: () => removeItem(i, 'thrown') }, icon('trash')))));
}

function itemDetail(item) {
  return h('div', { class: 'detail' },
    h('div', { class: `detail-top ${item.status}` },
      catIcon(item.category),
      h('p', null, h('strong', null, daysLong(item)), h('small', null, `${ZONE_LABEL[item.zone]} · use by ${fmtDate(item.expiry)}`)),
      statusTag(item)),
    h('div', { class: 'detail-actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => removeItem(item, 'eaten') }, icon('check'), 'Eaten'),
      h('button', { class: 'btn danger', type: 'button', onclick: () => removeItem(item, 'thrown') }, icon('trash'), 'Thrown away')),
    h('p', { class: 'sub detail-delete' }, 'Added by mistake? ',
      h('button', { class: 'link', type: 'button', onclick: () => deleteItem(item) }, 'Delete it'),
      ' (doesn\'t count as waste)'),
    h('h3', { class: 'detail-edit' }, 'Edit'),
    itemForm({
      initial: item, lockDefaults: true, submitLabel: 'Save changes',
      onSubmit: async (data) => {
        await api.put(`/fridge/${item.id}`, data);
        toast('Saved');
        await refresh();
      },
    }));
}

// ---------------------------------------------------------------- add / edit form

function itemForm({ initial = {}, lockDefaults = false, submitLabel, onSubmit }) {
  const f = {
    name: initial.name || '',
    zone: initial.zone || 'chilled',
    expiry: initial.expiry || null,
    quantity: initial.quantity || 1,
  };
  // Dictionary defaults fill in zone and expiry until the user sets them by hand.
  const touched = { zone: lockDefaults, expiry: lockDefaults };

  const zoneBox = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Where does it go?' });
  const quickBox = h('div', { class: 'picks' });
  const useBy = h('p', { class: 'use-by' });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const dateInput = h('input', { class: 'input date-input', type: 'date', 'aria-label': 'Exact expiry date', hidden: true });
  const submit = h('button', { class: 'btn primary wide', type: 'submit' }, submitLabel);

  const setExpiry = (value) => {
    f.expiry = value || null;
    touched.expiry = true;
    paint();
  };
  const openPicker = () => {
    dateInput.hidden = false;
    dateInput.focus();
    try { dateInput.showPicker(); } catch { /* the visible input still works */ }
  };

  function paint() {
    zoneBox.replaceChildren(...ZONES.map((z) =>
      h('button', {
        class: `seg-btn zone-${z}` + (f.zone === z ? ' on' : ''), type: 'button',
        role: 'radio', 'aria-checked': String(f.zone === z),
        onclick: () => { f.zone = z; touched.zone = true; paint(); },
      }, f.zone === z && icon('check'), ZONE_LABEL[z])));

    const isQuick = QUICK.some(([n]) => addDays(n) === f.expiry);
    quickBox.replaceChildren(
      ...QUICK.map(([n, label]) => {
        const on = f.expiry === addDays(n);
        return h('button', { class: 'pick' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on),
          onclick: () => setExpiry(addDays(n)) }, label);
      }),
      h('button', { class: 'pick' + (f.expiry && !isQuick ? ' on' : ''), type: 'button', onclick: openPicker },
        icon('calendar'), 'Pick a date'));
    dateInput.value = f.expiry || '';
    useBy.replaceChildren(...(f.expiry ? ['Use by ', h('strong', null, fmtDate(f.expiry))] : ['Choose when it expires']));
  }

  const applyDefaults = (entry) => {
    if (!entry) return;
    if (!touched.zone) f.zone = entry.zone;
    if (!touched.expiry) f.expiry = addDays(closestQuick(entry.shelf_life));
    paint();
  };

  const name = nameInput({ value: f.name, placeholder: 'e.g. Broccoli', onPick: applyDefaults });
  // Typed but not picked from the menu ("tomatoes"): ask the server for a dictionary match.
  name.input.addEventListener('change', async () => {
    const typed = name.input.value.trim();
    if (typed) applyDefaults(await api.get(`/ingredients/match?name=${encodeURIComponent(typed)}`));
  });
  dateInput.addEventListener('change', () => setExpiry(dateInput.value));

  paint();
  return h('form', {
    class: 'form', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      f.name = name.input.value.trim();
      error.textContent = !f.name ? 'Give it a name.' : !f.expiry ? 'Choose when it expires.' : '';
      if (error.textContent) return;
      submit.disabled = true;
      try {
        await onSubmit({ ...f });
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
      }
    },
  },
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Name'), name.el),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Where does it go?'), zoneBox),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Expires in'), quickBox, dateInput, useBy),
    h('div', { class: 'field inline' },
      h('span', { class: 'label' }, 'Quantity ', h('small', null, '(optional)')),
      stepper(f.quantity, (v) => { f.quantity = v; })),
    error,
    submit);
}

// ---------------------------------------------------------------- add panel

// The panel stays open after each item, so several can be added in a row.
// Only the close button (or Done) closes it.
function openAdd() {
  const body = h('div', { class: 'add-panel' });
  const added = []; // names saved since the panel opened

  // `from` is the bought list item being stored, or null for a brand-new item.
  const mount = (from) => {
    setChildren(body,
      added.length ? h('p', { class: 'added-banner', role: 'status' }, icon('check'),
        added.length === 1 ? `${added[0]} is in the fridge` : `Added: ${added.join(', ')}`) : null,
      state.pending.length ? h('section', { class: 'pending' },
        h('h3', null, h('span', { class: 'dot' }), 'Bought, not stored yet'),
        h('p', { class: 'sub' }, 'Tap one to fill in the form.'),
        h('div', { class: 'picks' }, state.pending.map((li) =>
          h('button', { class: 'pick' + (from?.id === li.id ? ' on' : ''), type: 'button',
            'aria-pressed': String(from?.id === li.id), onclick: () => mount(li) },
            catIcon(li.category), li.name, qtyText(li))))) : null,
      itemForm({
        initial: from ? {
          name: from.name,
          zone: from.default_zone,
          expiry: from.default_shelf_life ? addDays(closestQuick(from.default_shelf_life)) : null,
          quantity: from.quantity,
        } : {},
        submitLabel: 'Put in fridge',
        onSubmit: async (data) => {
          await api.post('/fridge', { ...data, from_list_id: from?.id });
          added.push(data.name);
          await load();
          drawFridge();
          mount(null);
          // Ready for the next item. Skip on touch screens, where focus pops up the keyboard.
          if (window.matchMedia('(pointer: fine)').matches) body.querySelector('.ac input')?.focus();
        },
      }),
      h('button', { class: 'btn wide add-done', type: 'button', onclick: closeSheet }, 'Done'));
  };

  mount(null);
  panel = null;
  openSheet(body, { title: 'Add to fridge' });
}

// ---------------------------------------------------------------- expired item check
// Asks what happened to each item past its date, one at a time.

async function openExpiredCheck() {
  const queue = await api.get('/fridge/expired-check');
  // The user may have moved to another page while this loaded.
  if (!queue.length || (location.hash.slice(1) || 'fridge') !== 'fridge') return;

  let index = 0;
  const body = h('div', { class: 'check' });
  const progress = () => (queue.length > 1 ? h('p', { class: 'check-progress' }, `${index + 1} of ${queue.length}`) : null);
  const next = () => {
    index += 1;
    if (index < queue.length) ask();
    else closeSheet();
  };
  const send = async (item, payload) => {
    const result = await api.post(`/fridge/${item.id}/resolve`, payload);
    await load();
    drawFridge();
    return result;
  };

  function ask() {
    const item = queue[index];
    const canKeep = item.keep_options.length > 0;
    setChildren(body,
      progress(),
      h('div', { class: 'check-top' },
        mascotImg(state.mascot.mood, 'small'),
        h('p', null, h('strong', null, item.name, qtyText(item)), h('span', null, `passed its date ${-item.days_left} ${item.days_left === -1 ? 'day' : 'days'} ago`))),
      h('p', { class: 'label' }, 'What happened to it?'),
      h('div', { class: 'check-actions' },
        h('button', { class: 'btn primary wide', type: 'button', onclick: () => finish(item, 'eaten') }, icon('check'), 'Ate it / used it up'),
        h('button', { class: 'btn danger wide', type: 'button', onclick: () => finish(item, 'thrown') }, icon('trash'), 'Threw it away'),
        canKeep
          ? h('button', { class: 'btn wide', type: 'button', onclick: () => keepStep(item) }, icon('calendar'), 'Still good, keep it')
          : h('p', { class: 'sub' }, 'It has been kept 7 days past its date, so it can\'t be kept any longer.')),
      h('button', { class: 'link', type: 'button', onclick: closeSheet }, 'Ask me later'));
  }

  async function finish(item, action) {
    // The pop-up shows the reaction to this one item (always happy for eaten, angry for
    // thrown away). The bird on the fridge keeps its standing mood.
    const { reaction } = await send(item, { action });
    setChildren(body,
      progress(),
      h('div', { class: 'check-result' },
        mascotImg(reaction.mood, action === 'eaten' ? 'hop' : 'shake'),
        h('p', { class: 'bubble static', role: 'status' }, reaction.message)),
      h('button', { class: 'btn primary wide', type: 'button', onclick: next }, index + 1 < queue.length ? 'Next item' : 'Done'));
  }

  function keepStep(item) {
    // High-risk food defaults to the shortest wait.
    let days = item.high_risk ? item.keep_options[0] : item.keep_options[Math.min(1, item.keep_options.length - 1)];
    const picks = h('div', { class: 'picks', role: 'radiogroup', 'aria-label': 'Ask me again in' });
    const paint = () => picks.replaceChildren(...item.keep_options.map((d) =>
      h('button', { class: 'pick' + (d === days ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(d === days),
        onclick: () => { days = d; paint(); } }, `${d} ${d === 1 ? 'day' : 'days'}`)));
    paint();
    setChildren(body,
      progress(),
      h('p', null, h('strong', null, item.name), ' stays in the fridge with a PAST DATE tag.'),
      h('p', { class: 'label' }, 'Ask me again in…'),
      picks,
      item.high_risk ? h('p', { class: 'hint' }, 'Use-by foods aren\'t safe to eat after the date, even if they look fine.') : null,
      h('div', { class: 'detail-actions' },
        h('button', { class: 'btn', type: 'button', onclick: ask }, icon('back'), 'Back'),
        h('button', { class: 'btn primary', type: 'button',
          onclick: async () => { await send(item, { action: 'keep', days }); toast(`OK, I'll ask about the ${item.name.toLowerCase()} again`); next(); } }, 'Keep it')));
  }

  ask();
  panel = null;
  openSheet(body, { title: 'Past its date' });
}
