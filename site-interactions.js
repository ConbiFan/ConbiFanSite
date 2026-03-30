import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const MAX_COMMENT_LENGTH = 280;
const DISPLAY_NAME_COOKIE = "cf-display-name";
const SESSION_COOKIE_BASE = "cf-supabase-auth";
const COOKIE_CHUNK_SIZE = 3500;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180;
const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "short",
  timeStyle: "short"
});

const config = normalizeConfig(window.CF_INTERACTIONS_CONFIG || {});
const widgetContexts = new Set();
const clientState = {
  client: null,
  user: null,
  owner: false
};

let clientPromise = null;
let observerStarted = false;

function normalizeConfig(rawConfig) {
  return {
    supabaseUrl: String(rawConfig.supabaseUrl || "").trim(),
    supabaseAnonKey: String(rawConfig.supabaseAnonKey || "").trim(),
    ownerEmail: String(rawConfig.ownerEmail || "").trim().toLowerCase(),
    siteName: String(rawConfig.siteName || document.title || "Conbi Fan").trim(),
    ownerRedirectUrl: String(rawConfig.ownerRedirectUrl || "").trim()
  };
}

function hasSupabaseConfig() {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

function readCookie(name) {
  const match = document.cookie
    .split("; ")
    .find(function (entry) {
      return entry.startsWith(name + "=");
    });

  if (!match) {
    return null;
  }

  return decodeURIComponent(match.slice(name.length + 1));
}

function writeCookie(name, value, maxAgeSeconds) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    name +
    "=" +
    encodeURIComponent(value) +
    "; path=/; max-age=" +
    maxAgeSeconds +
    "; SameSite=Lax" +
    secure;
}

function removeCookie(name) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    name +
    "=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax" +
    secure;
}

function listChunkCookies(baseName) {
  return document.cookie
    .split("; ")
    .map(function (entry) {
      const separator = entry.indexOf("=");
      return {
        name: separator === -1 ? entry : entry.slice(0, separator),
        value: separator === -1 ? "" : entry.slice(separator + 1)
      };
    })
    .filter(function (entry) {
      return entry.name === baseName || entry.name.startsWith(baseName + ".");
    })
    .sort(function (left, right) {
      if (left.name === right.name) {
        return 0;
      }

      if (left.name === baseName) {
        return -1;
      }

      if (right.name === baseName) {
        return 1;
      }

      const leftIndex = Number(left.name.split(".").pop());
      const rightIndex = Number(right.name.split(".").pop());
      return leftIndex - rightIndex;
    });
}

function clearChunkCookies(baseName) {
  listChunkCookies(baseName).forEach(function (entry) {
    removeCookie(entry.name);
  });
}

function createSessionStorageAdapter() {
  return {
    getItem: function () {
      const cookies = listChunkCookies(SESSION_COOKIE_BASE);
      if (!cookies.length) {
        return null;
      }

      return cookies
        .map(function (entry) {
          return decodeURIComponent(entry.value);
        })
        .join("");
    },
    setItem: function (_, value) {
      clearChunkCookies(SESSION_COOKIE_BASE);

      if (!value) {
        return;
      }

      if (value.length <= COOKIE_CHUNK_SIZE) {
        writeCookie(SESSION_COOKIE_BASE, value, COOKIE_MAX_AGE);
        return;
      }

      for (let index = 0; index < value.length; index += COOKIE_CHUNK_SIZE) {
        const chunk = value.slice(index, index + COOKIE_CHUNK_SIZE);
        const chunkName = SESSION_COOKIE_BASE + "." + index / COOKIE_CHUNK_SIZE;
        writeCookie(chunkName, chunk, COOKIE_MAX_AGE);
      }
    },
    removeItem: function () {
      clearChunkCookies(SESSION_COOKIE_BASE);
    }
  };
}

function readDisplayName() {
  return readCookie(DISPLAY_NAME_COOKIE) || "";
}

