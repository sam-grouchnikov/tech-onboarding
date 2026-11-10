import { ObjectId } from "mongodb";
import { collections, type Assignment } from "./db.js";

export type AssignResult =
  | { kind: "assigned"; assignment: Assignment }
  | { kind: "judge-busy" } // the judge already holds a QUEUED assignment
  | { kind: "none-available" }; // no project is eligible for this judge right now

let assignmentQueue: Promise<unknown> = Promise.resolve();

export async function assignNext(judgeId: string): Promise<AssignResult> {
  // The API runs in one process. Keep selection and insertion together across requests.
  const result = assignmentQueue.then(() => assignAvailableProject(judgeId));
  assignmentQueue = result.catch(() => undefined);
  return result;
}

async function assignAvailableProject(judgeId: string): Promise<AssignResult> {
  const { assignments, projects } = collections();
  const unavailableProjects = new Set<string>();
  const completedCounts = new Map<string, number>();

  for (const { judgeId: assignedJudge, projectId, status } of await assignments.find().toArray()) {
    if (status === "QUEUED" && assignedJudge === judgeId) return { kind: "judge-busy" };
    if (status === "QUEUED" || assignedJudge === judgeId) unavailableProjects.add(projectId);
    if (status === "COMPLETED") {
      completedCounts.set(projectId, (completedCounts.get(projectId) ?? 0) + 1);
    }
  }

  let fewestCompleted = Infinity;
  const candidates: string[] = [];
  for (const { _id: projectId } of await projects.find().toArray()) {
    if (unavailableProjects.has(projectId)) continue;

    const completed = completedCounts.get(projectId) ?? 0;
    if (completed < fewestCompleted) {
      fewestCompleted = completed;
      candidates.length = 0;
    }
    if (completed === fewestCompleted) candidates.push(projectId);
  }

  if (candidates.length === 0) return { kind: "none-available" };

  const assignment: Assignment = {
    _id: new ObjectId(),
    judgeId,
    projectId: candidates[Math.floor(Math.random() * candidates.length)],
    status: "QUEUED",
    createdAt: new Date(),
  };
  await assignments.insertOne(assignment);
  return { kind: "assigned", assignment };
}
