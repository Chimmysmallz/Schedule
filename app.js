const postflowConfig = window.POSTFLOW_CONFIG || {};
const supabaseClient = window.supabase?.createClient(postflowConfig.supabaseUrl, postflowConfig.supabasePublishableKey);
const apiBase = `${postflowConfig.supabaseUrl}/functions/v1/postflow-api`;

async function apiFetch(path, options = {}) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.access_token) throw new Error("Please sign in first");
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: { "Content-Type":"application/json", ...(options.headers || {}), Authorization:`Bearer ${session.access_token}`, apikey:postflowConfig.supabasePublishableKey }
  });
}

const monthLabel = document.getElementById("monthLabel");
const calendarGrid = document.getElementById("calendarGrid");
const modal = document.getElementById("composeModal");
const platformFilter = document.getElementById("platformFilter");
const caption = document.getElementById("caption");
const characterCount = document.getElementById("characterCount");
const postDate = document.getElementById("postDate");
const postTime = document.getElementById("postTime");

let displayedDate = new Date();
let selectedFormat = "Post";
let selectedPlatforms = ["instagram"];
let selectedPrivacyLevel = "";
let publishMode = "dry-run";
let scheduledPosts = [];
let pendingMedia = [];
let editingPostId = null;

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function postDateParts(post) {
  const date = new Date(post.scheduledAt);
  return {
    date: dateKey(date),
    time: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  };
}

async function loadPosts() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();\n    if (!session) { scheduledPosts = []; renderCalendar(); return; }\n    const response = await apiFetch("/posts");
    if (!response.ok) throw new Error("Could not load posts");
    const posts = await response.json();
    scheduledPosts = posts.map(post => ({
      ...post,
      ...postDateParts(post)
    }));
  } catch {
    scheduledPosts = [];
  }
  renderCalendar();
}

async function loadAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const authButton = document.getElementById("authButton");
  authButton.hidden = false;
  authButton.textContent = session ? "Sign out" : "Sign in";
  document.getElementById("newPostButton").disabled = !session;
}

document.getElementById("authButton").addEventListener("click", async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    await supabaseClient.auth.signOut();
    scheduledPosts = [];
    renderCalendar();
    await loadAuth();
    return;
  }
  const email = window.prompt("Postflow sign-in email");
  if (!email) return;
  const password = window.prompt("Postflow password");
  if (!password) return;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) { showToast(error.message); return; }
  await loadAuth();
  await loadPosts();
});

async function loadTikTokPrivacyOptions() {
  const field = document.getElementById("tiktokPrivacyField");
  const select = document.getElementById("tiktokPrivacy");
  const help = document.getElementById("tiktokPrivacyHelp");
  if (!selectedPlatforms.includes("tiktok")) {
    field.hidden = true;
    return;
  }
  field.hidden = false;
  select.innerHTML = '<option value="">Choose visibility</option>';
  try {
    const configResponse = await apiFetch("/config");
    const config = await configResponse.json();
    let options;
    if (config.providers?.tiktok) {
      const response = await apiFetch("/tiktok/creator-info");
      if (!response.ok) throw new Error("Could not load TikTok account settings");
      const creator = await response.json();
      options = creator.privacyLevelOptions || [];
      help.textContent = "Choose who can view this post on TikTok.";
    } else if (config.publishMode === "dry-run") {
      options = ["SELF_ONLY"];
      help.textContent = "Dry-run mode only. Connect TikTok to load your account's actual privacy options.";
    } else {
      throw new Error("TikTok is not connected");
    }
    for (const option of options) {
      const item = document.createElement("option");
      item.value = option;
      item.textContent = ({
        PUBLIC_TO_EVERYONE: "Everyone",
        MUTUAL_FOLLOW_FRIENDS: "Friends",
        FOLLOWER_OF_CREATOR: "Followers",
        SELF_ONLY: "Only me"
      })[option] || option;
      select.appendChild(item);
    }
    if (options.includes(selectedPrivacyLevel)) select.value = selectedPrivacyLevel;
    else select.value = "";
  } catch (error) {
    help.textContent = error.message;
    showToast("Could not load TikTok visibility options");
  }
}

document.getElementById("tiktokPrivacy").addEventListener("change", event => {
  selectedPrivacyLevel = event.target.value;
});

