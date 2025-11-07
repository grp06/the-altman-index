import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sam Altman Interview Explorer",
  description: "Transparent RAG walkthrough for 100 Sam Altman interviews.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
