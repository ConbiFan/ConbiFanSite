import {
  deleteComment,
  fetchReports,
  getClient,
  getVisitorUid,
  isOwnerUser,
  openConfirmDialog,
  resolveReport,
  signOutCurrentUser
} from "./site-interactions.js";
import {
  deleteBlogPost,
  fetchOwnerPosts,
  saveBlogPost,
  toBlogSlug
} from "./blog.js";

const status = document.querySelector("[data-owner-page-status]");
const email = document.querySelector("[data-owner-page-email]");
const loginForm = document.querySelector("[data-owner-login-form]");
const resetForm = document.querySelector("[data-owner-reset-form]");
const passwordInput = document.querySelector("[data-owner-password]");
const newPasswordInput = document.querySelector("[data-owner-new-password]");
const loginButton = document.querySelector("[data-owner-page-login]");
const signupButton = document.querySelector("[data-owner-page-signup]");
const resetButton = document.querySelector("[data-owner-page-reset]");
const savePasswordButton = document.querySelector("[data-owner-page-save-password]");
const logoutButton = document.querySelector("[data-owner-page-logout]");
const visitorUidRow = document.querySelector("[data-owner-visitor-uid-row]");
const visitorUidValue = document.querySelector("[data-owner-visitor-uid]");
const reportsStatus = document.querySelector("[data-owner-reports-status]");
const reportsList = document.querySelector("[data-owner-reports-list]");
const reportsSection = document.querySelector("[data-owner-reports-section]");
const blogSection = document.querySelector("[data-owner-blog-section]");
const blogStatus = document.querySelector("[data-owner-blog-status]");
const blogList = document.querySelector("[data-owner-blog-list]");
const blogForm = document.querySelector("[data-owner-blog-form]");
const blogTitleInput = document.querySelector("[data-owner-blog-title]");
const blogSlugInput = document.querySelector("[data-owner-blog-slug]");
const blogSummaryInput = document.querySelector("[data-owner-blog-summary]");
const blogImageUrlInput = document.querySelector("[data-owner-blog-image-url]");
const blogBodyInput = document.querySelector("[data-owner-blog-body]");
const blogPublishedInput = document.querySelector("[data-owner-blog-published]");
const blogSaveButton = document.querySelector("[data-owner-blog-save]");
const blogCancelButton = document.querySelector("[data-owner-blog-cancel]");
const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "short",
  timeStyle: "short"
});

let recoveryMode = false;
let editingBlogId = "";