function saveDisplayName(name) {
  writeCookie(DISPLAY_NAME_COOKIE, name, COOKIE_MAX_AGE);
}

function pagePath() {
  const path = location.pathname || "/index.html";
  return path === "/" ? "/index.html" : path;
}

function threadKey(id) {
  return pagePath() + "::" + id;
}

function formatDate(value) {
  try {
    return dateFormatter.format(new Date(value));
  } catch (error) {
    return "";
  }
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (typeof text === "string") {
    element.textContent = text;
  }
  return element;
}

function defaultOwnerRedirectUrl() {
  if (!/^https?:/i.test(location.href)) {
    return "";
  }

  return location.origin + "/owner.html";
}

function isOwnerUser(user) {
  return Boolean(
    user &&
      user.email &&
      config.ownerEmail &&
      user.email.toLowerCase() === config.ownerEmail
  );
}

async function getClient() {
  if (!hasSupabaseConfig()) {
    return null;
  }

  if (!clientPromise) {
    const storage = createSessionStorageAdapter();

    clientState.client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        persistSession: true,
        storage: storage
      }
    });

    clientPromise = clientState.client.auth.getUser().then(function (result) {
      clientState.user = result.data.user || null;
      clientState.owner = isOwnerUser(clientState.user);
      return clientState.client;
    });

    clientState.client.auth.onAuthStateChange(function (_, session) {
      clientState.user = session ? session.user : null;
      clientState.owner = isOwnerUser(clientState.user);
      refreshAllWidgets();
      notifyOwnerConsole();
    });
  }

  return clientPromise;
}

async function ensureVisitorSession() {
  const client = await getClient();

  if (!client) {
    return null;
  }

  if (clientState.user) {
    return clientState.user;
  }

  const result = await client.auth.signInAnonymously();
  if (result.error) {
    throw result.error;
  }

  clientState.user = result.data.user || null;
  clientState.owner = isOwnerUser(clientState.user);
  return clientState.user;
}

async function startOwnerMagicLink() {
  const client = await getClient();
  if (!client) {
    throw new Error("Supabase の設定がまだ入ってない。");
  }

  if (!config.ownerEmail) {
    throw new Error("ownerEmail が未設定。");
  }

  const redirectUrl = config.ownerRedirectUrl || defaultOwnerRedirectUrl();
  const result = await client.auth.signInWithOtp({
    email: config.ownerEmail,
    options: {
      emailRedirectTo: redirectUrl || undefined,
      shouldCreateUser: true
    }
  });

  if (result.error) {
    throw result.error;
  }
}

async function signOutCurrentUser() {
  const client = await getClient();
  if (!client) {
    return;
  }

  const result = await client.auth.signOut();
  if (result.error) {
    throw result.error;
  }
}

async function fetchThreadState(thread) {
  const client = await getClient();
  const user = await ensureVisitorSession();

  const likesPromise = client
    .from("engagement_likes")
    .select("user_id")
    .eq("thread_id", thread);

  const commentsPromise = client
    .from("engagement_comments")
    .select("id, thread_id, page_path, item_label, display_name, body, created_at")
    .eq("thread_id", thread)
    .order("created_at", { ascending: false });

  const results = await Promise.all([likesPromise, commentsPromise]);
  const likesResult = results[0];
  const commentsResult = results[1];

  if (likesResult.error) {
    throw likesResult.error;
  }

  if (commentsResult.error) {
    throw commentsResult.error;
  }

  const likeRows = likesResult.data || [];
  const comments = commentsResult.data || [];

  return {
    comments: comments,
    liked: likeRows.some(function (row) {
      return row.user_id === user.id;
    }),
    likes: likeRows.length
  };
}

