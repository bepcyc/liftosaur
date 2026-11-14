import { IDI } from "./di";
import { IApiResult, err } from "./apiv1Common";
import { FollowDao } from "../dao/followDao";
import { ILimitedUserDao, UserDao } from "../dao/userDao";
import { ProgramEditDao, ProgramEditDao_build } from "../dao/programEditDao";
import { FollowAccess_permissions } from "./followAccess";
import { FriendProgramBase_decode, FriendProgramBase_encode } from "./friendProgramBase";
import { FriendProgramUpdate_check } from "./friendProgramUpdate";
import { IFollowPermissions } from "../../src/models/follow";
import {
  IFriendProgramContext,
  IFriendProgramSummary,
  IProgramEdit,
  IProgramEditsForProgram,
  IProgramEditsResponse,
  IProgramEditSummary,
} from "../../src/models/friendProgram";
import { IExportedProgram, Program_exportProgram } from "../../src/models/program";
import { Settings_webEditorInitial } from "../../src/models/settings";
import { FriendProjection_settings } from "../../src/models/friendProjection";
import { IPlannerFriendTarget } from "../../src/pages/planner/models/plannerProgramSave";
import { IProgram } from "../../src/types";
import { FieldRevision_programPlanner } from "../../src/utils/fieldRevision";
import { VersionTrackerUtils_SERVER_DEVICE_ID } from "../../src/models/versionTracker/utils";
import { PlannerProgram_generateFullText } from "../../src/pages/planner/models/plannerProgram";

export type IFriendProgramNeed = "programs" | "programEdits";

export async function FriendPrograms_access(
  di: IDI,
  viewerId: string,
  ownerId: string,
  need: IFriendProgramNeed
): Promise<IApiResult<IFollowPermissions>> {
  if (ownerId === viewerId) {
    return err(400, "invalid_input", "That is your own account. Use the program tools for your own programs.");
  }
  const permissions = FollowAccess_permissions(viewerId, ownerId, await new FollowDao(di).get(viewerId, ownerId));
  if (permissions == null || !permissions[need]) {
    return err(404, "not_found", "No friend with this id shares programs with you. Use list_friends.");
  }
  return { success: true, data: permissions };
}

async function loadOwner(di: IDI, ownerId: string): Promise<IApiResult<ILimitedUserDao>> {
  const userDao = new UserDao(di);
  const user = await userDao.getLimitedById(ownerId);
  if (user == null) {
    return err(404, "not_found", "No friend with this id shares programs with you. Use list_friends.");
  }
  const migration = await userDao.migrateStoredStorage(user, VersionTrackerUtils_SERVER_DEVICE_ID);
  if (!migration.success) {
    return err(500, "server_error", "Could not load the program");
  }
  const owner = migration.data.user;
  const programs = await userDao.getProgramsByUserId(ownerId);
  return { success: true, data: { ...owner, storage: { ...owner.storage, programs } } };
}

function editable(program: IProgram): boolean {
  return program.planner != null && program.clonedAt != null;
}

function baseFor(owner: ILimitedUserDao, program: IProgram): string {
  return FriendProgramBase_encode({
    v: 1,
    ownerId: owner.id,
    programId: program.id,
    clonedAt: program.clonedAt ?? 0,
    plannerVersion: FieldRevision_programPlanner(owner.storage._versions, program.clonedAt),
  });
}

export async function FriendPrograms_list(
  di: IDI,
  viewerId: string,
  ownerId: string
): Promise<IApiResult<{ programs: IFriendProgramSummary[] }>> {
  const access = await FriendPrograms_access(di, viewerId, ownerId, "programs");
  if (!access.success) {
    return access;
  }
  const [user, programs] = await Promise.all([
    new UserDao(di).getLimitedById(ownerId),
    new UserDao(di).getProgramsByUserId(ownerId),
  ]);
  const currentId = user?.storage.currentProgramId;
  return {
    success: true,
    data: {
      programs: programs
        .filter(editable)
        .map((p) => ({ id: p.id, name: p.name, isCurrent: p.id === currentId }))
        .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.name.localeCompare(b.name)),
    },
  };
}

export async function FriendPrograms_get(
  di: IDI,
  viewerId: string,
  ownerId: string,
  programId: string
): Promise<IApiResult<IFriendProgramContext & { isCurrent: boolean }>> {
  const access = await FriendPrograms_access(di, viewerId, ownerId, "programs");
  if (!access.success) {
    return access;
  }
  const owner = await loadOwner(di, ownerId);
  if (!owner.success) {
    return owner;
  }
  const program = (owner.data.storage.programs || []).find((p) => p.id === programId);
  if (program == null || !editable(program)) {
    return err(404, "not_found", "Program not found. Use list_friend_programs.");
  }
  return {
    success: true,
    data: {
      ownerId,
      exported: Program_exportProgram(program, owner.data.storage.settings),
      settings: FriendProjection_settings(owner.data.storage.settings, access.data),
      base: baseFor(owner.data, program),
      canEdit: access.data.programEdits,
      isCurrent: owner.data.storage.currentProgramId === program.id,
    },
  };
}

export interface IFriendProgramEditorContext {
  exported: IExportedProgram;
  friendTarget: IPlannerFriendTarget;
}

