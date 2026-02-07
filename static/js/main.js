// ── State ──

const state = {
  user: null,
  courses: [],
  currentCourse: null,
  currentConversation: null,
  messages: [],
  topics: [],
  currentTopicId: null,
  topicPath: [],
};

// ── Helpers ──

function humanDelay(base, variance) {
  return base + Math.random() * variance;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function typeInto(target, text) {
  // For short text, type char-by-char; for long text, chunk it
  const chunkSize = text.length > 120 ? 4 : 1;
  for (let i = 0; i < text.length; i += chunkSize) {
    target.textContent += text.slice(i, i + chunkSize);
    await sleep(humanDelay(3, 8));
  }
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (res.status === 401) return null;
  return res.json();
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
    // Replace ==concept== with clickable highlighted terms
    text = text.replace(/==([^=]+)==/g, '<mark class="concept-link">$1</mark>');
    return marked.parse(text);
  }
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attachConceptLinks(el) {
  el.querySelectorAll('.concept-link').forEach(mark => {
    mark.addEventListener('click', (e) => {
      e.stopPropagation();
      const chatInput = document.getElementById('chat-input');
      chatInput.textContent = mark.textContent;
      handleSend();
    });
  });
}

function renderContent(el) {
  if (window.renderMathInElement) {
    renderMathInElement(el, {
      delimiters: [
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
    });
  }
}

// ── Landing animation ──

const el = document.getElementById('typed');
let landingRunning = true;

async function type(text) {
  for (const char of text) {
    if (!landingRunning) return;
    el.textContent += char;
    const delay = char === ' '
      ? humanDelay(160, 180)
      : humanDelay(100, 150);
    await sleep(delay);
  }
}

async function backspace(count) {
  for (let i = 0; i < count; i++) {
    if (!landingRunning) return;
    el.textContent = el.textContent.slice(0, -1);
    await sleep(humanDelay(70, 100));
  }
}

async function runLandingAnimation() {
  await sleep(1200);
  await type('Learn more precise.');
  await sleep(2000);
  await backspace(' precise.'.length);
  await sleep(500);
  await type('.');
  await sleep(1800);
  await backspace(' more.'.length);
  await sleep(500);
  await type('.');

  await sleep(15000);

  const topics = [
    'Python.', 'Control Theory.', 'Cooking.', 'Chess.',
    'Linear Algebra.', 'Philosophy.', 'Music Theory.',
    'Machine Learning.', 'History.', 'Economics.',
  ];

  let i = 0;
  while (landingRunning) {
    const topic = topics[i % topics.length];
    await backspace('.'.length);
    await sleep(300);
    await type(' ' + topic);
    await sleep(3000);
    await backspace((' ' + topic).length);
    await sleep(400);
    await type('.');
    await sleep(2000);
    i++;
  }
}

const landing = document.getElementById('landing');
const chat = document.getElementById('chat');

if (window.__isAuthenticated) {
  landingRunning = false;
  landing.style.display = 'none';
  chat.classList.add('visible');
  initApp();
} else {
  runLandingAnimation();
}

// ── Chat typing ──

async function addBotMessage(text, topicId) {
  const messages = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'msg bot';
  msg.dataset.topicId = topicId != null ? String(topicId) : '';

  const span = document.createElement('span');
  span.className = 'bot-text';
  msg.appendChild(span);

  const inputLine = document.querySelector('.chat-input-line');
  messages.insertBefore(msg, inputLine);

  if (text.length > 300) {
    // Long messages: render immediately with fade-in
    msg.style.opacity = '0';
    msg.style.transition = 'opacity 0.3s ease';
    span.innerHTML = renderMarkdown(text);
    renderContent(span);
    attachConceptLinks(span);
    messages.scrollTop = messages.scrollHeight;
    requestAnimationFrame(() => { msg.style.opacity = '1'; });
  } else {
    // Short messages: quick typing then render
    const cur = document.createElement('span');
    cur.className = 'cursor';
    cur.textContent = '|';
    msg.appendChild(cur);
    messages.scrollTop = messages.scrollHeight;

    await typeInto(span, text);
    cur.remove();

    span.innerHTML = renderMarkdown(text);
    renderContent(span);
    attachConceptLinks(span);
    messages.scrollTop = messages.scrollHeight;
  }

  return msg;
}

function addStaticMessage(role, text, topicId) {
  const messages = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'msg ' + role;
  msg.dataset.topicId = topicId != null ? String(topicId) : '';

  if (role === 'bot') {
    const span = document.createElement('span');
    span.className = 'bot-text';
    span.innerHTML = renderMarkdown(text);
    msg.appendChild(span);
    renderContent(span);
    attachConceptLinks(span);
  } else {
    msg.textContent = text;
  }

  const inputLine = document.querySelector('.chat-input-line');
  messages.insertBefore(msg, inputLine);
}

function addBranchMarker(topicTitle, parentTitle, topicId, beforeElement) {
  const messages = document.getElementById('chat-messages');
  const marker = document.createElement('div');
  marker.className = 'branch-marker';
  marker.dataset.topicId = topicId != null ? String(topicId) : '';

  const label = document.createElement('span');
  label.className = 'branch-label';
  label.textContent = topicTitle;
  marker.appendChild(label);

  if (parentTitle) {
    const back = document.createElement('span');
    back.className = 'branch-back';
    back.textContent = 'Back to ' + parentTitle;
    back.addEventListener('click', () => {
      // Navigate up to parent
      const parentTopic = findTopicByTitle(state.topics, parentTitle);
      if (parentTopic) {
        drillIntoTopic(parentTopic.id, parentTopic.title, false);
      } else {
        // Go to root
        state.currentTopicId = null;
        state.topicPath = [];
        renderBreadcrumb();
        renderTopicTree();
        renderKnowledgeMap();
        filterMessagesByTopic();
      }
    });
    marker.appendChild(back);
  }

  const insertPoint = beforeElement || document.querySelector('.chat-input-line');
  messages.insertBefore(marker, insertPoint);
  messages.scrollTop = messages.scrollHeight;
}

function addSuggestionChips(suggestions, topicId) {
  if (!suggestions || suggestions.length === 0) return;

  const messages = document.getElementById('chat-messages');
  const container = document.createElement('div');
  container.className = 'suggestions';
  container.dataset.topicId = topicId != null ? String(topicId) : '';

  suggestions.forEach(s => {
    const chip = document.createElement('span');
    chip.className = 'suggestion-chip';
    chip.textContent = s;
    chip.addEventListener('click', () => {
      container.remove();
      chatInput.textContent = s;
      handleSend();
    });
    container.appendChild(chip);
  });

  const inputLine = document.querySelector('.chat-input-line');
  messages.insertBefore(container, inputLine);
  messages.scrollTop = messages.scrollHeight;
}

// ── Thinking indicator ──

function showThinkingIndicator(topicId) {
  const messages = document.getElementById('chat-messages');
  const inputLine = document.querySelector('.chat-input-line');
  const indicator = document.createElement('div');
  indicator.className = 'thinking-indicator';
  indicator.id = 'thinking';
  indicator.dataset.topicId = topicId != null ? String(topicId) : '';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    indicator.appendChild(dot);
  }
  messages.insertBefore(indicator, inputLine);
  messages.scrollTop = messages.scrollHeight;
}

function hideThinkingIndicator() {
  const el = document.getElementById('thinking');
  if (el) el.remove();
}

// ── User input ──

const chatInput = document.getElementById('chat-input');
const inputLine = document.querySelector('.chat-input-line');

function focusInput() {
  chatInput.focus();
  const range = document.createRange();
  range.selectNodeContents(chatInput);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

document.querySelector('.chat-messages').addEventListener('click', (e) => {
  if (!window.getSelection().toString()) focusInput();
});

async function handleSend() {
  const text = chatInput.textContent.trim();
  if (!text) return;

  // If no course exists yet, treat first message as course creation
  if (!state.currentCourse) {
    await createCourseFromInput(text);
    return;
  }

  // If no conversation, create one
  if (!state.currentConversation) {
    const data = await api('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ course_id: state.currentCourse.id, title: text.slice(0, 80) }),
    });
    if (data) {
      state.currentConversation = data;
    }
  }

  const messages = document.getElementById('chat-messages');
  const topicAtSend = state.currentTopicId;

  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.textContent = text;
  userMsg.dataset.topicId = topicAtSend != null ? String(topicAtSend) : '';
  messages.insertBefore(userMsg, inputLine);

  chatInput.textContent = '';
  messages.scrollTop = messages.scrollHeight;
  showThinkingIndicator(topicAtSend);

  try {
    const data = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: state.currentConversation.id,
        message: text,
        topic_id: state.currentTopicId,
      }),
    });

    hideThinkingIndicator();

    if (data && data.reply) {
      const botMsg = await addBotMessage(data.reply, topicAtSend);

      // Update conversation title in state
      if (data.conversation_title) {
        state.currentConversation.title = data.conversation_title;
      }

      // If AI detected a new subtopic from user's question
      if (data.new_topic) {
        const nt = data.new_topic;

        // Re-tag the triggering messages with the new child topic
        userMsg.dataset.topicId = String(nt.id);
        botMsg.dataset.topicId = String(nt.id);

        // Insert branch marker before the user message
        const parentTitle = state.topicPath.length > 0
          ? state.topicPath[state.topicPath.length - 1].title
          : state.currentCourse?.name;
        addBranchMarker(nt.title, parentTitle, nt.id, userMsg);

        // Update current topic to the new one
        state.currentTopicId = nt.id;
        // Reload full topic tree from server
        await loadTopics();
        state.topicPath = buildTopicPath(state.topics, nt.id);
        renderBreadcrumb();
      }

    } else {
      await addBotMessage("Something went wrong. Please try again.", topicAtSend);
    }
  } catch (err) {
    hideThinkingIndicator();
    await addBotMessage("Something went wrong. Please try again.", topicAtSend);
  }
  focusInput();
}

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleSend();
  }
});

