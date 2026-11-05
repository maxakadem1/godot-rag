import type { Mode, RagEvent } from "./types";
import signalsCode from "@/data/replays/signals-code.json";
import getNodeOrNull from "@/data/replays/get-node-or-null.json";
import freezeLoading from "@/data/replays/freeze-loading.json";
import globalVariable from "@/data/replays/global-variable.json";
import lineOfSight from "@/data/replays/line-of-sight.json";
import noAnswerSteam from "@/data/replays/no-answer-steam.json";

/** A recorded /ask/stream run: each event with its time offset in ms. */
export type ReplayFile = {
  id: string;
  question: string;
  mode: Mode;
  events: ({ t: number } & RagEvent)[];
};

export type Outcome = "answered" | "missed" | "refused";

export type Replay = ReplayFile & {
  label: string;
  outcome: Outcome;
  /** What this run shows, good or bad. */
  note: string;
};

const meta: Record<string, Pick<Replay, "label" | "outcome" | "note">> = {
  "signals-code": {
    label: "Connect a signal in code",
    outcome: "answered",
    note: "Grounded and cited, but the code sample uses Godot 3 connect() syntax that isn't in the excerpt: the model filled a gap from memory.",
  },
  "get-node-or-null": {
    label: "What get_node_or_null returns",
    outcome: "answered",
    note: "Exact API name: keyword and vector search agree, and the class reference ranks first.",
  },
  "freeze-loading": {
    label: "Game freezes on a big level",
    outcome: "answered",
    note: "Paraphrase with no shared words. The right idea, but the background-loading tutorial didn't make the top 5.",
  },
  "global-variable": {
    label: "Keep the score between levels",
    outcome: "missed",
    note: "Needed the autoload page; retrieval found the 3D tutorial's score chapter instead, so the model declines rather than guessing.",
  },
  "line-of-sight": {
    label: "Can the enemy see the player?",
    outcome: "missed",
    note: "Needed ray-casting, a word the question never uses. A known hard paraphrase in the eval set.",
  },
  "no-answer-steam": {
    label: "Godot games released on Steam",
    outcome: "refused",
    note: "Not in the docs at all. The model says so instead of making up a number.",
  },
};

const files = [
  signalsCode,
  getNodeOrNull,
  freezeLoading,
  globalVariable,
  lineOfSight,
  noAnswerSteam,
] as ReplayFile[];

export const REPLAYS: Replay[] = files.map((f) => ({ ...f, ...meta[f.id] }));
