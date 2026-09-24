/*
  Simple Todo app
  - Add, complete, delete
  - Filter: all / active / completed
  - Edit: double-click item or Edit button
  - Multi-line task + subtask text (Shift+Enter for a new line)
  - Persists to localStorage
  - Drag & drop reorder (when filter = all)
  - Per-task progress (0-100) via slider or typed value
*/

const STORAGE_KEY = 'todo_app_items_v1';
const TASK_TEXT_MAX_LENGTH = 1000;
const SUBTASK_TEXT_MAX_LENGTH = 1000;
const TEXTAREA_MAX_HEIGHT = 360;
const CELEBRATION_MS = 1100;

/** @type {{id:string, text:string, completed:boolean, createdAt:number, progress:number, subtasks:{id:string,text:string,completed:boolean}[]}[]} */
let todos = load();

let currentFilter = 'all';

const els = {
  form: document.querySelector('#todo-form'),
  input: document.querySelector('#todo-input'),
  list: document.querySelector('#todo-list'),
  tpl: document.querySelector('#todo-item-template'),
  count: document.querySelector('#count'),
  empty: document.querySelector('#empty'),
  clearCompleted: document.querySelector('#clear-completed'),
  toggleAll: document.querySelector('#toggle-all'),
  filterButtons: Array.from(document.querySelectorAll('[data-filter]')),
  statTotal: document.querySelector('#stat-total'),
  statActive: document.querySelector('#stat-active'),
  statCompleted: document.querySelector('#stat-completed'),
  statOverall: document.querySelector('#stat-overall'),
  overallOrb: document.querySelector('#overall-orb'),
  overallOrbRing: document.querySelector('#overall-orb-ring'),
  overallOrbValue: document.querySelector('#overall-orb-value'),
  momentumNote: document.querySelector('#momentum-note'),
};

els.input.maxLength = TASK_TEXT_MAX_LENGTH;
setupAutoGrow(els.input);
submitOnEnter(els.input, () => addTodoFromComposer());

// Drag state
let draggingId = null;
let dragOverId = null;
// Subtask drag state
let subDraggingId = null;
let subDraggingParent = null;
let subDragOverId = null;

// Ids currently playing a completion flourish
const celebrating = new Set();
let lastOverall = null;

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  addTodoFromComposer();
});

function addTodoFromComposer() {
  const text = normalizeText(els.input.value);
  if (!text) return;

  todos.unshift({
    id: cryptoRandomId(),
    text,
    completed: false,
    createdAt: Date.now(),
    progress: 0,
    subtasks: [],
  });

  els.input.value = '';
  autoGrow(els.input);
  persist();
  render();
}

els.clearCompleted.addEventListener('click', () => {
  const before = todos.length;
  todos = todos.filter(t => !t.completed);
  if (todos.length !== before) {
    persist();
    render();
  }
});

els.toggleAll.addEventListener('click', () => {
  if (todos.length === 0) return;

  const anyActive = todos.some(t => !t.completed);
  const nextCompleted = anyActive;

  todos = todos.map(t => {
    const next = { ...t, completed: nextCompleted };
    if (nextCompleted) {
      next.progress = 100;
      if (!t.completed) celebrate(t.id);
    } else {
      if (next.progress === 100) next.progress = 0;
    }
    return next;
  });

  persist();
  render();
});

els.filterButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    currentFilter = btn.dataset.filter || 'all';
    els.filterButtons.forEach(b => {
      const active = (b.dataset.filter === currentFilter);
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    render();
  });
});

els.list.addEventListener('dragover', (e) => {
  if (!isReorderEnabled()) return;
  e.preventDefault();

  const li = e.target && e.target.closest ? e.target.closest('li.item') : null;
  if (!li || !li.dataset.id) return;
  const overId = li.dataset.id;
  if (overId === draggingId) return;

  dragOverId = overId;

  Array.from(els.list.querySelectorAll('li.item.drag-over')).forEach(n => n.classList.remove('drag-over'));
  li.classList.add('drag-over');
});

els.list.addEventListener('drop', (e) => {
  if (!isReorderEnabled()) return;
  e.preventDefault();

  const li = e.target && e.target.closest ? e.target.closest('li.item') : null;
  if (!li || !li.dataset.id) return;

  const dropId = li.dataset.id;
  if (!draggingId || draggingId === dropId) return;

  reorderTodos(draggingId, dropId);

  draggingId = null;
  dragOverId = null;

  persist();
  render();
});

