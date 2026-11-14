/* eslint-disable @typescript-eslint/no-explicit-any */
import "mocha";
import { expect } from "chai";
import JWT from "jsonwebtoken";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import sinon from "sinon";
import { getRawHandler, IHandler } from "../lambda";
import { buildMockDi, IMockDI } from "./utils/mockDi";
import { MockLogUtil } from "./utils/mockLogUtil";
import { MockFetch } from "./utils/mockFetch";
import { userTableNames, UserDao } from "../lambda/dao/userDao";
import { followTableNames } from "../lambda/dao/followDao";
import { reactionTableNames } from "../lambda/dao/reactionDao";
import { ProgramEditDao, ProgramEditDao_build, programEditTableNames } from "../lambda/dao/programEditDao";
import { Storage_getDefault } from "../src/models/storage";
import { FriendsFixtures_entry, FriendsFixtures_record } from "./friendsFixtures";
import { Program_create } from "../src/models/program";
import {
  PlannerProgram_evaluateText,
  PlannerProgram_generateFullText,
} from "../src/pages/planner/models/plannerProgram";

function event(
  method: string,
  path: string,
  userId: string | undefined,
  opts?: { body?: unknown; qs?: Record<string, string> }
): APIGatewayProxyEvent {
  const headers: Record<string, string> = {};
  if (userId != null) {
    headers.Cookie = `session=${JWT.sign({ userId }, "cookieSecret")}`;
  }
  return {
    body: opts?.body ? JSON.stringify(opts.body) : null,
    headers,
    multiValueHeaders: {},
    httpMethod: method,
    isBase64Encoded: false,
    path,
    pathParameters: {},
    queryStringParameters: opts?.qs || {},
    multiValueQueryStringParameters: {},
    stageVariables: {},
    requestContext: {} as any,
    resource: "",
  };
}

function body(result: APIGatewayProxyResult): any {
  return JSON.parse(result.body);
}

