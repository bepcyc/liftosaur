import type { JSX } from "react";
import {
  FriendsWeb_listUrl,
  FriendsWeb_presentation,
  FriendsWeb_programsUrl,
  FriendsWeb_workoutsUrl,
  IFriendsPageData,
  IFriendsWebRow,
} from "../../models/friendsWeb";
import { FriendProgram_editorUrl, IFriendProgramSummary } from "../../models/friendProgram";
import { RelativeTime_ago } from "../../utils/relativeTime";
import { FriendWorkoutsContent } from "./friendWorkoutsContent";

export type IFriendsContentProps = IFriendsPageData & { client: Window["fetch"] };

function FriendsList(props: { friends: IFriendsWebRow[]; now: number }): JSX.Element {
  if (props.friends.length === 0) {
    return (
      <p className="text-text-secondary" data-testid="friends-web-empty">
        You don't follow anyone yet. Invite a friend from the Friends screen in the Liftosaur app.
      </p>
    );
  }
  return (
    <ul>
      {props.friends.map((friend) => (
        <li key={friend.userId} className="flex flex-wrap items-center gap-4 mb-6" data-testid="friends-web-row">
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold">{friend.name}</div>
            {friend.lastWorkoutAt != null && (
              <div className="text-sm text-text-secondary">
                Trained {RelativeTime_ago(friend.lastWorkoutAt, props.now)}
              </div>
            )}
          </div>
          <a className="underline text-text-link" href={FriendsWeb_workoutsUrl(friend.userId)}>
            Workouts
          </a>
          {friend.canEditPrograms && (
            <a
              className="underline text-text-link"
              href={FriendsWeb_programsUrl(friend.userId)}
              data-testid="friends-web-programs"
            >
              Programs
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function FriendPrograms(props: { ownerId: string; programs: IFriendProgramSummary[] }): JSX.Element {
  if (props.programs.length === 0) {
    return <p className="text-text-secondary">No programs yet.</p>;
  }
  return (
    <ul>
      {props.programs.map((program) => (
        <li key={program.id} className="flex flex-wrap items-center gap-3 mb-6" data-testid="friends-web-program">
          <span className="text-lg font-bold">{program.name}</span>
          {program.isCurrent && (
            <span className="px-2 py-0.5 text-xs font-semibold rounded-md bg-background-purpledark text-text-purple">
              Current
            </span>
          )}
          <a className="underline text-text-link" href={FriendProgram_editorUrl("", props.ownerId, program.id)}>
            Edit
          </a>
        </li>
      ))}
    </ul>
  );
}

export function FriendsContent(props: IFriendsContentProps): JSX.Element {
  const { heading } = FriendsWeb_presentation(props);
  return (
    <div className="px-4">
      {props.kind !== "list" && (
        <a className="text-sm underline text-text-link" href={FriendsWeb_listUrl()}>
          All friends
        </a>
      )}
      <h1 className="mt-2 mb-6 text-2xl font-bold">{heading}</h1>
      {props.kind === "list" && <FriendsList friends={props.friends} now={props.now} />}
      {props.kind === "programs" && <FriendPrograms ownerId={props.ownerId} programs={props.programs} />}
      {props.kind === "workouts" && <FriendWorkoutsContent {...props} />}
    </div>
  );
}