async function toggleLike(thread, liked) {
  const client = await getClient();
  const user = await ensureVisitorSession();

  if (liked) {
    const result = await client
      .from("engagement_likes")
      .delete()
      .eq("thread_id", thread)
      .eq("user_id", user.id);

    if (result.error) {
      throw result.error;
    }

    return;
  }

  const result = await client.from("engagement_likes").upsert(
    {
      thread_id: thread,
      user_id: user.id
    },
    {
      onConflict: "thread_id,user_id"
    }
  );

  if (result.error) {
    throw result.error;
  }
}

async function addComment(context, name, text) {
  const client = await getClient();
  const user = await ensureVisitorSession();
  const result = await client.from("engagement_comments").insert({
    body: text,
    display_name: name,
    item_label: context.itemLabel,
    page_path: pagePath(),
    thread_id: context.thread,
    user_id: user.id
  });

  if (result.error) {
    throw result.error;
  }
}

async function deleteComment(commentId) {
  const client = await getClient();
  const result = await client.from("engagement_comments").delete().eq("id", commentId);

  if (result.error) {
    throw result.error;
  }
}

async function createReport(comment, reason) {
  const client = await getClient();
  const user = await ensureVisitorSession();
  const result = await client.from("engagement_reports").insert({
    comment_author: comment.display_name,
    comment_body: comment.body,
    comment_id: comment.id,
    item_label: comment.item_label,
    page_path: comment.page_path,
    reason: reason,
    reporter_user_id: user.id,
    thread_id: comment.thread_id
  });

  if (result.error) {
    throw result.error;
  }
}

async function fetchReports() {
  const client = await getClient();
  const result = await client
    .from("engagement_reports")
    .select(
      "id, comment_id, thread_id, page_path, item_label, comment_author, comment_body, reason, created_at, resolved_at"
    )
    .order("created_at", { ascending: false });

  if (result.error) {
    throw result.error;
  }

  return result.data || [];
}

async function resolveReport(reportId) {
  const client = await getClient();
  const user = await ensureVisitorSession();
  const result = await client
    .from("engagement_reports")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: user.id
    })
    .eq("id", reportId);

  if (result.error) {
    throw result.error;
  }
}

function inferItemLabel(target, fallback) {
  if (target.dataset.itemLabel) {
    return target.dataset.itemLabel;
  }

  const container =
    target.closest(".download-card, .card, .seed-card, section") || target.parentElement;

  if (!container) {
    return fallback;
  }

  const labelSource = container.querySelector("h1, h2, h3, .seed");
  return labelSource ? labelSource.textContent.trim() : fallback;
}

function createSetupNotice() {
  return createElement(
    "div",
    "cf-interactions__setup",
    "共有コメントを使うには site-interactions-config.js に Supabase のURLとpublishable keyを入れて、SQLを流す必要がある。ownerEmail は削除と通報管理用。"
  );
}

function buildCommentCard(context, comment) {
  const card = createElement("article", "cf-interactions__comment");
  const head = createElement("div", "cf-interactions__comment-head");
  const author = createElement("span", "cf-interactions__author", comment.display_name);
  const time = createElement("span", "cf-interactions__time", formatDate(comment.created_at));
  const body = createElement("p", "cf-interactions__body", comment.body);
  const actions = createElement("div", "cf-interactions__comment-actions");
  const reportButton = createElement("button", "cf-interactions__report", "報告");
  reportButton.type = "button";
  reportButton.title = "このコメントを通報する";
  reportButton.addEventListener("click", async function () {
    const reason = window.prompt("通報理由を入力して。ownerページの一覧に入る。", "");
    if (reason === null) {
      return;
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      window.alert("通報理由は空だと送れない。");
      return;
    }

    context.statusMessage = "報告を送信中...";
    context.statusTone = "";
    context.render();

    try {
      await createReport(comment, trimmedReason);
      context.statusMessage = "報告した。owner ページの一覧で確認できる。";
      context.statusTone = "ok";
      context.render();
    } catch (error) {
      context.statusMessage = friendlyError(error);
      context.statusTone = "error";
      context.render();
    }
  });

  head.appendChild(author);
  head.appendChild(time);
  actions.appendChild(reportButton);

  if (clientState.owner) {
    const deleteButton = createElement("button", "cf-interactions__delete", "削除");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", async function () {
      const ok = window.confirm("このコメントを消す？");
      if (!ok) {
        return;
      }

      context.statusMessage = "削除中...";
      context.statusTone = "";
      context.render();

      try {
        await deleteComment(comment.id);
        await context.reload();
        context.statusMessage = "コメントを削除した。";
        context.statusTone = "ok";
        context.render();
      } catch (error) {
        context.statusMessage = friendlyError(error);
        context.statusTone = "error";
        context.render();
      }
    });
    actions.appendChild(deleteButton);
  }

  card.appendChild(head);
  card.appendChild(body);
  card.appendChild(actions);
  return card;
}

