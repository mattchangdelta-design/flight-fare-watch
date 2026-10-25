import { useEffect } from "react";

type PageMeta = {
  title: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  twitterCard?: string;
};

function setMeta(attr: "name" | "property", key: string, content: string | undefined) {
  if (content === undefined) return;
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

/** Client-side replacement for TanStack Start's per-route `head()` meta. */
export function usePageMeta({ title, description, ogTitle, ogDescription, twitterCard }: PageMeta) {
  useEffect(() => {
    document.title = title;
    setMeta("name", "description", description);
    setMeta("property", "og:title", ogTitle);
    setMeta("property", "og:description", ogDescription);
    setMeta("name", "twitter:card", twitterCard);
  }, [title, description, ogTitle, ogDescription, twitterCard]);
}
