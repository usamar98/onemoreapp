import type { Project, Expense } from "./types";
export const timeWindows = {
  "30 minutes": 30,
  "2 hours": 120,
  "This weekend": 480,
} as const;
export function taskFor(project: Project) {
  return project.nextTask || project.memory?.nextTask || "";
}
export function suggestions(projects: Project[], minutes: number) {
  return projects
    .filter(
      (p) =>
        p.status !== "Archived" &&
        taskFor(p) &&
        p.taskMinutes != null &&
        p.taskMinutes > 0 &&
        p.taskMinutes <= minutes &&
        !p.blockers?.trim(),
    )
    .sort(
      (a, b) =>
        ({ High: 0, Normal: 1, Low: 2 })[a.taskPriority || "Normal"] -
          { High: 0, Normal: 1, Low: 2 }[b.taskPriority || "Normal"] ||
        a.priority - b.priority,
    )
    .map((p) => ({
      project: p,
      reason: `Your estimate is ${p.taskMinutes} minutes, within ${minutes} minutes. ${p.taskPriority || "Normal"} priority; no blocker recorded.${p.memory?.returnDate ? ` Intended return: ${p.memory.returnDate}.` : ""}`,
    }));
}
export function costTotals(expenses: Expense[], parkedOnly = false) {
  const totals: Record<string, number> = {};
  for (const expense of expenses.filter(
    (e) => !parkedOnly || e.continuesWhenParked,
  ))
    totals[expense.currency] =
      (totals[expense.currency] || 0) +
      expense.amount / (expense.interval === "Yearly" ? 12 : 1);
  return totals;
}
