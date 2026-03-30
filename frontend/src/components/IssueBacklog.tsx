import { ListTodo } from "lucide-react";
import { OpenIssue } from "../types/campaign";
import { EmptyState } from "./EmptyState";

interface IssueBacklogProps {
  issues: OpenIssue[];
  isLoading?: boolean;
}

export function IssueBacklog({ issues, isLoading }: IssueBacklogProps) {
  if (isLoading) {
    return (
      <section className="card">
        <div className="section-heading">
          <h2>Contribution backlog</h2>
          <p className="muted">Loading open issue ideas...</p>
        </div>
      </section>
    );
  }

  if (issues.length === 0) {
    return (
      <EmptyState
        variant="card"
        icon={ListTodo}
        title="Contribution backlog"
        message="No seeded issues are available right now."
      />
    );
  }

  return (
    <section className="card">
      <div className="section-heading">
        <h2>Contribution backlog</h2>
        <p className="muted">
          Ready-to-open issue ideas for your public repo after you push it.
        </p>
      </div>

      <div className="issue-list">
        {issues.map((issue) => (
          <article key={issue.id} className="issue-item">
            <div className="issue-topline">
              <strong>{issue.title}</strong>
              <span className="badge badge-neutral">{issue.points} pts</span>
            </div>
            <p>{issue.summary}</p>
            <div className="chip-row">
              {issue.labels.map((label) => (
                <span key={label} className="chip">
                  {label}
                </span>
              ))}
              <span className="chip-emphasis">{issue.complexity}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}