function renderCalendar() {
  const year = displayedDate.getFullYear();
  const month = displayedDate.getMonth();
  monthLabel.textContent = displayedDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  calendarGrid.innerHTML = "";

  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  for (let i = 0; i < 35; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const day = document.createElement("div");
    day.className = "day";
    if (date.getMonth() !== month) day.classList.add("muted");
    if (dateKey(date) === dateKey(new Date())) day.classList.add("today");

    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = date.getDate();
    day.appendChild(number);

    const add = document.createElement("button");
    add.className = "day-add";
    add.textContent = "+";
    add.setAttribute("aria-label", `Add post on ${date.toLocaleDateString()}`);
    add.addEventListener("click", () => openComposer(date));
    day.appendChild(add);

    scheduledPosts
      .filter(post => post.date === dateKey(date))
      .filter(post => platformFilter.value === "all" || post.platform === platformFilter.value)
      .forEach(post => {
        const card = document.createElement("button");
        card.className = `post-card ${post.format} ${post.platform}`;
        card.innerHTML = `
          <span class="thumb">${post.format === "reel" ? "▶" : post.format === "carousel" ? "▦" : "◉"}</span>
          <span class="post-card-copy">
            <strong>${escapeHtml(post.title)}</strong>
            <small>${post.time}${post.status ? ` • ${post.status}` : ""}</small>
            <span class="platform-badge">${post.platform === "tiktok" ? "♪" : "◎"}</span>
          </span>`;
        card.addEventListener("click", () => {
          if (post.status === "draft") {
            openComposer(new Date(`${post.date}T12:00:00`), post);
            return;
          }
          if (post.status === "failed") {
            if (window.confirm(`Retry "${post.title}"?`)) retryPost(post.id);
            return;
          }
          if (post.status === "scheduled" && window.confirm(`Cancel "${post.title}"?`)) {
            cancelPost(post.id);
            return;
          }
          showToast(`${post.title} • ${post.status || "published"}`);
        });
        day.appendChild(card);
      });
    calendarGrid.appendChild(day);
  }
}

function openComposer(date, post) {
  const chosen = date || displayedDate;
  postDate.value = post ? post.scheduledAt?.slice(0, 10) || dateKey(chosen) : dateKey(chosen);
  postTime.value = post?.scheduledAt
    ? new Date(post.scheduledAt).toTimeString().slice(0, 5)
    : "18:30";
  editingPostId = post?.id || null;
  if (post) {
    caption.value = post.caption || "";
    characterCount.textContent = caption.value.length;
    selectedPrivacyLevel = post.privacyLevel || "";
  } else {
    selectedPrivacyLevel = "";
  }
  loadTikTokPrivacyOptions();
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  caption.focus();
}

