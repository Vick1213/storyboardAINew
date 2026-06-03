import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AppSyncResolverEvent, AppSyncIdentityCognito } from "aws-lambda";

const TABLE = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

// Single-table keys:
//   Story    PK=STORY#<id>  SK=meta        GSI1PK=OWNER#<sub>  GSI1SK=STORY#<createdAt>
//   Character PK=STORY#<id>  SK=CHAR#<id>
//   Node      PK=STORY#<id>  SK=NODE#<id>
//   Edge      PK=STORY#<id>  SK=EDGE#<id>
const storyPK = (id: string) => `STORY#${id}`;
const ownerPK = (sub: string) => `OWNER#${sub}`;

type Event = AppSyncResolverEvent<Record<string, any>>;

const stripKeys = <T extends Record<string, any>>(item: T) => {
  const { PK, SK, GSI1PK, GSI1SK, ...rest } = item;
  return rest;
};

// Build a partial UpdateCommand from an input: SET only the provided fields, leave the
// rest untouched. `storyId`/`id` are keys, never written. All names go through
// ExpressionAttributeNames so reserved words (status, name, role, state) are safe.
// Returns the updated item (ALL_NEW) so the mutation/subscription payload is complete.
async function partialUpdate(SK: string, input: Record<string, any>) {
  const { storyId, id, ...fields } = input;
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    // Nothing to change — return the current item so the contract still holds.
    const res = await ddb.send(
      new GetCommand({ TableName: TABLE, Key: { PK: storyPK(storyId), SK } }),
    );
    return res.Item ? stripKeys(res.Item) : null;
  }
  const names: Record<string, string> = {};
  const values: Record<string, any> = {};
  const sets = entries.map(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = v;
    return `#f${i} = :v${i}`;
  });
  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: storyPK(storyId), SK },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }),
  );
  return res.Attributes ? stripKeys(res.Attributes) : null;
}

export const handler = async (event: Event) => {
  const field = event.info.fieldName;
  const sub = (event.identity as AppSyncIdentityCognito)?.sub ?? "anonymous";
  const args = event.arguments;
  const now = new Date().toISOString();

  switch (field) {
    case "createStory": {
      const id = randomUUID();
      const item = {
        PK: storyPK(id),
        SK: "meta",
        GSI1PK: ownerPK(sub),
        GSI1SK: `STORY#${now}`,
        id,
        ownerSub: sub,
        createdAt: now,
        ...args.input,
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
      return stripKeys(item);
    }

    case "listStories": {
      const res = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :p",
          ExpressionAttributeValues: { ":p": ownerPK(sub) },
          ScanIndexForward: false,
        }),
      );
      return (res.Items ?? []).map(stripKeys);
    }

    case "getStory": {
      const res = await ddb.send(
        new GetCommand({ TableName: TABLE, Key: { PK: storyPK(args.id), SK: "meta" } }),
      );
      return res.Item ? stripKeys(res.Item) : null;
    }

    case "createCharacter": {
      const id = randomUUID();
      const item = {
        PK: storyPK(args.input.storyId),
        SK: `CHAR#${id}`,
        id,
        createdAt: now,
        ...args.input,
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
      return stripKeys(item);
    }

    case "listCharacters": {
      const res = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: "PK = :p AND begins_with(SK, :sk)",
          ExpressionAttributeValues: { ":p": storyPK(args.storyId), ":sk": "CHAR#" },
        }),
      );
      return (res.Items ?? []).map(stripKeys);
    }

    case "createNode": {
      const id = randomUUID();
      const item = {
        PK: storyPK(args.input.storyId),
        SK: `NODE#${id}`,
        id,
        createdAt: now,
        ...args.input,
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
      return stripKeys(item);
    }

    case "listNodes": {
      const res = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: "PK = :p AND begins_with(SK, :sk)",
          ExpressionAttributeValues: { ":p": storyPK(args.storyId), ":sk": "NODE#" },
        }),
      );
      return (res.Items ?? []).map(stripKeys);
    }

    case "createEdge": {
      const id = randomUUID();
      const item = {
        PK: storyPK(args.input.storyId),
        SK: `EDGE#${id}`,
        id,
        createdAt: now,
        ...args.input,
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
      return stripKeys(item);
    }

    case "listEdges": {
      const res = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: "PK = :p AND begins_with(SK, :sk)",
          ExpressionAttributeValues: { ":p": storyPK(args.storyId), ":sk": "EDGE#" },
        }),
      );
      return (res.Items ?? []).map(stripKeys);
    }

    case "updateNode":
      return partialUpdate(`NODE#${args.input.id}`, args.input);

    case "updateCharacter":
      return partialUpdate(`CHAR#${args.input.id}`, args.input);

    default:
      throw new Error(`Unhandled field: ${field}`);
  }
};
