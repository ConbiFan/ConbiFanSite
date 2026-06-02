import { getClient, isOwnerUser } from "./site-interactions.js";

const BLOG_TITLE_MAX_LENGTH = 120;
const BLOG_SUMMARY_MAX_LENGTH = 220;
const BLOG_BODY_MAX_LENGTH = 12000;
const BLOG_IMAGE_URL_MAX_LENGTH = 2000;
const blogDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short"
});

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

function formatDate(value) {
  try {
    return blogDateFormatter.format(new Date(value));
  } catch (error) {
    return "";
  }
}

function friendlyBlogError(error) {
  const message = String(error && error.message ? error.message : error);

  if (/blog_posts/i.test(message) && /exist/i.test(message)) {
    return "ブログ用テーブルがまだありません。supabase-engagement.sql を更新版でもう一度実行してね。";
  }

  if (/duplicate key/i.test(message) && /slug/i.test(message)) {
    return "その slug はもう使われてる。別の slug に変えてね。";
  }

  if (/abort|timeout|timed out/i.test(message)) {
    return "Supabase への通信がタイムアウトした。ネットワークか Supabase の状態を見てね。";
  }

  return message;
}

function requireLength(value, min, max, label) {
  if (value.length < min || value.length > max) {
    throw new Error(label + " は " + min + "〜" + max + " 文字で入力してね。");
  }
}

function fallbackBlogSlug() {
  return "post-" + Date.now().toString(36);
}

function normalizeImageUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  if (text.length > BLOG_IMAGE_URL_MAX_LENGTH) {
    throw new Error("画像URLは " + BLOG_IMAGE_URL_MAX_LENGTH + " 文字以内で入力してね。");
  }

  let parsed;
  try {
    parsed = new URL(text);
  } catch (error) {
    throw new Error("画像URL は http:// または https:// で始まるものを入れてね。");
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("画像URL は http:// または https:// で始まるものを入れてね。");
  }

  return parsed.toString();
}

function normalizePostInput(input) {
  const title = String(input.title || "").trim();
  const summary = String(input.summary || "").trim();
  const body = String(input.body || "").trim();
  const imageUrl = normalizeImageUrl(input.imageUrl);
  const slugSource = String(input.slug || "").trim() || title;
  const slug = toBlogSlug(slugSource);

  requireLength(title, 1, BLOG_TITLE_MAX_LENGTH, "タイトル");
  requireLength(body, 1, BLOG_BODY_MAX_LENGTH, "本文");

  if (summary.length > BLOG_SUMMARY_MAX_LENGTH) {
    throw new Error("概要は " + BLOG_SUMMARY_MAX_LENGTH + " 文字以内で入力してね。");
  }

  if (!slug) {
    throw new Error("slug を作れなかった。タイトルか slug を見直してね。");
  }

  return {
    body: body,
    image_url: imageUrl,
    is_published: Boolean(input.isPublished),
    slug: slug,
    summary: summary,
    title: title
  };
}

async function getOwnerContext() {
  const client = await getClient();
  if (!client) {
    throw new Error("site-interactions-config.js の Supabase 設定がまだ空です。");
  }

  const result = await client.auth.getUser();
  if (result.error) {
    throw result.error;
  }

  const user = result.data.user;
  if (!isOwnerUser(user)) {
    throw new Error("owner としてログインしてからブログを管理してね。");
  }

  return {
    client: client,
    user: user
  };
}

function postSelectQuery() {
  return "id, slug, title, summary, body, image_url, is_published, created_at, updated_at, published_at";
}

function scrollToCurrentHash() {
  if (!location.hash) {
    return;
  }

  const id = decodeURIComponent(location.hash.slice(1));
  const target = document.getElementById(id);
  if (!target) {
    return;
  }

  target.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  target.classList.add("is-target");
  window.setTimeout(function () {
    target.classList.remove("is-target");
  }, 1600);
}