els.list.addEventListener('dragleave', (e) => {
  if (!isReorderEnabled()) return;
  const related = e.relatedTarget;
  if (!related || (related !== els.list && !els.list.contains(related))) {
    Array.from(els.list.querySelectorAll('li.item.drag-over')).forEach(n => n.classList.remove('drag-over'));
    dragOverId = null;
  }
});

els.list.addEventListener('dragend', () => {
  Array.from(els.list.querySelectorAll('li.item.drag-over')).forEach(n => n.classList.remove('drag-over'));
  Array.from(els.list.querySelectorAll('li.item.dragging')).forEach(n => n.classList.remove('dragging'));
  draggingId = null;
  dragOverId = null;
});

// The progress controls switch an item's draggable off while they are in use;
// one pair of listeners restores it for the whole list once the gesture ends.
function restoreDraggable() {
  if (!isReorderEnabled()) return;
  Array.from(els.list.querySelectorAll('li.item')).forEach(li => {
    if (li.classList.contains('editing')) return;
    if (li.contains(document.activeElement)) return;
    li.draggable = true;
  });
}

window.addEventListener('mouseup', restoreDraggable);
window.addEventListener('touchend', restoreDraggable);

function render() {
  const visible = getVisibleTodos();
  els.list.innerHTML = '';

  for (const todo of visible) {
    const node = createTodoNode(todo);
    els.list.appendChild(node);
  }

  // Size every textarea now that the nodes are laid out and measurable.
  Array.from(els.list.querySelectorAll('textarea.autogrow')).forEach(autoGrow);

  const activeCount = todos.filter(t => !t.completed).length;
  els.count.textContent = `${activeCount} item${activeCount === 1 ? '' : 's'} left`;
  updateDashboard(activeCount);

  els.empty.style.display = (visible.length === 0) ? 'block' : 'none';
}

function updateDashboard(activeCount) {
  const total = todos.length;
  const completed = todos.filter(t => t.completed).length;
  const overall = total === 0
    ? 0
    : clampProgress(todos.reduce((sum, t) => sum + clampProgress(t.progress), 0) / total);

  animateStat(els.statTotal, total);
  animateStat(els.statActive, activeCount);
  animateStat(els.statCompleted, completed);
  animateStat(els.statOverall, overall, '%');

  if (els.overallOrb) {
    els.overallOrb.classList.toggle('is-empty', overall === 0);
    els.overallOrb.classList.toggle('is-complete', total > 0 && overall === 100);

    if (lastOverall !== null && overall > lastOverall) {
      els.overallOrb.classList.remove('is-pulsing');
      void els.overallOrb.offsetWidth;
      els.overallOrb.classList.add('is-pulsing');
    }
  }

  if (els.overallOrbRing) els.overallOrbRing.style.strokeDasharray = `${overall} 100`;
  if (els.overallOrbValue) els.overallOrbValue.textContent = `${overall}%`;
  if (els.momentumNote) els.momentumNote.textContent = getMomentumNote(total, overall);

  lastOverall = overall;
}

function getMomentumNote(total, overall) {
  if (total === 0) return 'Add your first task to get rolling.';
  if (overall === 0) return 'Start anywhere. The first step is the whole trick.';
  if (overall < 25) return 'Momentum is building. Keep it moving.';
  if (overall < 50) return 'Good pace. A quarter of the way is real progress.';
  if (overall < 75) return 'Past halfway. The hard part is behind you.';
  if (overall < 100) return 'So close. Finish strong.';
  return 'All clear. Beautiful work.';
}

