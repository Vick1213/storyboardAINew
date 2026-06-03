"use client";
// Client-side root: configure Amplify once (Cognito + AppSync), pull in the Authenticator
// theme, and expose the auth context so any component can call useAuthenticator()/signOut.
// The actual sign-in gate lives in page.tsx via <Authenticator> (render-prop) so the
// signed-in user/signOut are in scope for the workspace.
import { Authenticator, ThemeProvider, type Theme } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { configureAmplify } from "../lib/amplify";

// Runs at module load on the client (before any GraphQL client is created in lib/api.ts).
configureAmplify();

// Dark theme to match the app shell (#0b0b0f).
const theme: Theme = {
  name: "storyboard-dark",
  overrides: [
    {
      colorMode: "dark",
      tokens: {
        colors: {
          background: { primary: { value: "#0b0b0f" }, secondary: { value: "#15151c" } },
          font: { interactive: { value: "#c9b6ff" } },
          brand: {
            primary: {
              "80": { value: "#7c5cff" },
              "90": { value: "#8f72ff" },
              "100": { value: "#a487ff" },
            },
          },
        },
      },
    },
  ],
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme} colorMode="dark">
      <Authenticator.Provider>{children}</Authenticator.Provider>
    </ThemeProvider>
  );
}
