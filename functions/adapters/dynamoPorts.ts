import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type {
  BiblePort,
  GraphPort,
  RetrievalPort,
  RetrievedChunk,
} from "@storyboard/ai";
import type { Character, NarrativeNode, PlotThread, Story, StyleGuide } from "@storyboard/types";

// Concrete DynamoDB adapters for the assembler's ports (docs/ARCHITECTURE.md §4).
// These are the only place that knows the single-table key layout; the assembler in
// packages/ai stays framework-agnostic. Keys mirror functions/graphql/index.ts:
//   Story      PK=STORY#<id>  SK=meta
//   StyleGuide PK=STORY#<id>  SK=STYLE
//   Character  PK=STORY#<id>  SK=CHAR#<id>
//   Node       PK=STORY#<id>  SK=NODE#<id>
//   Edge       PK=STORY#<id>  SK=EDGE#<id>   (fromNodeId/toNodeId [+ choice])

const storyPK = (id: string) => `STORY#${id}`;

const stripInternal = <T>(item: Record<string, any>): T => {
  const { PK, SK, GSI1PK, GSI1SK, ...rest } = item;
  return rest as T;
};

interface EdgeItem {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

// How many of the most-recent path nodes are served VERBATIM (and so excluded from the
// rolled-up arc summary to avoid double-counting). Kept in sync with the assembler's
// default recentK. A live hierarchical LLM rollup (§4.2) is deferred — for now the arc
// summary is a join of stored node summaries beyond the verbatim window.
const ARC_VERBATIM_SKIP = 6;

export interface DynamoPorts {
  bible: BiblePort;
  graph: GraphPort;
  retrieval: RetrievalPort;
}

export function makeDynamoPorts(
  tableName: string,
  client?: DynamoDBDocumentClient,
): DynamoPorts {
  const ddb =
    client ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });

  const queryByPrefix = async (storyId: string, skPrefix: string) => {
    const res = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :p AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":p": storyPK(storyId), ":sk": skPrefix },
      }),
    );
    return res.Items ?? [];
  };

  const loadNodes = async (storyId: string): Promise<Map<string, NarrativeNode>> => {
    const items = await queryByPrefix(storyId, "NODE#");
    return new Map(items.map((i) => [i.id as string, stripInternal<NarrativeNode>(i)]));
  };

  // Reverse adjacency: child nodeId -> deterministically-chosen parent nodeId.
  const loadParentOf = async (storyId: string): Promise<Map<string, string>> => {
    const edges = (await queryByPrefix(storyId, "EDGE#")).map(stripInternal<EdgeItem>);
    const incoming = new Map<string, string[]>();
    for (const e of edges) {
      const list = incoming.get(e.toNodeId) ?? [];
      list.push(e.fromNodeId);
      incoming.set(e.toNodeId, list);
    }
    const parentOf = new Map<string, string>();
    for (const [child, parents] of incoming) {
      // Reconvergence: pick a single deterministic parent (sorted) as the active path.
      parentOf.set(child, [...parents].sort()[0]!);
    }
    return parentOf;
  };

  // Ancestors of `nodeId`, nearest-first (excludes nodeId itself). Walks edges, guards
  // against accidental cycles (§3.2 says guard against them).
  const ancestorIds = (parentOf: Map<string, string>, nodeId: string, limit: number): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([nodeId]);
    let cur = parentOf.get(nodeId);
    while (cur && !seen.has(cur) && out.length < limit) {
      out.push(cur);
      seen.add(cur);
      cur = parentOf.get(cur);
    }
    return out;
  };

  const bible: BiblePort = {
    async getStory(storyId) {
      const res = await ddb.send(
        new GetCommand({ TableName: tableName, Key: { PK: storyPK(storyId), SK: "meta" } }),
      );
      return res.Item ? stripInternal<Story>(res.Item) : null;
    },
    async getStyleGuide(storyId) {
      const res = await ddb.send(
        new GetCommand({ TableName: tableName, Key: { PK: storyPK(storyId), SK: "STYLE" } }),
      );
      return res.Item ? stripInternal<StyleGuide>(res.Item) : null;
    },
    async getCharacters(storyId, ids) {
      if (!ids.length) return [];
      const wanted = new Set(ids);
      const items = await queryByPrefix(storyId, "CHAR#");
      return items.map(stripInternal<Character>).filter((c) => wanted.has(c.id));
    },
    async getOpenPlotThreads(storyId) {
      const items = await queryByPrefix(storyId, "THREAD#");
      return items
        .map(stripInternal<PlotThread>)
        .filter((t) => t.status === "open" || t.status === "foreshadowed");
    },
  };

  const graph: GraphPort = {
    async getNode(storyId, nodeId) {
      const res = await ddb.send(
        new GetCommand({ TableName: tableName, Key: { PK: storyPK(storyId), SK: `NODE#${nodeId}` } }),
      );
      return res.Item ? stripInternal<NarrativeNode>(res.Item) : null;
    },
    async getRecentPath(storyId, nodeId, k) {
      const [nodes, parentOf] = await Promise.all([loadNodes(storyId), loadParentOf(storyId)]);
      return ancestorIds(parentOf, nodeId, k)
        .map((id) => nodes.get(id))
        .filter((n): n is NarrativeNode => Boolean(n));
    },
    async getArcSummary(storyId, beforeNodeId) {
      const [nodes, parentOf] = await Promise.all([loadNodes(storyId), loadParentOf(storyId)]);
      // Everything before the verbatim window, OLDEST-first, summaries only.
      const distant = ancestorIds(parentOf, beforeNodeId, 1000).slice(ARC_VERBATIM_SKIP).reverse();
      return distant
        .map((id) => nodes.get(id)?.summary)
        .filter(Boolean)
        .join(" ");
    },
  };

  // Naive keyword retrieval — stands in for Aurora pgvector (the RetrievalPort seam).
  // Scores node summaries + character/lore text by query-term overlap. Swapping in a
  // real vector search is invisible to the assembler.
  const retrieval: RetrievalPort = {
    async search(storyId, query, limit) {
      const terms = new Set(
        query
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 3),
      );
      if (!terms.size) return [];

      const [nodeItems, charItems, threadItems] = await Promise.all([
        queryByPrefix(storyId, "NODE#"),
        queryByPrefix(storyId, "CHAR#"),
        queryByPrefix(storyId, "THREAD#"),
      ]);

      const candidates: Array<Omit<RetrievedChunk, "score">> = [
        ...nodeItems.map((i) => ({ kind: "node" as const, id: i.id as string, text: String(i.summary ?? i.content ?? "") })),
        ...charItems.map((i) => ({ kind: "character" as const, id: i.id as string, text: `${i.name}: ${[i.appearance, ...(i.traits ?? [])].filter(Boolean).join("; ")}` })),
        ...threadItems.map((i) => ({ kind: "lore" as const, id: i.id as string, text: String(i.summary ?? "") })),
      ];

      const score = (text: string) => {
        const words = text.toLowerCase().split(/[^a-z0-9]+/);
        let s = 0;
        for (const w of words) if (terms.has(w)) s += 1;
        return s;
      };

      return candidates
        .map((c) => ({ ...c, score: score(c.text) }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
  };

  return { bible, graph, retrieval };
}