function createTodoNode(todo) {
  const frag = els.tpl.content.cloneNode(true);
  const li = frag.querySelector('li.item');

  const toggle = frag.querySelector('input.toggle');
  const text = frag.querySelector('.text');
  const editInput = frag.querySelector('textarea.edit');
  const editBtn = frag.querySelector('[data-action=edit]');
  const delBtn = frag.querySelector('[data-action=delete]');

  const progressValueEl = frag.querySelector('.progress-number');
  const progressFillEl = frag.querySelector('.progress-fill');
  const progressInputEl = frag.querySelector('.progress-input');

  li.dataset.id = todo.id;
  li.classList.toggle('completed', todo.completed);
  if (celebrating.has(todo.id)) {
    li.classList.add('is-celebrating');
    setTimeout(() => li.classList.remove('is-celebrating'), CELEBRATION_MS);
  }

  if (isReorderEnabled()) {
    li.draggable = true;
    li.setAttribute('aria-grabbed', 'false');
  } else {
    li.draggable = false;
    li.removeAttribute('aria-grabbed');
  }

  toggle.checked = todo.completed;
  text.textContent = todo.text;
  editInput.value = todo.text;
  editInput.maxLength = TASK_TEXT_MAX_LENGTH;
  setupAutoGrow(editInput);

  const initialProgress = clampProgress(todo.progress);
  progressInputEl.value = String(initialProgress);
  setProgressUI(li, progressValueEl, progressFillEl, initialProgress);

  toggle.addEventListener('change', () => {
    const checked = toggle.checked;
    // When parent is toggled, propagate to subtasks
    const prev = getTodo(todo.id) || {};
    const nextSubtasks = Array.isArray(prev.subtasks) ? prev.subtasks.map(s => ({ ...s, completed: checked })) : [];
    const next = { completed: checked, subtasks: nextSubtasks };
    if (checked) {
      next.progress = 100;
      celebrate(todo.id);
    } else if (clampProgress(prev.progress ?? 0) === 100) {
      next.progress = 0;
    }

    updateTodo(todo.id, next);
  });

  // --- Keep drag-to-reorder from fighting the progress controls ---
  const disableDrag = () => { li.draggable = false; };
  const enableDrag = () => {
    if (isReorderEnabled() && !li.classList.contains('editing') && document.activeElement !== progressValueEl) {
      li.draggable = true;
    }
  };

  progressInputEl.addEventListener('mousedown', disableDrag);
  progressInputEl.addEventListener('touchstart', disableDrag, { passive: true });
  progressValueEl.addEventListener('mousedown', disableDrag);

  progressInputEl.addEventListener('input', () => {
    const v = clampProgress(Number(progressInputEl.value));
    setProgressUI(li, progressValueEl, progressFillEl, v);
  });

  progressInputEl.addEventListener('change', () => {
    commitProgress(todo.id, clampProgress(Number(progressInputEl.value)));
  });

  // --- Typed progress value (accepts 0 to 100) ---
  progressValueEl.addEventListener('focus', () => {
    disableDrag();
    progressValueEl.select();
  });

  progressValueEl.addEventListener('input', () => {
    const digits = progressValueEl.value.replace(/[^0-9]/g, '').slice(0, 3);
    const capped = (digits !== '' && Number(digits) > 100) ? '100' : digits;
    if (capped !== progressValueEl.value) progressValueEl.value = capped;
    if (capped === '') return;

    const v = clampProgress(Number(capped));
    progressInputEl.value = String(v);
    setProgressFillUI(li, progressFillEl, v);
  });

  progressValueEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      progressValueEl.blur();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      const stored = clampProgress(getTodo(todo.id)?.progress ?? 0);
      progressValueEl.value = String(stored);
      progressInputEl.value = String(stored);
      setProgressFillUI(li, progressFillEl, stored);
      progressValueEl.blur();
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
      const v = clampProgress(Number(progressValueEl.value || 0) + step);
      progressValueEl.value = String(v);
      progressInputEl.value = String(v);
      setProgressFillUI(li, progressFillEl, v);
    }
  });

  progressValueEl.addEventListener('blur', () => {
    const stored = clampProgress(getTodo(todo.id)?.progress ?? 0);

    if (progressValueEl.value === '') {
      progressValueEl.value = String(stored);
      progressInputEl.value = String(stored);
      setProgressFillUI(li, progressFillEl, stored);
      enableDrag();
      return;
    }

    const next = clampProgress(Number(progressValueEl.value));
    enableDrag();
    if (next !== stored) commitProgress(todo.id, next);
  });

  delBtn.addEventListener('click', () => {
    todos = todos.filter(t => t.id !== todo.id);
    persist();
    render();
  });

  // --- Subtasks UI and behavior ---
  const subtasksList = frag.querySelector('.subtasks-list');
  const subtaskForm = frag.querySelector('.subtask-form');
  const subtaskInput = frag.querySelector('.subtask-input');
  const subtaskCount = frag.querySelector('.subtasks-count');
  const subtasksRow = frag.querySelector('.subtasks-row');
  subtaskInput.maxLength = SUBTASK_TEXT_MAX_LENGTH;
  setupAutoGrow(subtaskInput);
  submitOnEnter(subtaskInput, () => addSubtask());

  function renderSubtasks() {
    subtasksList.innerHTML = '';
    const src = getTodo(todo.id)?.subtasks || [];

    const done = src.filter(s => s.completed).length;
    subtaskCount.textContent = `${done} / ${src.length}`;
    subtasksRow.classList.toggle('is-empty', src.length === 0);
    subtasksRow.classList.toggle('all-done', src.length > 0 && done === src.length);
    subtasksRow.style.setProperty('--subtask-progress', src.length ? `${Math.round((done / src.length) * 100)}%` : '0%');

    for (const s of src) {
      const li = document.createElement('li');
      li.className = 'subtask-item' + (s.completed ? ' completed' : '');
      li.dataset.id = s.id;
      li.draggable = true;

      const left = document.createElement('div');
      left.className = 'subtask-left';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'subtask-toggle';
      cb.checked = Boolean(s.completed);

      const span = document.createElement('span');
      span.className = 'subtask-text';
      span.textContent = s.text;

      left.appendChild(cb);
      left.appendChild(span);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn icon';
      editBtn.textContent = 'Edit';

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn icon danger';
      del.textContent = 'Delete';

      li.appendChild(left);
      const actions = document.createElement('div');
      actions.className = 'subtask-actions';
      actions.appendChild(editBtn);
      actions.appendChild(del);
      li.appendChild(actions);

      // drag start / end for subtask
      li.addEventListener('dragstart', (e) => {
        subDraggingId = s.id;
        subDraggingParent = todo.id;
        li.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', s.id); } catch {}
        e.dataTransfer.effectAllowed = 'move';
      });

      li.addEventListener('dragend', () => {
        subDraggingId = null;
        subDraggingParent = null;
        subDragOverId = null;
        li.classList.remove('dragging');
        Array.from(subtasksList.querySelectorAll('.subtask-item.drag-over')).forEach(n => n.classList.remove('drag-over'));
      });

      cb.addEventListener('change', () => {
        const checked = cb.checked;
        todos = todos.map(t => {
          if (t.id !== todo.id) return t;
          const nextSubs = (t.subtasks || []).map(ss => ss.id === s.id ? { ...ss, completed: checked } : ss);
          return { ...t, subtasks: nextSubs };
        });
        persist();
        render();
      });

      del.addEventListener('click', () => {
        todos = todos.map(t => {
          if (t.id !== todo.id) return t;
          const nextSubs = (t.subtasks || []).filter(ss => ss.id !== s.id);
          return { ...t, subtasks: nextSubs };
        });
        persist();
        render();
      });

      // edit subtask (double-click text or Edit button)
      const startEditSubtask = () => {
        if (left.querySelector('textarea.subtask-edit')) return;
        li.draggable = false;
        li.classList.add('editing');

        const input = document.createElement('textarea');
        input.rows = 1;
        input.className = 'subtask-edit autogrow';
        input.maxLength = SUBTASK_TEXT_MAX_LENGTH;
        input.value = s.text;
        left.replaceChild(input, span);
        setupAutoGrow(input);
        autoGrow(input);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);

        let settled = false;

        const cancel = () => {
          if (settled) return;
          settled = true;
          left.replaceChild(span, input);
          li.classList.remove('editing');
          if (isReorderEnabled()) li.draggable = true;
        };

        const commit = () => {
          if (settled) return;
          settled = true;

          const val = normalizeText(input.value);
          if (!val) {
            // an emptied subtask is removed
            todos = todos.map(t => {
              if (t.id !== todo.id) return t;
              return { ...t, subtasks: (t.subtasks || []).filter(ss => ss.id !== s.id) };
            });
          } else {
            todos = todos.map(t => {
              if (t.id !== todo.id) return t;
              return { ...t, subtasks: (t.subtasks || []).map(ss => ss.id === s.id ? { ...ss, text: val } : ss) };
            });
          }
          persist();
          render();
        };

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        });

        input.addEventListener('blur', () => commit());
        // prevent dragging while interacting with the input
        input.addEventListener('mousedown', (e) => e.stopPropagation());
      };

      span.addEventListener('dblclick', startEditSubtask);
      editBtn.addEventListener('click', startEditSubtask);

      subtasksList.appendChild(li);
    }
  }

  // subtasks list dragover and drop to reorder within same todo
  subtasksList.addEventListener('dragover', (e) => {
    e.preventDefault();
    const li = e.target && e.target.closest ? e.target.closest('li.subtask-item') : null;
    if (!li || !li.dataset.id) return;
    const overId = li.dataset.id;
    if (subDraggingParent !== todo.id) return;
    if (overId === subDraggingId) return;

    subDragOverId = overId;
    Array.from(subtasksList.querySelectorAll('li.subtask-item.drag-over')).forEach(n => n.classList.remove('drag-over'));
    li.classList.add('drag-over');
  });

  subtasksList.addEventListener('drop', (e) => {
    e.preventDefault();
    const li = e.target && e.target.closest ? e.target.closest('li.subtask-item') : null;
    if (!li || !li.dataset.id) return;
    const dropId = li.dataset.id;
    if (!subDraggingId || subDraggingParent !== todo.id || subDraggingId === dropId) return;

    todos = todos.map(t => {
      if (t.id !== todo.id) return t;
      const arr = (t.subtasks || []).slice();
      const from = arr.findIndex(x => x.id === subDraggingId);
      const to = arr.findIndex(x => x.id === dropId);
      if (from < 0 || to < 0) return t;
      const next = arr.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...t, subtasks: next };
    });

    subDraggingId = null;
    subDraggingParent = null;
    subDragOverId = null;
    persist();
    render();
  });

  function addSubtask() {
    const txt = normalizeText(subtaskInput.value);
    if (!txt) return;
    todos = todos.map(t => {
      if (t.id !== todo.id) return t;
      const nextSubs = [{ id: cryptoRandomId(), text: txt, completed: false }, ...(t.subtasks || [])];
      return { ...t, subtasks: nextSubs };
    });
    subtaskInput.value = '';
    autoGrow(subtaskInput);
    persist();
    render();
  }

  subtaskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addSubtask();
  });

  renderSubtasks();

  const startEdit = () => {
    li.classList.add('editing');
    li.draggable = false;
    li.setAttribute('aria-grabbed', 'false');
    editInput.value = getTodo(todo.id)?.text ?? '';
    autoGrow(editInput);
    editInput.focus();
    editInput.setSelectionRange(editInput.value.length, editInput.value.length);
  };

  const cancelEdit = () => {
    li.classList.remove('editing');
    editInput.value = getTodo(todo.id)?.text ?? '';
    if (isReorderEnabled()) li.draggable = true;
  };

  const commitEdit = () => {
    const next = normalizeText(editInput.value);
    if (!next) {
      todos = todos.filter(t => t.id !== todo.id);
      persist();
      render();
      return;
    }
    li.classList.remove('editing');
    if (isReorderEnabled()) li.draggable = true;
    updateTodo(todo.id, { text: next });
  };

  text.addEventListener('dblclick', startEdit);
  editBtn.addEventListener('click', startEdit);

  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      commitEdit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  });

  editInput.addEventListener('blur', () => {
    if (li.classList.contains('editing')) commitEdit();
  });

  li.addEventListener('dragstart', (e) => {
    if (!isReorderEnabled()) return;
    if (li.classList.contains('editing')) {
      e.preventDefault();
      return;
    }
    draggingId = todo.id;
    li.classList.add('dragging');
    li.setAttribute('aria-grabbed', 'true');
    try { e.dataTransfer.setData('text/plain', todo.id); } catch {}
    e.dataTransfer.effectAllowed = 'move';
  });

  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    li.classList.remove('drag-over');
    li.setAttribute('aria-grabbed', 'false');
  });

  return frag;
}

