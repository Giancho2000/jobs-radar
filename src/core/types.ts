// Profile, Criteria and Vacancy types

export interface RawVacancy {
    sourceId: string;
    source: string;
    title: string;
    company: string;
    location?: string
    remote?: boolean;
    description?: string;
    applyUrl: string;
    postedAt?: Date
}

export interface Vacancy extends RawVacancy {
    id: string;
    dedupKey: string;
    seenAt: Date;
}

export type Verdict =  'apply' | 'view' | 'save';
export type Confidence = 'high' | 'medium' | 'low';

export interface Score {
    value: number;
    confidence: Confidence;
    matchedStack: string[];
    criticalGaps: string[];
    minorGaps: string[];
    redFlags: string[];
    missingAtKeywords: string[];
    verdict: Verdict;
    reason: string;
}

export interface ScoredVacancy {
    vacancy: Vacancy;
    score: Score;
}

export interface HardCriteria {
    seniority: string[];
    mode: Array<'remote' | 'onsite' | 'hybrid'>;
    locations: string[];
    minimumSalaryUsd?: number;
    dealBreakers: string[];
    ExcludeKeywords: string[];
    umbralScore: number;
}

export interface Profile {
    cv: string;
    criteria: HardCriteria;
}

export interface RunContext {
    runAt: Date;
    outDir: string;
    timezone: string;
}

// Ports

export interface SourcePort {
    readonly name: string;
    fetch(since: Date): Promise<RawVacancy[]>;
}

export interface ScorerPort {
    score(vacancy: Vacancy, profile: Profile): Promise<Score>;
}

export interface SinkPort {
    readonly name: string;
    emit(items: ScoredVacancy[], ctx: RunContext): Promise<void>;
}

export interface DedupStore {
    isNew(dedupKey: string): Promise<boolean>;
    remember(vacancy: Vacancy): Promise<void>;
}