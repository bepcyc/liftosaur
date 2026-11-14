import { IFeedOwner, IFeedResponse, IFeedWorkout, FeedWorkout_key } from "./feedWorkout";
import { Follow_displayName, IFollowsResponse } from "./follow";
import { IReaction, IReactionSummary, IReactor, Reactions_applyMine } from "./reactions";
import {
  IFriendProgramContext,
  IFriendProgramSummary,
  IProgramEdit,
  IProgramEditsForProgram,
  IProgramEditsResponse,
} from "./friendProgram";
import { RelativeTime_ago } from "../utils/relativeTime";
import { ObjectUtils_filter } from "../utils/object";

export interface ISocialPage {
  keys: string[];
  cursor?: string;
  isLoading: boolean;
  hasMore: boolean;
  failedOwners: string[];
  loadedAt?: number;
}

export interface ISocialState {
  accountId: string;
  follows?: IFollowsResponse;
  workouts: Partial<Record<string, IFeedWorkout>>;
  owners: Partial<Record<string, IFeedOwner>>;
  reactions: Partial<Record<string, IReactionSummary>>;
  pages: Partial<Record<string, ISocialPage>>;
  hiddenOwners: string[];
  friendPrograms: Partial<Record<string, IFriendProgramSummary[]>>;
  friendProgram: Partial<Record<string, IFriendProgramContext>>;
  friendErrors: Partial<Record<string, string>>;
  programEdits?: IProgramEditsResponse & { loadedAt: number };
  programEditsByProgram: Partial<Record<string, IProgramEdit[]>>;
}

export const SocialState_homePage = "home";
export const SocialState_pageTtlMs = 60_000;

export function SocialState_isPageStale(page: ISocialPage | undefined, now: number): boolean {
  if (page == null) {
    return true;
  }
  return !page.isLoading && (page.loadedAt == null || now - page.loadedAt > SocialState_pageTtlMs);
}

export function SocialState_empty(accountId: string): ISocialState {
  return {
    accountId,
    workouts: {},
    owners: {},
    reactions: {},
    pages: {},
    hiddenOwners: [],
    friendPrograms: {},
    friendProgram: {},
    friendErrors: {},
    programEditsByProgram: {},
  };
}

export function SocialState_forAccount(
  state: ISocialState | undefined,
  accountId: string | undefined
): ISocialState | undefined {
  if (accountId == null) {
    return undefined;
  }
  if (state != null && state.accountId === accountId) {
    return state;
  }
  return SocialState_empty(accountId);
}

export function SocialState_pendingRequestCount(
  state: ISocialState | undefined,
  accountId: string | undefined
): number {
  return state != null && state.accountId === accountId ? (state.follows?.incoming.length ?? 0) : 0;
}

export function SocialState_startLoading(state: ISocialState, pageKey: string, isFirstPage: boolean): ISocialState {
  const page = state.pages[pageKey];
  const next: ISocialPage =
    isFirstPage || page == null
      ? { keys: page?.keys ?? [], cursor: undefined, isLoading: true, hasMore: page?.hasMore ?? true, failedOwners: [] }
      : { ...page, isLoading: true };
  return { ...state, pages: { ...state.pages, [pageKey]: next } };
}

export function SocialState_failLoading(state: ISocialState, pageKey: string): ISocialState {
  const page = state.pages[pageKey];
  if (page == null) {
    return state;
  }
  return { ...state, pages: { ...state.pages, [pageKey]: { ...page, isLoading: false } } };
}

export function SocialState_applyFeedPage(
  state: ISocialState,
  pageKey: string,
  response: IFeedResponse,
  isFirstPage: boolean,
  now: number = Date.now()
): ISocialState {
  if (response.accountId !== state.accountId) {
    return state;
  }
  const newKeys = response.workouts.map((w) => FeedWorkout_key(w.ownerId, w.recordId));
  const previousPage = state.pages[pageKey];
  const previous = isFirstPage ? [] : (previousPage?.keys ?? []);
  const page: ISocialPage = {
    keys: unionKeys(previous, newKeys),
    cursor: response.cursor,
    isLoading: false,
    hasMore: response.cursor != null,
    failedOwners: response.failedOwners,
    loadedAt: isFirstPage ? now : previousPage?.loadedAt,
  };
  return withFeedResponse(state, pageKey, response, page);
}

