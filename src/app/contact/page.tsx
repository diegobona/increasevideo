import Link from "next/link";
import type { Metadata } from "next";
import GuidePage from "@/components/GuidePage";
import { siteContact } from "@/config/site";
import { pageMetadata } from "@/libs/seo";

export const metadata: Metadata = pageMetadata(
  "/contact",
  "Contact Increase Video Quality",
  `Contact ${siteContact.operatorName} by email about video enhancement, a payment, or feedback on Increase Video Quality.`,
);

export default function ContactPage() {
  return (
    <GuidePage>
      <p className="eyebrow">GET IN TOUCH</p>
      <h1>Contact</h1>
      <p>For help with Increase Video Quality or to share feedback, email {siteContact.operatorName}:</p>
      <p><a href={`mailto:${siteContact.email}`}>{siteContact.email}</a></p>
      <p>Describe what happened and include the page address or job ID if relevant. For a payment question, include your order or receipt reference. Do not send passwords, card details, or sensitive videos.</p>
      <p>Read <Link href="/about">about the project</Link> or check <Link href="/privacy">how video storage and access work</Link>.</p>
    </GuidePage>
  );
}