function commitProgress(id, value) {
  const v = clampProgress(value);
  const prev = getTodo(id);
  if (!prev) return;

  const wasCompleted = Boolean(prev.completed);
  const nextCompleted = (v === 100) ? true : (wasCompleted && v < 100 ? false : wasCompleted);

  if (v === 100 && clampProgress(prev.progress) < 100) celebrate(id);

  updateTodo(id, { progress: v, completed: nextCompleted });
}

function celebrate(id) {
  celebrating.add(id);
  setTimeout(() => celebrating.delete(id), CELEBRATION_MS);
}

function setProgressUI(li, valueEl, fillEl, progress) {
  const p = clampProgress(progress);
  valueEl.value = String(p);
  setProgressFillUI(li, fillEl, p);
}

function setProgressFillUI(li, fillEl, progress) {
  const p = clampProgress(progress);
  fillEl.style.width = `${p}%`;
  fillEl.classList.toggle('is-empty', p === 0);
  if (li) {
    li.style.setProperty('--task-progress', `${p}%`);
    li.classList.toggle('is-full', p === 100);
  }
}

function animateStat(el, value, suffix = '') {
  if (!el) return;

  const target = Math.round(value);
  const parsed = Number(String(el.textContent).replace(/[^0-9-]/g, ''));
  const start = Number.isFinite(parsed) ? parsed : 0;

  if (el._statFrame) cancelAnimationFrame(el._statFrame);

  if (start === target || prefersReducedMotion()) {
    el.textContent = `${target}${suffix}`;
    return;
  }

  const duration = 420;
  const t0 = performance.now();

  const step = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = `${Math.round(start + (target - start) * eased)}${suffix}`;
    el._statFrame = (t < 1) ? requestAnimationFrame(step) : null;
  };

  el._statFrame = requestAnimationFrame(step);
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Keep stored text tidy so rendering stays consistent:
 * normalize line endings, strip trailing spaces per line,
 * collapse runs of blank lines to one, and trim the edges.
 */