// ── Sidebar toggle ──

const chatLayout = document.getElementById('chat');
const toggleLeft = document.getElementById('toggle-left');
const toggleRight = document.getElementById('toggle-right');

toggleLeft.addEventListener('click', () => {
  chatLayout.classList.toggle('left-collapsed');
  toggleLeft.innerHTML = chatLayout.classList.contains('left-collapsed')
    ? '&#9654;'
    : '&#9664;';
});

toggleRight.addEventListener('click', () => {
  chatLayout.classList.toggle('right-collapsed');
  toggleRight.innerHTML = chatLayout.classList.contains('right-collapsed')
    ? '&#9664;'
    : '&#9654;';
});

// ── Drag to resize sidebars ──

function initDrag(handleId, side) {
  const handle = document.getElementById(handleId);
  let dragging = false;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;

    if (side === 'left') {
      const width = Math.max(140, Math.min(e.clientX, 500));
      chatLayout.style.setProperty('--left-w', width + 'px');
    } else {
      const width = Math.max(140, Math.min(window.innerWidth - e.clientX, 500));
      chatLayout.style.setProperty('--right-w', width + 'px');
    }
  });

  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

initDrag('drag-left', 'left');
initDrag('drag-right', 'right');

// ── Topic tree helpers ──

function findTopicById(topics, id) {
  for (const t of topics) {
    if (t.id === id) return t;
    if (t.children) {
      const found = findTopicById(t.children, id);
      if (found) return found;
    }
  }
  return null;
}

