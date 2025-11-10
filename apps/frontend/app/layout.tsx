import type { Metadata } from "next";
import { NavBar } from "./components/NavBar";

export const metadata: Metadata = {
  title: "The Altman Index",
  description: "A searchable knowledge base of 100+ Sam Altman interviews with transparent RAG retrieval.",
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
      </body>
    </html>
  );
}