function getConfig() {
  return window.CF_INTERACTIONS_CONFIG || {};
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

function setReportStatus(text) {
  if (reportsStatus) {
    reportsStatus.textContent = text;
  }
}

function clearReportList() {
  if (reportsList) {
    reportsList.innerHTML = "";
  }
}

function setBlogStatus(text) {
  if (blogStatus) {
    blogStatus.textContent = text;
  }
}

function clearBlogList() {
  if (blogList) {
    blogList.innerHTML = "";
  }
}

function resetBlogEditor() {
  editingBlogId = "";

  if (blogForm) {
    blogForm.reset();
  }

  if (blogPublishedInput) {
    blogPublishedInput.checked = true;
  }

  if (blogSaveButton) {
    blogSaveButton.textContent = "記事を保存";
  }

  if (blogCancelButton) {
    blogCancelButton.hidden = true;
  }
}

function startBlogEdit(post) {
  editingBlogId = post.id;
  blogTitleInput.value = post.title || "";
  blogSlugInput.value = post.slug || "";
  blogSummaryInput.value = post.summary || "";
  blogImageUrlInput.value = post.image_url || "";
  blogBodyInput.value = post.body || "";
  blogPublishedInput.checked = Boolean(post.is_published);
  blogSaveButton.textContent = "記事を更新";
  blogCancelButton.hidden = false;
  setBlogStatus("編集中: " + post.title);
  blogTitleInput.focus();
}

function renderStatus(message) {
  if (message) {
    status.textContent = message;
  }
}

function showVisitorUid(visible) {
  if (visitorUidRow) {
    visitorUidRow.hidden = !visible;
  }

  if (visitorUidValue) {
    visitorUidValue.textContent = visible ? getVisitorUid() : "";
  }
}

function showOwnerSections(visible) {
  if (blogSection) {
    blogSection.hidden = !visible;
  }

  if (reportsSection) {
    reportsSection.hidden = !visible;
  }

  showVisitorUid(visible);
}

async function signInWithPassword(password) {
  const config = getConfig();
  const client = await getClient();
  const result = await client.auth.signInWithPassword({
    email: config.ownerEmail,
    password: password
  });

  if (result.error) {
    throw result.error;
  }
}

async function sendPasswordReset() {
  const config = getConfig();
  const client = await getClient();
  const result = await client.auth.resetPasswordForEmail(config.ownerEmail, {
    redirectTo: config.ownerRedirectUrl || undefined
  });

  if (result.error) {
    throw result.error;
  }
}

async function signUpOwner(password) {
  const config = getConfig();
  const client = await getClient();
  const result = await client.auth.signUp({
    email: config.ownerEmail,
    password: password
  });

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

function updateForms() {
  if (!loginForm || !resetForm) {
    return;
  }

  loginForm.hidden = recoveryMode;
  resetForm.hidden = !recoveryMode;
}

async function loadReports() {
  clearReportList();
  setReportStatus("通報一覧を読み込んでいます...");

  try {
    const reports = await fetchReports();
    const unresolved = reports.filter(function (report) {
      return !report.resolved_at;
    });

    if (!unresolved.length) {
      setReportStatus("未解決の通報はありません。");
      return;
    }

    setReportStatus("未解決 " + unresolved.length + " 件");
    unresolved.forEach(function (report) {
      reportsList.appendChild(buildReportCard(report));
    });
  } catch (error) {
    setReportStatus(String(error.message || error));
  }
}

async function loadBlogPosts() {
  clearBlogList();
  setBlogStatus("ブログ記事を読み込んでいます...");

  try {
    const posts = await fetchOwnerPosts();
    if (!posts.length) {
      setBlogStatus("まだ記事はないよ。");
      return;
    }

    const publishedCount = posts.filter(function (post) {
      return post.is_published;
    }).length;
    const draftCount = posts.length - publishedCount;

    setBlogStatus("公開 " + publishedCount + " 件 / 下書き " + draftCount + " 件");
    posts.forEach(function (post) {
      blogList.appendChild(buildBlogEntry(post));
    });
  } catch (error) {
    setBlogStatus(String(error.message || error));
  }
}

function buildReportCard(report) {
  const card = createElement("article", "report-card");
  const head = createElement("div", "report-head");
  const title = createElement("div", "report-title", report.item_label || "対象不明");
  const time = createElement("div", "report-time", formatDate(report.created_at));
  const meta = createElement(
    "div",
    "report-meta",
    "ページ: " +
      report.page_path +
      "\n投稿者: " +
      report.comment_author +
      (report.comment_id ? "" : "\nコメントはすでに削除されています")
  );
  const reasonLabel = createElement("div", "label", "通報理由");
  const reasonBox = createElement("div", "report-box", report.reason);
  const bodyLabel = createElement("div", "label", "通報対象コメント");
  const bodyBox = createElement("div", "report-box", report.comment_body);
  const actions = createElement("div", "report-actions");
  const openLink = createElement("a", "secondary", "対象ページを開く");
  openLink.href = report.page_path || "index.html";

  const resolveButton = createElement("button", "secondary", "解決済みにする");
  resolveButton.type = "button";
  resolveButton.addEventListener("click", async function () {
    resolveButton.disabled = true;
    setReportStatus("通報を解決済みにしています...");

    try {
      await resolveReport(report.id);
      await loadReports();
    } catch (error) {
      setReportStatus(String(error.message || error));
      resolveButton.disabled = false;
    }
  });

  actions.appendChild(openLink);
  actions.appendChild(resolveButton);

  if (report.comment_id) {
    const deleteButton = createElement("button", "danger", "コメントを削除して解決");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", async function () {
      const ok = await openConfirmDialog({
        body: "このコメントを削除し、この通報も解決済みにしますか？この操作は元に戻せません。",
        eyebrow: "削除",
        confirmText: "削除して解決",
        title: "コメントを削除",
        tone: "danger"
      });
      if (!ok) {
        return;
      }

      deleteButton.disabled = true;
      setReportStatus("コメント削除と通報解決を処理しています...");

      try {
        await deleteComment(report.comment_id);
        await resolveReport(report.id);
        await loadReports();
      } catch (error) {
        setReportStatus(String(error.message || error));
        deleteButton.disabled = false;
      }
    });
    actions.appendChild(deleteButton);
  }

  head.appendChild(title);
  head.appendChild(time);
  card.appendChild(head);
  card.appendChild(meta);
  card.appendChild(reasonLabel);
  card.appendChild(reasonBox);
  card.appendChild(bodyLabel);
  card.appendChild(bodyBox);
  card.appendChild(actions);
  return card;
}

