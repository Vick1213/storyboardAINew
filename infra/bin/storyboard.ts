#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { StoryboardStack } from "../lib/storyboard-stack";

const app = new cdk.App();

// Region is fixed to us-west-2 (Oregon): west coast AND has Bedrock (us-west-1 does not).
// Account comes from the ambient AWS credentials at deploy time.
new StoryboardStack(app, "StoryboardDev", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-west-2",
  },
  description: "StoryboardAI — dev stack (AppSync + DynamoDB + Cognito + S3 + Bedrock streaming).",
});

app.synth();