function friendlyError(error) {
  if (!error) {
    return "なんか失敗した。時間を置いてもう一回頼む。";
  }

  const message = String(error.message || error);

  if (/anonymous/i.test(message)) {
    return "Supabase 側で Anonymous sign-ins がオフっぽい。設定を入れてから再読込して。";
  }

  if (/Invalid API key/i.test(message) || /401/.test(message)) {
    return "Supabase の URL か anon key が違う。config を見直して。";
  }

  if (/row-level security/i.test(message) || /permission/i.test(message)) {
    return "権限設定で弾かれてる。SQL のポリシー確認が必要。";
  }

  if (/engagement_reports/i.test(message) && /exist/i.test(message)) {
    return "通報用テーブルがまだない。更新後の SQL をもう一回流して。";
  }

  return message;
}

function createWidgetContext(target, options) {
  const mode = options.mode || "card";
  const context = {
    comments: [],
    headingText: options.heading || (mode === "page" ? "ひとこと掲示板" : ""),
    introText: options.intro || "",
    itemLabel: options.itemLabel || inferItemLabel(target, options.id),
    likeCount: 0,
    liked: false,
    loading: true,
    metaText: options.metaText || (mode === "page" ? "共有コメントを読み込み中" : "共有リアクションを読み込み中"),
    mode: mode,
    noteText:
      options.note ||
      "コメントといいねは共有保存される。報告は owner 側の一覧へ送られる。",
    panelOpen: Boolean(options.expanded),
    setupNotice: null,
    statusMessage: "",
    statusTone: "",
    target: target,
    thread: threadKey(options.id)
  };

  const root = createElement("section", "cf-interactions cf-interactions--" + mode);
  const heading = context.headingText
    ? createElement("h3", "cf-interactions__heading", context.headingText)
    : null;
  const intro = context.introText
    ? createElement("p", "cf-interactions__intro", context.introText)
    : null;
  const status = createElement("p", "cf-interactions__status");
  const bar = createElement("div", "cf-interactions__bar");
  const likeButton = createElement("button", "cf-interactions__action");
  likeButton.type = "button";
  const likeText = createElement("span", "", "いいね");
  const likeCount = createElement("span", "cf-interactions__count", "0");
  const commentButton = createElement("button", "cf-interactions__action");
  commentButton.type = "button";
  const commentText = createElement("span", "", "コメント");
  const commentCount = createElement("span", "cf-interactions__count", "0");
  const meta = createElement("span", "cf-interactions__meta-text", context.metaText);
  const ownerChip = createElement("span", "cf-interactions__owner-chip", "owner mode");
  ownerChip.hidden = true;
  const panel = createElement("div", "cf-interactions__panel");
  const form = createElement("form", "cf-interactions__form");
  const nameField = createElement("label", "cf-interactions__field");
  const nameLabel = createElement("span", "cf-interactions__label", "名前");
  const nameInput = createElement("input", "cf-interactions__input");
  nameInput.type = "text";
  nameInput.maxLength = 24;
  nameInput.placeholder = "名無しのクラフター";
  nameInput.value = readDisplayName();
  const textField = createElement("label", "cf-interactions__field");
  const textLabel = createElement(
    "span",
    "cf-interactions__label",
    options.formLabel || "コメント"
  );
  const textArea = createElement("textarea", "cf-interactions__textarea");
  textArea.maxLength = MAX_COMMENT_LENGTH;
  textArea.placeholder = options.placeholder || "感想を書いてみて";
  const footer = createElement("div", "cf-interactions__footer");
  const note = createElement("span", "cf-interactions__note", context.noteText);
  const submit = createElement("button", "cf-interactions__submit", "送信");
  submit.type = "submit";
  const list = createElement("div", "cf-interactions__list");
  const empty = createElement(
    "p",
    "cf-interactions__empty",
    "まだコメントはない。最初のひとこと、置いていける。"
  );

  likeButton.appendChild(likeText);
  likeButton.appendChild(likeCount);
  commentButton.appendChild(commentText);
  commentButton.appendChild(commentCount);
  bar.appendChild(likeButton);
  bar.appendChild(commentButton);
  bar.appendChild(meta);
  bar.appendChild(ownerChip);

  nameField.appendChild(nameLabel);
  nameField.appendChild(nameInput);
  textField.appendChild(textLabel);
  textField.appendChild(textArea);
  footer.appendChild(note);
  footer.appendChild(submit);
  form.appendChild(nameField);
  form.appendChild(textField);
  form.appendChild(footer);
  panel.appendChild(form);
  panel.appendChild(list);

  if (heading) {
    root.appendChild(heading);
  }
  if (intro) {
    root.appendChild(intro);
  }
  root.appendChild(status);
  root.appendChild(bar);
  root.appendChild(panel);
  target.appendChild(root);

  context.elements = {
    commentButton: commentButton,
    commentCount: commentCount,
    empty: empty,
    likeButton: likeButton,
    likeCount: likeCount,
    list: list,
    meta: meta,
    nameInput: nameInput,
    ownerChip: ownerChip,
    panel: panel,
    status: status,
    submit: submit,
    textArea: textArea
  };

  context.render = function () {
    context.elements.likeCount.textContent = String(context.likeCount);
    context.elements.commentCount.textContent = String(context.comments.length);
    context.elements.likeButton.classList.toggle("is-liked", context.liked);
    context.elements.likeButton.disabled = context.loading;
    context.elements.commentButton.disabled = context.loading;
    context.elements.submit.disabled = context.loading;
    context.elements.likeButton.setAttribute("aria-pressed", context.liked ? "true" : "false");
    context.elements.commentButton.setAttribute(
      "aria-expanded",
      context.panelOpen ? "true" : "false"
    );
    context.elements.panel.classList.toggle("is-open", context.panelOpen);
    context.elements.ownerChip.hidden = !clientState.owner;
    context.elements.meta.textContent = context.metaText;
    context.elements.meta.classList.toggle("is-error", context.statusTone === "error");
    context.elements.meta.classList.toggle("is-ok", context.statusTone === "ok");
    context.elements.status.textContent = context.statusMessage;
    context.elements.status.classList.toggle("is-error", context.statusTone === "error");
    context.elements.status.classList.toggle("is-ok", context.statusTone === "ok");

    context.elements.list.innerHTML = "";
    if (!context.comments.length) {
      context.elements.list.appendChild(context.elements.empty);
    } else {
      context.comments.forEach(function (comment) {
        context.elements.list.appendChild(buildCommentCard(context, comment));
      });
    }
  };

  context.reload = async function () {
    if (!hasSupabaseConfig()) {
      context.loading = false;
      context.statusMessage = "";
      context.metaText = "共有コメントの設定待ち";
      if (!context.setupNotice) {
        context.setupNotice = createSetupNotice();
        context.target.appendChild(context.setupNotice);
      }
      context.render();
      return;
    }

    context.loading = true;
    context.statusMessage = "";
    context.metaText = "共有データを読み込み中";
    context.render();

    try {
      const state = await fetchThreadState(context.thread);
      context.comments = state.comments;
      context.likeCount = state.likes;
      context.liked = state.liked;
      context.metaText = clientState.owner
        ? "owner として閲覧中。削除ボタンが使える。"
        : "共有コメントを表示中";
      context.statusTone = "";
    } catch (error) {
      context.metaText = "読み込みに失敗";
      context.statusMessage = friendlyError(error);
      context.statusTone = "error";
    } finally {
      context.loading = false;
      context.render();
    }
  };

  likeButton.addEventListener("click", async function () {
    context.loading = true;
    context.statusMessage = "";
    context.metaText = "いいねを更新中";
    context.render();

    try {
      await toggleLike(context.thread, context.liked);
      await context.reload();
    } catch (error) {
      context.loading = false;
      context.statusMessage = friendlyError(error);
      context.statusTone = "error";
      context.render();
    }
  });

  commentButton.addEventListener("click", function () {
    context.panelOpen = !context.panelOpen;
    context.render();
  });

  nameInput.addEventListener("change", function () {
    saveDisplayName(nameInput.value.trim() || "名無しのクラフター");
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const name = nameInput.value.trim() || "名無しのクラフター";
    const text = textArea.value.trim();

    if (!text) {
      textArea.focus();
      return;
    }

    saveDisplayName(name);
    nameInput.value = name;
    context.loading = true;
    context.statusMessage = "";
    context.metaText = "コメント送信中";
    context.render();

    try {
      await addComment(context, name, text);
      textArea.value = "";
      context.panelOpen = true;
      await context.reload();
      context.statusMessage = "コメントを送った。";
      context.statusTone = "ok";
      context.render();
    } catch (error) {
      context.loading = false;
      context.statusMessage = friendlyError(error);
      context.statusTone = "error";
      context.render();
    }
  });

  context.render();
  widgetContexts.add(context);
  return context;
}

