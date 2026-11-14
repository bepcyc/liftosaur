import { ObjectUtils_keys } from "../utils/object";

export interface IFollowPermissions {
  notes: boolean;
  programs: boolean;
  programEdits: boolean;
}

export interface IFollowPerson {
  userId: string;
  nickname?: string;
  lastWorkoutAt?: number;
}

export interface IFollower extends IFollowPerson {
  permissions: IFollowPermissions;
}

export interface IFollowing extends IFollowPerson {
  permissions: IFollowPermissions;
}

export interface IApiFriend {
  userId: string;
  nickname?: string;
  canSeeNotes: boolean;
  canSeePrograms: boolean;
  canEditPrograms: boolean;
}

export interface IFollowRequest {
  requestId: string;
  nickname?: string;
  createdAt: number;
}

export interface IFollowsResponse {
  accountId: string;
  following: IFollowing[];
  followers: IFollower[];
  incoming: IFollowRequest[];
  outgoing: IFollowRequest[];
}

export const Follow_defaultPermissions: IFollowPermissions = { notes: false, programs: false, programEdits: false };

export const Follow_maxFollows = 100;

export function Follow_displayName(nickname: string | undefined): string {
  return nickname?.trim() || "A friend";
}

export const Follow_maxNicknameLength = 30;

export function Follow_nicknameError(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return "Pick a nickname";
  }
  if (trimmed.length > Follow_maxNicknameLength) {
    return `Use up to ${Follow_maxNicknameLength} characters`;
  }
  return undefined;
}

export function Follow_normalizePermissions(permissions: IFollowPermissions): IFollowPermissions {
  return { ...permissions, programs: permissions.programs || permissions.programEdits };
}

export function Follow_accessSummary(permissions: IFollowPermissions): string {
  const seen = ["workouts", permissions.notes ? "notes" : undefined, permissions.programs ? "programs" : undefined];
  const list = seen.filter((s): s is string => s != null);
  const sees = `Sees ${list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0]}`;
  return permissions.programEdits ? `${sees}, edits programs` : sees;
}

export function Follow_setPermission(
  permissions: IFollowPermissions,
  key: keyof IFollowPermissions,
  value: boolean
): IFollowPermissions {
  const next = { ...permissions, [key]: value };
  if (key === "programs" && !value) {
    next.programEdits = false;
  }
  return Follow_normalizePermissions(next);
}

export function Follow_parsePermissionsPatch(value: unknown): Partial<IFollowPermissions> | undefined {
  if (value == null || typeof value !== "object") {
    return undefined;
  }
  const record: Record<string, unknown> = { ...value };
  const patch: Partial<IFollowPermissions> = {};
  for (const key of ObjectUtils_keys(Follow_defaultPermissions)) {
    const flag = record[key];
    if (typeof flag === "boolean") {
      patch[key] = flag;
    } else if (flag !== undefined) {
      return undefined;
    }
  }
  return ObjectUtils_keys(patch).length > 0 ? patch : undefined;
}

export function Follow_applyPermissionsPatch(
  current: IFollowPermissions,
  patch: Partial<IFollowPermissions>
): IFollowPermissions {
  const next = { ...current, ...patch };
  if (patch.programs === false && patch.programEdits === undefined) {
    next.programEdits = false;
  }
  return Follow_normalizePermissions(next);
}

export function Follow_parsePermissions(value: unknown): IFollowPermissions | undefined {
  if (value == null || typeof value !== "object") {
    return undefined;
  }
  const { notes, programs, programEdits } = value as Record<string, unknown>;
  if (typeof notes !== "boolean") {
    return undefined;
  }
  return Follow_normalizePermissions({ notes, programs: programs === true, programEdits: programEdits === true });
}
