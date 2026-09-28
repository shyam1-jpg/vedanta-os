import type { Metadata } from "next";

/** The house description. A sentence, not the page title. */
export const PROPERTY_DESCRIPTION =
  "A beautiful grade II-listed luxury retreat centre. Nestled amongst 75 acres of woodlands, meadows and lakes in Lincolnshire — a Grade II listed Elizabethan estate.";

export function publicPageMetadata(title: string): Metadata {
  return {
    title: { absolute: title },
    description: PROPERTY_DESCRIPTION,
    openGraph: {
      title,
      description: PROPERTY_DESCRIPTION,
      siteName: "The Vedanta Way",
      locale: "en_GB",
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description: PROPERTY_DESCRIPTION,
    },
  };
}
