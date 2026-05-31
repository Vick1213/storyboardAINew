"use client";
import { Amplify } from "aws-amplify";

// Values come from `cdk deploy` outputs -> apps/web/.env (see /.env.example).
// Configure once on the client. Cognito user pool guards the AppSync GraphQL API.
export function configureAmplify() {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID!,
        userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID!,
      },
    },
    API: {
      GraphQL: {
        endpoint: process.env.NEXT_PUBLIC_GRAPHQL_URL!,
        region: process.env.NEXT_PUBLIC_AWS_REGION ?? "us-west-2",
        defaultAuthMode: "userPool",
      },
    },
  });
}
