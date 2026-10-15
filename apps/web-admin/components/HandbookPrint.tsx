"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

type Detail = { title: string; body_html: string; version: number; review_on: string | null; keywords: string[]; attachments: { filename: string; kind: string }[] };

export default function HandbookPrint() {
  const params = useSearchParams();
  const id = params.get("id");
  const [article, setArticle] = useState<Detail | null>(null);
  useEffect(() => { if (id) api<Detail>(`/v1/handbook/articles/${id}`).then(setArticle).catch(() => setArticle(null)); }, [id]);
  if (!article) return <p className="empty">Opening the article…</p>;
  return (
    <article className="print-sheet detail">
      <p className="k">The Vedanta Way · Handbook · version {article.version}</p>
      <h1>{article.title}</h1>
      <p className="m">{article.keywords.join(" · ")}{article.review_on ? ` · review ${article.review_on}` : ""}</p>
      <div className="rich" dangerouslySetInnerHTML={{ __html: article.body_html }} />
      {article.attachments.length > 0 && <p>Attachments: {article.attachments.map(a => a.filename).join(", ")}</p>}
      <button className="btn primary no-print" onClick={() => window.print()}>Print</button>
    </article>
  );
}
