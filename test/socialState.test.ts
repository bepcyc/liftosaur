import "mocha";
import { expect } from "chai";
import {
  SocialState_applyFeedPage,
  SocialState_applyFeedRefresh,
  SocialState_isPageStale,
  SocialState_pageTtlMs,
  SocialState_startRefresh,
  SocialState_applyOwnReactions,
  SocialState_applyReaction,
  SocialState_empty,
  SocialState_forAccount,
  SocialState_pendingRequestCount,
  SocialState_restoreReaction,
  SocialState_applyProgramEdits,
  SocialState_isProgramEditsStale,
  SocialState_programEditLine,
  SocialState_unseenProgramEdits,
  SocialState_hasUnseenEditsFor,
  SocialState_unseenEditsInOtherPrograms,
  SocialState_applyFriendProgram,
  SocialState_applyFriendPrograms,
  SocialState_applyFollows,
  SocialState_failFriendProgram,
  SocialState_failFriendPrograms,
  SocialState_friendProgramKey,
} from "../src/models/socialState";
import { IFollowsResponse } from "../src/models/follow";
import { Program_create } from "../src/models/program";
import { FeedWorkout_fromRecord, IFeedResponse } from "../src/models/feedWorkout";
import { Settings_build } from "../src/models/settings";
import { FriendsFixtures_record } from "./friendsFixtures";

function response(accountId: string, ids: number[], cursor?: string): IFeedResponse {
  return {
    accountId,
    workouts: ids.map((id) =>
      FeedWorkout_fromRecord(FriendsFixtures_record(id, `2026-11-0${id % 9}T10:00:00.000Z`), Settings_build(), "f1", {
        notes: false,
        programs: false,
        programEdits: false,
      })
    ),
    reactions: {},
    owners: { f1: { nickname: "friend" } },
    cursor,
    failedOwners: [],
  };
}

