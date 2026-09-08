export type OperationalStatusCounts = { new: number; followUp: number; approved: number; disqualified: number };

export function countOperationalWorkStatuses(workStatuses: readonly (string | null | undefined)[]): OperationalStatusCounts {
  const counts = { new: 0, followUp: 0, approved: 0, disqualified: 0 };
  for (const status of workStatuses) {
    if (status === "new") counts.new += 1;
    else if (["follow_up", "contacted", "appointment_scheduled", "in_progress"].includes(status ?? "")) counts.followUp += 1;
    else if (status === "converted") counts.approved += 1;
    else if (status === "not_converted") counts.disqualified += 1;
  }
  return counts;
}