describe("Friends API", () => {
  let sandbox: sinon.SinonSandbox;
  let di: IMockDI;
  let handler: IHandler;
  const ctx = { getRemainingTimeInMillis: (): number => 10000 };
  const call = (e: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => handler(e, ctx);

  async function addUser(id: string, nickname: string): Promise<void> {
    const storage = Storage_getDefault();
    storage.tempUserId = id;
    storage.settings.nickname = nickname;
    await di.dynamo.put({
      tableName: userTableNames.prod.users,
      item: { id, email: `${id}@example.com`, createdAt: 1, storage },
    });
  }

  async function addRecord(userId: string, id: number, date: string, notes?: string): Promise<void> {
    const record = FriendsFixtures_record(id, date, {
      notes,
      entries: [FriendsFixtures_entry({ notes: notes ? `${notes} entry` : undefined })],
    });
    await di.dynamo.put({ tableName: userTableNames.prod.historyRecords, item: { ...record, userId } });
  }

  async function befriend(
    follower: string,
    followee: string,
    notes: boolean = false,
    programs: { programs?: boolean } = {}
  ): Promise<string> {
    const invite = body(await call(event("POST", "/api/follow/invites", followee))).data;
    const request = body(await call(event("POST", `/api/follow/invites/${invite.token}/request`, follower))).data;
    await call(
      event("POST", `/api/follows/requests/${request.requestId}/approve`, followee, {
        body: { permissions: { notes, ...programs }, followBack: false },
      })
    );
    return request.requestId;
  }

  async function addProgram(userId: string, text: string): Promise<void> {
    const program = {
      ...Program_create("Strength", "p1"),
      clonedAt: 1000,
      nextDay: 2,
      planner: { vtype: "planner" as const, name: "Strength", weeks: PlannerProgram_evaluateText(text) },
    };
    await new UserDao(di).saveProgram(userId, program);
    const user = await di.dynamo.get<any>({ tableName: userTableNames.prod.users, key: { id: userId } });
    user.storage.currentProgramId = "p1";
    await di.dynamo.put({ tableName: userTableNames.prod.users, item: user });
  }

  beforeEach(async () => {
    (global as any).__API_HOST__ = "https://www.liftosaur.com";
    (global as any).__HOST__ = "https://www.liftosaur.com";
    (global as any).__ENV__ = "prod";
    (global as any).__FULL_COMMIT_HASH__ = "abc123";
    (global as any).__COMMIT_HASH__ = "abc123";
    (global as any).Rollbar = { configure: () => undefined };
    sandbox = sinon.createSandbox();
    let ts = 2000000000000;
    sandbox.stub(Date, "now").callsFake(() => {
      ts += 1;
      return ts;
    });
    const log = new MockLogUtil();
    const mockFetch = new MockFetch("anna", []);
    di = buildMockDi(log, mockFetch.fetch.bind(mockFetch));
    handler = getRawHandler(() => di);
    mockFetch.handler = handler;
    await addUser("anna", "Anna");
    await addUser("boris", "Boris");
    await addUser("carl", "Carl");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("rejects every endpoint without a session", async () => {
    expect((await call(event("POST", "/api/follow/invites", undefined))).statusCode).to.equal(401);
    expect((await call(event("GET", "/api/follows", undefined))).statusCode).to.equal(401);
    expect((await call(event("GET", "/api/feed", undefined))).statusCode).to.equal(401);
  });

  it("shows only the nickname before the follow is approved", async () => {
    const invite = body(await call(event("POST", "/api/follow/invites", "boris"))).data;
    expect(invite.url).to.equal(`https://www.liftosaur.com/f/${invite.token}`);
    const preview = await call(event("GET", `/api/follow/invites/${invite.token}`, "anna"));
    expect(body(preview).data).to.eql({ nickname: "Boris", isSelf: false });
    expect(preview.body).to.not.contain('boris"');
  });

  it("uses an invite once and returns the same request on retry", async () => {
    const invite = body(await call(event("POST", "/api/follow/invites", "boris"))).data;
    const first = body(await call(event("POST", `/api/follow/invites/${invite.token}/request`, "anna"))).data;
    const retry = body(await call(event("POST", `/api/follow/invites/${invite.token}/request`, "anna"))).data;
    expect(retry.requestId).to.equal(first.requestId);
    const other = await call(event("POST", `/api/follow/invites/${invite.token}/request`, "carl"));
    expect(other.statusCode).to.equal(404);
  });

  it("refuses an invite to yourself", async () => {
    const invite = body(await call(event("POST", "/api/follow/invites", "boris"))).data;
    const result = await call(event("POST", `/api/follow/invites/${invite.token}/request`, "boris"));
    expect(result.statusCode).to.equal(400);
  });

  it("lets only the followee approve", async () => {
    const invite = body(await call(event("POST", "/api/follow/invites", "boris"))).data;
    const request = body(await call(event("POST", `/api/follow/invites/${invite.token}/request`, "anna"))).data;
    const byFollower = await call(event("POST", `/api/follows/requests/${request.requestId}/approve`, "anna"));
    expect(byFollower.statusCode).to.equal(403);
    const byStranger = await call(event("POST", `/api/follows/requests/${request.requestId}/approve`, "carl"));
    expect(byStranger.statusCode).to.equal(403);
    const incoming = body(await call(event("GET", "/api/follows", "boris"))).data;
    expect(incoming.incoming.length).to.equal(1);
    expect(JSON.stringify(incoming.incoming)).to.not.contain("anna");
  });

  it("sends a pending request back on follow back", async () => {
    const invite = body(await call(event("POST", "/api/follow/invites", "boris"))).data;
    const request = body(await call(event("POST", `/api/follow/invites/${invite.token}/request`, "anna"))).data;
    await call(
      event("POST", `/api/follows/requests/${request.requestId}/approve`, "boris", {
        body: { permissions: { notes: false }, followBack: true },
      })
    );
    const anna = body(await call(event("GET", "/api/follows", "anna"))).data;
    expect(anna.following.map((f: any) => f.userId)).to.eql(["boris"]);
    expect(anna.incoming.length).to.equal(1);
    expect(anna.followers).to.eql([]);
  });

  it("serves followed workouts newest first and strips notes without permission", async () => {
    await befriend("anna", "boris", false);
    await addRecord("boris", 1000, "2026-11-01T10:00:00.000Z", "secret");
    await addRecord("boris", 2000, "2026-11-05T10:00:00.000Z");
    await addRecord("carl", 3000, "2026-11-06T10:00:00.000Z");
    const feed = body(await call(event("GET", "/api/feed", "anna"))).data;
    expect(feed.workouts.map((w: any) => w.recordId)).to.eql([2000, 1000]);
    expect(feed.owners.boris.nickname).to.equal("Boris");
    expect(JSON.stringify(feed)).to.not.contain("secret");
  });

  it("includes notes when the followee allows them", async () => {
    await befriend("anna", "boris", true);
    await addRecord("boris", 1000, "2026-11-01T10:00:00.000Z", "secret");
    const feed = body(await call(event("GET", "/api/feed", "anna"))).data;
    expect(feed.workouts[0].notes).to.equal("secret");
    expect(feed.workouts[0].exercises[0].notes).to.equal("secret entry");
  });

  it("pages the feed with a cursor without repeating or skipping workouts", async () => {
    await befriend("anna", "boris");
    for (let i = 1; i <= 5; i += 1) {
      await addRecord("boris", i * 1000, "2026-11-01T10:00:00.000Z");
    }
    const first = body(await call(event("GET", "/api/feed", "anna", { qs: { limit: "2" } }))).data;
    const second = body(
      await call(event("GET", "/api/feed", "anna", { qs: { limit: "2", cursor: first.cursor } }))
    ).data;
    const third = body(
      await call(event("GET", "/api/feed", "anna", { qs: { limit: "2", cursor: second.cursor } }))
    ).data;
    const ids = [...first.workouts, ...second.workouts, ...third.workouts].map((w: any) => w.recordId);
    expect(ids).to.eql([5000, 4000, 3000, 2000, 1000]);
  });

  it("lets followers and the owner react, and forbids strangers", async () => {
    await befriend("anna", "boris");
    await addRecord("boris", 1000, "2026-11-01T10:00:00.000Z");
    const ok = await call(event("PUT", "/api/reactions/boris/1000", "anna", { body: { reaction: "dino_fire" } }));
    expect(ok.statusCode).to.equal(200);
    const swap = await call(event("PUT", "/api/reactions/boris/1000", "anna", { body: { reaction: "dino_hug2" } }));
    expect(swap.statusCode).to.equal(200);
    const stranger = await call(event("PUT", "/api/reactions/boris/1000", "carl", { body: { reaction: "dino_pr" } }));
    expect(stranger.statusCode).to.equal(403);
    const bad = await call(event("PUT", "/api/reactions/boris/1000", "anna", { body: { reaction: "dino_nope" } }));
    expect(bad.statusCode).to.equal(400);
    const missing = await call(event("PUT", "/api/reactions/boris/9999", "anna", { body: { reaction: "dino_pr" } }));
    expect(missing.statusCode).to.equal(404);

    const own = body(await call(event("GET", "/api/reactions", "boris", { qs: { ids: "1000" } }))).data;
    expect(own["1000"].counts).to.eql({ dino_hug2: 1 });
    expect(own["1000"].reactors[0].nickname).to.equal("Anna");
  });

  it("hides reactions from people who no longer follow", async () => {
    await befriend("anna", "boris");
    await addRecord("boris", 1000, "2026-11-01T10:00:00.000Z");
    await call(event("PUT", "/api/reactions/boris/1000", "anna", { body: { reaction: "dino_fire" } }));
    await call(event("DELETE", "/api/follows/followers/anna", "boris"));
    const own = body(await call(event("GET", "/api/reactions", "boris", { qs: { ids: "1000" } }))).data;
    expect(own["1000"]).to.equal(undefined);
  });

  it("stops serving a removed follower", async () => {
    await befriend("anna", "boris");
    await addRecord("boris", 1000, "2026-11-01T10:00:00.000Z");
    await call(event("DELETE", "/api/follows/following/boris", "anna"));
    const feed = body(await call(event("GET", "/api/feed", "anna"))).data;
    expect(feed.workouts).to.eql([]);
  });

  it("removes follows and reactions with the account", async () => {
    await befriend("anna", "boris");
    await addRecord("boris", 1000, "2026-11-01T10:00:00.000Z");
    await call(event("PUT", "/api/reactions/boris/1000", "anna", { body: { reaction: "dino_fire" } }));
    await new UserDao(di).removeUser("anna");
    expect(Object.keys(di.dynamo.data[followTableNames.prod.follows] || {})).to.eql([]);
    expect(Object.keys(di.dynamo.data[reactionTableNames.prod.reactions] || {})).to.eql([]);
  });

  it("removes reactions when the workout is deleted", async () => {
    await befriend("anna", "boris");
    await addRecord("boris", 1000, "2026-11-01T10:00:00.000Z");
    await call(event("PUT", "/api/reactions/boris/1000", "anna", { body: { reaction: "dino_fire" } }));
    await new UserDao(di).deleteHistoryRecord("boris", 1000);
    expect(Object.keys(di.dynamo.data[reactionTableNames.prod.reactions] || {})).to.eql([]);
  });

  it("removes received reactions with the owner's account even when the workout is already gone", async () => {
    await befriend("anna", "boris");
    await addRecord("boris", 1000, "2026-11-01T10:00:00.000Z");
    await call(event("PUT", "/api/reactions/boris/1000", "anna", { body: { reaction: "dino_fire" } }));
    await di.dynamo.remove({ tableName: userTableNames.prod.historyRecords, key: { id: 1000, userId: "boris" } });
    await new UserDao(di).removeUser("boris");
    expect(Object.keys(di.dynamo.data[reactionTableNames.prod.reactions] || {})).to.eql([]);
  });

  it("serves the invite web page without exposing the inviter id", async () => {
    const invite = body(await call(event("POST", "/api/follow/invites", "boris"))).data;
    const page = await call(event("GET", `/f/${invite.token}`, undefined));
    expect(page.statusCode).to.equal(200);
    expect(page.body).to.contain("Boris invited you");
    expect(page.body).to.not.contain("boris");
    const expired = await call(event("GET", "/f/unknown-token", undefined));
    expect(expired.statusCode).to.equal(404);
  });

  it("changes only the permissions a request names", async () => {
    await befriend("anna", "boris", true, { programs: true });
    const result = await call(
      event("PUT", "/api/follows/followers/anna/permissions", "boris", { body: { permissions: { notes: false } } })
    );
    expect(result.statusCode).to.equal(200);
    const follows = body(await call(event("GET", "/api/follows", "anna"))).data;
    expect(follows.following[0].permissions).to.eql({ notes: false, programs: true });
  });

  describe("friend programs", () => {
    const original = "# Week 1\n## Day 1\nSquat / 3x5 / 100lb\n";
    const deload = "# Week 1\n## Day 1\nSquat / 5x5 / 90lb\n";

    it("shows programs only with the programs permission", async () => {
      await addProgram("boris", original);
      await befriend("anna", "boris");
      expect((await call(event("GET", "/api/friends/boris/programs", "anna"))).statusCode).to.equal(404);

      await befriend("carl", "boris", false, { programs: true });
      const list = body(await call(event("GET", "/api/friends/boris/programs", "carl"))).data;
      expect(list.programs).to.eql([{ id: "p1", name: "Strength", isCurrent: true }]);
      const follows = body(await call(event("GET", "/api/follows", "carl"))).data;
      expect(follows.following[0].permissions).to.eql({ notes: false, programs: true });
    });

    it("reads a program with its context, and refuses reads and edits without the programs permission", async () => {
      await addProgram("boris", original);
      await befriend("anna", "boris", false, { programs: true });
      const program = body(await call(event("GET", "/api/friends/boris/programs/p1", "anna"))).data;
      expect(program.exported.program.id).to.equal("p1");

      await befriend("carl", "boris", false);
      expect((await call(event("GET", "/api/friends/boris/programs/p1", "carl"))).statusCode).to.equal(404);
      const save = await call(
        event("POST", "/api/friends/boris/programs/p1", "carl", { body: { text: deload, base: program.base } })
      );
      expect(save.statusCode).to.equal(404);
    });

    it("writes the owner's program, keeps nextDay, and rejects a save from an old base", async () => {
      await addProgram("boris", original);
      await befriend("anna", "boris", false, { programs: true });
      const read = body(await call(event("GET", "/api/friends/boris/programs/p1", "anna"))).data;

      const first = await call(
        event("POST", "/api/friends/boris/programs/p1", "anna", { body: { text: deload, base: read.base } })
      );
      expect(first.statusCode).to.equal(200);
      const saved = (await new UserDao(di).getProgramsByUserId("boris"))[0];
      expect(PlannerProgram_generateFullText(saved.planner!.weeks)).to.contain("Squat / 5x5 / 90lb");
      expect(saved.nextDay).to.equal(2);

      const stale = await call(
        event("POST", "/api/friends/boris/programs/p1", "anna", { body: { text: original, base: read.base } })
      );
      expect(stale.statusCode).to.equal(409);
      const next = await call(
        event("POST", "/api/friends/boris/programs/p1", "anna", {
          body: { text: original, base: body(first).data.base },
        })
      );
      expect(next.statusCode).to.equal(200);
    });

    it("tells the owner who edited what, and marks the edits seen", async () => {
      await addProgram("boris", original);
      await befriend("anna", "boris", false, { programs: true });
      const read = body(await call(event("GET", "/api/friends/boris/programs/p1", "anna"))).data;
      await call(event("POST", "/api/friends/boris/programs/p1", "anna", { body: { text: deload, base: read.base } }));

      const edits = body(await call(event("GET", "/api/program-edits", "boris"))).data;
      expect(edits.unseenCount).to.equal(1);
      expect(edits.programs[0]).to.deep.include({ programId: "p1", programName: "Strength", unseen: 1 });
      expect(edits.programs[0].latest).to.deep.include({ editorId: "anna", nickname: "Anna" });

      const detail = body(await call(event("GET", "/api/program-edits/p1", "boris"))).data;
      expect(detail.edits[0].before).to.contain("Squat / 3x5 / 100lb");
      expect(detail.edits[0].after).to.contain("Squat / 5x5 / 90lb");

      const seen = body(
        await call(event("POST", "/api/program-edits/seen", "boris", { body: { programId: "p1" } }))
      ).data;
      expect(seen.unseenCount).to.equal(0);
      expect(body(await call(event("GET", "/api/program-edits", "anna"))).data.unseenCount).to.equal(0);
    });

    it("marks every unseen edit of a program seen, including those past the newest 20", async () => {
      const dao = new ProgramEditDao(di);
      for (let i = 0; i < 25; i += 1) {
        const programId = i === 0 ? "p2" : "p1";
        const args = { ownerId: "boris", programId, programName: "Strength", editorId: "anna", revision: "" };
        await dao.put(ProgramEditDao_build({ ...args, now: 1000 + i }));
      }
      const detail = body(await call(event("GET", "/api/program-edits/p1", "boris"))).data;
      expect(detail.edits).to.have.length(20);

      const seen = body(
        await call(event("POST", "/api/program-edits/seen", "boris", { body: { programId: "p1" } }))
      ).data;
      expect(seen.unseenCount).to.equal(1);
      expect(seen.programs.find((p: any) => p.programId === "p2").unseen).to.equal(1);
    });

    it("does not write when another write landed after the load", async () => {
      const userDao = new UserDao(di);
      const loaded = (await userDao.getLimitedById("boris"))!;
      const other = (await userDao.getLimitedById("boris"))!;
      await userDao.applyStorageUpdate(other, (old) => ({ ...old }), "phone");
      const stored = await userDao.applyStorageUpdateIfUnchanged(
        loaded,
        (old) => ({ ...old }),
        "srv_api",
        () => []
      );
      expect(stored).to.equal(false);
      const fresh = (await userDao.getLimitedById("boris"))!;
      expect(
        await userDao.applyStorageUpdateIfUnchanged(
          fresh,
          (old) => ({ ...old }),
          "srv_api",
          () => []
        )
      ).to.equal(true);
    });

    it("removes program edits with the editor's and the owner's accounts", async () => {
      await addProgram("boris", original);
      await befriend("anna", "boris", false, { programs: true });
      const read = body(await call(event("GET", "/api/friends/boris/programs/p1", "anna"))).data;
      await call(event("POST", "/api/friends/boris/programs/p1", "anna", { body: { text: deload, base: read.base } }));
      expect(Object.keys(di.dynamo.data[programEditTableNames.prod.programEdits] || {})).to.have.length(1);
      await new UserDao(di).removeUser("anna");
      expect(Object.keys(di.dynamo.data[programEditTableNames.prod.programEdits] || {})).to.eql([]);
    });

    it("serves the coach web editor only with the programs permission", async () => {
      await addProgram("boris", original);
      await befriend("anna", "boris", false);
      expect((await call(event("GET", "/planner/friend/boris/p1", "anna"))).statusCode).to.equal(404);
      expect((await call(event("GET", "/planner/friend/boris/p1", undefined))).statusCode).to.equal(302);

      await befriend("carl", "boris", false, { programs: true });
      const page = await call(event("GET", "/planner/friend/boris/p1", "carl"));
      expect(page.statusCode).to.equal(200);
      expect(page.body).to.contain("Editing Boris");
      expect(page.body).to.contain("Squat");
      expect(page.body).to.not.contain("boris@example.com");
    });

    it("never sends the owner's notes to a friend without the notes permission", async () => {
      await addProgram("boris", original);
      const user = await di.dynamo.get<any>({ tableName: userTableNames.prod.users, key: { id: "boris" } });
      user.storage.settings.exerciseData = { squat_barbell: { rm1: { value: 140, unit: "kg" }, notes: "SECRET knee" } };
      await di.dynamo.put({ tableName: userTableNames.prod.users, item: user });
      await addRecord("boris", 1000, "2026-11-01T10:00:00.000Z", "SECRET workout");
      await befriend("carl", "boris", false, { programs: true });

      const responses = await Promise.all([
        call(event("GET", "/api/feed", "carl")),
        call(event("GET", "/api/friends/boris/programs", "carl")),
        call(event("GET", "/api/friends/boris/programs/p1", "carl")),
        call(event("GET", "/planner/friend/boris/p1", "carl")),
      ]);
      for (const response of responses) {
        expect(response.statusCode).to.equal(200);
        expect(response.body).to.not.contain("SECRET");
      }
      const program = body(responses[2]).data;
      expect(program.settings.exerciseData.squat_barbell.rm1.value).to.equal(140);
    });

    it("refuses your own account and planner-less programs", async () => {
      await addProgram("boris", original);
      expect((await call(event("GET", "/api/friends/boris/programs", "boris"))).statusCode).to.equal(400);
      await befriend("anna", "boris", false, { programs: true });
      expect((await call(event("GET", "/api/friends/boris/programs/missing", "anna"))).statusCode).to.equal(404);
    });
  });
});