function findTopicByTitle(topics, title) {
  for (const t of topics) {
    if (t.title === title) return t;
    if (t.children) {
      const found = findTopicByTitle(t.children, title);
      if (found) return found;
    }
  }
  return null;
}

function buildTopicPath(topics, targetId) {
  // Build path from root to target
  function search(nodes, path) {
    for (const t of nodes) {
      const newPath = [...path, { id: t.id, title: t.title }];
      if (t.id === targetId) return newPath;
      if (t.children) {
        const found = search(t.children, newPath);
        if (found) return found;
      }
    }
    return null;
  }
  return search(topics, []) || [];
}

// ── Topic filtering ──

function getVisibleTopicIds(topicId) {
  if (topicId == null) return null; // null = show all
  const path = buildTopicPath(state.topics, topicId);
  if (path.length === 0) return null; // topic not found, show all
  return new Set(path.map(p => p.id));
}

function filterMessagesByTopic() {
  const container = document.getElementById('chat-messages');
  const inputLine = document.querySelector('.chat-input-line');
  const visibleIds = getVisibleTopicIds(state.currentTopicId);

  let child = container.firstChild;
  while (child && child !== inputLine) {
    if (child.dataset && 'topicId' in child.dataset) {
      const tid = child.dataset.topicId;
      if (tid === '' || visibleIds === null || visibleIds.has(parseInt(tid))) {
        child.classList.remove('topic-hidden');
      } else {
        child.classList.add('topic-hidden');
      }
    }
    child = child.nextSibling;
  }

  container.scrollTop = container.scrollHeight;
}