function normalizeText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function autoGrow(el) {
  if (!el) return;

  el.style.height = 'auto';

  // scrollHeight excludes borders, but box-sizing is border-box, so add them
  // back or every field loses a couple of pixels and starts scrolling.
  const cs = getComputedStyle(el);
  const borders = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
  const full = el.scrollHeight + borders;

  el.style.height = `${Math.min(full, TEXTAREA_MAX_HEIGHT)}px`;
  el.classList.toggle('is-scrolling', full > TEXTAREA_MAX_HEIGHT);
}

function setupAutoGrow(el) {
  if (!el || el._autoGrowBound) return;
  el._autoGrowBound = true;
  el.addEventListener('input', () => autoGrow(el));
  autoGrow(el);
}

function submitOnEnter(el, handler) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handler();
    }
  });
}

function clampProgress(n) {
  const v = Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function isReorderEnabled() {
  return currentFilter === 'all';
}

function reorderTodos(sourceId, targetId) {
  const fromIndex = todos.findIndex(t => t.id === sourceId);
  const toIndex = todos.findIndex(t => t.id === targetId);
  if (fromIndex < 0 || toIndex < 0) return;

  const next = todos.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  todos = next;
}

function getVisibleTodos() {
  if (currentFilter === 'active') return todos.filter(t => !t.completed);
  if (currentFilter === 'completed') return todos.filter(t => t.completed);
  return todos;
}

function getTodo(id) {
  return todos.find(t => t.id === id);
}

function updateTodo(id, patch) {
  let changed = false;
  todos = todos.map(t => {
    if (t.id !== id) return t;
    changed = true;
    const next = { ...t, ...patch };
    next.progress = clampProgress(next.progress);
    if (next.completed) next.progress = 100;
    return next;
  });

  if (changed) {
    persist();
    render();
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(x => x && typeof x.id === 'string' && typeof x.text === 'string')
      .map(x => {
        const completed = Boolean(x.completed);
        const progress = clampProgress(typeof x.progress === 'number' ? x.progress : (completed ? 100 : 0));

        const subsRaw = Array.isArray(x.subtasks) ? x.subtasks : [];
        const subs = subsRaw
          .filter(s => s && typeof s.id === 'string' && typeof s.text === 'string')
          .map(s => ({ id: s.id, text: normalizeText(s.text), completed: Boolean(s.completed) }));

        return {
          id: x.id,
          text: normalizeText(x.text),
          completed,
          createdAt: typeof x.createdAt === 'number' ? x.createdAt : Date.now(),
          progress: completed ? 100 : progress,
          subtasks: subs,
        };
      });
  } catch {
    return [];
  }
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

render();