function buildBlogEntry(post) {
  const card = createElement("article", "blog-entry");
  const head = createElement("div", "blog-entry-head");
  const title = createElement("h3", "blog-entry-title", post.title);
  const badges = createElement("div", "blog-entry-badges");
  const stateBadge = createElement(
    "span",
    "badge" + (post.is_published ? "" : " is-draft"),
    post.is_published ? "公開中" : "下書き"
  );
  const imageBadge = post.image_url ? createElement("span", "badge", "画像あり") : null;
  const meta = createElement(
    "p",
    "blog-entry-meta",
    "作成: " +
      formatDate(post.created_at) +
      " / 更新: " +
      formatDate(post.updated_at || post.created_at)
  );
  const slug = createElement("p", "blog-entry-slug", "slug: " + post.slug);
  const summary = createElement(
    "p",
    "blog-entry-summary",
    post.summary || "概要は未入力"
  );
  const actions = createElement("div", "blog-actions");
  const openLink = createElement(
    "a",
    "secondary",
    post.is_published ? "公開ページを開く" : "下書きのため非公開"
  );
  const editButton = createElement("button", "secondary", "編集");
  const deleteButton = createElement("button", "danger", "削除");

  badges.appendChild(stateBadge);
  if (imageBadge) {
    badges.appendChild(imageBadge);
  }
  head.appendChild(title);
  head.appendChild(badges);

  if (post.is_published) {
    openLink.href = "blog.html#" + post.slug;
  } else {
    openLink.classList.add("is-disabled");
  }

  editButton.type = "button";
  editButton.addEventListener("click", function () {
    startBlogEdit(post);
  });

  deleteButton.type = "button";
  deleteButton.addEventListener("click", async function () {
    const ok = await openConfirmDialog({
      body: "この記事を削除しますか？この操作は元に戻せません。",
      eyebrow: "ブログ削除",
      confirmText: "削除する",
      title: "記事を削除",
      tone: "danger"
    });
    if (!ok) {
      return;
    }

    deleteButton.disabled = true;
    setBlogStatus("記事を削除しています...");

    try {
      await deleteBlogPost(post.id);
      if (editingBlogId === post.id) {
        resetBlogEditor();
      }
      await loadBlogPosts();
    } catch (error) {
      setBlogStatus(String(error.message || error));
      deleteButton.disabled = false;
    }
  });

  actions.appendChild(openLink);
  actions.appendChild(editButton);
  actions.appendChild(deleteButton);
  card.appendChild(head);
  card.appendChild(meta);
  card.appendChild(slug);
  card.appendChild(summary);
  card.appendChild(actions);
  return card;
}

async function refresh() {
  const config = getConfig();
  if (email) {
    email.textContent = config.ownerEmail || "(ownerEmail 未設定)";
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    renderStatus("site-interactions-config.js の Supabase 設定がまだ空です。");
    loginButton.disabled = true;
    signupButton.disabled = true;
    resetButton.disabled = true;
    logoutButton.disabled = true;
    showOwnerSections(false);
    clearBlogList();
    setBlogStatus("Supabase 設定をお待ちください。");
    clearReportList();
    setReportStatus("Supabase 設定をお待ちください。");
    return;
  }

  if (!config.ownerEmail) {
    renderStatus("ownerEmail が未設定です。ここにご自身のメールアドレスを設定するまで削除権限はご利用いただけません。");
    loginButton.disabled = true;
    signupButton.disabled = true;
    resetButton.disabled = true;
    logoutButton.hidden = true;
    showOwnerSections(false);
    clearBlogList();
    setBlogStatus("ownerEmail を設定するとブログ管理もご利用いただけます。");
    clearReportList();
    setReportStatus("ownerEmail を設定すると通報一覧もご利用いただけます。");
    return;
  }

  const client = await getClient();
  const sessionResult = await client.auth.getSession();
  const session = sessionResult.data ? sessionResult.data.session : null;
  let user = session ? session.user : null;

  if (user) {
    const userResult = await client.auth.getUser();
    user = userResult.data ? userResult.data.user : null;
  }

  if (isOwnerUser(user)) {
    renderStatus("オーナーとしてログインしています。このブラウザからコメント削除、通報確認、ブログ投稿をご利用いただけます。");
    logoutButton.hidden = false;
    logoutButton.disabled = false;
    showOwnerSections(true);
    if (!recoveryMode) {
      await loadBlogPosts();
      await loadReports();
    }
    return;
  }

  renderStatus(
    recoveryMode
      ? "再設定モードです。新しいパスワードを保存してから通常どおりログインしてください。"
      : "ownerEmail とパスワードでログインできます。初回は登録ボタンまたは再設定ボタンから開始できます。"
  );
  logoutButton.hidden = true;
  showOwnerSections(false);
  clearBlogList();
  resetBlogEditor();
  setBlogStatus(
    recoveryMode ? "新しいパスワードを保存するとブログ管理を表示できます。" : "owner としてログインすると、ここからブログ記事を書けます。"
  );
  clearReportList();
  setReportStatus(
    recoveryMode ? "新しいパスワードを保存すると通報一覧を表示できます。" : "owner としてログインすると、ここに通報一覧が表示されます。"
  );
}

