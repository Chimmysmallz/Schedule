const monthLabel = document.getElementById("monthLabel");
const calendarGrid = document.getElementById("calendarGrid");
const modal = document.getElementById("composeModal");
const platformFilter = document.getElementById("platformFilter");
const caption = document.getElementById("caption");
const characterCount = document.getElementById("characterCount");
const postDate = document.getElementById("postDate");
const postTime = document.getElementById("postTime");

let displayedDate = new Date(2026, 10, 1);
let selectedFormat = "Post";
let selectedPlatforms = ["instagram"];

const scheduledPosts = [
  { date: "2026-11-02", time: "9:00 AM", title: "Studio journal", format: "post", platform: "instagram" },
  { date: "2026-11-05", time: "11:30 AM", title: "Color stories", format: "carousel", platform: "instagram" },
  { date: "2026-11-08", time: "6:30 PM", title: "Weekend edits", format: "reel", platform: "tiktok" },
  { date: "2026-11-10", time: "12:00 PM", title: "Behind the scenes", format: "post", platform: "instagram" },
  { date: "2026-11-13", time: "4:15 PM", title: "New collection", format: "carousel", platform: "instagram" },
  { date: "2026-11-17", time: "7:00 PM", title: "Making the set", format: "reel", platform: "tiktok" },
  { date: "2026-11-20", time: "10:00 AM", title: "Autumn textures", format: "post", platform: "instagram" },
  { date: "2026-11-24", time: "5:45 PM", title: "Gift guide", format: "carousel", platform: "instagram" },
  { date: "2026-11-27", time: "6:30 PM", title: "Holiday preview", format: "reel", platform: "tiktok" }
];

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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
    if (dateKey(date) === "2026-11-20") day.classList.add("today");

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
            <strong>${post.title}</strong>
            <small>${post.time}</small>
            <span class="platform-badge">${post.platform === "tiktok" ? "♪" : "◎"}</span>
          </span>`;
        card.addEventListener("click", () => showToast(`${post.title} • ${post.time}`));
        day.appendChild(card);
      });
    calendarGrid.appendChild(day);
  }
}

function openComposer(date) {
  const chosen = date || displayedDate;
  postDate.value = dateKey(chosen);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  caption.focus();
}

function closeComposer() {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

document.getElementById("newPostButton").addEventListener("click", () => openComposer(new Date(2026, 10, 20)));
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
  displayedDate = new Date(2026, 10, 20);
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
  });
});

document.getElementById("mediaUpload").addEventListener("click", () => {
  document.getElementById("mediaInput").click();
});

document.getElementById("mediaInput").addEventListener("change", event => {
  const count = event.target.files.length;
  if (count) showToast(`${count} media file${count === 1 ? "" : "s"} added`);
});

document.getElementById("bestTime").addEventListener("click", () => {
  postTime.value = "18:30";
  showToast("Best posting time selected");
});

document.getElementById("saveDraft").addEventListener("click", () => {
  closeComposer();
  showToast("Draft saved");
});

document.getElementById("schedulePost").addEventListener("click", () => {
  if (!selectedPlatforms.length) {
    showToast("Select at least one platform");
    return;
  }
  if (!postDate.value || !postTime.value) {
    showToast("Choose a date and time");
    return;
  }

  const title = caption.value.trim() || `${selectedFormat} post`;
  scheduledPosts.push({
    date: postDate.value,
    time: new Date(`2026-01-01T${postTime.value}`).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit"
    }),
    title,
    format: selectedFormat.toLowerCase(),
    platform: selectedPlatforms[0]
  });
  closeComposer();
  caption.value = "";
  characterCount.textContent = "0";
  const [year, month] = postDate.value.split("-").map(Number);
  displayedDate = new Date(year, month - 1, 1);
  renderCalendar();
  showToast("Post scheduled");
});

renderCalendar();