export function SocialState_applyFeedRefresh(
  state: ISocialState,
  pageKey: string,
  response: IFeedResponse,
  now: number
): ISocialState {
  const previousPage = state.pages[pageKey];
  if (previousPage == null) {
    return SocialState_applyFeedPage(state, pageKey, response, true, now);
  }
  if (response.accountId !== state.accountId) {
    return state;
  }
  const newKeys = response.workouts.map((w) => FeedWorkout_key(w.ownerId, w.recordId));
  const page: ISocialPage = {
    ...previousPage,
    keys: unionKeys(newKeys, previousPage.keys),
    isLoading: false,
    loadedAt: now,
  };
  return withFeedResponse(state, pageKey, response, page);
}

export function SocialState_startRefresh(state: ISocialState, pageKey: string): ISocialState {
  const page = state.pages[pageKey];
  if (page == null) {
    return state;
  }
  return { ...state, pages: { ...state.pages, [pageKey]: { ...page, isLoading: true } } };
}

function unionKeys(first: string[], second: string[]): string[] {
  const seen = new Set(first);
  return [...first, ...second.filter((k) => !seen.has(k))];
}

function withFeedResponse(
  state: ISocialState,
  pageKey: string,
  response: IFeedResponse,
  page: ISocialPage
): ISocialState {
  const workouts = { ...state.workouts };
  for (const workout of response.workouts) {
    workouts[FeedWorkout_key(workout.ownerId, workout.recordId)] = workout;
  }
  return {
    ...state,
    workouts,
    owners: { ...state.owners, ...response.owners },
    reactions: { ...state.reactions, ...response.reactions },
    pages: { ...state.pages, [pageKey]: page },
  };
}

export function SocialState_applyOwnReactions(
  state: ISocialState,
  ownerId: string,
  requestedIds: number[],
  summaries: Partial<Record<string, IReactionSummary>>
): ISocialState {
  const reactions = { ...state.reactions };
  for (const recordId of requestedIds) {
    const key = FeedWorkout_key(ownerId, recordId);
    const summary = summaries[String(recordId)];
    if (summary != null) {
      reactions[key] = summary;
    } else {
      delete reactions[key];
    }
  }
  return { ...state, reactions };
}

export function SocialState_applyReaction(
  state: ISocialState,
  key: string,
  viewer: IReactor,
  next: IReaction | undefined
): ISocialState {
  return {
    ...state,
    reactions: { ...state.reactions, [key]: Reactions_applyMine(state.reactions[key], viewer, next) },
  };
}

export function SocialState_restoreReaction(
  state: ISocialState,
  key: string,
  summary: IReactionSummary | undefined
): ISocialState {
  const reactions = { ...state.reactions };
  if (summary == null) {
    delete reactions[key];
  } else {
    reactions[key] = summary;
  }
  return { ...state, reactions };
}

export function SocialState_applyFollows(state: ISocialState, follows: IFollowsResponse): ISocialState {
  if (follows.accountId !== state.accountId) {
    return state;
  }
  const sharing = new Set(follows.following.filter((f) => f.permissions.programs).map((f) => f.userId));
  return {
    ...state,
    follows,
    friendPrograms: ObjectUtils_filter(state.friendPrograms, (ownerId) => sharing.has(ownerId)),
    friendProgram: ObjectUtils_filter(
      state.friendProgram,
      (_, context) => context != null && sharing.has(context.ownerId)
    ),
  };
}

export function SocialState_invalidatePages(state: ISocialState): ISocialState {
  return { ...state, pages: {} };
}

export function SocialState_setHiddenOwners(state: ISocialState, hiddenOwners: string[]): ISocialState {
  return { ...state, hiddenOwners, pages: { ...state.pages, [SocialState_homePage]: undefined } };
}