async function setupRecoveryListener() {
  const client = await getClient();
  client.auth.onAuthStateChange(function (event) {
    if (event === "PASSWORD_RECOVERY") {
      recoveryMode = true;
      updateForms();
      showOwnerSections(false);
      renderStatus("再設定リンクを確認しました。新しいパスワードを入力して保存してください。");
      setBlogStatus("パスワード再設定が完了するまでブログ管理は表示されません。");
      setReportStatus("パスワード再設定が完了するまで通報一覧は表示されません。");
    }
  });
}

document.addEventListener("DOMContentLoaded", function () {
  updateForms();
  resetBlogEditor();

  setupRecoveryListener()
    .then(function () {
      return refresh();
    })
    .catch(function (error) {
      renderStatus(String(error.message || error));
      setReportStatus(String(error.message || error));
    });

  if (blogForm) {
    blogForm.addEventListener("submit", async function (event) {
      event.preventDefault();

      if (!blogSlugInput.value.trim() && blogTitleInput.value.trim()) {
        blogSlugInput.value = toBlogSlug(blogTitleInput.value);
      }

      blogSaveButton.disabled = true;
      blogCancelButton.disabled = true;
      setBlogStatus(editingBlogId ? "記事を更新しています..." : "記事を保存しています...");

      try {
        const saved = await saveBlogPost({
          body: blogBodyInput.value,
          id: editingBlogId || undefined,
          imageUrl: blogImageUrlInput.value,
          isPublished: blogPublishedInput.checked,
          slug: blogSlugInput.value,
          summary: blogSummaryInput.value,
          title: blogTitleInput.value
        });

        resetBlogEditor();
        await loadBlogPosts();
        setBlogStatus(
          (saved.is_published ? "記事を保存したよ。" : "下書きを保存したよ。") +
            " slug: " +
            saved.slug
        );
      } catch (error) {
        setBlogStatus(String(error.message || error));
      } finally {
        blogSaveButton.disabled = false;
        blogCancelButton.disabled = false;
      }
    });
  }

  if (blogCancelButton) {
    blogCancelButton.addEventListener("click", function () {
      resetBlogEditor();
      setBlogStatus("新規記事モードに戻したよ。");
    });
  }

  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const password = passwordInput.value;

    loginButton.disabled = true;
    renderStatus("ログインしています...");

    try {
      await signInWithPassword(password);
      passwordInput.value = "";
      await refresh();
    } catch (error) {
      renderStatus(String(error.message || error));
    } finally {
      loginButton.disabled = false;
    }
  });

  signupButton.addEventListener("click", async function () {
    const password = passwordInput.value.trim();

    if (password.length < 8) {
      renderStatus("初回登録を行う場合は、先に8文字以上のパスワードをご入力ください。");
      return;
    }

    signupButton.disabled = true;
    renderStatus("初回登録を行っています...");

    try {
      const data = await signUpOwner(password);
      passwordInput.value = "";

      if (data.session) {
        renderStatus("登録が完了しました。このまま owner としてログインしています。");
        await refresh();
        return;
      }

      renderStatus(
        "登録リクエストは完了しましたが、すぐにはログインできていません。Supabase の Confirm email を一時的に OFF にしてから再度お試しください。"
      );
    } catch (error) {
      renderStatus(String(error.message || error));
    } finally {
      signupButton.disabled = false;
    }
  });

  resetButton.addEventListener("click", async function () {
    resetButton.disabled = true;
    renderStatus("再設定メールを送信しています...");

    try {
      await sendPasswordReset();
      renderStatus("再設定メールを送信しました。メール内のリンクから新しいパスワードを設定してください。");
    } catch (error) {
      renderStatus(String(error.message || error));
    } finally {
      resetButton.disabled = false;
    }
  });

  resetForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const newPassword = newPasswordInput.value.trim();

    if (newPassword.length < 8) {
      renderStatus("パスワードは8文字以上で設定してください。");
      return;
    }

    savePasswordButton.disabled = true;
    renderStatus("新しいパスワードを保存しています...");

    try {
      const client = await getClient();
      const result = await client.auth.updateUser({
        password: newPassword
      });

      if (result.error) {
        throw result.error;
      }

      newPasswordInput.value = "";
      recoveryMode = false;
      updateForms();
      renderStatus("パスワードを更新しました。次回からは通常どおりログインできます。");
      await refresh();
    } catch (error) {
      renderStatus(String(error.message || error));
    } finally {
      savePasswordButton.disabled = false;
    }
  });

  logoutButton.addEventListener("click", async function () {
    logoutButton.disabled = true;
    renderStatus("ログアウトしています...");

    try {
      await signOutCurrentUser();
      recoveryMode = false;
      updateForms();
      renderStatus("ログアウトしました。");
      await refresh();
    } catch (error) {
      renderStatus(String(error.message || error));
    } finally {
      logoutButton.disabled = false;
    }
  });
});