describe("SocialState", () => {
  it("counts pending requests only for the signed-in account", () => {
    const request = { requestId: "r1", nickname: "Bob", createdAt: 1 };
    const social = {
      ...SocialState_empty("me"),
      follows: {
        accountId: "me",
        following: [],
        followers: [],
        incoming: [request, { ...request, requestId: "r2" }],
        outgoing: [],
      },
    };
    expect(SocialState_pendingRequestCount(social, "me")).to.equal(2);
    expect(SocialState_pendingRequestCount(social, "other")).to.equal(0);
    expect(SocialState_pendingRequestCount(SocialState_empty("me"), "me")).to.equal(0);
    expect(SocialState_pendingRequestCount(undefined, undefined)).to.equal(0);
  });

  it("appends pages without duplicating keys and tracks the cursor", () => {
    let state = SocialState_empty("me");
    state = SocialState_applyFeedPage(state, "home", response("me", [1, 2], "c1"), true);
    state = SocialState_applyFeedPage(state, "home", response("me", [2, 3]), false);
    expect(state.pages.home?.keys).to.eql(["f1:1", "f1:2", "f1:3"]);
    expect(state.pages.home?.hasMore).to.equal(false);
    expect(state.owners.f1?.nickname).to.equal("friend");
  });

  it("treats a page as stale after a minute, but never while it loads", () => {
    const loaded = SocialState_applyFeedPage(SocialState_empty("me"), "home", response("me", [1], "c1"), true, 1000);
    expect(SocialState_isPageStale(undefined, 0)).to.equal(true);
    expect(SocialState_isPageStale(loaded.pages.home, 1000 + SocialState_pageTtlMs)).to.equal(false);
    expect(SocialState_isPageStale(loaded.pages.home, 1001 + SocialState_pageTtlMs)).to.equal(true);
    const refreshing = SocialState_startRefresh(loaded, "home");
    expect(SocialState_isPageStale(refreshing.pages.home, 1001 + SocialState_pageTtlMs)).to.equal(false);
  });

  it("adds new workouts on refresh and keeps the loaded pages and cursor", () => {
    let state = SocialState_empty("me");
    state = SocialState_applyFeedPage(state, "home", response("me", [2, 3], "c1"), true, 1000);
    state = SocialState_applyFeedPage(state, "home", response("me", [4], "c2"), false, 2000);
    state = SocialState_applyFeedRefresh(state, "home", response("me", [1, 2], "fresh"), 90_000);
    expect(state.pages.home?.keys).to.eql(["f1:1", "f1:2", "f1:3", "f1:4"]);
    expect(state.pages.home?.cursor).to.equal("c2");
    expect(state.pages.home?.loadedAt).to.equal(90_000);
  });

  it("replaces the page on a first-page reload", () => {
    let state = SocialState_empty("me");
    state = SocialState_applyFeedPage(state, "home", response("me", [1, 2], "c1"), true);
    state = SocialState_applyFeedPage(state, "home", response("me", [3], "c2"), true);
    expect(state.pages.home?.keys).to.eql(["f1:3"]);
  });

  it("drops a response that belongs to another account", () => {
    const state = SocialState_empty("me");
    const next = SocialState_applyFeedPage(state, "home", response("someone-else", [1]), true);
    expect(next).to.equal(state);
  });

  it("resets on account change", () => {
    const switched = SocialState_forAccount(
      SocialState_applyFeedPage(SocialState_empty("a"), "home", response("a", [1]), true),
      "b"
    );
    expect(switched?.accountId).to.equal("b");
    expect(switched?.pages).to.eql({});
    expect(switched?.workouts).to.eql({});
    expect(SocialState_forAccount(switched, "b")).to.equal(switched);
  });

  it("clears friend data on logout", () => {
    expect(SocialState_forAccount(SocialState_empty("a"), undefined)).to.equal(undefined);
  });

  it("applies a reaction optimistically and restores it on failure", () => {
    const state = SocialState_applyOwnReactions(SocialState_empty("me"), "me", [5], {
      5: { counts: { dino_pr: 1 }, reactors: [{ nickname: "x" }], total: 1 },
    });
    const before = state.reactions["me:5"];
    const reacted = SocialState_applyReaction(state, "me:5", { userId: "me" }, "dino_fire");
    expect(reacted.reactions["me:5"]?.counts).to.eql({ dino_pr: 1, dino_fire: 1 });
    const restored = SocialState_restoreReaction(reacted, "me:5", before);
    expect(restored.reactions["me:5"]).to.equal(before);
  });

  it("clears a requested own workout whose last reaction was removed", () => {
    const summary = { counts: { dino_pr: 1 }, reactors: [{ nickname: "x" }], total: 1 };
    const loaded = SocialState_applyOwnReactions(SocialState_empty("me"), "me", [5, 6], { 5: summary, 6: summary });
    const refreshed = SocialState_applyOwnReactions(loaded, "me", [5], {});
    expect(refreshed.reactions["me:5"]).to.equal(undefined);
    expect(refreshed.reactions["me:6"]).to.equal(summary);
  });

  describe("program edits", () => {
    const hour = 60 * 60 * 1000;
    const now = 100 * 24 * hour;
    const edits = {
      accountId: "me",
      unseenCount: 2,
      programs: [
        {
          programId: "p1",
          programName: "5x5",
          unseen: 2,
          latest: { editorId: "c", nickname: "Sam", createdAt: now - 2 * hour },
        },
        { programId: "p2", programName: "Old", unseen: 0, latest: { editorId: "c", createdAt: now - 40 * 24 * hour } },
      ],
    };

    it("counts unseen edits for the signed-in account only, and ignores another account's response", () => {
      const state = SocialState_applyProgramEdits(SocialState_empty("me"), edits, now);
      expect(SocialState_unseenProgramEdits(state, "me")).to.equal(2);
      expect(SocialState_unseenProgramEdits(state, "other")).to.equal(0);
      const foreign = SocialState_applyProgramEdits(SocialState_empty("me"), { ...edits, accountId: "x" }, now);
      expect(SocialState_unseenProgramEdits(foreign, "me")).to.equal(0);
    });

    it("writes the program line for recent edits, and hides edits older than 30 days", () => {
      const state = SocialState_applyProgramEdits(SocialState_empty("me"), edits, now);
      expect(SocialState_programEditLine(state.programEdits, "p1", now)).to.eql({
        text: "Sam edited this program · 2h ago",
        isUnseen: true,
      });
      expect(SocialState_programEditLine(state.programEdits, "p2", now)).to.equal(undefined);
      expect(SocialState_programEditLine(state.programEdits, "p3", now)).to.equal(undefined);
    });

    it("refreshes after the TTL", () => {
      const state = SocialState_applyProgramEdits(SocialState_empty("me"), edits, now);
      expect(SocialState_isProgramEditsStale(state, now + 1000)).to.equal(false);
      expect(SocialState_isProgramEditsStale(state, now + SocialState_pageTtlMs + 1)).to.equal(true);
      expect(SocialState_isProgramEditsStale(SocialState_empty("me"), now)).to.equal(true);
    });

    it("counts unseen edits outside the current program, for the dot on the change-program button", () => {
      const withOther = {
        ...edits,
        programs: [...edits.programs, { ...edits.programs[1], programId: "p3", unseen: 3 }],
      };
      expect(SocialState_unseenEditsInOtherPrograms(withOther, "p1")).to.equal(3);
      expect(SocialState_unseenEditsInOtherPrograms(withOther, "p3")).to.equal(2);
      expect(SocialState_unseenEditsInOtherPrograms(edits, "p1")).to.equal(0);
      expect(SocialState_unseenEditsInOtherPrograms(undefined, "p1")).to.equal(0);
    });

    it("asks to mark seen when the summary has unseen edits the loaded page does not show", () => {
      const state = SocialState_applyProgramEdits(SocialState_empty("me"), edits, now);
      const seenPage = [{ id: "e1", programId: "p1", editorId: "c", createdAt: now, seen: true }];
      expect(SocialState_hasUnseenEditsFor(state, "p1", seenPage)).to.equal(true);
      expect(SocialState_hasUnseenEditsFor(state, "p2", seenPage)).to.equal(false);
      expect(SocialState_hasUnseenEditsFor(state, "p2", [{ ...seenPage[0], seen: false }])).to.equal(true);
    });
  });

  describe("friend programs", () => {
    const program = Program_create("5x5", "p1");
    const context = {
      ownerId: "sam",
      exported: { program, customExercises: {}, version: "1", settings: {} },
      settings: Settings_build(),
      base: "b",
      canEdit: false,
    };
    function follows(programs: boolean): IFollowsResponse {
      const permissions = { notes: false, programs, programEdits: false };
      return {
        accountId: "me",
        following: [{ userId: "sam", permissions }],
        followers: [],
        incoming: [],
        outgoing: [],
      };
    }

    it("replaces cached data with a message on failure, and clears the message on success", () => {
      let state = SocialState_applyFriendProgram(SocialState_empty("me"), context);
      state = SocialState_failFriendProgram(state, "sam", "p1", "not_found");
      const key = SocialState_friendProgramKey("sam", "p1");
      expect(state.friendProgram[key]).to.equal(undefined);
      expect(state.friendErrors[key]).to.contain("not be shared");
      expect(SocialState_failFriendPrograms(state, "sam", "network").friendErrors.sam).to.contain("connection");
      state = SocialState_applyFriendProgram(state, context);
      expect(state.friendErrors[key]).to.equal(undefined);
    });

    it("drops cached programs of people who stopped sharing them", () => {
      let state = SocialState_applyFriendPrograms(SocialState_empty("me"), "sam", [
        { id: "p1", name: "5x5", isCurrent: true },
      ]);
      state = SocialState_applyFriendProgram(state, context);
      const kept = SocialState_applyFollows(state, follows(true));
      expect(kept.friendPrograms.sam).to.have.length(1);
      const dropped = SocialState_applyFollows(state, follows(false));
      expect(dropped.friendPrograms.sam).to.equal(undefined);
      expect(dropped.friendProgram[SocialState_friendProgramKey("sam", "p1")]).to.equal(undefined);
    });
  });
});
