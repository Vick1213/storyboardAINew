import type { ReactNode } from "react";
import { Providers } from "./providers";

export const metadata = {
  title: "StoryboardAI",
  description: "Claude Code, but for writing stories.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "ui-sans-serif, system-ui", margin: 0, background: "#0b0b0f", color: "#e8e8ec" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
