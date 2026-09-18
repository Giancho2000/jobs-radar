import type { DedupStore, Profile, RunContext, ScorerPort, SinkPort, SourcePort } from "./types";

export async function run (
    sources: SourcePort[],
    scorer: ScorerPort,
    sinks: SinkPort[],
    store: DedupStore,
    profile: Profile,
    ctx: RunContext
): Promise<void>;