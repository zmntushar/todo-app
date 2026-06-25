/*
  Simple Todo app
  - Add, complete, delete
  - Filter: all / active / completed
  - Edit: double-click item or Edit button
  - Persists to localStorage
  - Drag & drop reorder (when filter = all)
  - Per-task progress (0-100)
*/

const STORAGE_KEY = 'todo_app_items_v1';
const TASK_TEXT_MAX_LENGTH = 1000;
const SUBTASK_TEXT_MAX_LENGTH = 1000;

/** @type {{id:string, text:string, completed:boolean, createdAt:number, progress:number}[]} */
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
};

els.input.maxLength = TASK_TEXT_MAX_LENGTH;

// Drag state
let draggingId = null;
let dragOverId = null;
// Subtask drag state
let subDraggingId = null;
let subDraggingParent = null;
let subDragOverId = null;

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
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
  persist();
  render();
});

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

function render() {
  const visible = getVisibleTodos();
  els.list.innerHTML = '';

  for (const todo of visible) {
    const node = createTodoNode(todo);
    els.list.appendChild(node);
  }

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

  if (els.statTotal) els.statTotal.textContent = String(total);
  if (els.statActive) els.statActive.textContent = String(activeCount);
  if (els.statCompleted) els.statCompleted.textContent = String(completed);
  if (els.statOverall) els.statOverall.textContent = `${overall}%`;
  if (els.overallOrb) els.overallOrb.classList.toggle('is-empty', overall === 0);
  if (els.overallOrbRing) els.overallOrbRing.style.strokeDasharray = `${overall} 100`;
  if (els.overallOrbValue) els.overallOrbValue.textContent = `${overall}%`;
}

function createTodoNode(todo) {
  const frag = els.tpl.content.cloneNode(true);
  const li = frag.querySelector('li.item');

  const toggle = frag.querySelector('input.toggle');
  const text = frag.querySelector('.text');
  const editInput = frag.querySelector('input.edit');
  const editBtn = frag.querySelector('[data-action=edit]');
  const delBtn = frag.querySelector('[data-action=delete]');

  const progressValueEl = frag.querySelector('.progress-value');
  const progressFillEl = frag.querySelector('.progress-fill');
  const progressInputEl = frag.querySelector('.progress-input');

  li.dataset.id = todo.id;
  li.classList.toggle('completed', todo.completed);

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

  const initialProgress = clampProgress(todo.progress);
  progressInputEl.value = String(initialProgress);
  setProgressUI(progressValueEl, progressFillEl, initialProgress);

  toggle.addEventListener('change', () => {
    const checked = toggle.checked;
    // When parent is toggled, propagate to subtasks
    const prev = getTodo(todo.id) || {};
    const nextSubtasks = Array.isArray(prev.subtasks) ? prev.subtasks.map(s => ({ ...s, completed: checked })) : [];
    const next = { completed: checked, subtasks: nextSubtasks };
    if (checked) next.progress = 100;
    else if (clampProgress(prev.progress ?? 0) === 100) next.progress = 0;

    updateTodo(todo.id, next);
  });

  // --- FIX: Prevent Reorder Interference ---
  const disableDrag = () => { li.draggable = false; };
  const enableDrag = () => { if (isReorderEnabled()) li.draggable = true; };

  progressInputEl.addEventListener('mousedown', disableDrag);
  progressInputEl.addEventListener('touchstart', disableDrag, { passive: true });
  window.addEventListener('mouseup', enableDrag);
  window.addEventListener('touchend', enableDrag);

  progressInputEl.addEventListener('input', () => {
    const v = clampProgress(Number(progressInputEl.value));
    setProgressUI(progressValueEl, progressFillEl, v);
  });

  progressInputEl.addEventListener('change', () => {
    const v = clampProgress(Number(progressInputEl.value));
    const wasCompleted = Boolean(getTodo(todo.id)?.completed);
    const nextCompleted = (v === 100) ? true : (wasCompleted && v < 100 ? false : wasCompleted);

    updateTodo(todo.id, { progress: v, completed: nextCompleted });
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
  subtaskInput.maxLength = SUBTASK_TEXT_MAX_LENGTH;

  function renderSubtasks() {
    subtasksList.innerHTML = '';
    const src = getTodo(todo.id)?.subtasks || [];
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

      // edit subtask (double-click span or Edit button)
      const startEditSubtask = () => {
        li.draggable = false;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'subtask-edit';
        input.maxLength = SUBTASK_TEXT_MAX_LENGTH;
        input.value = s.text;
        left.replaceChild(input, span);
        input.focus();
        input.select();

        const cancel = () => {
          left.replaceChild(span, input);
          if (isReorderEnabled()) li.draggable = true;
        };

        const commit = () => {
          const val = (input.value || '').trim();
          if (!val) {
            // delete if empty
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
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
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

  subtaskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const txt = (subtaskInput.value || '').trim();
    if (!txt) return;
    todos = todos.map(t => {
      if (t.id !== todo.id) return t;
      const nextSubs = [{ id: cryptoRandomId(), text: txt, completed: false }, ...(t.subtasks || [])];
      return { ...t, subtasks: nextSubs };
    });
    subtaskInput.value = '';
    persist();
    render();
  });

  renderSubtasks();

  const startEdit = () => {
    li.classList.add('editing');
    li.draggable = false;
    li.setAttribute('aria-grabbed', 'false');
    editInput.value = getTodo(todo.id)?.text ?? '';
    editInput.focus();
    editInput.select();
  };

  const cancelEdit = () => {
    li.classList.remove('editing');
    editInput.value = getTodo(todo.id)?.text ?? '';
    if (isReorderEnabled()) li.draggable = true;
  };

  const commitEdit = () => {
    const next = editInput.value.trim();
    if (!next) {
      todos = todos.filter(t => t.id !== todo.id);
      persist();
      render();
      return;
    }
    updateTodo(todo.id, { text: next });
    li.classList.remove('editing');
    if (isReorderEnabled()) li.draggable = true;
  };

  text.addEventListener('dblclick', startEdit);
  editBtn.addEventListener('click', startEdit);

  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') cancelEdit();
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

function setProgressUI(valueEl, fillEl, progress) {
  const p = clampProgress(progress);
  valueEl.textContent = `${p}%`;
  fillEl.style.width = `${p}%`;
  fillEl.classList.toggle('is-empty', p === 0);
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
          .map(s => ({ id: s.id, text: s.text, completed: Boolean(s.completed) }));

        return {
          id: x.id,
          text: x.text,
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
