import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui/Toast";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://gregale.dev"),
  title: {
    default: "Gregale — Scale-to-zero Firecracker MicroVM Cloud",
    template: "%s | Gregale",
  },
  description:
    "Gregale runs serverless services inside isolated Firecracker microVMs. Services park as memory snapshots and wake on request in under 350ms.",
  keywords: [
    "Gregale",
    "gregale.dev",
    "Firecracker",
    "MicroVM",
    "Serverless",
    "Cloud Platform",
    "FaaS",
    "Scale to zero",
  ],
  authors: [{ name: "Gregale Team" }],
  creator: "Gregale",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://gregale.dev",
    siteName: "Gregale",
    title: "Gregale — Scale-to-zero Firecracker MicroVM Cloud",
    description:
      "Gregale runs serverless services inside isolated Firecracker microVMs. Services park as memory snapshots and wake on request in under 350ms.",
    images: [
      {
        url: "/gregale-logo-green-trans.png",
        width: 1200,
        height: 630,
        alt: "Gregale MicroVM Cloud",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Gregale — Scale-to-zero Firecracker MicroVM Cloud",
    description:
      "Gregale runs serverless services inside isolated Firecracker microVMs. Services park as memory snapshots and wake on request in under 350ms.",
    images: ["/gregale-logo-green-trans.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: { icon: "/gregale-logo-icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
