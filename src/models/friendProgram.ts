import { IExportedProgram } from "./program";
import { ISettings } from "../types";

export function FriendProgram_editorUrl(host: string, ownerId: string, programId: string): string {
  return `${host}/planner/friend/${encodeURIComponent(ownerId)}/${encodeURIComponent(programId)}`;
}

export function FriendProgram_previewSettings(viewer: ISettings, owner: ISettings): ISettings {
  return {
    ...viewer,
    units: owner.units,
    planner: owner.planner,
    timers: owner.timers,
    muscleGroups: owner.muscleGroups,
    exercises: { ...viewer.exercises, ...owner.exercises },
    exerciseData: owner.exerciseData,
  };
}

export interface IFriendProgramSummary {
  id: string;
  name: string;
  isCurrent: boolean;
}

export interface IFriendProgramContext {
  ownerId: string;
  exported: IExportedProgram;
  settings: ISettings;
  base: string;
  canEdit: boolean;
}

export interface IProgramEditSummary {
  programId: string;
  programName: string;
  unseen: number;
  latest: { editorId: string; nickname?: string; createdAt: number };
}

export interface IProgramEditsResponse {
  accountId: string;
  unseenCount: number;
  programs: IProgramEditSummary[];
}

export interface IProgramEdit {
  id: string;
  programId: string;
  editorId: string;
  nickname?: string;
  createdAt: number;
  seen: boolean;
  before?: string;
  after?: string;
}

export interface IProgramEditsForProgram {
  accountId: string;
  programId: string;
  edits: IProgramEdit[];
}
