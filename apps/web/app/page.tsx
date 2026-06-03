"use client";
// The app gate: <Authenticator> renders Cognito sign-up/sign-in (Amplify UI), and only
// once authed mounts the Workspace with the signed-in identity. The authed session is
// what unlocks the userPool-guarded AppSync API used throughout lib/api.ts.
import { Authenticator } from "@aws-amplify/ui-react";
import { Workspace } from "./Workspace";

export default function Home() {
  return (
    <Authenticator signUpAttributes={["email"]}>
      {({ signOut, user }) => (
        <Workspace
          email={user?.signInDetails?.loginId ?? user?.username}
          signOut={signOut}
        />
      )}
    </Authenticator>
  );
}