function buildBlogPostArticle(post) {
  const article = createElement("article", "blog-post");
  const head = createElement("div", "blog-post__head");
  const title = createElement("h2", "blog-post__title", post.title);
  const meta = createElement(
    "p",
    "blog-post__meta",
    "公開: " + formatDate(post.published_at || post.created_at)
  );
  const link = createElement("a", "blog-post__permalink", "#" + post.slug);
  const image = post.image_url ? document.createElement("img") : null;
  const body = createElement("div", "blog-post__body", post.body);
  const interactionHost = createElement("div", "blog-post__engagement");

  article.id = post.slug;
  link.href = "#" + post.slug;
  link.textContent = "この投稿へのリンク";
  interactionHost.dataset.entryEngagement = "blog-post-" + post.slug;
  interactionHost.dataset.engagementIntro =
    "この記事へのコメント欄。感想や反応を気軽にどうぞ。";
  interactionHost.dataset.engagementNote =
    "未ログインでも匿名 UID でコメントできます。コメントといいねは共有保存されます。コメント欄では画像は送れません。ルールは rules.html を確認してね。通報は owner 側の一覧へ送信されます。";
  interactionHost.dataset.commentPlaceholder =
    "この記事の感想、気になったところ、ひとことなどをご入力ください";
  interactionHost.dataset.formLabel = "この記事へのコメント";
  interactionHost.dataset.metaText = "ご感想を残せます";
  interactionHost.dataset.itemLabel = "ブログ記事: " + post.title;

  head.appendChild(title);
  head.appendChild(link);
  article.appendChild(head);
  article.appendChild(meta);

  if (post.summary) {
    article.appendChild(createElement("p", "blog-post__summary", post.summary));
  }

  if (image) {
    image.className = "blog-post__image";
    image.src = post.image_url;
    image.alt = post.title;
    image.loading = "lazy";
    article.appendChild(image);
  }

  article.appendChild(body);
  article.appendChild(interactionHost);
  return article;
}

function renderBlogPosts(listElement, posts) {
  listElement.innerHTML = "";

  posts.forEach(function (post) {
    listElement.appendChild(buildBlogPostArticle(post));
  });

  scrollToCurrentHash();
}

async function initPublicBlogPage() {
  const status = document.querySelector("[data-blog-status]");
  const list = document.querySelector("[data-blog-list]");
  const config = window.CF_INTERACTIONS_CONFIG || {};

  if (!status || !list) {
    return;
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    status.textContent = "ブログ設定を準備中です。";
    return;
  }

  status.textContent = "ブログ記事を読み込んでいます...";

  try {
    const posts = await fetchPublishedPosts();
    if (!posts.length) {
      status.textContent = "まだ公開記事はないよ。";
      list.innerHTML = "";
      return;
    }

    status.textContent = "公開記事 " + posts.length + " 件";
    renderBlogPosts(list, posts);
  } catch (error) {
    status.textContent = friendlyBlogError(error);
  }
}

function watchHashNavigation() {
  const list = document.querySelector("[data-blog-list]");
  if (!list) {
    return;
  }

  window.addEventListener("hashchange", function () {
    scrollToCurrentHash();
  });
}

function sortPostsByNewest(posts) {
  return posts.slice().sort(function (left, right) {
    return (
      new Date(right.published_at || right.created_at).getTime() -
      new Date(left.published_at || left.created_at).getTime()
    );
  });
}

function configReady() {
  const config = window.CF_INTERACTIONS_CONFIG || {};
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

async function fetchPublishedPosts() {
  if (!configReady()) {
    return [];
  }

  const client = await getClient();
  const result = await client
    .from("blog_posts")
    .select(postSelectQuery())
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (result.error) {
    throw new Error(friendlyBlogError(result.error));
  }

  return sortPostsByNewest(result.data || []);
}

async function fetchOwnerPosts() {
  const context = await getOwnerContext();
  const result = await context.client
    .from("blog_posts")
    .select(postSelectQuery())
    .order("created_at", { ascending: false });

  if (result.error) {
    throw new Error(friendlyBlogError(result.error));
  }

  return result.data || [];
}

async function saveBlogPost(input) {
  const context = await getOwnerContext();
  const normalized = normalizePostInput(input);
  const payload = Object.assign({}, normalized, {
    author_user_id: context.user.id
  });

  let result;
  if (input.id) {
    result = await context.client
      .from("blog_posts")
      .update(payload)
      .eq("id", input.id)
      .select(postSelectQuery())
      .single();
  } else {
    result = await context.client
      .from("blog_posts")
      .insert(payload)
      .select(postSelectQuery())
      .single();
  }

  if (result.error) {
    throw new Error(friendlyBlogError(result.error));
  }

  return result.data;
}

async function deleteBlogPost(id) {
  const context = await getOwnerContext();
  const result = await context.client.from("blog_posts").delete().eq("id", id);

  if (result.error) {
    throw new Error(friendlyBlogError(result.error));
  }
}

function toBlogSlug(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);

  return normalized || fallbackBlogSlug();
}

document.addEventListener("DOMContentLoaded", function () {
  initPublicBlogPage();
  watchHashNavigation();
});

export {
  deleteBlogPost,
  fetchOwnerPosts,
  fetchPublishedPosts,
  saveBlogPost,
  toBlogSlug
};
