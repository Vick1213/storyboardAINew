// Seed a demo story into the deployed DynamoDB table so the GROUNDED writing loop is
// testable without first building Cognito sign-in + bible CRUD (that's the next session).
// It writes directly to the single table using the same key layout the resolver and the
// assembler's DynamoDB adapters expect (functions/adapters/dynamoPorts.ts).
//
// Usage (after `cdk deploy` prints the Table name / from the stack output):
//   cd functions
//   TABLE_NAME=<StoryboardStack table name> AWS_REGION=us-west-2 node seed/seed.mjs
//
// Idempotent: fixed IDs, so re-running overwrites the demo rather than duplicating it.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.TABLE_NAME;
const REGION = process.env.AWS_REGION ?? "us-west-2";
if (!TABLE) {
  console.error("Set TABLE_NAME (the deployed DynamoDB table name from the CDK output).");
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

const STORY = "demo-ashfall";
const PK = `STORY#${STORY}`;
const now = "2026-01-01T00:00:00.000Z";

// ── The bible (source of truth) ──────────────────────────────────────────────
const items = [
  {
    PK, SK: "meta", id: STORY, ownerSub: "seed",
    title: "The Ashfall Letters",
    premise:
      "In Calder, a harbor city where the recently dead are slowly forgotten by everyone who knew them, a courier named Mara carries letters that are the last proof those people existed.",
    genre: "literary fantasy", pov: "third-limited", tense: "past", createdAt: now,
  },
  {
    PK, SK: "STYLE", storyId: STORY,
    pov: "third-limited", tense: "past", tone: "elegiac, dry-witted, grounded",
    proseStyle: "spare sentences, concrete sensory detail, little exposition",
    contentRating: "PG-13",
  },

  // Characters — tendencies are deliberately vivid so grounding is visible in the output.
  {
    PK, SK: "CHAR#mara", id: "mara", storyId: STORY, name: "Mara", role: "protagonist",
    traits: ["stubborn", "loyal to a fault", "allergic to being thanked"],
    tendencies: ["deflects with dry humor when she's scared", "checks the exits in any room", "refuses help even when bleeding"],
    speechPatterns: "clipped, sardonic, never finishes a sentimental sentence",
    appearance: "a scarred grey courier's coat, ash-stained boots, hair shorn close",
    state: { location: "the Lower Docks", wounded: "shallow knife cut, left forearm", carrying: "an unsigned letter" },
    createdAt: now,
  },
  {
    PK, SK: "CHAR#jon", id: "jon", storyId: STORY, name: "Jon", role: "supporting",
    traits: ["cautious", "kind in small practical ways"],
    tendencies: ["over-explains when nervous", "always offers food"],
    speechPatterns: "warm, rambling, apologetic",
    appearance: "a dockside baker's apron, flour in his beard",
    state: { location: "the Lower Docks", knows: "a back way out of the dock quarter" },
    createdAt: now,
  },
  {
    PK, SK: "CHAR#vesh", id: "vesh", storyId: STORY, name: "The Vesh", role: "antagonist",
    traits: ["patient", "soft-spoken", "certain"],
    tendencies: ["never raises its voice", "speaks of the dead in the present tense"],
    speechPatterns: "formal, archaic, unhurried",
    appearance: "a tall figure in a fog-coloured veil; you forget its face the moment you look away",
    state: { wants: "the unsigned letter destroyed before it can be delivered" },
    createdAt: now,
  },

  // Plot threads (open obligations the writer should pay off / not drop).
  { PK, SK: "THREAD#sender", id: "sender", storyId: STORY, status: "open",
    summary: "Who wrote the unsigned letter Mara is carrying, and why must it never reach the Vesh?", createdAt: now },
  { PK, SK: "THREAD#brother", id: "brother", storyId: STORY, status: "foreshadowed",
    summary: "Mara's brother died in the fog last winter; she is the only one in Calder who still remembers his name.", createdAt: now },
  { PK, SK: "THREAD#debt", id: "debt", storyId: STORY, status: "resolved",
    summary: "Mara's debt to the harbormaster was settled in chapter one.", createdAt: now },

  // ── The narrative graph (nodes + edges) ─────────────────────────────────────
  { PK, SK: "NODE#n1", id: "n1", storyId: STORY, title: "The Oath", status: "locked",
    summary: "Mara takes the courier's oath and accepts an unsigned letter from a dying stranger.",
    content:
      "The stranger pressed the letter into Mara's hands with fingers already going cold. \"It has to be remembered,\" he said. She took it. She always took it. That was the oath, and the oath was the only thing in Calder that the fog could not eat.",
    charactersPresent: ["mara"], createdAt: now },
  { PK, SK: "NODE#n2", id: "n2", storyId: STORY, title: "The Docks at Dusk", status: "revised",
    summary: "Mara reaches the Lower Docks; Jon warns her she's being followed.",
    content:
      "By the time Mara reached the Lower Docks the lamps were drowning in fog. Jon was shuttering the bakery, flour to the elbows. \"Someone asked after you,\" he said, not looking up. \"Tall. Veiled. I forgot its face before it left.\" Mara felt the letter against her ribs like a second heartbeat.",
    charactersPresent: ["mara", "jon"], createdAt: now },
  { PK, SK: "NODE#n3", id: "n3", storyId: STORY, title: "Ambush in the Fog", status: "draft",
    summary: "The Vesh corners Mara on the quay and demands the letter; she's cut but escapes onto the boards.",
    content:
      "The Vesh did not run. It simply was there, between Mara and the water, where a moment ago there had been only fog. \"Give me the letter,\" it said, gently, as though offering her a kindness. Steel came out of the grey. The cut opened along her forearm before she understood she'd been moving. Then she was past it, boots hammering the wet boards, the letter still hers.",
    charactersPresent: ["mara", "vesh"], createdAt: now },

  // The node you'll write FROM (one branch of the fork). Mara + Jon in scene; recent
  // path = n3 -> n2 -> n1.
  { PK, SK: "NODE#n4", id: "n4", storyId: STORY, title: "The Back Way", status: "draft",
    summary: "Bleeding, Mara reaches Jon's back door and has to decide whether to drag him into this.",
    content: "",
    charactersPresent: ["mara", "jon"], createdAt: now },

  // The other branch of the fork — Mara alone. Demonstrates that the graph forks.
  { PK, SK: "NODE#n5", id: "n5", storyId: STORY, title: "Alone in the Alleys", status: "draft",
    summary: "Mara tries to lose the Vesh in the dock-quarter alleys, alone, bleeding.",
    content: "",
    charactersPresent: ["mara"], createdAt: now },

  // Edges: a linear lead-up (n1→n2→n3) and an authored decision-game FORK at n3 — two
  // choice edges to two different nodes. The narrative is a graph, not a list (§3.2).
  { PK, SK: "EDGE#e1", id: "e1", storyId: STORY, fromNodeId: "n1", toNodeId: "n2", createdAt: now },
  { PK, SK: "EDGE#e2", id: "e2", storyId: STORY, fromNodeId: "n2", toNodeId: "n3", createdAt: now },
  { PK, SK: "EDGE#e3", id: "e3", storyId: STORY, fromNodeId: "n3", toNodeId: "n4",
    choice: { label: "Run to Jon's bakery", effects: { alliesEndangered: true } }, createdAt: now },
  { PK, SK: "EDGE#e4", id: "e4", storyId: STORY, fromNodeId: "n3", toNodeId: "n5",
    choice: { label: "Lose the Vesh in the alleys, alone" }, createdAt: now },
];

const main = async () => {
  for (const Item of items) {
    await ddb.send(new PutCommand({ TableName: TABLE, Item }));
  }
  console.log(`Seeded ${items.length} items into ${TABLE} (region ${REGION}).`);
  console.log("");
  console.log("Grounded-writing demo target:");
  console.log(`  storyId = ${STORY}`);
  console.log(`  nodeId  = n4   (Mara + Jon in scene; recent path n3 → n2 → n1)`);
  console.log("");
  console.log('Try intent "continue" — the prose should honour Mara\'s tendencies');
  console.log("(deflects with dry humor when scared, refuses help even when bleeding).");
};

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