export function SocialState_friendProgramKey(ownerId: string, programId: string): string {
  return `${ownerId}:${programId}`;
}

export function SocialState_applyFriendPrograms(
  state: ISocialState,
  ownerId: string,
  programs: IFriendProgramSummary[]
): ISocialState {
  return {
    ...state,
    friendPrograms: { ...state.friendPrograms, [ownerId]: programs },
    friendErrors: { ...state.friendErrors, [ownerId]: undefined },
  };
}

export function SocialState_applyFriendProgram(state: ISocialState, context: IFriendProgramContext): ISocialState {
  const key = SocialState_friendProgramKey(context.ownerId, context.exported.program.id);
  return {
    ...state,
    friendProgram: { ...state.friendProgram, [key]: context },
    friendErrors: { ...state.friendErrors, [key]: undefined },
  };
}

function friendLoadMessage(error: string): string {
  return error === "network"
    ? "Couldn't load. Check your connection and try again."
    : "Couldn't load. It may not be shared with you anymore.";
}

export function SocialState_failFriendPrograms(state: ISocialState, ownerId: string, error: string): ISocialState {
  return {
    ...state,
    friendPrograms: { ...state.friendPrograms, [ownerId]: undefined },
    friendErrors: { ...state.friendErrors, [ownerId]: friendLoadMessage(error) },
  };
}

export function SocialState_failFriendProgram(
  state: ISocialState,
  ownerId: string,
  programId: string,
  error: string
): ISocialState {
  const key = SocialState_friendProgramKey(ownerId, programId);
  return {
    ...state,
    friendProgram: { ...state.friendProgram, [key]: undefined },
    friendErrors: { ...state.friendErrors, [key]: friendLoadMessage(error) },
  };
}

export function SocialState_applyProgramEdits(
  state: ISocialState,
  response: IProgramEditsResponse,
  now: number
): ISocialState {
  if (response.accountId !== state.accountId) {
    return state;
  }
  return { ...state, programEdits: { ...response, loadedAt: now } };
}

export function SocialState_applyProgramEditsFor(state: ISocialState, response: IProgramEditsForProgram): ISocialState {
  if (response.accountId !== state.accountId) {
    return state;
  }
  return { ...state, programEditsByProgram: { ...state.programEditsByProgram, [response.programId]: response.edits } };
}

export function SocialState_isProgramEditsStale(state: ISocialState | undefined, now: number): boolean {
  const loadedAt = state?.programEdits?.loadedAt;
  return loadedAt == null || now - loadedAt > SocialState_pageTtlMs;
}

export function SocialState_unseenProgramEdits(state: ISocialState | undefined, accountId: string | undefined): number {
  return state != null && state.accountId === accountId ? (state.programEdits?.unseenCount ?? 0) : 0;
}

export function SocialState_hasUnseenEditsFor(
  state: ISocialState | undefined,
  programId: string,
  loaded: IProgramEdit[]
): boolean {
  const summary = state?.programEdits?.programs.find((p) => p.programId === programId);
  return (summary?.unseen ?? 0) > 0 || loaded.some((e) => !e.seen);
}

export function SocialState_unseenEditsInOtherPrograms(
  programEdits: IProgramEditsResponse | undefined,
  currentProgramId: string
): number {
  return (programEdits?.programs ?? [])
    .filter((p) => p.programId !== currentProgramId)
    .reduce((sum, p) => sum + p.unseen, 0);
}

const recentEditMs = 30 * 24 * 60 * 60 * 1000;

export interface IProgramEditLine {
  text: string;
  isUnseen: boolean;
}

export function SocialState_programEditLine(
  programEdits: IProgramEditsResponse | undefined,
  programId: string,
  now: number
): IProgramEditLine | undefined {
  const summary = programEdits?.programs.find((p) => p.programId === programId);
  if (summary == null || now - summary.latest.createdAt > recentEditMs) {
    return undefined;
  }
  const name = Follow_displayName(summary.latest.nickname);
  return {
    text: `${name} edited this program · ${RelativeTime_ago(summary.latest.createdAt, now)}`,
    isUnseen: summary.unseen > 0,
  };
}