// ── Render functions ──

function renderCourseSelect() {
  const dropdown = document.getElementById('course-dropdown');
  const selected = document.getElementById('dropdown-selected');
  const menu = document.getElementById('dropdown-menu');
  menu.innerHTML = '';

  // Show current course name
  if (state.currentCourse) {
    selected.textContent = state.currentCourse.name;
    selected.classList.remove('dropdown-placeholder');
  } else {
    selected.textContent = 'Select course...';
    selected.classList.add('dropdown-placeholder');
  }

  // Build course items
  state.courses.forEach(c => {
    const item = document.createElement('div');
    item.className = 'dropdown-item';
    if (state.currentCourse && c.id === state.currentCourse.id) {
      item.classList.add('dropdown-active');
    }
    item.textContent = c.name;
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      dropdown.classList.remove('open');
      if (state.currentCourse && c.id === state.currentCourse.id) return;

      state.currentCourse = c;
      state.currentTopicId = null;
      state.topicPath = [];
      renderCourseSelect();
      await loadConversation();
      await loadTopics();
      renderBreadcrumb();
      clearChatMessages();

      if (state.currentConversation) {
        await loadAndDisplayMessages();
      } else {
        await addBotMessage("Welcome! What would you like to study?");
      }
      focusInput();
    });
    menu.appendChild(item);
  });

  // "+ New course" item
  const newItem = document.createElement('div');
  newItem.className = 'dropdown-item dropdown-new';
  newItem.textContent = '+ New course';
  newItem.addEventListener('click', (e) => {
    e.stopPropagation();

    // Replace the "+ New course" item with an inline input
    newItem.style.display = 'none';
    const inputRow = document.createElement('div');
    inputRow.className = 'dropdown-input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dropdown-input';
    input.placeholder = 'Course name...';
    input.spellcheck = false;

    const confirm = document.createElement('span');
    confirm.className = 'dropdown-input-confirm';
    confirm.textContent = 'Go';

    inputRow.appendChild(input);
    inputRow.appendChild(confirm);
    menu.appendChild(inputRow);
    input.focus();

    async function submitCourse() {
      const name = input.value.trim();
      if (!name) return;
      inputRow.remove();
      dropdown.classList.remove('open');

      const data = await api('/api/courses', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      if (data) {
        await loadCourses();
        state.currentCourse = state.courses.find(c => c.id === data.id);
        renderCourseSelect();
        state.currentConversation = { id: data.conversation_id, title: name };
        state.currentTopicId = null;
        state.topicPath = [];
        await loadTopics();
        renderBreadcrumb();
        clearChatMessages();

        // Ask AI for initial suggestions
        showThinkingIndicator(null);
        try {
          const chatData = await api('/api/chat', {
            method: 'POST',
            body: JSON.stringify({
              conversation_id: data.conversation_id,
              message: `I want to learn about ${name}`,
              topic_id: null,
            }),
          });
          hideThinkingIndicator();
          if (chatData && chatData.reply) {
            await addBotMessage(chatData.reply);
          }
        } catch (e) {
          hideThinkingIndicator();
          await addBotMessage(`Welcome to ${name}! What would you like to start with?`);
        }
        focusInput();
      }
    }

    function cancelInput() {
      inputRow.remove();
      newItem.style.display = '';
    }

    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') submitCourse();
      if (ev.key === 'Escape') cancelInput();
    });
    input.addEventListener('click', (ev) => ev.stopPropagation());
    confirm.addEventListener('click', (ev) => {
      ev.stopPropagation();
      submitCourse();
    });
  });
  menu.appendChild(newItem);

  // Toggle dropdown on click
  selected.onclick = (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  };
}

// Close dropdown when clicking outside
document.addEventListener('click', () => {
  const dropdown = document.getElementById('course-dropdown');
  if (dropdown) dropdown.classList.remove('open');
});

