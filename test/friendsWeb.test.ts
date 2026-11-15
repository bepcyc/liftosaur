import "mocha";
import { expect } from "chai";
import {
  FriendsWeb_presentation,
  FriendsWeb_programsUrl,
  FriendsWeb_rows,
  FriendsWeb_workoutsUrl,
} from "../src/models/friendsWeb";
import { IFollowing } from "../src/models/follow";

function following(userId: string, overrides: Partial<IFollowing> = {}): IFollowing {
  return { userId, permissions: { notes: false, programs: false }, ...overrides };
}

describe("FriendsWeb", () => {
  it("lists the most recently trained friends first, then by name", () => {
    const rows = FriendsWeb_rows([
      following("a", { nickname: "Zed", lastWorkoutAt: 100 }),
      following("b", { nickname: "Amy" }),
      following("c", { nickname: "Bob" }),
      following("d", { nickname: "Kim", lastWorkoutAt: 200 }),
    ]);
    expect(rows.map((r) => r.name)).to.eql(["Kim", "Zed", "Amy", "Bob"]);
  });

  it("names friends without a nickname 'A friend' and marks who shares programs", () => {
    const rows = FriendsWeb_rows([following("a", { permissions: { notes: false, programs: true } })]);
    expect(rows).to.eql([{ userId: "a", name: "A friend", lastWorkoutAt: undefined, canEditPrograms: true }]);
  });

  it("gives each page its path, document title and heading", () => {
    const base = { isMobile: false, account: { id: "me", isCurrent: true }, now: 0 };
    expect(FriendsWeb_presentation({ ...base, kind: "list", friends: [] })).to.eql({
      path: "/user/friends",
      documentTitle: "Friends | Liftosaur",
      heading: "Friends",
    });
    expect(FriendsWeb_presentation({ ...base, kind: "programs", ownerId: "a b", name: "Sam", programs: [] })).to.eql({
      path: "/user/friends/a%20b/programs",
      documentTitle: "Sam's programs | Liftosaur",
      heading: "Sam's programs",
    });
  });

  it("builds escaped page urls", () => {
    expect(FriendsWeb_workoutsUrl("a/b")).to.equal("/user/friends/a%2Fb/workouts");
    expect(FriendsWeb_programsUrl("abc")).to.equal("/user/friends/abc/programs");
  });
});