function closeComposer() {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  editingPostId = null;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

async function retryPost(id) {
  const response = await apiFetch(`/retry?id=${encodeURIComponent(id)}`, { method: "POST" });
  if (!response.ok) {
    showToast("Could not retry post");
    return;
  }
  await loadPosts();
  showToast("Post queued for retry");
}

async function cancelPost(id) {
  const response = await apiFetch(`/posts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) {
    showToast("Could not cancel post");
    return;
  }
  await loadPosts();
  showToast("Post cancelled");
}

document.getElementById("newPostButton").addEventListener("click", () => openComposer(new Date()));
document.getElementById("closeModal").addEventListener("click", closeComposer);
modal.addEventListener("click", event => { if (event.target === modal) closeComposer(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeComposer(); });

document.getElementById("prevMonth").addEventListener("click", () => {
  displayedDate = new Date(displayedDate.getFullYear(), displayedDate.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById("nextMonth").addEventListener("click", () => {
  displayedDate = new Date(displayedDate.getFullYear(), displayedDate.getMonth() + 1, 1);
  renderCalendar();
});
document.getElementById("todayButton").addEventListener("click", () => {
  displayedDate = new Date();
  renderCalendar();
});
platformFilter.addEventListener("change", renderCalendar);

caption.addEventListener("input", () => { characterCount.textContent = caption.value.length; });

document.querySelectorAll(".format-option").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".format-option").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    selectedFormat = button.dataset.format;
  });
});

document.querySelectorAll(".platform-choice").forEach(button => {
  button.addEventListener("click", () => {
    const platform = button.dataset.platform;
    if (button.classList.contains("active") && selectedPlatforms.length > 1) {
      button.classList.remove("active");
      selectedPlatforms = selectedPlatforms.filter(item => item !== platform);
    } else {
      button.classList.add("active");
      if (!selectedPlatforms.includes(platform)) selectedPlatforms.push(platform);
    }
    loadTikTokPrivacyOptions();
  });
});

document.getElementById("mediaUpload").addEventListener("click", () => {
  document.getElementById("mediaInput").click();
});

document.getElementById("mediaInput").addEventListener("change", async event => {
  const files = Array.from(event.target.files);
  if (!files.length) return;
  showToast("Uploading media...");
  pendingMedia = [];

  for (const file of files) {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const response = await apiFetch("/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, data })
    });
    if (!response.ok) {
      showToast("Media upload failed");
      return;
    }
    pendingMedia.push(await response.json());
  }
  showToast(`${pendingMedia.length} media file${pendingMedia.length === 1 ? "" : "s"} added`);
});

document.getElementById("bestTime").addEventListener("click", () => {
  postTime.value = "18:30";
  showToast("Best posting time selected");
});

document.getElementById("generateContent").addEventListener("click", async () => {
  const topic = document.getElementById("contentTopic").value.trim();
  if (!topic) {
    showToast("Enter a topic or campaign idea");
    return;
  }
  showToast("Generating copy...");
  try {
    const platform = selectedPlatforms[0];
    const response = await apiFetch("/content/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, platform, tone: "friendly" })
    });
    if (!response.ok) throw new Error(await response.text());
    const content = await response.json();
    caption.value = content.caption;
    characterCount.textContent = caption.value.length;
    showToast(`Copy generated with ${content.provider === "ai" ? "AI" : "templates"}`);
  } catch {
    showToast("Could not generate copy");
  }
});

document.getElementById("renderContent").addEventListener("click", async () => {
  const title = caption.value.trim() || document.getElementById("contentTopic").value.trim();
  if (!title) {
    showToast("Add a caption or topic first");
    return;
  }
  showToast("Rendering Remotion video...");
  try {
    const response = await apiFetch("/content/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        caption: caption.value.trim(),
        platform: selectedPlatforms[0]
      })
    });
    if (!response.ok) throw new Error(await response.text());
    const media = await response.json();
    pendingMedia = [media];
    showToast("Remotion video ready");
  } catch {
    showToast("Could not render video");
  }
});

document.getElementById("saveDraft").addEventListener("click", async () => {
  const title = caption.value.trim() || `${selectedFormat} post`;
  const body = {
    title,
    caption: caption.value.trim(),
    format: selectedFormat.toLowerCase(),
    platform: selectedPlatforms[0],
    privacyLevel: selectedPrivacyLevel || null,
    status: "draft",
    media: pendingMedia
  };
  try {
    const method = editingPostId ? "PATCH" : "POST";
    const url = editingPostId ? `/posts?id=${encodeURIComponent(editingPostId)}` : "/posts";
    const response = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error("Could not save draft");
    closeComposer();
    caption.value = "";
    pendingMedia = [];
    editingPostId = null;
    editingPostId = null;
    await loadPosts();
    showToast("Draft saved");
  } catch {
    showToast("Could not save draft");
  }
});

document.getElementById("schedulePost").addEventListener("click", async () => {
  if (!selectedPlatforms.length) {
    showToast("Select at least one platform");
    return;
  }
  if (!postDate.value || !postTime.value) {
    showToast("Choose a date and time");
    return;
  }

  const title = caption.value.trim() || `${selectedFormat} post`;
  const scheduledAt = new Date(`${postDate.value}T${postTime.value}:00`).toISOString();
  const created = [];

  const platformsToSchedule = editingPostId ? [selectedPlatforms[0]] : selectedPlatforms;
  for (const platform of platformsToSchedule) {
    try {
      const body = {
        title,
        caption: caption.value.trim(),
        format: selectedFormat.toLowerCase(),
        platform,
        privacyLevel: platform === "tiktok" ? selectedPrivacyLevel : null,
        scheduledAt,
        status: "scheduled",
        media: pendingMedia
      };
      const isEditing = Boolean(editingPostId);
      const response = await apiFetch(isEditing ? `/posts?id=${encodeURIComponent(editingPostId)}` : "/posts", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(await response.text());
      created.push(await response.json());
    } catch {
      showToast(`Could not schedule ${platform}`);
      return;
    }
  }

  closeComposer();
  caption.value = "";
  pendingMedia = [];
  characterCount.textContent = "0";
  const [year, month] = postDate.value.split("-").map(Number);
  displayedDate = new Date(year, month - 1, 1);
  await loadPosts();
  showToast(`${created.length} post${created.length === 1 ? "" : "s"} scheduled`);
});

loadAuth();
loadPosts();