function renderTopicTree() {
  const container = document.getElementById('topic-tree');
  container.innerHTML = '';

  if (state.topics.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = 'Topics will appear as you ask questions.';
    container.appendChild(empty);
    return;
  }

  function buildNode(topic, depth) {
    const item = document.createElement('div');
    item.className = 'tree-item';
    if (depth >= 2) item.classList.add('tree-detail');
    if (state.currentTopicId === topic.id) {
      item.classList.add('active');
    }
    item.style.paddingLeft = (0.75 + depth * 0.75) + 'rem';

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = topic.title;
    item.appendChild(label);

    if (state.currentTopicId === topic.id) {
      const marker = document.createElement('span');
      marker.className = 'tree-here-marker';
      marker.textContent = '<';
      item.appendChild(marker);
    }

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      drillIntoTopic(topic.id, topic.title, true);
    });

    container.appendChild(item);

    if (topic.children && topic.children.length > 0) {
      topic.children.forEach(child => buildNode(child, depth + 1));
    }
  }

  state.topics.forEach(topic => buildNode(topic, 0));
}

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = '';

  if (!state.currentCourse) return;

  // Course name (root)
  const root = document.createElement('span');
  root.className = 'breadcrumb-segment breadcrumb-root';
  root.textContent = state.currentCourse.name;
  root.addEventListener('click', () => {
    state.currentTopicId = null;
    state.topicPath = [];
    renderBreadcrumb();
    renderTopicTree();
    renderKnowledgeMap();
    filterMessagesByTopic();
  });
  bc.appendChild(root);

  // Topic path segments
  state.topicPath.forEach((seg, i) => {
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = ' > ';
    bc.appendChild(sep);

    const span = document.createElement('span');
    span.className = 'breadcrumb-segment';
    if (i === state.topicPath.length - 1) {
      span.classList.add('breadcrumb-current');
    }
    span.textContent = seg.title;
    span.addEventListener('click', () => {
      // Navigate to this point in the path
      state.currentTopicId = seg.id;
      state.topicPath = state.topicPath.slice(0, i + 1);
      renderBreadcrumb();
      renderTopicTree();
      renderKnowledgeMap();
      filterMessagesByTopic();
    });
    bc.appendChild(span);
  });
}

function renderUserInfo() {
  const el = document.getElementById('user-info');
  if (state.user) {
    el.innerHTML = `
      <span class="user-name">${state.user.name}</span>
      <a href="/auth/logout" class="logout-link">Log out</a>
    `;
  }
}

function clearChatMessages() {
  const messages = document.getElementById('chat-messages');
  const inputLine = document.querySelector('.chat-input-line');
  while (messages.firstChild !== inputLine) {
    messages.removeChild(messages.firstChild);
  }
}

// ── Knowledge Map ──

