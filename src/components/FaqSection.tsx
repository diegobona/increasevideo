import { siteContact } from "@/config/site";
import type { ReactNode } from "react";

export default function FaqSection({ id = "faq", eyebrow, title, introduction, children }: {
  id?: string;
  eyebrow: string;
  title: string;
  introduction: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="container faq-section" aria-labelledby={`${id}-title`}>
      <div className="faq-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{introduction}</p>
        <a className="text-link" href={`mailto:${siteContact.email}`}>Ask us something else <span aria-hidden="true">↗</span></a>
      </div>
      <div className="faq-list">{children}</div>
    </section>
  );
}

export function FaqItem({ question, children }: { question: string; children: ReactNode }) {
  return <details><summary>{question}</summary><p>{children}</p></details>;
}
