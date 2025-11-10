import type { Metadata } from "next";
import { NavBar } from "./components/NavBar";
import Script from "next/script";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://query-sam-altman.onrender.com"),
  title: "The Altman Index",
  description: "A searchable knowledge base of 100+ Sam Altman interviews with transparent RAG retrieval.",
  openGraph: {
    title: "The Altman Index",
    description: "A searchable knowledge base of 100+ Sam Altman interviews with transparent RAG retrieval.",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://query-sam-altman.onrender.com", // Update with your actual domain
    siteName: "The Altman Index",
    images: [
      {
        url: "/congress.jpg",
        width: 1200,
        height: 630,
        alt: "The Altman Index - Search 100+ Sam Altman interviews",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Altman Index",
    description: "A searchable knowledge base of 100+ Sam Altman interviews with transparent RAG retrieval.",
    images: ["/congress.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <NavBar />
        {children}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-CEHHGBPM03"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){window.dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-CEHHGBPM03', {
              page_title: document.title,
              page_location: window.location.href
            });
          `}
        </Script>
      </body>
    </html>
  );
}