function seededRandom(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

function countDescendants(topic) {
  if (!topic.children || topic.children.length === 0) return 1;
  let count = 0;
  topic.children.forEach(c => { count += countDescendants(c); });
  return count;
}

function layoutKnowledgeMap(topics) {
  const nodes = [];
  const edges = [];
  const vSpacing = 70;
  const minHSpacing = 55;

  function layoutSubtree(topic, cx, y, availWidth, depth, parentId) {
    const jitterX = (seededRandom(topic.id) - 0.5) * 8;
    const jitterY = (seededRandom(topic.id + 100) - 0.5) * 6;
    const nx = cx + jitterX;
    const ny = y + jitterY;

    nodes.push({
      id: topic.id,
      title: topic.title,
      x: nx,
      y: ny,
      depth: depth,
      status: topic.status || 'not_started',
    });

    if (parentId !== null) {
      edges.push({ from: parentId, to: topic.id });
    }

    if (topic.children && topic.children.length > 0) {
      const totalDesc = topic.children.reduce((s, c) => s + countDescendants(c), 0);
      const childY = y + vSpacing;
      let offsetX = cx - availWidth / 2;

      topic.children.forEach(child => {
        const childDesc = countDescendants(child);
        const childWidth = Math.max(minHSpacing, (childDesc / totalDesc) * availWidth);
        const childCx = offsetX + childWidth / 2;
        layoutSubtree(child, childCx, childY, childWidth, depth + 1, topic.id);
        offsetX += childWidth;
      });
    }
  }

  if (topics.length === 0) return { nodes, edges };

  const totalWidth = Math.max(200, topics.length * 100);
  const segmentWidth = totalWidth / topics.length;

  topics.forEach((topic, i) => {
    const cx = segmentWidth * i + segmentWidth / 2;
    layoutSubtree(topic, cx, 30, segmentWidth, 0, null);
  });

  return { nodes, edges };
}

function renderKnowledgeMap() {
  const container = document.getElementById('knowledge-map');
  if (!container) return;

  if (state.topics.length === 0) {
    container.innerHTML = '<div class="sidebar-empty">Your knowledge map will grow as you explore topics.</div>';
    return;
  }

  // Wrap topics under a virtual course root so all top-level topics connect to it
  const courseRoot = {
    id: -1,
    title: state.currentCourse ? state.currentCourse.name : 'Course',
    children: state.topics,
    status: 'root',
  };
  const { nodes, edges } = layoutKnowledgeMap([courseRoot]);
  if (nodes.length === 0) {
    container.innerHTML = '<div class="sidebar-empty">Your knowledge map will grow as you explore topics.</div>';
    return;
  }

  // Calculate bounding box
  const padding = 40;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  });

  const vbX = minX - padding;
  const vbY = minY - padding;
  const vbW = Math.max(maxX - minX + padding * 2, 120);
  const vbH = Math.max(maxY - minY + padding * 2 + 20, 100);

  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = n; });

  // Build SVG
  let svg = `<svg class="km-svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" preserveAspectRatio="xMidYMin meet">`;

  // Edges
  edges.forEach(e => {
    const from = nodeMap[e.from];
    const to = nodeMap[e.to];
    if (!from || !to) return;
    const midY = (from.y + to.y) / 2;
    svg += `<path class="km-edge" d="M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}" />`;
  });

  // Nodes
  nodes.forEach(n => {
    const isRoot = n.id === -1;
    const isCurrent = n.id === state.currentTopicId;
    const isInProgress = n.status === 'in_progress';
    let nodeClass = 'km-node';
    if (isRoot) nodeClass += ' km-root';
    else if (isCurrent) nodeClass += ' km-current';
    else if (isInProgress) nodeClass += ' km-visited';
    else nodeClass += ' km-unvisited';

    const r = isRoot ? 24 : (n.depth <= 1 ? 20 : (n.depth === 2 ? 16 : 13));
    const truncTitle = n.title.length > 14 ? n.title.slice(0, 12) + '..' : n.title;
    const fontSize = isRoot ? 9 : (n.depth <= 1 ? 8.5 : (n.depth === 2 ? 7.5 : 7));

    svg += `<g class="${nodeClass}" data-topic-id="${n.id}" data-topic-title="${n.title.replace(/"/g, '&quot;')}" style="cursor:pointer">`;
    svg += `<title>${n.title}</title>`;
    svg += `<circle cx="${n.x}" cy="${n.y}" r="${r}" />`;
    svg += `<text x="${n.x}" y="${n.y + r + fontSize + 4}" text-anchor="middle" font-size="${fontSize}">${truncTitle}</text>`;
    svg += `</g>`;
  });

  svg += `</svg>`;
  container.innerHTML = svg;

  // Attach click handlers (skip course root node)
  container.querySelectorAll('.km-node').forEach(g => {
    const id = parseInt(g.dataset.topicId);
    if (id === -1) return;
    g.addEventListener('click', () => {
      const title = g.dataset.topicTitle;
      drillIntoTopic(id, title, true);
    });
  });
}

// ── Topic navigation ──

async function drillIntoTopic(topicId, topicTitle, insertMarker) {
  const parentTitle = state.topicPath.length > 0
    ? state.topicPath[state.topicPath.length - 1].title
    : state.currentCourse?.name;

  // Build the path to this topic
  state.topicPath = buildTopicPath(state.topics, topicId);
  state.currentTopicId = topicId;

  if (insertMarker) {
    // Only insert branch marker if one doesn't already exist for this topic
    const container = document.getElementById('chat-messages');
    const existing = container.querySelector(`.branch-marker[data-topic-id="${topicId}"]`);
    if (!existing) {
      addBranchMarker(topicTitle, parentTitle, topicId);

      // Notify backend of the branch
      if (state.currentConversation) {
        await api(`/api/conversations/${state.currentConversation.id}/branch`, {
          method: 'POST',
          body: JSON.stringify({ topic_id: topicId, topic_title: topicTitle }),
        });
      }
    }
  }

  renderBreadcrumb();
  renderTopicTree();
  renderKnowledgeMap();
  filterMessagesByTopic();
  focusInput();
}

// ── Data loading ──

async function loadCourses() {
  const data = await api('/api/courses');
  if (data) state.courses = data;
}

