import { randomUUID } from "node:crypto";
import { db } from "./database";
import { accessibleRows, projectAccess } from "./access";
export const notificationKinds = [
  "assignment",
  "return",
  "deployment",
  "enquiry",
  "blocker",
  "integration",
] as const;
export type NotificationKind = (typeof notificationKinds)[number];
export async function preferences(user: string) {
  const row = await db()
    .prepare("SELECT data FROM notification_preferences WHERE user_id=?")
    .get(user);
  return {
    assignment: true,
    return: true,
    deployment: true,
    enquiry: true,
    blocker: true,
    integration: true,
    ...(row ? JSON.parse(String(row.data)) : {}),
  } as Record<NotificationKind, boolean>;
}
export async function notify(
  user: string,
  projectId: string,
  kind: NotificationKind,
  text: string,
  eventId: string = randomUUID(),
) {
  try {
    await projectAccess(projectId, user);
  } catch {
    return;
  }
  if (!(await preferences(user))[kind]) return;
  await db()
    .prepare(
      "INSERT INTO notifications VALUES(?,?,?,?,?,?,null) ON CONFLICT(id) DO NOTHING",
    )
    .run(
      `${eventId}:${user}`,
      user,
      projectId,
      kind,
      text,
      new Date().toISOString(),
    );
}
export async function notifyOwners(
  owner: string,
  projectId: string,
  kind: NotificationKind,
  text: string,
  eventId: string,
) {
  const ids = [
    owner,
    ...(
      await db()
        .prepare("SELECT user_id FROM members WHERE workspace_id=? AND role=?")
        .all(owner, "Owner")
    ).map((r) => String(r.user_id)),
  ];
  for (const id of ids) await notify(id, projectId, kind, text, eventId);
}
export async function notificationList(user: string) {
  const ids = new Set(
    (await accessibleRows(user)).map((r) => JSON.parse(String(r.data)).id),
  );
  return (
    await db()
      .prepare(
        "SELECT * FROM notifications WHERE user_id=? ORDER BY at DESC LIMIT 100",
      )
      .all(user)
  ).filter((r) => ids.has(r.project_id));
}
export async function returnNotifications(actor?: string) {
  const rows = actor
    ? await accessibleRows(actor)
    : await db().prepare("SELECT owner,data FROM projects").all();
  const today = new Date().toISOString().slice(0, 10);
  for (const row of rows) {
    const p = JSON.parse(String(row.data));
    if (
      p.status !== "Parked" ||
      !p.memory?.returnDate ||
      p.memory.returnDate > today
    )
      continue;
    const recipients = actor
      ? [actor]
      : [
          String(row.owner),
          ...(
            await db()
              .prepare(
                "SELECT user_id FROM members WHERE workspace_id=? AND role<>?",
              )
              .all(row.owner, "Viewer")
          ).map((r) => String(r.user_id)),
        ];
    for (const user of recipients)
      await notify(
        user,
        p.id,
        "return",
        `${p.name} is ready for its planned return on ${p.memory.returnDate}.`,
        `return:${p.id}:${p.memory.returnDate}`,
      );
  }
}