export async function FriendPrograms_editorContext(
  di: IDI,
  viewerId: string,
  ownerId: string,
  programId: string
): Promise<IApiResult<IFriendProgramEditorContext>> {
  const access = await FriendPrograms_access(di, viewerId, ownerId, "programEdits");
  if (!access.success) {
    return access;
  }
  const owner = await loadOwner(di, ownerId);
  if (!owner.success) {
    return owner;
  }
  const program = (owner.data.storage.programs || []).find((p) => p.id === programId);
  if (program == null || !editable(program)) {
    return err(404, "not_found", "Program not found");
  }
  const settings = owner.data.storage.settings;
  const exported = Program_exportProgram(program, settings);
  return {
    success: true,
    data: {
      exported,
      friendTarget: {
        ownerId,
        nickname: settings.nickname,
        base: baseFor(owner.data, program),
        settings: Settings_webEditorInitial(FriendProjection_settings(settings, access.data), exported.customExercises),
      },
    },
  };
}

export async function FriendPrograms_update(
  di: IDI,
  editorId: string,
  ownerId: string,
  programId: string,
  args: { text: unknown; base: unknown }
): Promise<IApiResult<{ id: string; base: string }>> {
  const access = await FriendPrograms_access(di, editorId, ownerId, "programEdits");
  if (!access.success) {
    return access;
  }
  const owner = await loadOwner(di, ownerId);
  if (!owner.success) {
    return owner;
  }
  const storage = owner.data.storage;
  const existing = (storage.programs || []).find((p) => p.id === programId);
  const check = FriendProgramUpdate_check({
    ownerId,
    programId,
    base: FriendProgramBase_decode(args.base),
    existing,
    versions: storage._versions,
    text: args.text,
    settings: storage.settings,
  });
  if (!check.ok) {
    return { success: false, error: check.error };
  }
  const updated = check.program;
  const userDao = new UserDao(di);
  const now = Date.now();
  const stored = await userDao.applyStorageUpdateIfUnchanged(
    owner.data,
    (old) => ({ ...old, programs: (old.programs || []).map((p) => (p.id === programId ? updated : p)) }),
    VersionTrackerUtils_SERVER_DEVICE_ID,
    () => [
      userDao.saveProgram(ownerId, updated),
      userDao
        .saveProgramRevision(ownerId, updated, { editorId, before: existing?.planner })
        .then((revision) =>
          new ProgramEditDao(di).put(
            ProgramEditDao_build({
              ownerId,
              programId,
              programName: updated.name,
              editorId,
              revision: revision ?? "",
              now,
            })
          )
        )
        .catch((e) => di.log.log("Friend program edit: failed to record the revision", e)),
    ]
  );
  if (!stored) {
    return err(409, "conflict", "The program changed since you read it. Read it again and redo the edit.");
  }
  return { success: true, data: { id: programId, base: baseFor(owner.data, updated) } };
}

export async function FriendPrograms_listEdits(di: IDI, ownerId: string): Promise<IProgramEditsResponse> {
  const rows = await new ProgramEditDao(di).listForOwner(ownerId, 200);
  const nicknames = await new UserDao(di).getNicknamesByIds(Array.from(new Set(rows.map((r) => r.editorId))));
  const byProgram = new Map<string, IProgramEditSummary>();
  for (const row of rows) {
    const summary = byProgram.get(row.programId);
    if (summary == null) {
      byProgram.set(row.programId, {
        programId: row.programId,
        programName: row.programName,
        unseen: row.seen ? 0 : 1,
        latest: { editorId: row.editorId, nickname: nicknames[row.editorId], createdAt: row.createdAt },
      });
    } else if (!row.seen) {
      summary.unseen += 1;
    }
  }
  const programs = Array.from(byProgram.values());
  return { accountId: ownerId, unseenCount: programs.reduce((sum, p) => sum + p.unseen, 0), programs };
}

export async function FriendPrograms_listEditsFor(
  di: IDI,
  ownerId: string,
  programId: string
): Promise<IProgramEditsForProgram> {
  const userDao = new UserDao(di);
  const rows = await new ProgramEditDao(di).listForProgram(ownerId, programId, 20);
  const [nicknames, revisions] = await Promise.all([
    userDao.getNicknamesByIds(Array.from(new Set(rows.map((r) => r.editorId)))),
    Promise.all(rows.map((r) => (r.revision ? userDao.getProgramRevision(ownerId, programId, r.revision) : undefined))),
  ]);
  const edits: IProgramEdit[] = rows.map((row, i) => {
    const revision = revisions[i];
    return {
      id: row.id,
      programId,
      editorId: row.editorId,
      nickname: nicknames[row.editorId],
      createdAt: row.createdAt,
      seen: row.seen,
      before: revision?.before != null ? PlannerProgram_generateFullText(revision.before.weeks) : undefined,
      after:
        revision?.program.planner != null ? PlannerProgram_generateFullText(revision.program.planner.weeks) : undefined,
    };
  });
  return { accountId: ownerId, programId, edits };
}

export async function FriendPrograms_markEditsSeen(di: IDI, ownerId: string, programId: unknown): Promise<void> {
  if (typeof programId !== "string") {
    return;
  }
  const dao = new ProgramEditDao(di);
  const unseen = (await dao.listForOwner(ownerId, 200)).filter((r) => !r.seen && r.programId === programId);
  await dao.markSeen(
    ownerId,
    unseen.map((r) => r.id)
  );
}