async function loadConversation() {
  if (!state.currentCourse) {
    state.currentConversation = null;
    return;
  }
  // Get the first (most recent) conversation for this course
  const data = await api(`/api/conversations?course_id=${state.currentCourse.id}`);
  if (data && data.length > 0) {
    state.currentConversation = data[0];
  } else {
    state.currentConversation = null;
  }
}

async function loadTopics() {
  if (!state.currentCourse) {
    state.topics = [];
    renderTopicTree();
    renderKnowledgeMap();
    return;
  }
  const data = await api(`/api/courses/${state.currentCourse.id}/topics`);
  if (data) state.topics = data;
  renderTopicTree();
  renderKnowledgeMap();
}

async function loadAndDisplayMessages() {
  if (!state.currentConversation) return;

  const data = await api(`/api/conversations/${state.currentConversation.id}`);
  if (!data) return;

  state.currentConversation = data;
  clearChatMessages();

  let lastTopicId = null;
  data.messages.forEach(m => {
    // Insert branch markers when topic context changes
    if (m.topic_id !== lastTopicId && m.topic_id !== null && lastTopicId !== null) {
      const topic = findTopicById(state.topics, m.topic_id);
      if (topic) {
        const parentTopic = findTopicById(state.topics, lastTopicId);
        addBranchMarker(topic.title, parentTopic ? parentTopic.title : state.currentCourse?.name, m.topic_id);
      }
    }
    lastTopicId = m.topic_id;

    addStaticMessage(m.role === 'assistant' ? 'bot' : 'user', m.content, m.topic_id);
  });

  // Set current topic to the last message's topic
  if (data.messages.length > 0) {
    const lastMsg = data.messages[data.messages.length - 1];
    if (lastMsg.topic_id) {
      state.currentTopicId = lastMsg.topic_id;
      state.topicPath = buildTopicPath(state.topics, lastMsg.topic_id);
    }
  }

  const messages = document.getElementById('chat-messages');
  messages.scrollTop = messages.scrollHeight;
  renderBreadcrumb();
  renderTopicTree();
  renderKnowledgeMap();
  filterMessagesByTopic();
}

async function createCourseFromInput(text) {
  const messages = document.getElementById('chat-messages');

  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.textContent = text;
  userMsg.dataset.topicId = '';
  messages.insertBefore(userMsg, inputLine);
  chatInput.textContent = '';
  messages.scrollTop = messages.scrollHeight;

  const courseData = await api('/api/courses', {
    method: 'POST',
    body: JSON.stringify({ name: text.trim() }),
  });

  if (courseData) {
    await loadCourses();
    state.currentCourse = state.courses.find(c => c.id === courseData.id);
    renderCourseSelect();

    state.currentConversation = {
      id: courseData.conversation_id,
      title: text.trim(),
    };
    state.currentTopicId = null;
    state.topicPath = [];
    await loadTopics();
    renderBreadcrumb();

    // Send first message to AI to get suggestions
    showThinkingIndicator(null);
    try {
      const data = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          conversation_id: courseData.conversation_id,
          message: `I want to learn about ${text.trim()}`,
          topic_id: null,
        }),
      });

      hideThinkingIndicator();
      if (data && data.reply) {
        await addBotMessage(data.reply);
      }
    } catch (err) {
      hideThinkingIndicator();
      await addBotMessage(`Great! I've set up "${text.trim()}" as your course. What would you like to learn about?`);
    }
  }

  focusInput();
}

// ── App initialization ──

async function initApp() {
  const user = await api('/api/me');
  if (!user) return;
  state.user = user;
  renderUserInfo();

  await loadCourses();

  if (state.courses.length > 0) {
    state.currentCourse = state.courses[0];
    renderCourseSelect();

    await loadConversation();
    await loadTopics();

    if (state.currentConversation) {
      await loadAndDisplayMessages();

      if (state.currentConversation.messages && state.currentConversation.messages.length === 0) {
        await sleep(400);
        await addBotMessage("Welcome back! What would you like to study?");
      }
    } else {
      await sleep(400);
      await addBotMessage("Welcome back! Start exploring or ask me anything.");
    }
  } else {
    renderCourseSelect();
    await sleep(400);
    await addBotMessage("Hey! Welcome to Studium.");
    await sleep(600);
    await addBotMessage("I'm your study companion. To get started, tell me what subject you'd like to study -- for example, 'Linear Algebra' or 'Python'.");
  }

  focusInput();
}
