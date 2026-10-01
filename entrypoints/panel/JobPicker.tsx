import { useEffect, useState } from 'react';
import type { Project } from '@/lib/api/auto-agent-client';
import type { JobMatch } from '@/lib/api/job-matcher';
import { sendToBackground } from '@/lib/background-client';

const SERVICE_LABELS: Record<string, string> = {
  FRONTEND_DEMO: 'Frontend demo',
  FRONTEND_DEMO_NEXT_PHASE: 'Frontend demo, next phase',
  MOBILE_DEMO: 'Mobile demo',
  MOBILE_DEMO_NEXT_PHASE: 'Mobile demo, next phase',
};

function jobLabel(job: JobMatch): string {
  const date = job.completedAt ? new Date(job.completedAt).toLocaleDateString() : '';
  return [job.jobName, SERVICE_LABELS[job.serviceType] ?? job.serviceType, date].filter(Boolean).join(' · ');
}

type Props = {
  note: string;
  error: string | null;
  onChoose: (match: JobMatch) => void;
  /** Absent when there is no demo to go back to. */
  onCancel?: () => void;
};

/** Project → demo, for a page whose site does not match any demo the reviewer can see. */
export function JobPicker({ note, error, onChoose, onCancel }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [jobs, setJobs] = useState<JobMatch[] | null>(null);
  const [jobId, setJobId] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void sendToBackground({ type: 'list-projects' }).then((result) => {
      if (result.ok) setProjects(result.value);
      else setLoadError(result.error);
    });
  }, []);

  useEffect(() => {
    setJobs(null);
    setJobId('');
    const project = projects?.find((candidate) => candidate.id === projectId);
    if (!project) return;
    let active = true;
    void sendToBackground({ type: 'list-demo-jobs', project }).then((result) => {
      if (!active) return;
      if (result.ok) {
        setJobs(result.value);
        setJobId(result.value[0]?.jobId ?? '');
      } else {
        setLoadError(result.error);
      }
    });
    return () => {
      active = false;
    };
  }, [projectId, projects]);

  const job = jobs?.find((candidate) => candidate.jobId === jobId);

  return (
    <form
      className="picker"
      aria-label="Choose demo"
      onSubmit={(event) => {
        event.preventDefault();
        if (job) onChoose(job);
      }}
    >
      <p>{note}</p>
      {error && <p className="error">{error}</p>}
      <label>
        Project
        <select value={projectId} disabled={!projects} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">{projects ? 'Choose a project' : 'Loading…'}</option>
          {projects?.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Demo
        <select value={jobId} disabled={!jobs || jobs.length === 0} onChange={(event) => setJobId(event.target.value)}>
          {!jobs && <option value="">{projectId ? 'Loading…' : 'Choose a project first'}</option>}
          {jobs?.length === 0 && <option value="">No finished demos in this project</option>}
          {jobs?.map((candidate) => (
            <option key={candidate.jobId} value={candidate.jobId}>
              {jobLabel(candidate)}
            </option>
          ))}
        </select>
      </label>
      {loadError && <p className="error">{loadError}</p>}
      <div className="row__actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="primary" disabled={!job}>
          Use this demo
        </button>
      </div>
    </form>
  );
}