function refreshAllWidgets() {
  widgetContexts.forEach(function (context) {
    context.reload();
  });
}

function mountInteraction(target, options) {
  if (!target || target.dataset.cfInteractionsMounted === "true") {
    return null;
  }

  target.dataset.cfInteractionsMounted = "true";
  const context = createWidgetContext(target, options);
  context.reload();
  return context;
}

function mountAll() {
  document.querySelectorAll("[data-page-engagement]").forEach(function (target) {
    mountInteraction(target, {
      expanded: target.dataset.engagementExpanded === "true",
      formLabel: target.dataset.formLabel,
      heading: target.dataset.engagementHeading,
      id: target.dataset.pageEngagement,
      intro: target.dataset.engagementIntro,
      itemLabel: target.dataset.itemLabel,
      metaText: target.dataset.metaText,
      mode: "page",
      note: target.dataset.engagementNote,
      placeholder: target.dataset.commentPlaceholder
    });
  });

  document.querySelectorAll("[data-entry-engagement]").forEach(function (target) {
    mountInteraction(target, {
      formLabel: target.dataset.formLabel,
      id: target.dataset.entryEngagement,
      intro: target.dataset.engagementIntro,
      itemLabel: target.dataset.itemLabel,
      metaText: target.dataset.metaText,
      mode: "card",
      note: target.dataset.engagementNote,
      placeholder: target.dataset.commentPlaceholder
    });
  });

  if (!observerStarted) {
    observerStarted = true;
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (!(node instanceof HTMLElement)) {
            return;
          }

          if (node.matches("[data-entry-engagement], [data-page-engagement]")) {
            mountAll();
            return;
          }

          if (
            node.querySelector &&
            node.querySelector("[data-entry-engagement], [data-page-engagement]")
          ) {
            mountAll();
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}

function getOwnerConsoleElements() {
  return {
    email: document.querySelector("[data-owner-email]"),
    login: document.querySelector("[data-owner-login]"),
    logout: document.querySelector("[data-owner-logout]"),
    status: document.querySelector("[data-owner-status]")
  };
}

function renderOwnerConsole() {
  const elements = getOwnerConsoleElements();
  if (!elements.status) {
    return;
  }

  if (!hasSupabaseConfig()) {
    elements.status.textContent =
      "site-interactions-config.js の Supabase 設定がまだ空。";
    if (elements.login) {
      elements.login.disabled = true;
    }
    if (elements.logout) {
      elements.logout.disabled = true;
    }
    return;
  }

  if (elements.email) {
    elements.email.textContent = config.ownerEmail || "(ownerEmail 未設定)";
  }

  if (!config.ownerEmail) {
    elements.status.textContent =
      "ownerEmail が未設定。削除権限はまだ有効化できない。";
    if (elements.login) {
      elements.login.hidden = false;
      elements.login.disabled = true;
    }
    if (elements.logout) {
      elements.logout.hidden = true;
    }
    return;
  }

  if (clientState.owner) {
    elements.status.textContent =
      "オーナーとしてログイン中。このブラウザから削除ボタンが使える。";
    if (elements.login) {
      elements.login.hidden = true;
    }
    if (elements.logout) {
      elements.logout.hidden = false;
      elements.logout.disabled = false;
    }
    return;
  }

  elements.status.textContent =
    "まだオーナーログインしてない。ボタンを押すと magic link を送る。";
  if (elements.login) {
    elements.login.hidden = false;
    elements.login.disabled = false;
  }
  if (elements.logout) {
    elements.logout.hidden = true;
  }
}

function notifyOwnerConsole() {
  renderOwnerConsole();
}

async function setupOwnerConsole() {
  const elements = getOwnerConsoleElements();
  if (!elements.status) {
    return;
  }

  renderOwnerConsole();

  if (elements.login) {
    elements.login.addEventListener("click", async function () {
      elements.login.disabled = true;
      elements.status.textContent = "magic link を送信中...";

      try {
        await startOwnerMagicLink();
        elements.status.textContent =
          "メールを送った。受信したリンクをこのサイトで開けば owner になる。";
      } catch (error) {
        elements.status.textContent = friendlyError(error);
      } finally {
        elements.login.disabled = false;
      }
    });
  }

  if (elements.logout) {
    elements.logout.addEventListener("click", async function () {
      elements.logout.disabled = true;
      elements.status.textContent = "ログアウト中...";

      try {
        await signOutCurrentUser();
        elements.status.textContent = "ログアウトした。";
      } catch (error) {
        elements.status.textContent = friendlyError(error);
      } finally {
        elements.logout.disabled = false;
      }
    });
  }

  try {
    await getClient();
  } catch (error) {
    elements.status.textContent = friendlyError(error);
  }

  renderOwnerConsole();
}

document.addEventListener("DOMContentLoaded", function () {
  mountAll();
  setupOwnerConsole();
});

window.CfInteractions = {
  getClient: getClient,
  isOwnerUser: isOwnerUser,
  mountAll: mountAll,
  mountEntry: function (target, options) {
    return mountInteraction(target, Object.assign({ mode: "card" }, options || {}));
  },
  mountPage: function (target, options) {
    return mountInteraction(target, Object.assign({ mode: "page" }, options || {}));
  },
  fetchReports: fetchReports,
  resolveReport: resolveReport,
  deleteComment: deleteComment,
  signOutCurrentUser: signOutCurrentUser,
  startOwnerMagicLink: startOwnerMagicLink
};

export {
  deleteComment,
  fetchReports,
  getClient,
  isOwnerUser,
  resolveReport,
  signOutCurrentUser,
  startOwnerMagicLink
};
